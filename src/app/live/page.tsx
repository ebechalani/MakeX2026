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
    setCategories(cats);
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  const filtered = filterCatId ? displays.filter(d => d.category.id === filterCatId) : displays;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-wide">MakeX 2026 — LIVE</h1>
          <p className="text-gray-400 text-xs mt-0.5">Updated: {lastUpdate.toLocaleTimeString()}</p>
        </div>
        <div className="flex items-center gap-4">
          <select className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm"
            value={filterCatId} onChange={e => setFilterCatId(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
            ))}
          </select>
          <Link href="/" className="text-gray-400 hover:text-white text-sm">← Home</Link>
        </div>
      </header>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(({ table, category, now, next, prepare }) => (
          <div key={table.id} className="bg-gray-800 rounded-2xl overflow-hidden border border-gray-700">
            <div className="bg-gray-700 px-4 py-3">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                {category.name}{category.age_range_label ? ` · ${category.age_range_label}` : ''}
              </p>
              <p className="text-xl font-black">{table.display_label || `Table ${table.table_number}`}</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="bg-green-900 border border-green-500 rounded-xl p-3">
                <p className="text-green-400 text-xs font-black uppercase tracking-wider mb-1">NOW</p>
                {now ? (
                  <>
                    <p className="text-white font-black text-lg leading-tight">{now.team_name}</p>
                    {now.student_names && <p className="text-green-300 text-xs mt-0.5">{now.student_names}</p>}
                  </>
                ) : <p className="text-green-600 text-sm">— Empty —</p>}
              </div>
              <div className="bg-blue-900/50 border border-blue-700 rounded-xl p-3">
                <p className="text-blue-400 text-xs font-black uppercase tracking-wider mb-1">NEXT</p>
                {next ? (
                  <>
                    <p className="text-white font-bold text-base leading-tight">{next.team_name}</p>
                    {next.student_names && <p className="text-blue-300 text-xs mt-0.5">{next.student_names}</p>}
                  </>
                ) : <p className="text-blue-700 text-sm">— Empty —</p>}
              </div>
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-3">
                <p className="text-yellow-400 text-xs font-black uppercase tracking-wider mb-1">PREPARE</p>
                {prepare ? (
                  <>
                    <p className="text-white font-medium text-sm leading-tight">{prepare.team_name}</p>
                    {prepare.student_names && <p className="text-yellow-300 text-xs mt-0.5">{prepare.student_names}</p>}
                  </>
                ) : <p className="text-yellow-700 text-sm">— Empty —</p>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-20 text-gray-500">
            <p className="text-2xl">No active tables</p>
            <p className="text-sm mt-2">Waiting for categories and passations to be configured</p>
          </div>
        )}
      </div>
    </div>
  );
}
