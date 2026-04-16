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

// Show student name — fall back to team_name for old records
function getName(p: Passation | null): string {
  if (!p) return '';
  return p.student_names || p.team_name || '—';
}

function getTime(p: Passation | null): string {
  if (!p?.scheduled_time) return '';
  return new Date(p.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LivePage() {
  const supabase = useMemo(() => createClient(), []);
  const [displays, setDisplays] = useState<TableDisplay[]>([]);
  const [filterCatId, setFilterCatId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const [{ data: cats }, { data: tabs }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('tables').select('*').eq('active', true).order('table_number'),
      supabase.from('passations').select('*')
        .not('live_status', 'eq', 'Finished')
        .not('live_status', 'eq', 'Absent')
        .order('queue_position')
        .order('scheduled_time'),
    ]);
    if (!cats || !tabs || !pas) return;
    setCategories(cats as Category[]);
    const result: TableDisplay[] = (tabs as Table[]).map(table => {
      const cat = (cats as Category[]).find(c => c.id === table.category_id);
      if (!cat) return null;
      const tp = (pas as Passation[]).filter(p => p.table_id === table.id);
      const nowP = tp.find(p => p.live_status === 'In Progress') || tp[0] || null;
      const rest = tp.filter(p => p.id !== nowP?.id);
      return { table, category: cat, now: nowP, next: rest[0] || null, prepare: rest[1] || null };
    }).filter(Boolean) as TableDisplay[];
    setDisplays(result);
  }, [supabase]);

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel('live-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, loadAll)
      .subscribe(s => setConnected(s === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(ch); };
  }, [loadAll, supabase]);

  const filtered = filterCatId
    ? displays.filter(d => d.category.id === filterCatId)
    : displays;

  // Group by category
  const groups = filtered.reduce<{ cat: Category; rows: TableDisplay[] }[]>((acc, d) => {
    const g = acc.find(x => x.cat.id === d.category.id);
    if (g) g.rows.push(d);
    else acc.push({ cat: d.category, rows: [d] });
    return acc;
  }, []);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0f1a', color: '#fff' }}>

      {/* ── HEADER BAR ── */}
      <header style={{ background: '#111827', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        className="flex items-center justify-between px-6 py-3 sticky top-0 z-40">

        <div className="flex items-center gap-5">
          <div>
            <p className="text-xl font-black tracking-tight text-white">
              MakeX <span style={{ color: '#3b82f6' }}>2026</span>
              <span className="text-white/40 font-normal text-sm ml-3">Live Board</span>
            </p>
          </div>
          {/* Connection pill */}
          <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
            style={{ background: connected ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: connected ? '#4ade80' : '#f87171' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? '#4ade80' : '#f87171', boxShadow: connected ? '0 0 6px #4ade80' : 'none' }} />
            {connected ? 'LIVE' : 'Connecting…'}
          </span>
        </div>

        <div className="flex items-center gap-5">
          {/* Clock */}
          <div className="text-right">
            <p className="text-3xl font-black tabular-nums" style={{ color: '#e2e8f0', letterSpacing: '-0.02em' }}>
              {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-white/30 mt-0.5">
              {clock.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          </div>
          {/* Category filter */}
          <select
            className="text-sm rounded-xl px-3 py-2 focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0' }}
            value={filterCatId}
            onChange={e => setFilterCatId(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}
              </option>
            ))}
          </select>
          <Link href="/" className="text-xs text-white/25 hover:text-white/50 transition">← Home</Link>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <div className="flex-1 p-5 pb-12 space-y-8 overflow-auto">

        {groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32">
            <p className="text-4xl font-black text-white/10 mb-3">No Active Tables</p>
            <p className="text-white/20 text-sm">Waiting for admin to assign passations</p>
          </div>
        )}

        {groups.map(({ cat, rows }) => (
          <section key={cat.id}>
            {/* Category banner */}
            <div className="flex items-center gap-4 mb-4">
              <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
              <div className="flex items-center gap-2 px-4 py-1.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <span className="text-xs font-bold uppercase tracking-widest text-white/50">
                  {cat.name}
                </span>
                {cat.age_range_label && (
                  <span className="text-xs text-white/30">{cat.age_range_label}</span>
                )}
              </div>
              <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
            </div>

            {/* Table cards */}
            <div className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {rows.map(({ table, now, next, prepare }) => {
                const hasAny = !!(now || next || prepare);
                return (
                  <div key={table.id}
                    className="rounded-2xl overflow-hidden flex flex-col"
                    style={{
                      background: '#141b2d',
                      border: hasAny ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.04)',
                      boxShadow: hasAny ? '0 4px 24px rgba(0,0,0,0.5)' : 'none',
                    }}>

                    {/* Table header */}
                    <div className="flex items-center justify-between px-4 py-3"
                      style={{ background: '#1e2a3d', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      <span className="font-black text-lg text-white">
                        {table.display_label || `Table ${table.table_number}`}
                      </span>
                      {now && (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5"
                          style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400"
                            style={{ boxShadow: '0 0 6px #4ade80', animation: 'pulse 2s infinite' }} />
                          ACTIVE
                        </span>
                      )}
                    </div>

                    {/* ── NOW ── */}
                    <div className="px-4 pt-4 pb-4 flex-1"
                      style={{ background: now ? 'rgba(22,163,74,0.25)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black uppercase tracking-widest"
                          style={{ color: now ? '#4ade80' : 'rgba(255,255,255,0.2)' }}>
                          ▶ NOW
                        </span>
                        {now && getTime(now) && (
                          <span className="text-xs font-mono px-2 py-0.5 rounded-md"
                            style={{ background: 'rgba(0,0,0,0.3)', color: 'rgba(74,222,128,0.8)' }}>
                            {getTime(now)}
                          </span>
                        )}
                      </div>
                      {now ? (
                        <p className="font-black text-white leading-tight"
                          style={{ fontSize: 'clamp(1.1rem, 2.5vw, 1.5rem)' }}>
                          {getName(now)}
                        </p>
                      ) : (
                        <p className="font-semibold" style={{ color: 'rgba(255,255,255,0.1)', fontSize: '1rem' }}>
                          — Waiting —
                        </p>
                      )}
                    </div>

                    {/* ── NEXT ── */}
                    <div className="px-4 py-3"
                      style={{ background: next ? 'rgba(37,99,235,0.25)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-black uppercase tracking-widest"
                          style={{ color: next ? '#60a5fa' : 'rgba(255,255,255,0.15)' }}>
                          ⏭ NEXT
                        </span>
                        {next && getTime(next) && (
                          <span className="text-xs font-mono px-2 py-0.5 rounded-md"
                            style={{ background: 'rgba(0,0,0,0.3)', color: 'rgba(96,165,250,0.7)' }}>
                            {getTime(next)}
                          </span>
                        )}
                      </div>
                      {next ? (
                        <p className="font-bold text-white text-base leading-tight">{getName(next)}</p>
                      ) : (
                        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.1)' }}>—</p>
                      )}
                    </div>

                    {/* ── PREPARE ── */}
                    <div className="px-4 py-3"
                      style={{ background: prepare ? 'rgba(180,83,9,0.2)' : 'transparent' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-black uppercase tracking-widest"
                          style={{ color: prepare ? '#fbbf24' : 'rgba(255,255,255,0.12)' }}>
                          ⚑ PREPARE
                        </span>
                        {prepare && getTime(prepare) && (
                          <span className="text-xs font-mono px-2 py-0.5 rounded-md"
                            style={{ background: 'rgba(0,0,0,0.3)', color: 'rgba(251,191,36,0.7)' }}>
                            {getTime(prepare)}
                          </span>
                        )}
                      </div>
                      {prepare ? (
                        <p className="font-semibold text-sm leading-tight" style={{ color: 'rgba(255,255,255,0.85)' }}>
                          {getName(prepare)}
                        </p>
                      ) : (
                        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.1)' }}>—</p>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* ── STATUS FOOTER ── */}
      <div className="fixed bottom-0 left-0 right-0 py-2 px-6 flex items-center justify-between"
        style={{ background: 'rgba(11,15,26,0.95)', borderTop: '1px solid rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)' }}>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
          MakeX 2026 · Lebanon National Competition
        </p>
        <p className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.15)' }}>
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>

    </div>
  );
}
