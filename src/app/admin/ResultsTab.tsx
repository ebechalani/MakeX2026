'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import { SHEETS, type Sheet } from '@/lib/scoresheets';
import type { Category, Table, Passation } from '@/lib/types';

// ── School / Club classification ─────────────────────────────────────────────
import {
  orgType,
  type RoundResult, type RankedStudent, type CategoryRankings,
  calcAge, roundResult, betterResult, compareResults,
  assignRanks, reRank, buildRankings,
} from '@/lib/ranking';

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

/** True if the category name matches Capelli Inspire (case-insensitive). */
function isCapelliInspire(catName: string | null | undefined): boolean {
  return !!catName && /capelli\s*inspire/i.test(catName);
}

/** Categories that should not be split into school/club rankings — single unified ranking. */
function isUnifiedRanking(catName: string | null | undefined): boolean {
  if (!catName) return false;
  return /capelli\s*soccer/i.test(catName) || /makex\s*starter/i.test(catName);
}

// ── MakeX Starter team builder ────────────────────────────────────────────────
type StarterTeam = { id: string; name: string; s1Key: string; s2Key: string };

function StarterTeamBuilder({ catId, rankings, groupId, onSaveScore }: {
  catId: string;
  rankings: CategoryRankings;
  groupId: string;
  onSaveScore: (id: string, score: number | null, time: number | null) => Promise<void>;
}) {
  const storageKey = `makex2026:starterTeams:${catId}`;

  const [teams, setTeams] = useState<StarterTeam[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Students not in the DB — injected manually
  const STARTER_HARDCODED: RankedStudent[] = useMemo(() => {
    const none: RoundResult = { score: null, time: null, status: '—' };
    return [
      { key: '__hc__carlo kafrouni|roboholic', teamName: 'Carlo Kafrouni', clubName: 'RoboHolic', tableLabel: '—', type: 'Club', age: null, r1: none, r2: none, best: none, rank: 999, r1Id: null, r2Id: null },
      { key: '__hc__jean paul mrad|roboholic',  teamName: 'Jean Paul Mrad',  clubName: 'RoboHolic', tableLabel: '—', type: 'Club', age: null, r1: none, r2: none, best: none, rank: 999, r1Id: null, r2Id: null },
    ];
  }, []);

  const allStudents = useMemo(() => {
    const base = [...rankings.schools, ...rankings.clubs];
    // Add hardcoded students only if not already present (match by first+last name, case-insensitive)
    const nameIn = (name: string) => base.some(s =>
      s.teamName.toLowerCase().includes(name.toLowerCase())
    );
    const extras = STARTER_HARDCODED.filter(hc => !nameIn(hc.teamName));
    return [...base, ...extras];
  }, [rankings, STARTER_HARDCODED]);
  const assignedKeys = useMemo(() => new Set(teams.flatMap(t => [t.s1Key, t.s2Key])), [teams]);
  const unassigned   = useMemo(() => allStudents.filter(s => !assignedKeys.has(s.key)), [allStudents, assignedKeys]);

  function saveTeams(next: StarterTeam[]) {
    setTeams(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function toggleSelect(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); }
      else if (next.size < 2) { next.add(key); }
      return next;
    });
  }

  function createTeam() {
    const [k1, k2] = [...selected];
    const s1 = allStudents.find(s => s.key === k1)!;
    const s2 = allStudents.find(s => s.key === k2)!;
    const name = `${s1.teamName.split(' ')[0]} & ${s2.teamName.split(' ')[0]}`;
    saveTeams([...teams, { id: Math.random().toString(36).slice(2), name, s1Key: k1, s2Key: k2 }]);
    setSelected(new Set());
  }

  function deleteTeam(id: string) { saveTeams(teams.filter(t => t.id !== id)); }
  function renameTeam(id: string, name: string) { saveTeams(teams.map(t => t.id === id ? { ...t, name } : t)); }

  // Build RankedStudent entries for each team (combined scores)
  const teamRows: RankedStudent[] = useMemo(() => teams.map((team, i) => {
    const s1 = allStudents.find(s => s.key === team.s1Key);
    const s2 = allStudents.find(s => s.key === team.s2Key);
    const none: RoundResult = { score: null, time: null, status: '—' };
    const combine = (a: RoundResult, b: RoundResult): RoundResult => ({
      score:  (a.score ?? 0) + (b.score ?? 0) || null,
      time:   a.time != null && b.time != null ? a.time + b.time : null,
      status: a.score != null ? a.status : b.status,
    });
    const r1 = combine(s1?.r1 ?? none, s2?.r1 ?? none);
    const r2 = combine(s1?.r2 ?? none, s2?.r2 ?? none);
    return {
      key: team.id,
      teamName: team.name,
      clubName: [s1?.clubName, s2?.clubName].filter(Boolean).filter((v, j, a) => a.indexOf(v) === j).join(' / '),
      tableLabel: s1?.tableLabel || s2?.tableLabel || '—',
      type: 'Club' as const,
      age: null,
      r1, r2,
      best: betterResult(r1, r2),
      rank: i + 1,
      r1Id: null,
      r2Id: null,
    };
  }), [teams, allStudents]);

  return (
    <div className="space-y-4">
      {/* ── Builder panel ── */}
      <div className="bg-white border border-violet-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 bg-violet-50 border-b border-violet-100 flex items-center justify-between">
          <span className="font-bold text-violet-800 text-sm">👥 Team Builder — MakeX Starter</span>
          <span className="text-xs text-violet-500">
            {teams.length} team{teams.length !== 1 ? 's' : ''} · {unassigned.length} unassigned student{unassigned.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="p-4 space-y-5">
          {/* Unassigned student chips */}
          {unassigned.length > 0 ? (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
                Click 2 students to pair them&nbsp;
                <span className={`font-bold ${selected.size === 2 ? 'text-violet-600' : 'text-slate-400'}`}>
                  ({selected.size}/2 selected)
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {unassigned.map(s => {
                  const isSel = selected.has(s.key);
                  return (
                    <button key={s.key} onClick={() => toggleSelect(s.key)}
                      className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition-all ${
                        isSel
                          ? 'bg-violet-600 text-white border-violet-600 shadow-md scale-105'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-violet-400 hover:text-violet-700'
                      }`}>
                      {s.teamName}
                      {s.clubName && (
                        <span className={`ml-1.5 font-normal text-[10px] ${isSel ? 'text-violet-200' : 'text-slate-400'}`}>
                          {s.clubName}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selected.size === 2 && (
                <div className="mt-3 flex items-center gap-3">
                  <button onClick={createTeam}
                    className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-5 py-2 rounded-lg transition shadow-sm">
                    ✓ Create Team
                  </button>
                  <button onClick={() => setSelected(new Set())}
                    className="text-xs text-slate-400 hover:text-slate-600 underline">cancel</button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">All students have been assigned to teams.</p>
          )}

          {/* Created teams list */}
          {teams.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Paired Teams</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {teams.map(team => {
                  const s1 = allStudents.find(s => s.key === team.s1Key);
                  const s2 = allStudents.find(s => s.key === team.s2Key);
                  return (
                    <div key={team.id} className="flex items-start gap-2 bg-violet-50/60 border border-violet-100 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <input
                          value={team.name}
                          onChange={e => renameTeam(team.id, e.target.value)}
                          className="font-bold text-sm text-violet-900 bg-transparent w-full border-b border-transparent hover:border-violet-300 focus:border-violet-500 focus:outline-none"
                        />
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {s1?.teamName ?? '?'} &amp; {s2?.teamName ?? '?'}
                        </p>
                      </div>
                      <button onClick={() => deleteTeam(team.id)}
                        className="text-slate-300 hover:text-red-500 text-xs mt-0.5 flex-shrink-0 transition">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Team ranking table ── */}
      {teamRows.length > 0 && (
        <RankingTable
          rows={teamRows}
          label="🏆 Team Rankings — MakeX Starter"
          labelClass="text-violet-700 bg-violet-50 border-violet-200"
          catTitle="MakeX Starter"
          groupId={groupId}
          overrideOnly={true}
          onSaveScore={onSaveScore}
        />
      )}
      {teamRows.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm bg-white border border-slate-200 rounded-2xl">
          Pair students into teams above to see the ranking table.
        </div>
      )}
    </div>
  );
}

/** Split a ranking list into age bands. Bands re-rank from 1. */
type AgeBand = { label: string; ageTag: string; rows: RankedStudent[] };
function splitCapelliByAge(rows: RankedStudent[]): AgeBand[] {
  // Age ≤ 9 counts in the 8–9 band (includes 7-year-olds)
  // Upper bound is 13 (not 12) to include students who were 12 in the school year but turned 13 by competition day
  const young = reRank(rows.filter(s => s.age != null && s.age <= 9));
  const old   = reRank(rows.filter(s => s.age != null && s.age >= 10 && s.age <= 13));
  const other = reRank(rows.filter(s => s.age == null || s.age > 13));
  const bands: AgeBand[] = [];
  if (young.length) bands.push({ label: '8–9 years',   ageTag: '8-9',   rows: young });
  if (old.length)   bands.push({ label: '10–12 years', ageTag: '10-12', rows: old   });
  if (other.length) bands.push({ label: 'Other / Unknown DOB', ageTag: 'other', rows: other });
  return bands;
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

  // ── Manual entry form state ───────────────────────────────────────────────
  const [showManual, setShowManual] = useState(false);
  const [mCatId,    setMCatId]    = useState('');
  const [mTableId,  setMTableId]  = useState('');
  const [mName,     setMName]     = useState('');
  const [mClub,     setMClub]     = useState('');
  const [mDob,      setMDob]      = useState('');
  const [mR1Score,  setMR1Score]  = useState('');
  const [mR1Time,   setMR1Time]   = useState('');
  const [mR2Score,  setMR2Score]  = useState('');
  const [mR2Time,   setMR2Time]   = useState('');
  const [mSaving,   setMSaving]   = useState(false);
  const [mMsg,      setMMsg]      = useState<{ ok: boolean; text: string } | null>(null);

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
    const map = new Map<string, CategoryRankings>();
    for (const cat of categories) {
      const r1 = passations.filter(p => p.category_id === cat.id && (p.round_number ?? 1) === 1);
      const r2 = passations.filter(p => p.category_id === cat.id && p.round_number === 2);
      map.set(cat.id, buildRankings(r1, r2, tables));
    }
    return map;
  }, [passations, categories, tables]);

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

  // Tables filtered to selected manual-entry category
  const mTables = useMemo(() => tables.filter(t => t.category_id === mCatId), [tables, mCatId]);

  async function submitManual() {
    if (!mName.trim()) { setMMsg({ ok: false, text: 'Student name is required.' }); return; }
    if (!mCatId)        { setMMsg({ ok: false, text: 'Category is required.' }); return; }
    if (!mTableId)      { setMMsg({ ok: false, text: 'Table is required.' }); return; }

    const rows: Record<string, unknown>[] = [];
    const base = {
      team_name: mName.trim(),
      student_names: mName.trim(),
      club_name: mClub.trim() || null,
      date_of_birth: mDob || null,
      category_id: mCatId,
      table_id: mTableId,
      live_status: 'Finished',
      final_result_status: 'Finished',
      queue_position: 9999,
      delay_count: 0,
    };

    const r1Score = mR1Score !== '' ? Number(mR1Score) : null;
    const r1Time  = mR1Time  !== '' ? Number(mR1Time)  : null;
    const r2Score = mR2Score !== '' ? Number(mR2Score) : null;
    const r2Time  = mR2Time  !== '' ? Number(mR2Time)  : null;

    if (r1Score !== null || r1Time !== null) {
      rows.push({ ...base, round_number: 1, score: r1Score, time_seconds: r1Time });
    }
    if (r2Score !== null || r2Time !== null) {
      rows.push({ ...base, round_number: 2, score: r2Score, time_seconds: r2Time });
    }
    if (rows.length === 0) { setMMsg({ ok: false, text: 'Enter at least one score or time.' }); return; }

    setMSaving(true);
    setMMsg(null);
    const { error } = await supabase.from('passations').insert(rows);
    setMSaving(false);
    if (error) { setMMsg({ ok: false, text: error.message }); return; }
    setMMsg({ ok: true, text: `Added ${rows.length} record${rows.length > 1 ? 's' : ''} for "${mName.trim()}".` });
    setMName(''); setMClub(''); setMDob('');
    setMR1Score(''); setMR1Time(''); setMR2Score(''); setMR2Time('');
    load();
  }

  async function saveScore(id: string, score: number | null, time: number | null) {
    const { error } = await supabase.from('passations').update({
      score,
      time_seconds: time,
      final_result_status: 'Finished',
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { alert('Save failed: ' + error.message); return; }
    load();
  }

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

    // ── Ranking sheets per category (schools + clubs separately) ─────────
    // Columns: A=Rank B=Student C=Club D=Table E=Age F=R1pts G=R1time H=R1status
    //          I=R2pts J=R2time K=R2status L=BestPts M=BestTime
    const rankHeader = [
      'Rank', 'Student', 'Club / Academy', 'Table', 'Age',
      'R1 Points', 'R1 Time (s)', 'R1 Status',
      'R2 Points', 'R2 Time (s)', 'R2 Status',
      'Best Points', 'Best Time (s)',
    ];
    const rankCols = [
      { wch: 6 }, { wch: 28 }, { wch: 28 }, { wch: 10 }, { wch: 5 },
      { wch: 10 }, { wch: 11 }, { wch: 12 },
      { wch: 10 }, { wch: 11 }, { wch: 12 },
      { wch: 11 }, { wch: 12 },
    ];

    function writeRankSheet(label: string, rows: RankedStudent[]) {
      if (rows.length === 0) return;
      const lastRow = rows.length + 1; // Excel row number of last data row (row 1 = header)

      const data: (string | number | null)[][] = [rankHeader];
      for (const s of rows) {
        data.push([
          s.rank, s.teamName, s.clubName, s.tableLabel, s.age ?? '—',
          s.r1.score ?? '—', s.r1.time ?? '—', s.r1.status,
          s.r2.score ?? '—', s.r2.time ?? '—', s.r2.status,
          s.best.score ?? '—', s.best.time ?? '—',
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = rankCols;

      // ── Inject Excel formulas so manual edits to R1/R2 recalculate automatically ──
      // Columns: A=Rank B=Student C=Club D=Table E=Age F=R1pts G=R1time H=R1status
      //          I=R2pts J=R2time K=R2status L=BestPts M=BestTime
      for (let excelRow = 2; excelRow <= lastRow; excelRow++) {
        const ri = excelRow - 1; // 0-based row index for SheetJS encode_cell
        const r  = excelRow;     // 1-based Excel row number used inside formula strings

        // Best Points (col L, c=11):
        // Pick the score from whichever round wins (higher pts → winner; tie → lower time)
        const bpf =
          `IF(ISNUMBER(F${r}),` +
            `IF(ISNUMBER(I${r}),` +
              `IF(F${r}>I${r},F${r},` +
              `IF(I${r}>F${r},I${r},` +
              `IF(ISNUMBER(G${r}),` +
                `IF(ISNUMBER(J${r}),IF(G${r}<=J${r},F${r},I${r}),F${r}),` +
                `IF(ISNUMBER(J${r}),I${r},F${r})))),` +
            `F${r}),` +
          `IF(ISNUMBER(I${r}),I${r},""))`;

        // Best Time (col M, c=12):
        // Pick the time from the SAME winning round as Best Points
        const btf =
          `IF(ISNUMBER(F${r}),` +
            `IF(ISNUMBER(I${r}),` +
              `IF(F${r}>I${r},G${r},` +
              `IF(I${r}>F${r},J${r},` +
              `IF(ISNUMBER(G${r}),` +
                `IF(ISNUMBER(J${r}),IF(G${r}<=J${r},G${r},J${r}),G${r}),` +
                `IF(ISNUMBER(J${r}),J${r},""))))),` +
            `G${r}),` +
          `IF(ISNUMBER(J${r}),J${r},""))`;

        // Rank (col A, c=0):
        // Count students ranked above: higher best-pts, or same pts + lower best-time
        const rf =
          `IF(ISNUMBER(L${r}),` +
            `SUMPRODUCT(` +
              `(ISNUMBER($L$2:$L$${lastRow})*($L$2:$L$${lastRow}>L${r}))+` +
              `(ISNUMBER($L$2:$L$${lastRow})*($L$2:$L$${lastRow}=L${r})*` +
               `ISNUMBER(M${r})*ISNUMBER($M$2:$M$${lastRow})*($M$2:$M$${lastRow}<M${r}))` +
            `)+1,"")`;

        // Write formula cells (preserve static cached value so file shows data
        // even before Excel recalculates)
        const setF = (c: number, f: string, v: number | string) => {
          const addr = XLSX.utils.encode_cell({ r: ri, c });
          ws[addr] = typeof v === 'number' ? { t: 'n', v, f } : { t: 's', v, f };
        };

        const s = rows[excelRow - 2];
        setF(11, bpf, s.best.score ?? '');
        setF(12, btf, s.best.time  ?? '');
        setF(0,  rf,  s.rank);
      }

      XLSX.utils.book_append_sheet(wb2, ws, uniqueName(label));
    }

    for (const cat of categories) {
      const { schools, clubs } = rankingsByCat.get(cat.id) || { schools: [], clubs: [] };
      const catShort = cat.name.replace(/Sportswonderland/i, 'SW').replace(/Capelli/i, 'Cap').replace(/MakeX/i, 'MX');
      const ageTag   = cat.age_range_label ? ' ' + cat.age_range_label.replace(/[^0-9–-]/g, '') : '';

      if (isUnifiedRanking(cat.name)) {
        // Single combined ranking — no school/club split
        const combined = reRank([...schools, ...clubs]);
        writeRankSheet(`${catShort}${ageTag} Ranking`, combined);
      } else if (isCapelliInspire(cat.name)) {
        // Split Capelli Inspire into 8-9 and 10-12 age bands
        const schoolBands = splitCapelliByAge(schools);
        const clubBands   = splitCapelliByAge(clubs);
        for (const b of schoolBands) writeRankSheet(`${catShort} ${b.ageTag} Schools`, b.rows);
        for (const b of clubBands)   writeRankSheet(`${catShort} ${b.ageTag} Clubs`,   b.rows);
      } else {
        writeRankSheet(`${catShort}${ageTag} Schools`, schools);
        writeRankSheet(`${catShort}${ageTag} Clubs`,   clubs);
      }
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

      {/* ── Manual Entry Panel ── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <button
          onClick={() => { setShowManual(v => !v); setMMsg(null); }}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition">
          <span className="text-sm font-bold text-slate-700">✏️ Add Manual Entry (absent from system)</span>
          <span className="text-slate-400 text-sm">{showManual ? '▲' : '▼'}</span>
        </button>

        {showManual && (
          <div className="px-5 pb-5 border-t border-slate-100 space-y-4">
            <p className="text-xs text-slate-400 mt-3">Fill in the student's details and the results from paper. Leave rounds blank if not played.</p>

            {/* Row 1 — category + table */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Category *</label>
                <select value={mCatId} onChange={e => { setMCatId(e.target.value); setMTableId(''); }}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— select —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Table *</label>
                <select value={mTableId} onChange={e => setMTableId(e.target.value)}
                  disabled={!mCatId}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:opacity-40">
                  <option value="">— select —</option>
                  {mTables.map(t => (
                    <option key={t.id} value={t.id}>{t.display_label || `Table ${t.table_number}`}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2 — name + club + dob */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Student / Team Name *</label>
                <input value={mName} onChange={e => setMName(e.target.value)} placeholder="e.g. Elio Azar"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Club / School</label>
                <input value={mClub} onChange={e => setMClub(e.target.value)} placeholder="e.g. Roboholic"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Date of Birth</label>
                <input type="date" value={mDob} onChange={e => setMDob(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            {/* Row 3 — scores */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Round 1</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-400 block mb-1">Score (pts)</label>
                    <input type="number" value={mR1Score} onChange={e => setMR1Score(e.target.value)} placeholder="0"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-400 block mb-1">Time (seconds)</label>
                    <input type="number" value={mR1Time} onChange={e => setMR1Time(e.target.value)} placeholder="0"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white" />
                  </div>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Round 2</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-400 block mb-1">Score (pts)</label>
                    <input type="number" value={mR2Score} onChange={e => setMR2Score(e.target.value)} placeholder="0"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-400 block mb-1">Time (seconds)</label>
                    <input type="number" value={mR2Time} onChange={e => setMR2Time(e.target.value)} placeholder="0"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white" />
                  </div>
                </div>
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center gap-3">
              <button onClick={submitManual} disabled={mSaving}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl transition">
                {mSaving ? 'Saving…' : '＋ Add to Results'}
              </button>
              {mMsg && (
                <p className={`text-sm font-medium ${mMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                  {mMsg.ok ? '✓' : '✗'} {mMsg.text}
                </p>
              )}
            </div>
          </div>
        )}
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
          {/* Category filter */}
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
                  {t === 'all' ? 'All' : t === 'school' ? '🏫 Schools only' : '🏢 Clubs only'}
                </button>
              ))}
            </div>
          </div>

          {/* Per-category ranking tables */}
          {categories
            .filter(cat => !filterCat || cat.id === filterCat)
            .map(cat => {
              const { schools, clubs } = rankingsByCat.get(cat.id) || { schools: [], clubs: [] };
              if (schools.length === 0 && clubs.length === 0) return null;

              const catTitle = cat.name + (cat.age_range_label ? ` (${cat.age_range_label})` : '');
              const splitByAge = isCapelliInspire(cat.name);
              const unified = isUnifiedRanking(cat.name);

              // Unified ranking → merge schools+clubs into a single re-ranked list
              if (unified) {
                const isSoccer  = /capelli\s*soccer/i.test(cat.name);
                const isStarter = /makex\s*starter/i.test(cat.name);

                // MakeX Starter: special team-builder flow
                if (isStarter) {
                  const { schools: sc, clubs: cl } = rankingsByCat.get(cat.id) || { schools: [], clubs: [] };
                  if (sc.length === 0 && cl.length === 0) return null;
                  return (
                    <div key={cat.id} className="space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold text-slate-800 text-base">{cat.name}
                          {cat.age_range_label && <span className="ml-2 text-slate-400 font-normal text-sm">({cat.age_range_label})</span>}
                        </h3>
                        <span className="text-xs text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded">👥 Team pairing</span>
                      </div>
                      <StarterTeamBuilder
                        catId={cat.id}
                        rankings={{ schools: sc, clubs: cl }}
                        groupId={`${cat.id}-starter`}
                        onSaveScore={saveScore}
                      />
                    </div>
                  );
                }

                const combined = reRank([...schools, ...clubs]);
                if (combined.length === 0) return null;
                return (
                  <div key={cat.id} className="space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-bold text-slate-800 text-base">{cat.name}
                        {cat.age_range_label && <span className="ml-2 text-slate-400 font-normal text-sm">({cat.age_range_label})</span>}
                      </h3>
                      {isSoccer
                        ? <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">📌 Manual ranking only</span>
                        : <><span className="text-xs text-slate-400">Best of R1 &amp; R2 · points → time</span>
                           <span className="text-xs text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">Single ranking</span></>
                      }
                    </div>
                    <RankingTable
                      rows={combined}
                      label="🏆 Overall Rankings"
                      labelClass="text-emerald-700 bg-emerald-50 border-emerald-200"
                      catTitle={catTitle}
                      groupId={`${cat.id}-unified`}
                      overrideOnly={isSoccer}
                      onSaveScore={saveScore}
                    />
                  </div>
                );
              }

              // For Capelli Inspire: split into 8–9 and 10–12 age bands; otherwise one band.
              const schoolBands: AgeBand[] = splitByAge
                ? splitCapelliByAge(schools)
                : (schools.length ? [{ label: '', ageTag: '', rows: schools }] : []);
              const clubBands: AgeBand[] = splitByAge
                ? splitCapelliByAge(clubs)
                : (clubs.length ? [{ label: '', ageTag: '', rows: clubs }] : []);

              return (
                <div key={cat.id} className="space-y-3">
                  {/* Category header */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-slate-800 text-base">{cat.name}
                      {cat.age_range_label && <span className="ml-2 text-slate-400 font-normal text-sm">({cat.age_range_label})</span>}
                    </h3>
                    <span className="text-xs text-slate-400">Best of R1 &amp; R2 · points → time</span>
                    {splitByAge && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">Split by age</span>}
                  </div>

                  {/* Schools ranking */}
                  {(rankType === 'all' || rankType === 'school') && schoolBands.map(band => (
                    <RankingTable
                      key={`sch-${band.ageTag || 'all'}`}
                      rows={band.rows}
                      label={`🏫 School Rankings${band.label ? ` — ${band.label}` : ''}`}
                      labelClass="text-blue-700 bg-blue-50 border-blue-200"
                      catTitle={catTitle + (band.label ? ` · ${band.label}` : '')}
                      groupId={`${cat.id}-school-${band.ageTag || 'all'}`}
                      onSaveScore={saveScore}
                    />
                  ))}

                  {/* Clubs ranking */}
                  {(rankType === 'all' || rankType === 'club') && clubBands.map(band => (
                    <RankingTable
                      key={`clb-${band.ageTag || 'all'}`}
                      rows={band.rows}
                      label={`🏢 Club Rankings${band.label ? ` — ${band.label}` : ''}`}
                      labelClass="text-purple-700 bg-purple-50 border-purple-200"
                      catTitle={catTitle + (band.label ? ` · ${band.label}` : '')}
                      groupId={`${cat.id}-club-${band.ageTag || 'all'}`}
                      onSaveScore={saveScore}
                    />
                  ))}
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

// ── Ranking table component ───────────────────────────────────────────────────
function RankingTable({ rows, label, labelClass, catTitle: _catTitle, groupId, overrideOnly = false, onSaveScore }: {
  rows: RankedStudent[];
  label: string;
  labelClass: string;
  catTitle: string;
  groupId: string;
  overrideOnly?: boolean;
  onSaveScore: (id: string, score: number | null, time: number | null) => Promise<void>;
}) {
  const storageKey = `makex2026:rankOverrides:${groupId}`;

  const [overrides, setOverrides] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  });

  function saveOverride(key: string, rank: number | null) {
    setOverrides(prev => {
      const next = { ...prev };
      if (rank == null || isNaN(rank)) { delete next[key]; } else { next[key] = rank; }
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  // Apply overrides: replace rank for overridden students, then re-sort by effective rank
  const displayRows = useMemo(() => {
    const mapped = rows.map(s => ({
      ...s,
      displayRank: overrides[s.key] ?? s.rank,
      isOverridden: s.key in overrides,
    }));
    // In overrideOnly mode: show overridden rows first (sorted by rank), then unoverridden rows dimmed at the bottom
    if (overrideOnly) {
      const pinned   = mapped.filter(s =>  s.isOverridden).sort((a, b) => a.displayRank - b.displayRank);
      const unpinned = mapped.filter(s => !s.isOverridden).sort((a, b) => compareResults(a.best, b.best));
      return [...pinned, ...unpinned];
    }
    const visible = mapped;
    return visible.sort((a, b) => {
      if (a.displayRank !== b.displayRank) return a.displayRank - b.displayRank;
      return compareResults(a.best, b.best);
    });
  }, [rows, overrides, overrideOnly]);

  const [editingKey,  setEditingKey]  = useState<string | null>(null);
  const [rankEditKey, setRankEditKey] = useState<string | null>(null);
  const [editR1Score, setEditR1Score] = useState('');
  const [editR1Time,  setEditR1Time]  = useState('');
  const [editR2Score, setEditR2Score] = useState('');
  const [editR2Time,  setEditR2Time]  = useState('');
  const [saving,      setSaving]      = useState(false);

  function openEdit(s: RankedStudent & { displayRank: number; isOverridden: boolean }) {
    setEditingKey(s.key);
    setRankEditKey(null);
    setEditR1Score(s.r1.score != null ? String(s.r1.score) : '');
    setEditR1Time(s.r1.time  != null ? String(s.r1.time)  : '');
    setEditR2Score(s.r2.score != null ? String(s.r2.score) : '');
    setEditR2Time(s.r2.time  != null ? String(s.r2.time)  : '');
  }

  async function commitEdit(s: RankedStudent) {
    setSaving(true);
    if (s.r1Id) {
      const score = editR1Score !== '' ? Number(editR1Score) : null;
      const time  = editR1Time  !== '' ? Number(editR1Time)  : null;
      await onSaveScore(s.r1Id, score, time);
    }
    if (s.r2Id) {
      const score = editR2Score !== '' ? Number(editR2Score) : null;
      const time  = editR2Time  !== '' ? Number(editR2Time)  : null;
      await onSaveScore(s.r2Id, score, time);
    }
    setSaving(false);
    setEditingKey(null);
  }

  function commitRankOverride(key: string, rawValue: string) {
    const v = rawValue.trim();
    const n = v !== '' ? Number(v) : null;
    saveOverride(key, n != null && !isNaN(n) && n >= 1 ? n : null);
    setRankEditKey(null);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className={`px-5 py-2.5 border-b flex items-center justify-between ${labelClass}`}>
        <span className="font-bold text-sm">{label}</span>
        <div className="flex items-center gap-3">
          {Object.keys(overrides).length > 0 && (
            <button onClick={() => { setOverrides({}); localStorage.removeItem(storageKey); }}
              className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded hover:bg-orange-100 transition">
              📌 {Object.keys(overrides).length} override{Object.keys(overrides).length !== 1 ? 's' : ''} · clear all
            </button>
          )}
          {overrideOnly
            ? <span className="text-xs text-orange-500 opacity-80">{displayRows.length} pinned · click a rank number to add</span>
            : <span className="text-xs opacity-70">{rows.length} participant{rows.length !== 1 ? 's' : ''} · {rows.filter(s => s.best.score != null).length} scored</span>
          }
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/60 border-b border-slate-100">
            <tr>
              <th className="w-8"></th>
              <th className="text-center px-3 py-2 text-xs font-bold text-slate-500 uppercase w-12">Rank</th>
              <th className="text-left px-3 py-2 text-xs font-bold text-slate-500 uppercase">Student</th>
              <th className="text-left px-3 py-2 text-xs font-bold text-slate-500 uppercase">Academy / Club</th>
              <th className="text-left px-2 py-2 text-xs font-bold text-slate-400 uppercase">Table</th>
              <th className="text-center px-2 py-2 text-xs font-bold text-slate-400 uppercase w-10">Age</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">R1 pts</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-slate-400 uppercase">R1 time</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-slate-500 uppercase">R2 pts</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-slate-400 uppercase">R2 time</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-emerald-700 uppercase">Best pts</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-emerald-600 uppercase">Best time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {displayRows.map(s => {
              const isTied = displayRows.filter(r => r.displayRank === s.displayRank).length > 1;
              const medal = s.displayRank === 1 && !isTied && !s.isOverridden ? '🥇'
                          : s.displayRank === 2 && !isTied && !s.isOverridden ? '🥈'
                          : s.displayRank === 3 && !isTied && !s.isOverridden ? '🥉'
                          : null;
              const isTop = s.displayRank <= 3 && s.best.score != null && (!overrideOnly || s.isOverridden);
              const isDimmed = overrideOnly && !s.isOverridden;
              const isEditing = editingKey === s.key;
              return (
                <>
                  <tr key={s.key} className={isEditing ? 'bg-blue-50' : isDimmed ? 'opacity-30' : isTop ? 'bg-amber-50/40' : 'hover:bg-slate-50/60'}>
                    <td className="px-2 text-center">
                      <button onClick={() => isEditing ? setEditingKey(null) : openEdit(s)}
                        className="text-slate-400 hover:text-blue-600 transition text-xs px-1"
                        title="Edit score / rank">
                        {isEditing ? '✕' : '✏️'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold text-slate-700 text-base">
                      {rankEditKey === s.key ? (
                        <input
                          type="number" min="1" autoFocus
                          defaultValue={s.displayRank}
                          className="w-12 text-center border border-orange-400 rounded px-1 py-0.5 text-sm font-mono bg-white outline-none"
                          onBlur={e => commitRankOverride(s.key, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') setRankEditKey(null);
                          }}
                        />
                      ) : (
                        <span
                          title="Click to override rank"
                          onClick={() => setRankEditKey(s.key)}
                          className={`cursor-pointer select-none rounded px-1 hover:bg-orange-50 ${s.isOverridden ? 'text-orange-600 font-bold' : ''}`}
                        >
                          {s.isOverridden
                            ? <span className="inline-flex items-center gap-0.5">📌{s.displayRank}<span onClick={e => { e.stopPropagation(); saveOverride(s.key, null); }} className="ml-1 text-[10px] text-orange-300 hover:text-red-500 cursor-pointer" title="Clear override">✕</span></span>
                            : isDimmed
                            ? <span className="text-slate-300 text-xs">—</span>
                            : medal ?? (
                              <span className={`font-normal text-sm ${isTied ? 'text-orange-500' : 'text-slate-400'}`}>
                                {isTied ? `=${s.displayRank}` : s.displayRank}
                              </span>
                            )
                          }
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-slate-800">{s.teamName}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{s.clubName || '—'}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-500 whitespace-nowrap">{s.tableLabel}</td>
                    <td className="px-2 py-2.5 text-center text-xs text-slate-500">{s.age != null ? s.age : <span className="text-slate-300">—</span>}</td>
                    <RoundCell res={s.r1} highlight={s.r1 === s.best} />
                    <TimeCell  res={s.r1} highlight={s.r1 === s.best} />
                    <RoundCell res={s.r2} highlight={s.r2 === s.best} />
                    <TimeCell  res={s.r2} highlight={s.r2 === s.best} />
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-700">
                      {s.best.score != null ? s.best.score : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-600">
                      {s.best.time != null ? `${s.best.time}s` : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                  {isEditing && (
                    <tr key={`${s.key}-edit`} className="bg-blue-50 border-b border-blue-100">
                      <td colSpan={12} className="px-5 py-3">
                        <div className="flex flex-wrap items-end gap-4">
                          {s.r1Id && (
                            <div className="flex items-end gap-2">
                              <p className="text-xs font-bold text-slate-500 uppercase mr-1 mb-1.5">R1</p>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Score (pts)</label>
                                <input type="number" value={editR1Score} onChange={e => setEditR1Score(e.target.value)}
                                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-mono bg-white" placeholder="—" />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Time (s)</label>
                                <input type="number" value={editR1Time} onChange={e => setEditR1Time(e.target.value)}
                                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-mono bg-white" placeholder="—" />
                              </div>
                            </div>
                          )}
                          {s.r2Id && (
                            <div className="flex items-end gap-2">
                              <p className="text-xs font-bold text-slate-500 uppercase mr-1 mb-1.5">R2</p>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Score (pts)</label>
                                <input type="number" value={editR2Score} onChange={e => setEditR2Score(e.target.value)}
                                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-mono bg-white" placeholder="—" />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Time (s)</label>
                                <input type="number" value={editR2Time} onChange={e => setEditR2Time(e.target.value)}
                                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-mono bg-white" placeholder="—" />
                              </div>
                            </div>
                          )}
                          <button onClick={() => commitEdit(s)} disabled={saving}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition mb-0">
                            {saving ? 'Saving…' : '✓ Save'}
                          </button>
                          <button onClick={() => setEditingKey(null)}
                            className="text-xs text-slate-500 hover:text-slate-700 underline">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
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
