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

  function tableLabel(t: Table) {
    const cat = categories.find(c => c.id === t.category_id);
    return `${cat?.name || '?'} · ${t.display_label || `Table ${t.table_number}`}`;
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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-800">Judges</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {judges.length} judges · {assignments.length} table assignment{assignments.length === 1 ? '' : 's'} · click a chip to toggle
        </p>
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
              {Array.from(tablesByCat.entries()).map(([catId, catTables]) => {
                const cat = categories.find(c => c.id === catId);
                return (
                  <div key={catId}>
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      {cat?.name} {cat?.age_range_label && <span className="font-normal">({cat.age_range_label})</span>}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {catTables.map(t => {
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
                                  : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            {mine ? '✓ ' : takenByOther ? '🔒 ' : ''}{t.display_label || `Table ${t.table_number}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
