'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import { SHEETS, type Sheet } from '@/lib/scoresheets';
import type { Category, Table, Passation } from '@/lib/types';

// ── School / Club classification ─────────────────────────────────────────────
const SCHOOL_NAMES = new Set([
  'Carmelites', 'CCJ', 'CND Steam Club', 'Coducators',
  'College Maristes Notre Dame de Lourdes', 'Ecole De La Mission éDucative',
  'Ecole des Soeurs de la Croix - Hrajel', 'Ecole Saint Elie - SFM Zahle',
  'ESJ Capucins Batroun', 'Futurebot Academy', 'IC Ain Aar', 'IDEA',
  'IDEA Centre Saint Michel', 'Ingenious Coding And Robotics Academy',
  'Kincobot', 'Lycée Charlemagne', 'Lycée Montaigne', 'Mindscape Academy',
  'Mont La Salle', 'Robateks Academy', 'RoboHolic',
  'Sainte Famille Francaise Jounieh', 'SJS Robotics Club', 'SSCC Kfardebian',
]);

function orgType(clubName: string | null): 'School' | 'Club' {
  return SCHOOL_NAMES.has(clubName ?? '') ? 'School' : 'Club';
}

// ── Score breakdown helpers ───────────────────────────────────────────────────
const BREAKDOWN_RE = /\[score-breakdown:\s*(\{[\s\S]*?\})\]/;
type Breakdown = { sheet: string; void: boolean; vals: Record<string, number>; counts: Record<string, number> };

