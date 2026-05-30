'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Passation } from '@/lib/types';
import Link from 'next/link';
import * as XLSX from 'xlsx';

// ── helpers ────────────────────────────────────────────────────────────────────

function isExcluded(cat: Category) {
  // Soccer and MakeX Starter use different ranking systems
  return /soccer/i.test(cat.name) || /makex\s*starter/i.test(cat.name);
}

interface BestResult {
  score: number;
  time: number | null;
  round: number;
}

/** Pick the round with the highest score; on tie, lowest time wins. */
function getBest(rounds: Passation[]): BestResult {
  const finished = rounds.filter(r => r.live_status === 'Finished' && r.score != null);
  if (finished.length === 0) return { score: 0, time: null, round: 0 };
  let best = finished[0];
  for (const r of finished.slice(1)) {
    const rs = r.score ?? 0;
    const bs = best.score ?? 0;
    if (rs > bs) {
      best = r;
    } else if (rs === bs) {
      const rt = r.time_seconds;
      const bt = best.time_seconds;
      if (rt !== null && (bt === null || rt < bt)) best = r;
    }
  }
  return { score: best.score ?? 0, time: best.time_seconds, round: best.round_number ?? 1 };
}

interface RankedRow {
  rank: number;
  name: string;
  club: string;
  score: number;
  time: number | null;
  round: number;
  tied: boolean;
}

interface CatRanking {
  category: Category;
  rows: RankedRow[];
}

function fmtTime(s: number | null) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function RankingPage() {
  const supabase = useMemo(() => createClient(), []);
  const [rankings, setRankings] = useState<CatRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCatId, setFilterCatId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cats }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('passations').select('*').eq('live_status', 'Finished'),
    ]);
    if (!cats || !pas) { setLoading(false); return; }

    const allCats = cats as Category[];
    const allPas = pas as Passation[];

    const result: CatRanking[] = [];

    for (const cat of allCats) {
      if (isExcluded(cat)) continue;

      const catPas = allPas.filter(p => p.category_id === cat.id);
      if (catPas.length === 0) continue;

      // Group by student identity: team_name + club_name
      const studentMap = new Map<string, Passation[]>();
      for (const p of catPas) {
        const key = `${(p.team_name || '').trim().toLowerCase()}||${(p.club_name || '').trim().toLowerCase()}`;
        if (!studentMap.has(key)) studentMap.set(key, []);
        studentMap.get(key)!.push(p);
      }

      // Compute best result per student
      const students = Array.from(studentMap.values()).map(rounds => {
        const best = getBest(rounds);
        const rep = rounds[0];
        return {
          name: rep.student_names || rep.team_name || '—',
          club: rep.club_name || '—',
          score: best.score,
          time: best.time,
          round: best.round,
        };
      });

      // Sort: score DESC, time ASC (null → last)
      students.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.time === null && b.time === null) return 0;
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time - b.time;
      });

      // Assign ranks (tied if same score AND same time)
      const rows: RankedRow[] = students.map((s, i) => {
        const prev = i > 0 ? students[i - 1] : null;
        const tied = prev !== null && prev.score === s.score && prev.time === s.time;
        const rank = tied
          ? (rows[i - 1]?.rank ?? i + 1)
          : i + 1;
        return { rank, ...s, tied };
      });

      result.push({ category: cat, rows });
    }

    setRankings(result);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = filterCatId
    ? rankings.filter(r => r.category.id === filterCatId)
    : rankings;

  const exportExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    for (const { category: cat, rows } of filtered) {
      const catLabel = `${cat.name}${cat.age_range_label ? ` (${cat.age_range_label})` : ''}`;
      const sheetName = catLabel.replace(/[\\/*?[\]:]/g, '').slice(0, 31);

      const data: (string | number)[][] = [
        ['MakeX 2026 Lebanon — Rankings'],
        [catLabel],
        [],
        ['Rank', 'Participant Name', 'Academy / Club', 'Best Score', 'Best Time', 'Round'],
        ...rows.map(r => [
          r.rank,
          r.name,
          r.club,
          r.score,
          r.time != null ? `${r.time}s` : '—',
          `Round ${r.round}`,
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 6 }, { wch: 32 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 9 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MakeX2026_Rankings_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filtered]);

  const rankBg = (rank: number) => {
    if (rank === 1) return 'rgba(250,204,21,0.15)';
    if (rank === 2) return 'rgba(203,213,225,0.2)';
    if (rank === 3) return 'rgba(234,179,8,0.1)';
    return 'transparent';
  };
  const rankColor = (rank: number) => {
    if (rank === 1) return '#b45309';
    if (rank === 2) return '#475569';
    if (rank === 3) return '#92400e';
    return '#64748b';
  };
  const rankLabel = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm transition">← Home</Link>
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Rankings</h1>
            <p className="text-xs text-slate-400">Best score · best time — all finished students</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            value={filterCatId}
            onChange={e => setFilterCatId(e.target.value)}>
            <option value="">All Categories</option>
            {rankings.map(r => (
              <option key={r.category.id} value={r.category.id}>
                {r.category.name}{r.category.age_range_label ? ` (${r.category.age_range_label})` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={exportExcel}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Excel
          </button>
          <button onClick={load}
            className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl transition">
            Refresh
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mr-3" />
          <p className="text-slate-500">Loading rankings…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-32">
          <p className="text-slate-400 text-xl font-semibold">No results yet</p>
          <p className="text-slate-300 text-sm mt-2">Rankings appear once students are marked Finished</p>
        </div>
      )}

      {/* Rankings */}
      {!loading && (
        <div className="p-6 space-y-8">
          {filtered.map(({ category: cat, rows }) => (
            <div key={cat.id} className="bg-white rounded-2xl overflow-hidden shadow-md border border-slate-200">
              {/* Category header */}
              <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}
                className="px-8 py-5 flex items-center justify-between">
                <div>
                  <p className="text-white/40 text-xs font-bold uppercase tracking-widest mb-1">MakeX 2026 · Lebanon</p>
                  <h2 className="text-white font-black text-xl leading-tight">
                    {cat.name}
                    {cat.age_range_label && (
                      <span className="ml-3 text-blue-400 font-semibold text-sm">{cat.age_range_label}</span>
                    )}
                  </h2>
                </div>
                <span className="text-white/40 text-sm font-semibold">{rows.length} student{rows.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-16">Rank</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Participant Name</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Academy / Club</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Best Score</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Best Time</th>
                      <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Round</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: rankBg(row.rank) }}>
                        <td className="px-6 py-4">
                          <span className="font-black text-lg" style={{ color: rankColor(row.rank) }}>
                            {rankLabel(row.rank)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-800 text-base">{row.name}</p>
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-sm">{row.club}</td>
                        <td className="px-6 py-4">
                          <span className="font-black text-xl text-slate-800">{row.score}</span>
                          <span className="text-slate-400 text-xs ml-1">pts</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono font-bold text-slate-700">{fmtTime(row.time)}</span>
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-xs font-medium">
                          R{row.round}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
