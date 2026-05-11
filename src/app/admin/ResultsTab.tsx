'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import { SHEETS, type Sheet } from '@/lib/scoresheets';
import type { Category, Table, Passation } from '@/lib/types';

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

export default function ResultsTab() {
  const supabase = useMemo(() => createClient(), []);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [filterCat, setFilterCat] = useState<string>('');
  const [filterRound, setFilterRound] = useState<'all' | '1' | '2'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'finalized' | 'void' | 'absent' | 'scheduled'>('all');
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
    const fin = passations.filter(p => p.final_result_status === 'Finished').length;
    const vd  = passations.filter(p => p.final_result_status === 'Void').length;
    const abs = passations.filter(p => p.live_status === 'Absent').length;
    const sched = passations.filter(p => p.live_status === 'Scheduled' && !p.finalized_at).length;
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

  function downloadXlsxReport() {
    // Group by (category, table) and produce one sheet per group
    const wb = XLSX.utils.book_new();
    const groups = new Map<string, Passation[]>();
    for (const p of passations) {
      if (!p.table_id) continue;
      const k = `${p.category_id}__${p.table_id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    // Sort sheet entries by category name then table number
    const sortedGroups = Array.from(groups.entries()).sort(([ka], [kb]) => {
      const ca = categories.find(c => c.id === ka.split('__')[0]);
      const cb = categories.find(c => c.id === kb.split('__')[0]);
      const cn = (ca?.name || '').localeCompare(cb?.name || '');
      if (cn !== 0) return cn;
      const ta = tables.find(t => t.id === ka.split('__')[1]);
      const tb = tables.find(t => t.id === kb.split('__')[1]);
      return (ta?.table_number ?? 0) - (tb?.table_number ?? 0);
    });

    let summaryRows: (string | number)[][] = [
      ['Sheet', 'Category', 'Table', 'Students', 'Finalized', 'Void', 'Absent']
    ];

    const usedNames = new Set<string>();
    for (const [k, rows] of sortedGroups) {
      const [catId, tabId] = k.split('__');
      const cat = categories.find(c => c.id === catId);
      const tab = tables.find(t => t.id === tabId);
      if (!cat || !tab) continue;
      // Sort rows: by round, then by scheduled_time, then by queue_position
      rows.sort((a, b) => {
        const ra = a.round_number ?? 1;
        const rb = b.round_number ?? 1;
        if (ra !== rb) return ra - rb;
        const at = a.scheduled_time || '';
        const bt = b.scheduled_time || '';
        if (at !== bt) return at.localeCompare(bt);
        return a.queue_position - b.queue_position;
      });

      const data: (string | number)[][] = [
        ['Student', 'Academy / Club', 'Round', 'Points', 'Time (s)', 'Scheduled', 'Live Status', 'Final Result', 'Judge'],
      ];
      let fin = 0, vd = 0, abs = 0;
      for (const p of rows) {
        const isVoid = p.final_result_status === 'Void';
        if (p.final_result_status === 'Finished' && !isVoid) fin++;
        if (isVoid) vd++;
        if (p.live_status === 'Absent') abs++;
        data.push([
          p.team_name || '',
          p.club_name || '',
          p.round_number ?? 1,
          isVoid ? 'VOID' : (p.score ?? ''),
          p.time_seconds ?? '',
          p.scheduled_time ? new Date(p.scheduled_time).toLocaleString() : '',
          p.live_status || '',
          p.final_result_status || '',
          p.judge_name || '',
        ]);
      }

      // Excel sheet names cap at 31 chars and have illegal chars [/?*[]:\\]
      const tabLabel = tab.display_label || `T${tab.table_number}`;
      const rawName = `${cat.name.replace(/Sportswonderland/i, 'SW')} ${tabLabel}`;
      let sheetName = rawName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
      // Ensure uniqueness
      let unique = sheetName, n = 2;
      while (usedNames.has(unique)) { unique = (sheetName.slice(0, 28) + '_' + n).slice(0, 31); n++; }
      usedNames.add(unique);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [
        { wch: 28 }, // Student
        { wch: 28 }, // Club
        { wch: 6 },  // Round
        { wch: 8 },  // Points
        { wch: 9 },  // Time
        { wch: 18 }, // Scheduled
        { wch: 12 }, // Live Status
        { wch: 12 }, // Final Result
        { wch: 18 }, // Judge
      ];
      XLSX.utils.book_append_sheet(wb, ws, unique);

      summaryRows.push([unique, cat.name + (cat.age_range_label ? ` (${cat.age_range_label})` : ''), tabLabel, rows.length, fin, vd, abs]);
    }

    // Prepend a Summary sheet
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
    summaryWs['!cols'] = [{ wch: 30 }, { wch: 36 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }];
    // book_append_sheet appends; to put Summary first we re-create the book
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, summaryWs, 'Summary');
    for (const nm of wb.SheetNames) XLSX.utils.book_append_sheet(wb2, wb.Sheets[nm], nm);

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    XLSX.writeFile(wb2, `MakeX_2026_Results_${stamp}.xlsx`);
  }

  async function clearJudgeData() {
    // Anything that the trial could have touched
    const touched = passations.filter(p =>
      p.final_result_status || p.live_status !== 'Scheduled' || p.score != null ||
      p.signature_image || p.judge_name || p.finalized_at ||
      (p.delay_count ?? 0) > 0
    );
    if (touched.length === 0) {
      alert('Nothing to clear — system is already in a clean state.');
      return;
    }
    const phrase = `clear ${touched.length}`;
    const typed = prompt(
      `This will reset EVERY trace of the trial run on ${touched.length} passations:\n\n` +
      `  • score, time, signature, judge name, finalized timestamp\n` +
      `  • live status → Scheduled, final result status → cleared\n` +
      `  • delay count → 0\n` +
      `  • queue positions → restored from original schedule order\n` +
      `  • score-breakdown notes stripped\n\n` +
      `Scheduling (table, scheduled time, round, students) is preserved.\n\n` +
      `Type exactly:  ${phrase}`
    );
    if (typed !== phrase) {
      alert('Cancelled.');
      return;
    }
    setClearing(true);
    let ok = 0, fail = 0;

    // Phase 1 — clear trial fields on every touched row
    for (const p of touched) {
      const cleanedNotes = stripBreakdown(p.notes);
      const { error } = await supabase.from('passations').update({
        score: null,
        time_seconds: null,
        signature_image: null,
        judge_name: null,
        finalized_at: null,
        live_status: 'Scheduled',
        final_result_status: null,
        delay_count: 0,
        notes: cleanedNotes,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id);
      if (error) fail++; else ok++;
    }

    // Phase 2 — restore queue_position per (table, round) by re-sorting by scheduled_time.
    // scheduled_time wasn't changed by delays, so it's the source of truth for the canonical order.
    const allRows = passations.slice();
    const byTableRound = new Map<string, Passation[]>();
    for (const p of allRows) {
      if (!p.table_id) continue;
      const k = `${p.table_id}|${p.round_number ?? 1}`;
      if (!byTableRound.has(k)) byTableRound.set(k, []);
      byTableRound.get(k)!.push(p);
    }
    for (const [k, rows] of byTableRound) {
      const [, roundStr] = k.split('|');
      const isR2 = roundStr === '2';
      const base = isR2 ? 1001 : 1; // matches the generator's offset
      rows.sort((a, b) => {
        const at = a.scheduled_time || '';
        const bt = b.scheduled_time || '';
        return at.localeCompare(bt);
      });
      for (let i = 0; i < rows.length; i++) {
        const expected = base + i;
        if (rows[i].queue_position !== expected) {
          await supabase.from('passations').update({
            queue_position: expected,
            updated_at: new Date().toISOString(),
          }).eq('id', rows[i].id);
        }
      }
    }

    setClearing(false);
    alert(`Cleared ${ok} passation${ok === 1 ? '' : 's'}.${fail ? ' Failed: ' + fail : ''}\nQueue positions restored from scheduled times.`);
    load();
  }

  if (loading) return <p className="text-slate-400 text-sm">Loading results…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Results &amp; Scoresheet Review</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            ✓ {stats.fin} finalized · ⚠ {stats.vd} void · ⊘ {stats.abs} absent · … {stats.sched} not yet judged
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadXlsxReport}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl">
            ⬇ Download Excel report
          </button>
          <button
            onClick={clearJudgeData}
            disabled={clearing}
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">
            {clearing ? 'Clearing…' : '🗑 Clear all judge test data'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2">
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name} {c.age_range_label && `(${c.age_range_label})`}</option>)}
        </select>
        <select value={filterRound} onChange={e => setFilterRound(e.target.value as 'all'|'1'|'2')}
          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="all">Both rounds</option>
          <option value="1">Round 1</option>
          <option value="2">Round 2</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all'|'finalized'|'void'|'absent'|'scheduled')}
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
              <tr><td colSpan={10} className="text-center py-12 text-slate-400">No passations match these filters.</td></tr>
            )}
            {filtered.map(p => {
              const isOpen = expanded.has(p.id);
              const bd = parseBreakdown(p.notes);
              const sheet = sheetForBreakdown(bd);
              const voidFlag = p.final_result_status === 'Void' || !!bd?.void;
              return (
                <Row
                  key={p.id}
                  p={p}
                  isOpen={isOpen}
                  voidFlag={voidFlag}
                  bd={bd}
                  sheet={sheet}
                  catLabel={catLabel(p.category_id)}
                  tableLabel={tableLabel(p.table_id)}
                  fmtTime={fmtTime}
                  onToggle={() => setExpanded(prev => {
                    const n = new Set(prev);
                    if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                    return n;
                  })}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ p, isOpen, voidFlag, bd, sheet, catLabel, tableLabel, fmtTime, onToggle }: {
  p: Passation; isOpen: boolean; voidFlag: boolean;
  bd: Breakdown | null; sheet: Sheet | undefined;
  catLabel: string; tableLabel: string;
  fmtTime: (s: string | null) => string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50/60 cursor-pointer" onClick={onToggle}>
        <td className="px-2 text-slate-400 text-center">{isOpen ? '▾' : '▸'}</td>
        <td className="px-3 py-2.5 font-semibold text-slate-800">{p.team_name}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600">{p.club_name || '—'}</td>
        <td className="px-3 py-2.5 text-xs text-slate-500">{catLabel}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600">{tableLabel}</td>
        <td className="px-3 py-2.5 text-xs text-slate-500">R{p.round_number ?? 1}</td>
        <td className={`px-3 py-2.5 text-right font-mono font-bold ${voidFlag ? 'text-red-600' : 'text-slate-800'}`}>
          {voidFlag ? 'VOID' : (p.score != null ? p.score : '—')}
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
            voidFlag ? 'bg-red-100 text-red-700' :
            p.final_result_status === 'Finished' ? 'bg-emerald-100 text-emerald-700' :
            p.live_status === 'Absent' ? 'bg-amber-100 text-amber-700' :
            p.live_status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
            'bg-slate-100 text-slate-500'
          }`}>
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
          <td colSpan={9} className="px-5 py-4">
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
                      Scoresheet breakdown — {sheet.name}
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
                                  {ch ? `${ch.label}` : <span className="text-slate-300">—</span>}
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
                    {p.score != null
                      ? 'Free-form score (no structured breakdown recorded for this category).'
                      : 'Not yet judged.'}
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
