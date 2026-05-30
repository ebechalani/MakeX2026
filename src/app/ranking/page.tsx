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
  const finished = rounds.filter(r => r.score != null);
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
      // Include any passation that has a score — covers manual edits by admin
      // regardless of live_status
      supabase.from('passations').select('*').not('score', 'is', null),
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

  const [exporting, setExporting] = useState(false);
  const [templating, setTemplating] = useState(false);

  const exportExcel = useCallback(async () => {
    setExporting(true);
    const [{ data: cats }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('passations').select('*').order('queue_position'),
    ]);
    setExporting(false);
    if (!cats || !pas) { alert('Failed to load data for export'); return; }

    const allCats = cats as Category[];
    const allPas = pas as Passation[];
    const wb = XLSX.utils.book_new();

    for (const cat of allCats) {
      if (isExcluded(cat)) continue;
      if (filterCatId && cat.id !== filterCatId) continue;

      const catPas = allPas.filter(p => p.category_id === cat.id);
      if (catPas.length === 0) continue;

      // Group rounds by student
      const studentMap = new Map<string, Passation[]>();
      for (const p of catPas) {
        const key = `${(p.team_name || '').trim().toLowerCase()}||${(p.club_name || '').trim().toLowerCase()}`;
        if (!studentMap.has(key)) studentMap.set(key, []);
        studentMap.get(key)!.push(p);
      }

      const students = Array.from(studentMap.values()).map(rounds => {
        const rep = rounds[0];
        const r1 = rounds.find(r => (r.round_number ?? 1) === 1);
        const r2 = rounds.find(r => r.round_number === 2);
        const scored = rounds.filter(r => r.score != null);
        const best = scored.length > 0 ? getBest(scored) : { score: 0, time: null };
        return {
          name: rep.student_names || rep.team_name || '—',
          club: rep.club_name || '—',
          r1score: r1?.score ?? null,
          r1time:  r1?.time_seconds ?? null,
          r2score: r2?.score ?? null,
          r2time:  r2?.time_seconds ?? null,
          bestScore: best.score,
          bestTime:  best.time,
        };
      });

      students.sort((a, b) => {
        if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
        if (a.bestTime === null) return 1;
        if (b.bestTime === null) return -1;
        return a.bestTime - b.bestTime;
      });

      const catLabel = `${cat.name}${cat.age_range_label ? ` (${cat.age_range_label})` : ''}`;
      const sheetName = catLabel.replace(/[\\/*?[\]:]/g, '').slice(0, 31);

      // Build all rows as a flat array (static values) — formulas added below
      // Row 1: title, Row 2: note, Row 3: blank, Row 4: headers, Row 5+: data
      const rows: (string | number | null)[][] = [
        [`MakeX 2026 Lebanon — ${catLabel}`, '', '', '', '', '', '', '', ''],
        ['Edit R1/R2 Score & Time — Best Score and Best Time recalculate automatically', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
        ['#', 'Participant Name', 'Club / Academy', 'R1 Score', 'R1 Time (s)', 'R2 Score', 'R2 Time (s)', 'Best Score', 'Best Time (s)'],
        ...students.map((s, i) => [
          i + 1,
          s.name,
          s.club,
          s.r1score ?? '',
          s.r1time  ?? '',
          s.r2score ?? '',
          s.r2time  ?? '',
          s.bestScore ?? 0,   // placeholder — overwritten with formula below
          s.bestTime  ?? 0,   // placeholder — overwritten with formula below
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Overwrite H and I columns with formula cells
      // Columns: D=R1Score  E=R1Time  F=R2Score  G=R2Time
      // Formulas always return a number (0 when no data)
      students.forEach((s, i) => {
        const r = 5 + i;

        // Best Score = MAX(R1,R2); if one round missing use the other; 0 if both missing
        ws[`H${r}`] = {
          t: 'n',
          v: s.bestScore ?? 0,
          f: `IF(AND(D${r}="",F${r}=""),0,IF(D${r}="",F${r},IF(F${r}="",D${r},MAX(D${r},F${r}))))`,
        };

        // Best Time = time from the round with best score; on tie take MIN; 0 if no time
        ws[`I${r}`] = {
          t: 'n',
          v: s.bestTime ?? 0,
          f: `IF(AND(D${r}="",F${r}=""),0,IF(F${r}="",E${r},IF(D${r}="",G${r},IF(D${r}>F${r},E${r},IF(F${r}>D${r},G${r},MIN(E${r},G${r}))))))`,
        };
      });

      ws['!cols'] = [
        { wch: 4 }, { wch: 30 }, { wch: 22 },
        { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
        { wch: 12 }, { wch: 13 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellFormula: true } as any);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MakeX2026_Rankings_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [supabase, filterCatId]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const downloadTemplate = useCallback(async () => {
    setTemplating(true);
    const [{ data: cats }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('passations').select('id,team_name,student_names,club_name,category_id,round_number,queue_position').order('queue_position'),
    ]);
    setTemplating(false);
    if (!cats || !pas) { alert('Failed to load data'); return; }

    const allCats = cats as Category[];
    const allPas = pas as Passation[];

    const wb = XLSX.utils.book_new();

    for (const cat of allCats) {
      if (isExcluded(cat)) continue;
      if (filterCatId && cat.id !== filterCatId) continue;

      const catPas = allPas.filter(p => p.category_id === cat.id);
      if (catPas.length === 0) continue;

      // Unique students (by team_name + club) — keep round_number for reference
      const seen = new Set<string>();
      const students: { name: string; club: string }[] = [];
      for (const p of catPas) {
        const key = `${(p.team_name || '').trim().toLowerCase()}||${(p.club_name || '').trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        students.push({
          name: p.student_names || p.team_name || '—',
          club: p.club_name || '—',
        });
      }

      const catLabel = `${cat.name}${cat.age_range_label ? ` (${cat.age_range_label})` : ''}`;
      const sheetName = catLabel.replace(/[\\/*?[\]:]/g, '').slice(0, 31);

      // Build header rows as plain array
      const headerRows = [
        [`MakeX 2026 Lebanon — ${catLabel}`],
        ['Fill in R1 Score, R1 Time, R2 Score, R2 Time. Best Score & Best Time are calculated automatically.'],
        [],
        ['#', 'Participant Name', 'Club / Academy', 'R1 Score', 'R1 Time (s)', 'R2 Score', 'R2 Time (s)', 'Best Score', 'Best Time (s)'],
      ];

      const ws = XLSX.utils.aoa_to_sheet(headerRows);

      // Add student rows with Excel formulas starting at row 5 (index 4, 1-based = row 5)
      students.forEach((s, i) => {
        const row = 5 + i; // 1-based Excel row
        const r = row.toString();

        // A: index
        ws[`A${r}`] = { t: 'n', v: i + 1 };
        // B: name
        ws[`B${r}`] = { t: 's', v: s.name };
        // C: club
        ws[`C${r}`] = { t: 's', v: s.club };
        // D: R1 Score (empty, to be filled)
        ws[`D${r}`] = { t: 'z', v: undefined };
        // E: R1 Time (empty)
        ws[`E${r}`] = { t: 'z', v: undefined };
        // F: R2 Score (empty)
        ws[`F${r}`] = { t: 'z', v: undefined };
        // G: R2 Time (empty)
        ws[`G${r}`] = { t: 'z', v: undefined };

        // H: Best Score formula
        // → IF both empty → "", IF only R1 → R1, IF only R2 → R2, ELSE MAX
        ws[`H${r}`] = { t: 'n', f: `IF(AND(D${r}="",F${r}=""),"",IF(D${r}="",F${r},IF(F${r}="",D${r},MAX(D${r},F${r}))))` };

        // I: Best Time formula
        // → IF both empty → ""
        // → IF only R1 → E (R1 time)
        // → IF only R2 → G (R2 time)
        // → IF R1 score > R2 score → E (R1 time)
        // → IF R2 score > R1 score → G (R2 time)
        // → Tie in score → MIN(E,G)
        ws[`I${r}`] = { t: 'n', f: `IF(AND(D${r}="",F${r}=""),"",IF(D${r}="",G${r},IF(F${r}="",E${r},IF(D${r}>F${r},E${r},IF(F${r}>D${r},G${r},MIN(E${r},G${r}))))))` };
      });

      // Set worksheet range
      const lastRow = 4 + students.length;
      ws['!ref'] = `A1:I${lastRow}`;

      ws['!cols'] = [
        { wch: 4 },   // #
        { wch: 30 },  // Name
        { wch: 22 },  // Club
        { wch: 10 },  // R1 Score
        { wch: 12 },  // R1 Time
        { wch: 10 },  // R2 Score
        { wch: 12 },  // R2 Time
        { wch: 12 },  // Best Score
        { wch: 13 },  // Best Time
      ];

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellFormula: true } as any);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MakeX2026_ScoreTemplate_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [supabase, filterCatId]);

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
            disabled={exporting}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition">
            {exporting
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
            }
            {exporting ? 'Fetching…' : 'Export Excel'}
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