function parseBreakdown(notes: string | null | undefined): Breakdown | null {
  if (!notes) return null;
  const m = notes.match(BREAKDOWN_RE);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
function stripBreakdown(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const cleaned = notes.replace(BREAKDOWN_RE, '').trim();
  return cleaned || null;
}

// ── Ranking helpers ───────────────────────────────────────────────────────────
type RoundResult = { score: number | null; time: number | null; status: string };

function roundResult(p: Passation | undefined): RoundResult {
  if (!p) return { score: null, time: null, status: '—' };
  if (p.live_status === 'Absent') return { score: null, time: null, status: 'Absent' };
  if (p.final_result_status === 'Void') return { score: null, time: null, status: 'Void' };
  return { score: p.score ?? null, time: p.time_seconds ?? null, status: p.final_result_status || p.live_status || '—' };
}

// Compare two round results: higher score wins; equal score → lower time wins; null score = worst
function betterResult(a: RoundResult, b: RoundResult): RoundResult {
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sa > sb ? a : b;
  // Tie on score — lower time is better (null time = worst)
  if (a.time == null && b.time == null) return a;
  if (a.time == null) return b;
  if (b.time == null) return a;
  return a.time <= b.time ? a : b;
}

// Compare two results for sorting: descending score, ascending time
function compareResults(a: RoundResult, b: RoundResult): number {
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;              // higher score first
  if (a.time == null && b.time == null) return 0;
  if (a.time == null) return 1;              // no time → last
  if (b.time == null) return -1;
  return a.time - b.time;                    // lower time first
}

type RankedStudent = {
  key: string;
  teamName: string;
  clubName: string;
  type: 'School' | 'Club';
  r1: RoundResult;
  r2: RoundResult;
  best: RoundResult;
  overallRank: number;
  schoolRank: number | null;
  clubRank: number | null;
};

function buildRankings(r1rows: Passation[], r2rows: Passation[]): RankedStudent[] {
  // Deduplicate by (team_name, club_name) — keep R1 and R2 per student
  const r1map = new Map<string, Passation>();
  const r2map = new Map<string, Passation>();
  const key = (p: Passation) => `${p.team_name}|${p.club_name}`.toLowerCase();
  for (const p of r1rows) r1map.set(key(p), p);
  for (const p of r2rows) r2map.set(key(p), p);

  const allKeys = new Set([...r1map.keys(), ...r2map.keys()]);
  const students: Omit<RankedStudent, 'overallRank' | 'schoolRank' | 'clubRank'>[] = [];

  for (const k of allKeys) {
    const r1p = r1map.get(k);
    const r2p = r2map.get(k);
    const ref = r1p || r2p!;
    const r1res = roundResult(r1p);
    const r2res = roundResult(r2p);
    const best = betterResult(r1res, r2res);
    students.push({
      key: k,
      teamName: ref.team_name,
      clubName: ref.club_name || '',
      type: orgType(ref.club_name),
      r1: r1res,
      r2: r2res,
      best,
    });
  }

  // Sort overall by best result
  students.sort((a, b) => compareResults(a.best, b.best));

  // Assign overall, school, club ranks
  let overallRank = 0, schoolRank = 0, clubRank = 0;
  return students.map(s => {
    overallRank++;
    const sr = s.type === 'School' ? ++schoolRank : null;
    const cr = s.type === 'Club' ? ++clubRank : null;
    return { ...s, overallRank, schoolRank: sr, clubRank: cr };
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ResultsTab() {
  const supabase = useMemo(() => createClient(), []);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [view, setView] = useState<'raw' | 'rankings'>('rankings');
  const [filterCat, setFilterCat] = useState<string>('');
  const [filterRound, setFilterRound] = useState<'all' | '1' | '2'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'finalized' | 'void' | 'absent' | 'scheduled'>('all');
  const [rankType, setRankType] = useState<'all' | 'school' | 'club'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, c, t] = await Promise.all([
      supabase.from('passations').select('*').order('scheduled_time').order('queue_position'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('tables').select('*').order('table_number'),
    ]);
    if (p.data) setPassations(p.data as Passation[]);
    if (c.data) setCategories(c.data as Category[]);
    if (t.data) setTables(t.data as Table[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('admin-results')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, supabase]);

  // ── Rankings per category ─────────────────────────────────────────────────
  const rankingsByCat = useMemo(() => {
    const map = new Map<string, RankedStudent[]>();
    for (const cat of categories) {
      const r1 = passations.filter(p => p.category_id === cat.id && (p.round_number ?? 1) === 1);
      const r2 = passations.filter(p => p.category_id === cat.id && p.round_number === 2);
      map.set(cat.id, buildRankings(r1, r2));
    }
    return map;
  }, [passations, categories]);

  // ── Filtered raw view ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return passations.filter(p => {
      if (filterCat && p.category_id !== filterCat) return false;
      if (filterRound !== 'all' && String(p.round_number ?? 1) !== filterRound) return false;
      if (filterStatus === 'finalized' && p.final_result_status !== 'Finished') return false;
      if (filterStatus === 'void' && p.final_result_status !== 'Void') return false;
      if (filterStatus === 'absent' && p.live_status !== 'Absent') return false;
      if (filterStatus === 'scheduled' && p.live_status !== 'Scheduled') return false;
      return true;
    });
  }, [passations, filterCat, filterRound, filterStatus]);

  const stats = useMemo(() => {
    const r1 = passations.filter(p => (p.round_number ?? 1) === 1);
    const fin = r1.filter(p => p.final_result_status === 'Finished').length;
    const vd  = r1.filter(p => p.final_result_status === 'Void').length;
    const abs = r1.filter(p => p.live_status === 'Absent').length;
    const sched = r1.filter(p => p.live_status === 'Scheduled' && !p.finalized_at).length;
    return { fin, vd, abs, sched };
  }, [passations]);

  function catLabel(id: string) {
    const c = categories.find(c => c.id === id);
    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : '—';
  }
  function tableLabel(id: string) {
    const t = tables.find(t => t.id === id);
    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
  }
  function fmtTime(s: string | null) {
    return s ? new Date(s).toLocaleString() : '—';
  }
  function sheetForBreakdown(b: Breakdown | null): Sheet | undefined {
    if (!b) return undefined;
    return SHEETS.find(s => s.key === b.sheet);
  }

  // ── Excel export ──────────────────────────────────────────────────────────
  function downloadXlsxReport() {
    const wb2 = XLSX.utils.book_new();
    const usedNames = new Set<string>();

    function uniqueName(raw: string): string {
      let name = raw.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
      let n = 2;
      while (usedNames.has(name)) { name = (raw.slice(0, 28) + '_' + n).slice(0, 31); n++; }
      usedNames.add(name);
      return name;
    }

    // ── Summary sheet ─────────────────────────────────────────────────────
    const summaryRows: (string | number)[][] = [
      ['Category', 'Total Students', 'Finalized', 'Void', 'Absent', 'Pending'],
    ];
    for (const cat of categories) {
      const r1 = passations.filter(p => p.category_id === cat.id && (p.round_number ?? 1) === 1);
      summaryRows.push([
        cat.name + (cat.age_range_label ? ` (${cat.age_range_label})` : ''),
        r1.length,
        r1.filter(p => p.final_result_status === 'Finished').length,
        r1.filter(p => p.final_result_status === 'Void').length,
        r1.filter(p => p.live_status === 'Absent').length,
        r1.filter(p => p.live_status === 'Scheduled' && !p.finalized_at).length,
      ]);
    }
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    summaryWs['!cols'] = [{ wch: 36 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb2, summaryWs, 'Summary');

    // ── Ranking sheet per category ────────────────────────────────────────
    for (const cat of categories) {
      const rankings = rankingsByCat.get(cat.id) || [];
      if (rankings.length === 0) continue;

      const header = [
        'Overall Rank', 'School Rank', 'Club Rank', 'Type',
        'Student', 'Club / Academy',
        'R1 Points', 'R1 Time (s)', 'R1 Status',
        'R2 Points', 'R2 Time (s)', 'R2 Status',
        'Best Points', 'Best Time (s)',
      ];
      const rows: (string | number | null)[][] = [header];

      for (const s of rankings) {
        const showRow = rankType === 'all'
          || (rankType === 'school' && s.type === 'School')
          || (rankType === 'club' && s.type === 'Club');
        if (!showRow) continue;

        rows.push([
          s.overallRank,
          s.schoolRank ?? '—',
          s.clubRank ?? '—',
          s.type,
          s.teamName,
          s.clubName,
          s.r1.score ?? '—',
          s.r1.time ?? '—',
          s.r1.status,
          s.r2.score ?? '—',
          s.r2.time ?? '—',
          s.r2.status,
          s.best.score ?? '—',
          s.best.time ?? '—',
        ]);
      }

      const catShortName = cat.name.replace(/Sportswonderland/i, 'SW').replace(/Capelli/i, 'Cap').replace(/MakeX/i, 'MX');
      const rankWs = XLSX.utils.aoa_to_sheet(rows);
      rankWs['!cols'] = [
        { wch: 12 }, { wch: 11 }, { wch: 10 }, { wch: 7 },
        { wch: 26 }, { wch: 26 },
        { wch: 9 }, { wch: 10 }, { wch: 12 },
        { wch: 9 }, { wch: 10 }, { wch: 12 },
        { wch: 11 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb2, rankWs, uniqueName(`Rank ${catShortName}${cat.age_range_label ? ' ' + cat.age_range_label.replace(/[^0-9–-]/g, '') : ''}`));
    }

    // ── Raw results per table ─────────────────────────────────────────────
    const groups = new Map<string, Passation[]>();
    for (const p of passations) {
      if (!p.table_id) continue;
      const k = `${p.category_id}__${p.table_id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    const sortedGroups = Array.from(groups.entries()).sort(([ka], [kb]) => {
      const ca = categories.find(c => c.id === ka.split('__')[0]);
      const cb = categories.find(c => c.id === kb.split('__')[0]);
      const cn = (ca?.name || '').localeCompare(cb?.name || '');
      if (cn !== 0) return cn;
      const ta = tables.find(t => t.id === ka.split('__')[1]);
      const tb = tables.find(t => t.id === kb.split('__')[1]);
      return (ta?.table_number ?? 0) - (tb?.table_number ?? 0);
    });

    for (const [k, rows] of sortedGroups) {
      const [catId, tabId] = k.split('__');
      const cat = categories.find(c => c.id === catId);
      const tab = tables.find(t => t.id === tabId);
      if (!cat || !tab) continue;
      rows.sort((a, b) => {
        const ra = a.round_number ?? 1, rb = b.round_number ?? 1;
        if (ra !== rb) return ra - rb;
        return (a.scheduled_time || '').localeCompare(b.scheduled_time || '');
      });
      const data: (string | number)[][] = [
        ['Student', 'Type', 'Academy / Club', 'Round', 'Points', 'Time (s)', 'Status', 'Final Result', 'Judge'],
      ];
      for (const p of rows) {
        const isVoid = p.final_result_status === 'Void';
        data.push([
          p.team_name || '',
          orgType(p.club_name),
          p.club_name || '',
          p.round_number ?? 1,
          isVoid ? 'VOID' : (p.score ?? ''),
          p.time_seconds ?? '',
          p.live_status || '',
          p.final_result_status || '',
          p.judge_name || '',
        ]);
      }
      const tabLabel = tab.display_label || `T${tab.table_number}`;
      const rawName = `${cat.name.replace(/Sportswonderland/i, 'SW')} ${tabLabel}`;
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 26 }, { wch: 7 }, { wch: 26 }, { wch: 6 }, { wch: 8 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb2, ws, uniqueName(rawName));
    }

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    XLSX.writeFile(wb2, `MakeX_2026_Results_${stamp}.xlsx`);
  }

  // ── Clear judge data ──────────────────────────────────────────────────────
  async function clearJudgeData() {
    const touched = passations.filter(p =>
      p.final_result_status || p.live_status !== 'Scheduled' || p.score != null ||
      p.signature_image || p.judge_name || p.finalized_at || (p.delay_count ?? 0) > 0
    );
    if (touched.length === 0) { alert('Nothing to clear — system is already clean.'); return; }
    const phrase = `clear ${touched.length}`;
    const typed = prompt(`Reset ALL judge data on ${touched.length} passations.\n\nType: ${phrase}`);
    if (typed !== phrase) { alert('Cancelled.'); return; }
    setClearing(true);
    let ok = 0, fail = 0;
    for (const p of touched) {
      const cleanedNotes = stripBreakdown(p.notes);
      const { error } = await supabase.from('passations').update({
        score: null, time_seconds: null, signature_image: null,
        judge_name: null, finalized_at: null, live_status: 'Scheduled',
        final_result_status: null, delay_count: 0, notes: cleanedNotes,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id);
      if (error) fail++; else ok++;
    }
    const byTableRound = new Map<string, Passation[]>();
    for (const p of passations) {
      if (!p.table_id) continue;
      const k = `${p.table_id}|${p.round_number ?? 1}`;
      if (!byTableRound.has(k)) byTableRound.set(k, []);
      byTableRound.get(k)!.push(p);
    }
    for (const [k, rows] of byTableRound) {
      const isR2 = k.split('|')[1] === '2';
      rows.sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
      for (let i = 0; i < rows.length; i++) {
        const expected = (isR2 ? 1001 : 1) + i;
        if (rows[i].queue_position !== expected)
          await supabase.from('passations').update({ queue_position: expected, updated_at: new Date().toISOString() }).eq('id', rows[i].id);
      }
    }
    setClearing(false);
    alert(`Cleared ${ok} passation${ok === 1 ? '' : 's'}.${fail ? ' Failed: ' + fail : ''}`);
    load();
  }

  if (loading) return <p className="text-slate-400 text-sm">Loading results…</p>;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Results &amp; Rankings</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            R1: ✓ {stats.fin} finalized · ⚠ {stats.vd} void · ⊘ {stats.abs} absent · … {stats.sched} pending
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={downloadXlsxReport}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl">
            ⬇ Excel report
          </button>
          <button onClick={clearJudgeData} disabled={clearing}
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">
            {clearing ? 'Clearing…' : '🗑 Clear test data'}
          </button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['rankings', 'raw'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition ${
              view === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {v === 'rankings' ? '🏆 Rankings' : '📋 Raw Results'}
          </button>
        ))}
      </div>

      {/* ── RANKINGS VIEW ── */}
      {view === 'rankings' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap gap-2 items-center">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name} {c.age_range_label && `(${c.age_range_label})`}</option>)}
            </select>
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              {(['all', 'school', 'club'] as const).map(t => (
                <button key={t} onClick={() => setRankType(t)}
                  className={`px-3 py-1 text-xs font-bold rounded transition ${
                    rankType === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {t === 'all' ? 'All' : t === 'school' ? '🏫 Schools' : '🏢 Clubs'}
                </button>
              ))}
            </div>
          </div>

          {/* Per-category ranking tables */}
          {categories
            .filter(cat => !filterCat || cat.id === filterCat)
            .map(cat => {
              const rankings = (rankingsByCat.get(cat.id) || []).filter(s =>
                rankType === 'all' || (rankType === 'school' ? s.type === 'School' : s.type === 'Club')
              );
              if (rankings.length === 0) return null;

              const schoolCount = rankings.filter(s => s.type === 'School').length;
              const clubCount   = rankings.filter(s => s.type === 'Club').length;
              const finalized   = rankings.filter(s => s.best.score != null).length;

              return (
                <div key={cat.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-slate-800">{cat.name}
                        {cat.age_range_label && <span className="ml-2 text-slate-400 font-normal text-sm">({cat.age_range_label})</span>}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {rankings.length} students · {finalized} scored · 🏫 {schoolCount} schools · 🏢 {clubCount} clubs
                      </p>
                    </div>
                    <div className="flex gap-3 text-xs text-slate-400">
                      <span>Best of R1 &amp; R2 · points → time</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50/60 border-b border-slate-100">
                        <tr>
                          <th className="text-center px-3 py-2 text-xs font-bold text-slate-500 uppercase w-12">Rank</th>
                          <th className="text-center px-2 py-2 text-xs font-bold text-slate-400 uppercase w-16">
                            <span className="text-blue-600">🏫</span>
                          </th>
                          <th className="text-center px-2 py-2 text-xs font-bold text-slate-400 uppercase w-16">
                            <span className="text-purple-600">🏢</span>
                          </th>
                          <th className="text-left px-3 py-2 text-xs font-bold text-slate-500 uppercase">Student</th>
                          <th className="text-left px-3 py-2 text-xs font-bold text-slate-500 uppercase">Academy / Club</th>
                          <th className="text-center px-2 py-2 text-xs font-bold text-slate-400 uppercase w-12">Type</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">R1 pts</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-slate-400 uppercase">R1 time</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">R2 pts</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-slate-400 uppercase">R2 time</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-emerald-700 uppercase">Best pts</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-emerald-600 uppercase">Best time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {rankings.map((s, idx) => {
                          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                          const isTop = idx < 3 && s.best.score != null;
                          return (
                            <tr key={s.key} className={`${isTop ? 'bg-amber-50/40' : 'hover:bg-slate-50/60'}`}>
                              <td className="px-3 py-2.5 text-center font-bold text-slate-700">
                                {medal ?? <span className="text-slate-400 font-normal">{s.overallRank}</span>}
                              </td>
                              <td className="px-2 py-2.5 text-center text-xs font-semibold text-blue-700">
                                {s.schoolRank != null ? `#${s.schoolRank}` : <span className="text-slate-200">—</span>}
                              </td>
                              <td className="px-2 py-2.5 text-center text-xs font-semibold text-purple-700">
                                {s.clubRank != null ? `#${s.clubRank}` : <span className="text-slate-200">—</span>}
                              </td>
                              <td className="px-3 py-2.5 font-semibold text-slate-800">{s.teamName}</td>
                              <td className="px-3 py-2.5 text-xs text-slate-600">{s.clubName || '—'}</td>
                              <td className="px-2 py-2.5 text-center">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  s.type === 'School' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                                }`}>{s.type === 'School' ? '🏫' : '🏢'}</span>
                              </td>
                              <RoundCell res={s.r1} highlight={s.r1 === s.best} />
                              <TimeCell res={s.r1} highlight={s.r1 === s.best} />
                              <RoundCell res={s.r2} highlight={s.r2 === s.best} />
                              <TimeCell res={s.r2} highlight={s.r2 === s.best} />
                              <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">
                                {s.best.score != null ? s.best.score : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-600">
                                {s.best.time != null ? `${s.best.time}s` : <span className="text-slate-300">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* ── RAW RESULTS VIEW ── */}
      {view === 'raw' && (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name} {c.age_range_label && `(${c.age_range_label})`}</option>)}
            </select>
            <select value={filterRound} onChange={e => setFilterRound(e.target.value as 'all' | '1' | '2')}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="all">Both rounds</option>
              <option value="1">Round 1</option>
              <option value="2">Round 2</option>
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all' | 'finalized' | 'void' | 'absent' | 'scheduled')}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              <option value="all">All statuses</option>
              <option value="finalized">Finalized only</option>
              <option value="void">Void only</option>
              <option value="absent">Absent only</option>
              <option value="scheduled">Not yet judged</option>
            </select>
            <span className="text-xs text-slate-400 self-center ml-auto">{filtered.length} shown</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="w-8"></th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Student</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Academy</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-slate-400 uppercase">Type</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Category</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Table</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">R</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Score</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Status</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Judge</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase">Sig</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="text-center py-12 text-slate-400">No passations match these filters.</td></tr>
                )}
                {filtered.map(p => {
                  const isOpen = expanded.has(p.id);
                  const bd = parseBreakdown(p.notes);
                  const sheet = sheetForBreakdown(bd);
                  const voidFlag = p.final_result_status === 'Void' || !!bd?.void;
                  return (
                    <RawRow key={p.id} p={p} isOpen={isOpen} voidFlag={voidFlag} bd={bd} sheet={sheet}
                      catLabel={catLabel(p.category_id)} tableLabel={tableLabel(p.table_id)} fmtTime={fmtTime}
                      onToggle={() => setExpanded(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small cell helpers ────────────────────────────────────────────────────────
function RoundCell({ res, highlight }: { res: RoundResult; highlight: boolean }) {
  if (res.status === 'Absent') return <td className="px-3 py-2.5 text-right text-xs text-amber-500">absent</td>;
  if (res.status === 'Void')   return <td className="px-3 py-2.5 text-right text-xs text-red-500">void</td>;
  if (res.score == null)       return <td className="px-3 py-2.5 text-right text-slate-300 text-xs">—</td>;
  return (
    <td className={`px-3 py-2.5 text-right font-mono font-semibold ${highlight ? 'text-emerald-700' : 'text-slate-700'}`}>
      {res.score}
    </td>
  );
}
function TimeCell({ res, highlight }: { res: RoundResult; highlight: boolean }) {
  if (res.time == null) return <td className="px-3 py-2.5 text-right text-slate-200 text-xs">—</td>;
  return (
    <td className={`px-3 py-2.5 text-right font-mono text-xs ${highlight ? 'text-emerald-600' : 'text-slate-400'}`}>
      {res.time}s
    </td>
  );
}

// ── Raw row ───────────────────────────────────────────────────────────────────
function RawRow({ p, isOpen, voidFlag, bd, sheet, catLabel, tableLabel, fmtTime, onToggle }: {
  p: Passation; isOpen: boolean; voidFlag: boolean;
  bd: Breakdown | null; sheet: Sheet | undefined;
  catLabel: string; tableLabel: string;
  fmtTime: (s: string | null) => string;
  onToggle: () => void;
}) {
  const type = orgType(p.club_name);
  return (
    <>
      <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={onToggle}>
        <td className="px-2 text-slate-400 text-center">{isOpen ? '▾' : '▸'}</td>
        <td className="px-3 py-2.5 font-semibold text-slate-800">{p.team_name}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600">{p.club_name || '—'}</td>
        <td className="px-2 py-2.5 text-center">
          <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${type === 'School' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
            {type === 'School' ? '🏫' : '🏢'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs text-slate-500">{catLabel}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600">{tableLabel}</td>
        <td className="px-3 py-2.5 text-xs text-slate-500">R{p.round_number ?? 1}</td>
        <td className={`px-3 py-2.5 text-right font-mono font-bold ${voidFlag ? 'text-red-600' : 'text-slate-800'}`}>
          {voidFlag ? 'VOID' : p.score != null ? p.score : '—'}
          {p.time_seconds != null && !voidFlag && <span className="text-slate-400 font-normal text-xs ml-1">({p.time_seconds}s)</span>}
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
            voidFlag ? 'bg-red-100 text-red-700' :
            p.final_result_status === 'Finished' ? 'bg-emerald-100 text-emerald-700' :
            p.live_status === 'Absent' ? 'bg-amber-100 text-amber-700' :
            p.live_status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
            'bg-slate-100 text-slate-500'}`}>
            {voidFlag ? 'void' : p.final_result_status || p.live_status}
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs text-slate-500">{p.judge_name || '—'}</td>
        <td className="px-3 py-2.5">
          {p.signature_image
            ? <img src={p.signature_image} alt="sig" className="h-6 w-12 object-contain border border-slate-200 rounded bg-white" />
            : <span className="text-slate-300 text-xs">—</span>}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-slate-50/70">
          <td></td>
          <td colSpan={10} className="px-5 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-xs space-y-1 text-slate-600">
                <p><strong>Student names:</strong> {p.student_names || '—'}</p>
                <p><strong>Coach:</strong> {p.coach_name || '—'}</p>
                <p><strong>Scheduled:</strong> {fmtTime(p.scheduled_time)}</p>
                <p><strong>Finalized:</strong> {fmtTime(p.finalized_at)}</p>
                <p><strong>Time (s):</strong> {p.time_seconds ?? '—'}</p>
                <p><strong>Queue #:</strong> {p.queue_position}</p>
              </div>
              <div>
                {sheet && bd ? (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 bg-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      Scoresheet — {sheet.name}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {sheet.sections.map(sec => (
                        <div key={sec.title} className="px-3 py-2">
                          <p className="font-semibold text-xs text-slate-700">{sec.title}</p>
                          <ul className="mt-1 space-y-0.5">
                            {sec.items.map(item => {
                              if (item.kind === 'counter') {
                                const c = bd.counts[item.id] ?? 0;
                                return <li key={item.id} className="text-[11px] text-slate-600 flex justify-between">
                                  <span>{item.title}</span>
                                  <span className="font-mono font-bold">{c} × {item.perUnit} = {c * item.perUnit}</span>
                                </li>;
                              }
                              const sel = bd.vals[item.id];
                              const ch = item.choices.find(c => c.value === sel);
                              return <li key={item.id} className="text-[11px] text-slate-600 flex justify-between gap-3">
                                <span className="truncate">{item.title}</span>
                                <span className={`font-mono font-bold ${ch?.value === -9999 ? 'text-red-600' : ''}`}>
                                  {ch ? ch.label : <span className="text-slate-300">—</span>}
                                </span>
                              </li>;
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    {p.score != null ? 'Free-form score.' : 'Not yet judged.'}
                  </p>
                )}
                {p.notes && stripBreakdown(p.notes) && (
                  <div className="mt-3 text-xs">
                    <p className="font-bold text-slate-500 text-[10px] uppercase tracking-wider">Notes</p>
                    <p className="text-slate-600">{stripBreakdown(p.notes)}</p>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
