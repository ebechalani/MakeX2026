'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation } from '@/lib/types';

interface TableDisplay {
  table: Table;
  category: Category;
  now: Passation | null;
  next: Passation | null;
  prepare: Passation | null;
}

function getName(p: Passation | null): string {
  if (!p) return '';
  return p.student_names || p.team_name || '—';
}

function getTime(p: Passation | null): string {
  if (!p?.scheduled_time) return '';
  return new Date(p.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Assign a consistent accent color per category index
const CAT_ACCENTS = [
  { hdr: '#1e40af', pill: '#3b82f6', glow: 'rgba(59,130,246,0.15)' },
  { hdr: '#7c2d12', pill: '#f97316', glow: 'rgba(249,115,22,0.15)' },
  { hdr: '#14532d', pill: '#22c55e', glow: 'rgba(34,197,94,0.15)' },
  { hdr: '#4c1d95', pill: '#a78bfa', glow: 'rgba(167,139,250,0.15)' },
  { hdr: '#7f1d1d', pill: '#f87171', glow: 'rgba(248,113,113,0.15)' },
  { hdr: '#0c4a6e', pill: '#38bdf8', glow: 'rgba(56,189,248,0.15)' },
];

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
      const nowP = tp.find(p => p.live_status === 'In Progress') || tp.find(p => p.live_status === 'Next') || tp[0] || null;
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

  // Group by category (preserve insertion order)
  const groups = filtered.reduce<{ cat: Category; rows: TableDisplay[]; idx: number }[]>((acc, d) => {
    const g = acc.find(x => x.cat.id === d.category.id);
    if (g) g.rows.push(d);
    else acc.push({ cat: d.category, rows: [d], idx: acc.length });
    return acc;
  }, []);

  return (
    <div className="min-h-screen flex flex-col select-none"
      style={{ background: '#060a12', color: '#fff', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── HEADER ── */}
      <header style={{ background: 'linear-gradient(90deg,#0f172a 0%,#111827 100%)', borderBottom: '2px solid rgba(59,130,246,0.4)' }}
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-40">

        <div className="flex items-center gap-6">
          <div>
            <p style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1 }}>
              MakeX <span style={{ color: '#3b82f6' }}>2026</span>
            </p>
            <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: '2px' }}>
              Lebanon · Live Board
            </p>
          </div>
          {/* Live pill */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '0.85rem', fontWeight: 800, letterSpacing: '0.08em',
            padding: '5px 14px', borderRadius: '999px',
            background: connected ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: connected ? '#4ade80' : '#f87171',
            border: `1px solid ${connected ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
          }}>
            <span style={{
              width: 9, height: 9, borderRadius: '50%',
              background: connected ? '#4ade80' : '#f87171',
              boxShadow: connected ? '0 0 8px #4ade80' : 'none',
              animation: connected ? 'livepulse 1.8s ease-in-out infinite' : 'none',
            }} />
            {connected ? 'LIVE' : 'Connecting…'}
          </span>
        </div>

        <div className="flex items-center gap-8">
          {/* Category filter */}
          <select
            style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '0.9rem',
              fontWeight: 600, cursor: 'pointer',
            }}
            value={filterCatId}
            onChange={e => setFilterCatId(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}
              </option>
            ))}
          </select>

          {/* Big clock */}
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1, color: '#f1f5f9', fontVariantNumeric: 'tabular-nums' }}>
              {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.3)', textAlign: 'right', marginTop: 2 }}>
              {clock.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, padding: '20px 24px 80px', overflow: 'auto' }}>

        {groups.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
            <p style={{ fontSize: '3rem', fontWeight: 900, color: 'rgba(255,255,255,0.07)', marginBottom: 8 }}>No Active Tables</p>
            <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: '1.1rem' }}>Waiting for judge activity…</p>
          </div>
        )}

        {groups.map(({ cat, rows, idx }) => {
          const accent = CAT_ACCENTS[idx % CAT_ACCENTS.length];
          return (
            <section key={cat.id} style={{ marginBottom: 28 }}>

              {/* Category banner */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ height: 2, flex: 1, background: `linear-gradient(90deg, transparent, ${accent.pill}40)` }} />
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 20px', borderRadius: '999px',
                  background: accent.glow,
                  border: `1px solid ${accent.pill}50`,
                }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', color: accent.pill }}>
                    {cat.name}
                  </span>
                  {cat.age_range_label && (
                    <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                      {cat.age_range_label}
                    </span>
                  )}
                </div>
                <div style={{ height: 2, flex: 1, background: `linear-gradient(90deg, ${accent.pill}40, transparent)` }} />
              </div>

              {/* Table cards grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(320px, 1fr))`,
                gap: 14,
              }}>
                {rows.map(({ table, now, next, prepare }) => {
                  const isActive = now?.live_status === 'In Progress';
                  return (
                    <div key={table.id} style={{
                      borderRadius: 16,
                      overflow: 'hidden',
                      background: '#0d1220',
                      border: isActive
                        ? `2px solid ${accent.pill}70`
                        : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: isActive ? `0 0 32px ${accent.pill}25` : '0 2px 12px rgba(0,0,0,0.5)',
                      display: 'flex', flexDirection: 'column',
                    }}>

                      {/* Table header */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 16px',
                        background: isActive ? accent.hdr : '#141b2d',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                      }}>
                        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
                          {table.display_label || `Table ${table.table_number}`}
                        </span>
                        {isActive && (
                          <span style={{
                            fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.1em',
                            padding: '3px 10px', borderRadius: '999px',
                            background: 'rgba(34,197,94,0.25)', color: '#4ade80',
                            border: '1px solid rgba(74,222,128,0.4)',
                            display: 'flex', alignItems: 'center', gap: 5,
                          }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80', display: 'inline-block' }} />
                            ON AIR
                          </span>
                        )}
                      </div>

                      {/* NOW */}
                      <div style={{
                        padding: '14px 16px',
                        background: now ? (isActive ? 'rgba(22,163,74,0.18)' : 'rgba(59,130,246,0.12)') : 'transparent',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        flex: '0 0 auto',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
                            color: isActive ? '#4ade80' : (now ? '#60a5fa' : 'rgba(255,255,255,0.18)'),
                          }}>
                            {isActive ? '▶ NOW RUNNING' : (now ? '▶ CURRENT' : '▶ NOW')}
                          </span>
                          {now && getTime(now) && (
                            <span style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', padding: '2px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: 6 }}>
                              {getTime(now)}
                            </span>
                          )}
                        </div>
                        {now ? (
                          <p style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.02em', wordBreak: 'break-word' }}>
                            {getName(now)}
                          </p>
                        ) : (
                          <p style={{ fontSize: '1.1rem', color: 'rgba(255,255,255,0.12)', fontStyle: 'italic' }}>— Waiting —</p>
                        )}
                        {now?.club_name && (
                          <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)', marginTop: 3, fontWeight: 500 }}>
                            {now.club_name}
                          </p>
                        )}
                      </div>

                      {/* NEXT */}
                      <div style={{
                        padding: '10px 16px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        background: next ? 'rgba(37,99,235,0.1)' : 'transparent',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: next ? '#60a5fa' : 'rgba(255,255,255,0.15)' }}>
                            ⏭ NEXT
                          </span>
                          {next && getTime(next) && (
                            <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', padding: '1px 7px', background: 'rgba(0,0,0,0.25)', borderRadius: 5 }}>
                              {getTime(next)}
                            </span>
                          )}
                        </div>
                        {next ? (
                          <>
                            <p style={{ fontSize: '1.25rem', fontWeight: 800, color: '#e2e8f0', lineHeight: 1.2, letterSpacing: '-0.01em', wordBreak: 'break-word' }}>
                              {getName(next)}
                            </p>
                            {next.club_name && (
                              <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                                {next.club_name}
                              </p>
                            )}
                          </>
                        ) : (
                          <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.1)', fontStyle: 'italic' }}>—</p>
                        )}
                      </div>

                      {/* PREPARE */}
                      <div style={{
                        padding: '9px 16px',
                        background: prepare ? 'rgba(180,83,9,0.1)' : 'transparent',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: prepare ? '#fbbf24' : 'rgba(255,255,255,0.12)' }}>
                            ⚑ PREPARE
                          </span>
                          {prepare && getTime(prepare) && (
                            <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', padding: '1px 7px', background: 'rgba(0,0,0,0.2)', borderRadius: 5 }}>
                              {getTime(prepare)}
                            </span>
                          )}
                        </div>
                        {prepare ? (
                          <>
                            <p style={{ fontSize: '1.05rem', fontWeight: 700, color: 'rgba(255,255,255,0.75)', lineHeight: 1.2, wordBreak: 'break-word' }}>
                              {getName(prepare)}
                            </p>
                            {prepare.club_name && (
                              <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.28)', marginTop: 2 }}>
                                {prepare.club_name}
                              </p>
                            )}
                          </>
                        ) : (
                          <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.1)', fontStyle: 'italic' }}>—</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '8px 28px',
        background: 'rgba(6,10,18,0.96)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.2)', fontWeight: 600, letterSpacing: '0.05em' }}>
          MakeX 2026 · Lebanon National Competition
        </p>
        <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>

      <style>{`
        @keyframes livepulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px #4ade80; }
          50% { opacity: 0.5; box-shadow: 0 0 3px #4ade80; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>
    </div>
  );
}
