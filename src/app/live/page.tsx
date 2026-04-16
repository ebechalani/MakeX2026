'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation } from '@/lib/types';
import Link from 'next/link';

interface TableDisplay {
  table: Table;
  category: Category;
  now: Passation | null;
  next: Passation | null;
  prepare: Passation | null;
}

function fmt(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LivePage() {
  const supabase = useMemo(() => createClient(), []);
  const [displays, setDisplays] = useState<TableDisplay[]>([]);
  const [filterCatId, setFilterCatId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(new Date());

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const [{ data: cats }, { data: tabs }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('tables').select('*').eq('active', true).order('table_number'),
      supabase.from('passations').select('*')
        .not('live_status', 'eq', 'Finished')
        .not('live_status', 'eq', 'Absent')
        .order('queue_position').order('scheduled_time'),
    ]);
    if (!cats || !tabs || !pas) return;
    setCategories(cats as Category[]);
    const result: TableDisplay[] = (tabs as Table[]).map(table => {
      const cat = (cats as Category[]).find(c => c.id === table.category_id);
      if (!cat) return null;
      const tablePas = (pas as Passation[]).filter(p => p.table_id === table.id);
      const current = tablePas.find(p => p.live_status === 'In Progress') || tablePas[0] || null;
      const rest = tablePas.filter(p => p.id !== current?.id);
      return { table, category: cat, now: current, next: rest[0] || null, prepare: rest[1] || null };
    }).filter(Boolean) as TableDisplay[];
    setDisplays(result);
    setLastUpdate(new Date());
  }, [supabase]);

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel('live-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, loadAll)
      .subscribe(status => setConnected(status === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(channel); };
  }, [loadAll, supabase]);

  const filtered = filterCatId ? displays.filter(d => d.category.id === filterCatId) : displays;

  // Group by category for better layout
  const grouped = filtered.reduce<Record<string, TableDisplay[]>>((acc, d) => {
    const key = d.category.id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-950 text-white overflow-x-hidden">

      {/* ── Top bar ── */}
      <header className="bg-gray-900 border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>
          <span className="text-white font-black text-lg tracking-tight">
            MakeX 2026 <span className="text-blue-400">LIVE</span>
          </span>
          <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold ${connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {connected ? 'Live' : 'Connecting'}
          </span>
        </div>

        <div className="flex items-center gap-5">
          {/* Live clock */}
          <div className="text-right hidden sm:block">
            <p className="text-2xl font-black text-white tabular-nums">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
            <p className="text-xs text-white/30">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>

          <select
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
            value={filterCatId}
            onChange={e => setFilterCatId(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}
              </option>
            ))}
          </select>
          <Link href="/" className="text-white/30 hover:text-white/60 text-sm transition">← Home</Link>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="p-5 space-y-8">
        {Object.entries(grouped).map(([catId, tableDisplays]) => {
          const cat = tableDisplays[0].category;
          return (
            <section key={catId}>
              {/* Category heading */}
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-white/10" />
                <h2 className="text-sm font-bold text-white/40 uppercase tracking-widest px-2">
                  {cat.name}{cat.age_range_label ? ` · ${cat.age_range_label}` : ''}
                </h2>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Table cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {tableDisplays.map(({ table, now: nowTeam, next: nextTeam, prepare: prepTeam }) => (
                  <div key={table.id} className="rounded-2xl overflow-hidden border border-white/8 shadow-2xl flex flex-col">

                    {/* Table label */}
                    <div className="bg-gray-800 px-5 py-3 flex items-center justify-between">
                      <span className="text-white font-black text-xl tracking-tight">
                        {table.display_label || `Table ${table.table_number}`}
                      </span>
                      {nowTeam && (
                        <span className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-full">
                          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                          ACTIVE
                        </span>
                      )}
                    </div>

                    {/* NOW — large, full green */}
                    <div className={`px-5 py-5 flex-1 ${nowTeam ? 'bg-emerald-600' : 'bg-gray-900/60'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-100/80">
                          ▶ NOW
                        </span>
                        {nowTeam?.scheduled_time && (
                          <span className="text-xs font-mono bg-black/20 text-emerald-100/70 px-2 py-0.5 rounded-md">
                            {fmt(nowTeam.scheduled_time)}
                          </span>
                        )}
                      </div>
                      {nowTeam ? (
                        <>
                          <p className="text-white font-black text-2xl leading-tight">{nowTeam.team_name}</p>
                          {nowTeam.student_names && (
                            <p className="text-emerald-100/70 text-sm mt-1 truncate">{nowTeam.student_names}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-white/20 text-lg font-semibold mt-1">— Waiting —</p>
                      )}
                    </div>

                    {/* NEXT — blue */}
                    <div className={`px-5 py-4 border-t border-white/5 ${nextTeam ? 'bg-blue-700' : 'bg-gray-900/40'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-blue-100/70">
                          ⏭ NEXT
                        </span>
                        {nextTeam?.scheduled_time && (
                          <span className="text-xs font-mono bg-black/20 text-blue-100/60 px-2 py-0.5 rounded-md">
                            {fmt(nextTeam.scheduled_time)}
                          </span>
                        )}
                      </div>
                      {nextTeam ? (
                        <>
                          <p className="text-white font-bold text-lg leading-tight">{nextTeam.team_name}</p>
                          {nextTeam.student_names && (
                            <p className="text-blue-100/60 text-xs mt-0.5 truncate">{nextTeam.student_names}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-white/15 text-sm">—</p>
                      )}
                    </div>

                    {/* PREPARE — amber */}
                    <div className={`px-5 py-3.5 border-t border-white/5 ${prepTeam ? 'bg-amber-600' : 'bg-gray-900/30'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/70">
                          ⚑ PREPARE
                        </span>
                        {prepTeam?.scheduled_time && (
                          <span className="text-xs font-mono bg-black/20 text-amber-100/60 px-2 py-0.5 rounded-md">
                            {fmt(prepTeam.scheduled_time)}
                          </span>
                        )}
                      </div>
                      {prepTeam ? (
                        <>
                          <p className="text-white font-semibold text-base leading-tight">{prepTeam.team_name}</p>
                          {prepTeam.student_names && (
                            <p className="text-amber-100/55 text-xs mt-0.5 truncate">{prepTeam.student_names}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-white/15 text-sm">—</p>
                      )}
                    </div>

                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-32">
            <p className="text-white/20 text-3xl font-black">No active tables</p>
            <p className="text-white/10 text-base mt-2">Waiting for the admin to configure passations</p>
          </div>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-white/5 px-6 py-2 flex items-center justify-between">
        <p className="text-white/30 text-xs">MakeX 2026 · Lebanon National Competition</p>
        <p className="text-white/20 text-xs tabular-nums">
          Last updated: {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
