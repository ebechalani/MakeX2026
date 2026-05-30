'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table } from '@/lib/types';

type Judge = { id: string; name: string; username: string; whatsapp_number: string | null; password_plain: string | null };
type Assignment = { judge_id: string; table_id: string };

export default function JudgesTab() {
  const supabase = useMemo(() => createClient(), []);
  const [judges, setJudges] = useState<Judge[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [j, t, c, a] = await Promise.all([
      supabase.from('judges').select('id, name, username, whatsapp_number, password_plain').order('username'),
      supabase.from('tables').select('*').eq('active', true).order('category_id').order('table_number'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('judge_tables').select('judge_id, table_id'),
    ]);
    if (j.data) setJudges(j.data as Judge[]);
    if (t.data) setTables(t.data as Table[]);
    if (c.data) setCategories(c.data as Category[]);
    if (a.data) setAssignments(a.data as Assignment[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // judge_id → Set<table_id>
  const byJudge = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!m.has(a.judge_id)) m.set(a.judge_id, new Set());
      m.get(a.judge_id)!.add(a.table_id);
    }
    return m;
  }, [assignments]);

  // table_id → judge_id that owns it (first assignment wins)
  const tableOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments) {
      if (!m.has(a.table_id)) m.set(a.table_id, a.judge_id);
    }
    return m;
  }, [assignments]);

  // Derive a judge's home category from their username prefix
  function homeCategoryId(username: string): string | null {
    const u = username.toLowerCase();
    let pattern = '';
    if (u.startsWith('csoccer'))   pattern = 'capelli soccer';
    else if (u.startsWith('cinspire'))  pattern = 'capelli inspire';
    else if (u.startsWith('cstarter'))  pattern = 'capelli starter';
    else if (u.startsWith('minspire'))  pattern = 'makex inspire';
    else if (u.startsWith('mstarter'))  pattern = 'makex starter';
    if (!pattern) return null;
    return categories.find(c => c.name.toLowerCase().includes(pattern.split(' ')[0]) &&
                                c.name.toLowerCase().includes(pattern.split(' ')[1]))?.id ?? null;
  }

  async function toggle(judge_id: string, table_id: string, currentlyAssigned: boolean) {
    setBusyKey(judge_id + '|' + table_id);
    if (currentlyAssigned) {
      await supabase.rpc('unassign_judge_table', { p_judge_id: judge_id, p_table_id: table_id });
    } else {
      await supabase.rpc('assign_judge_table', { p_judge_id: judge_id, p_table_id: table_id });
    }
    await load();
    setBusyKey('');
  }

  if (loading) return <p className="text-slate-400 text-sm">Loading judges…</p>;

  const tablesByCat = new Map<string, Table[]>();
  for (const t of tables) {
    if (!tablesByCat.has(t.category_id)) tablesByCat.set(t.category_id, []);
    tablesByCat.get(t.category_id)!.push(t);
  }

  const swCat = categories.find(c => /sportswonderland/i.test(c.name));
  const swTables = swCat ? (tablesByCat.get(swCat.id) || []) : [];

  // ── Print credentials ────────────────────────────────────────────────────────
  function printCredentials() {
    const rows = judges.map(j => {
      const myTables = [...(byJudge.get(j.id) || new Set<string>())];
      const tableLabels = myTables.map(tid => {
        const t = tables.find(x => x.id === tid);
        if (!t) return '';
        const cat = categories.find(c => c.id === t.category_id);
        return `${cat?.name ?? ''}${cat?.age_range_label ? ` (${cat.age_range_label})` : ''} — ${t.display_label || `Table ${t.table_number}`}`;
      }).filter(Boolean).join('\n');
      return { name: j.name, username: j.username, password: j.password_plain || '—', tables: tableLabels || '— none assigned —' };
    });

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Judge Credentials — MakeX 2026</title>
<style>
  body { font-family: Arial, sans-serif; background:#f1f5f9; margin:0; padding:24px; }
  h1 { text-align:center; font-size:20px; margin-bottom:24px; color:#1e293b; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
  .card { background:white; border:2px solid #e2e8f0; border-radius:12px; padding:20px; page-break-inside:avoid; }
  .card-header { font-size:13px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px; }
  .name { font-size:18px; font-weight:900; color:#0f172a; margin-bottom:12px; }
  .row { display:flex; gap:8px; align-items:baseline; margin-bottom:6px; }
  .label { font-size:11px; color:#94a3b8; font-weight:700; text-transform:uppercase; width:68px; flex-shrink:0; }
  .value { font-size:14px; font-family:monospace; color:#1e293b; font-weight:700; }
  .tables { font-size:12px; color:#475569; white-space:pre-line; line-height:1.6; }
  @media print { body{background:white;padding:0;} h1{margin-top:16px;} }
</style></head><body>
<h1>MakeX 2026 Lebanon — Judge Credentials</h1>
<div class="grid">
${rows.map(r => `<div class="card">
  <div class="card-header">Judge Access Card</div>
  <div class="name">${r.name}</div>
  <div class="row"><span class="label">Username</span><span class="value">${r.username}</span></div>
  <div class="row"><span class="label">Password</span><span class="value">${r.password}</span></div>
  <div class="row" style="align-items:flex-start"><span class="label">Tables</span><span class="tables">${r.tables}</span></div>
</div>`).join('')}
</div>
<script>window.onload=function(){window.print();}</script>
</body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800">Judges</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {judges.length} judges · {assignments.length} table assignment{assignments.length === 1 ? '' : 's'} · click a chip to toggle
          </p>
        </div>
        <button
          onClick={printCredentials}
          disabled={judges.length === 0}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-semibold transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Credentials
        </button>
      </div>

      {judges.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
          No judges in the database yet. Run <code>scripts/seed_judges.sql</code> in Supabase to create them.
        </div>
      )}

      {judges.map(j => {
        const my = byJudge.get(j.id) || new Set<string>();
        return (
          <div key={j.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-800">{j.name}</h3>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-xs font-mono bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded">
                    <span className="text-slate-400 font-sans">user</span> {j.username}
                  </span>
                  {j.password_plain ? (
                    <span className="inline-flex items-center gap-1 text-xs font-mono bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 rounded">
                      <span className="text-amber-400 font-sans">pw</span> {j.password_plain}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 italic">password hidden</span>
                  )}
                  <span className="text-xs text-slate-400">
                    {my.size === 0 ? <span className="text-amber-600 not-italic">⚠ no tables assigned</span> :
                     `${my.size} table${my.size === 1 ? '' : 's'} assigned`}
                  </span>
                </div>
              </div>
              {j.whatsapp_number && <span className="text-xs text-slate-400 shrink-0">📱 {j.whatsapp_number}</span>}
            </div>
            <div className="p-4 space-y-3">
              {(() => {
                const homeCatId = homeCategoryId(j.username);
                const homeTables = homeCatId ? (tablesByCat.get(homeCatId) || []) : [];
                const homeCat = homeCatId ? categories.find(c => c.id === homeCatId) : null;

                const sections: { label: string; tables: Table[]; isSW: boolean }[] = [];
                if (homeTables.length > 0 && homeCatId !== swCat?.id) {
                  sections.push({ label: homeCat?.name || 'My Category', tables: homeTables, isSW: false });
                }
                if (swTables.length > 0) {
                  sections.push({ label: 'Sportswonderland', tables: swTables, isSW: true });
                }

                return sections.map(({ label, tables: sectionTables, isSW }) => (
                  <div key={label}>
                    <p className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 ${isSW ? 'text-orange-400' : 'text-slate-400'}`}>
                      {label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sectionTables.map(t => {
                        const mine = my.has(t.id);
                        const ownerId = tableOwner.get(t.id);
                        const takenByOther = !!ownerId && !mine;
                        const ownerName = takenByOther ? judges.find(jj => jj.id === ownerId)?.name : null;
                        const busy = busyKey === j.id + '|' + t.id;
                        return (
                          <button key={t.id}
                            onClick={() => !takenByOther && toggle(j.id, t.id, mine)}
                            disabled={busy || takenByOther}
                            title={takenByOther ? `Already assigned to ${ownerName || 'another judge'}` : ''}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
                              mine
                                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500'
                                : takenByOther
                                  ? 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed opacity-60'
                                  : isSW
                                    ? 'bg-orange-50 border-orange-200 text-orange-700 hover:border-orange-300'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {mine ? '✓ ' : takenByOther ? '🔒 ' : ''}{t.display_label || `Table ${t.table_number}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
