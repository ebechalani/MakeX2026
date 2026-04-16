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

export default function LivePage() {
  const supabase = useMemo(() => createClient(), []);
  const [displays, setDisplays] = useState<TableDisplay[]>([]);
  const [filterCatId, setFilterCatId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [connected, setConnected] = useState(false);

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
      const now = tablePas.find(p => p.live_status === 'In Progress') || tablePas[0] || null;
      const rest = tablePas.filter(p => p.id !== now?.id);
      return { table, category: cat, now, next: rest[0] || null, prepare: rest[1] || null };
    }).filter(Boolean) as TableDisplay[];
    setDisplays(result);
    setLastUpdate(new Date());
  }, [supabase]);

  useEffect(() => {
    loadAll();
    const channel = supabase
      .channel('live-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, loadAll)
      .subscribe(status => {
        setConnected(status === 'SUBSCRIBED');
      });
    return () => { supabase.removeChannel(channel); };
  }, [loadAll, supabase]);

  const filtered = filterCatId ? displays.filter(d => d.category.id === filterCatId) : displays;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      {/* Header */}
      <header className="bg-[#0d1526] border-b border-white/5 px-6 py-4 flex items-center justify-between sticky top-0 z-30 backdrop-blur">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">MakeX 2026 <span className="text-blue-400">· LIVE</span></h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-xs text-white/40">
                {connected ? 'Live' : 'Connecting…'} · Updated {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-white/20"
            value={filterCatId}
            onChange={e => setFilterCatId(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
            ))}
          </select>
          <Link href="/" className="text-white/30 hover:text-white/60 text-sm transition">← Home</Link>
        </div>
      </header>

      {/* Grid */}
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(({ table, category, now, next, prepare }) => (
          <div key={table.id} className="bg-[#0d1526] rounded-2xl border border-white/5 overflow-hidden shadow-xl">
            {/* Table header */}
            <div className="bg-white/5 px-4 py-3 border-b border-white/5">
              <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest truncate">
                {category.name}{category.age_range_label ? ` · ${category.age_range_label}` : ''}
              </p>
              <p className="text-white text-lg font-black leading-tight mt-0.5">
                {table.display_label || `Table ${table.table_number}`}
              </p>
            </div>

            <div className="p-4 space-y-3">
              {/* NOW */}
              <div className={`rounded-xl p-4 border ${now ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-white/3 border-white/5'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {now && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  <p className="text-emerald-400 text-xs font-black uppercase tracking-widest">NOW</p>
                </div>
                {now ? (
                  <>
                    <p className="text-white font-black text-xl leading-tight">{now.team_name}</p>
                    {now.student_names && <p className="text-emerald-300/70 text-xs mt-1 truncate">{now.student_names}</p>}
                  </>
                ) : (
                  <p className="text-white/20 text-sm font-medium">Empty</p>
                )}
              </div>

              {/* NEXT */}
              <div className={`rounded-xl p-3.5 border ${next ? 'bg-blue-500/10 border-blue-500/30' : 'bg-white/3 border-white/5'}`}>
                <p className="text-blue-400 text-xs font-black uppercase tracking-widest mb-1.5">NEXT</p>
                {next ? (
                  <>
                    <p className="text-white font-bold text-base leading-tight">{next.team_name}</p>
                    {next.student_names && <p className="text-blue-300/60 text-xs mt-0.5 truncate">{next.student_names}</p>}
                  </>
                ) : (
                  <p className="text-white/15 text-sm">Empty</p>
                )}
              </div>

              {/* PREPARE */}
              <div className={`rounded-xl p-3.5 border ${prepare ? 'bg-amber-500/10 border-amber-500/20' : 'bg-white/3 border-white/5'}`}>
                <p className="text-amber-400 text-xs font-black uppercase tracking-widest mb-1.5">PREPARE</p>
                {prepare ? (
                  <>
                    <p className="text-white/80 font-semibold text-sm leading-tight">{prepare.team_name}</p>
                    {prepare.student_names && <p className="text-amber-300/50 text-xs mt-0.5 truncate">{prepare.student_names}</p>}
                  </>
                ) : (
                  <p className="text-white/15 text-sm">Empty</p>
                )}
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full text-center py-24">
            <svg className="w-16 h-16 text-white/10 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-white/30 text-xl font-semibold">No active tables</p>
            <p className="text-white/15 text-sm mt-2">Waiting for categories and passations to be configured by admin</p>
          </div>
        )}
      </div>
    </div>
  );
}
