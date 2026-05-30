'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation } from '@/lib/types';

type ViewMode = 'mbot2' | 'sw';

const isSW    = (c: Category) => /sports\s*wonderland/i.test(c.name);
const isMBot2 = (c: Category) => !isSW(c) && !/capelli\s*soccer/i.test(c.name) && !/makex\s*starter/i.test(c.name);

function getName(p: Passation | null) {
  if (!p) return null;
  return p.student_names || p.team_name || null;
}

function fmtTime(s: string | null) {
  if (!s) return '';
  return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

const STATUS_COLOR: Record<string, string> = {
  'In Progress': '#22c55e',
  'Next':        '#3b82f6',
  'Prepare':     '#f59e0b',
  'Scheduled':   '#94a3b8',
  'Delayed':     '#f97316',
  'Finished':    '#6b7280',
  'Absent':      '#ef4444',
};

// Soft category accent colours (cycles)
const CAT_COLORS = [
  '#3b82f6', '#a78bfa', '#34d399', '#f59e0b',
  '#f87171', '#38bdf8', '#fb923c', '#4ade80',
];

export default function DisplayPage() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories]   = useState<Category[]>([]);
  const [tables, setTables]           = useState<Table[]>([]);
  const [passations, setPassations]   = useState<Passation[]>([]);
  const [view, setView]               = useState<ViewMode>('mbot2');
  const [connected, setConnected]     = useState(false);
  const [clock, setClock]             = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const [{ data: cats }, { data: tabs }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('tables').select('*').eq('active', true).order('category_id').order('table_number'),
      supabase.from('passations')
        .select('*')
        .in('live_status', ['Scheduled', 'Prepare', 'Next', 'In Progress', 'Delayed'])
        .order('queue_position')
        .order('scheduled_time'),
    ]);
    if (cats) setCategories(cats as Category[]);
    if (tabs) setTables(tabs as Table[]);
    if (pas)  setPassations(pas as Passation[]);
  }, [supabase]);

  useEffect(() => {
    load();
    const ch = supabase.channel('display-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, load)
      .subscribe(s => setConnected(s === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(ch); };
  }, [load, supabase]);

  // Filter categories by view
  const visibleCats = useMemo(() =>
    categories.filter(c => view === 'sw' ? isSW(c) : isMBot2(c)),
    [categories, view]
  );

  // Map category id → accent color
  const catColor = useMemo(() => {
    const m = new Map<string, string>();
    visibleCats.forEach((c, i) => m.set(c.id, CAT_COLORS[i % CAT_COLORS.length]));
    return m;
  }, [visibleCats]);

  // Group tables by category (only visible cats)
  const groups = useMemo(() => {
    const catIds = new Set(visibleCats.map(c => c.id));
    const result: { cat: Category; color: string; rows: { table: Table; now: Passation | null; next: Passation | null }[] }[] = [];
    for (const cat of visibleCats) {
      const catTables = tables.filter(t => t.category_id === cat.id);
      const rows = catTables.map(table => {
        const tp = passations
          .filter(p => p.table_id === table.id)
          .sort((a, b) => (a.queue_position ?? 999) - (b.queue_position ?? 999));
        const now = tp.find(p => p.live_status === 'In Progress')
          || tp.find(p => p.live_status === 'Next')
          || tp.find(p => p.live_status === 'Prepare')
          || tp[0] || null;
        const next = tp.find(p => p !== now && p.live_status !== 'Finished' && p.live_status !== 'Absent') || null;
        return { table, now, next };
      });
      if (rows.length > 0) result.push({ cat, color: catColor.get(cat.id) ?? '#3b82f6', rows });
    }
    return result;
  }, [visibleCats, tables, passations, catColor]);

  return (
    <div style={{ minHeight: '100vh', background: '#0b0f1a', color: '#f1f5f9', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── TOP BAR ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(11,15,26,0.97)',
        borderBottom: '2px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(12px)',
        padding: '14px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        {/* Left: branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div>
            <p style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1 }}>
              MakeX <span style={{ color: '#3b82f6' }}>2026</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'rgba(255,255,255,0.35)', marginLeft: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Lebanon</span>
            </p>
            <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', marginTop: 2, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Table Display
            </p>
          </div>
          {/* Live dot */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.1em',
            padding: '4px 12px', borderRadius: 999,
            background: connected ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: connected ? '#4ade80' : '#f87171',
            border: `1px solid ${connected ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected ? '#4ade80' : '#f87171',
              boxShadow: connected ? '0 0 6px #4ade80' : 'none',
            }} />
            {connected ? 'LIVE' : '...'}
          </span>
        </div>

        {/* Centre: toggle */}
        <div style={{
          display: 'flex', gap: 4, padding: 4,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {([['mbot2', '🤖 mBot2'], ['sw', '🏃 Sportswonderland']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              style={{
                padding: '8px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.01em',
                transition: 'all 0.18s',
                background: view === k ? '#3b82f6' : 'transparent',
                color: view === k ? '#fff' : 'rgba(255,255,255,0.45)',
                boxShadow: view === k ? '0 2px 12px rgba(59,130,246,0.4)' : 'none',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Right: clock */}
        <p style={{ fontSize: '1.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.7)', letterSpacing: '-0.01em' }}>
          {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </p>
      </header>

      {/* ── CONTENT ── */}
      <main style={{ padding: '24px 24px 48px' }}>
        {groups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: 'rgba(255,255,255,0.2)', fontSize: '1.1rem' }}>
            No active tables for this view.
          </div>
        )}

        {groups.map(({ cat, color, rows }) => (
          <section key={cat.id} style={{ marginBottom: 36 }}>
            {/* Category header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              marginBottom: 14,
            }}>
              <div style={{ width: 5, height: 32, borderRadius: 3, background: color, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: '1.15rem', fontWeight: 800, color, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
                  {cat.name}
                </p>
                {cat.age_range_label && (
                  <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                    {cat.age_range_label}
                  </p>
                )}
              </div>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)', marginLeft: 4 }} />
              <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.25)', fontWeight: 600 }}>{rows.length} tables</p>
            </div>

            {/* Table cards grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 14,
            }}>
              {rows.map(({ table, now, next }) => {
                const status = now?.live_status ?? 'Scheduled';
                const statusColor = STATUS_COLOR[status] ?? '#94a3b8';
                const name = getName(now);
                const nextName = getName(next);

                return (
                  <div key={table.id} style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid rgba(255,255,255,0.09)`,
                    borderTop: `3px solid ${color}`,
                    borderRadius: 16,
                    padding: '18px 20px',
                    display: 'flex', flexDirection: 'column', gap: 12,
                  }}>
                    {/* Table label */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <p style={{
                        fontSize: '2rem', fontWeight: 900, lineHeight: 1,
                        color, letterSpacing: '-0.03em',
                      }}>
                        {table.display_label || `Table ${table.table_number}`}
                      </p>
                      {/* Status badge */}
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                        padding: '4px 10px', borderRadius: 999,
                        background: `${statusColor}18`,
                        color: statusColor,
                        border: `1px solid ${statusColor}40`,
                      }}>
                        {status}
                      </span>
                    </div>

                    {/* Current participant */}
                    <div style={{
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: 10, padding: '12px 14px',
                      borderLeft: `3px solid ${statusColor}`,
                    }}>
                      <p style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                        NOW PLAYING
                      </p>
                      {name ? (
                        <>
                          <p style={{
                            fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.15,
                            color: '#f1f5f9', wordBreak: 'break-word',
                          }}>
                            {name}
                          </p>
                          {now?.club_name && (
                            <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginTop: 4 }}>
                              {now.club_name}
                            </p>
                          )}
                          {now?.scheduled_time && (
                            <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                              🕐 {fmtTime(now.scheduled_time)}
                            </p>
                          )}
                        </>
                      ) : (
                        <p style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>— empty —</p>
                      )}
                    </div>

                    {/* Next participant */}
                    {nextName && (
                      <div style={{
                        borderRadius: 10, padding: '10px 14px',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                      }}>
                        <p style={{ fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                          UP NEXT
                        </p>
                        <p style={{ fontSize: '1rem', fontWeight: 700, color: 'rgba(255,255,255,0.65)' }}>
                          {nextName}
                        </p>
                        {next?.club_name && (
                          <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontWeight: 600, marginTop: 2 }}>
                            {next.club_name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
