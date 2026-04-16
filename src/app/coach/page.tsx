'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation } from '@/lib/types';
import Link from 'next/link';

const STATUS_STYLES: Record<string, { card: string; badge: string; dot: string; message: string }> = {
  Scheduled:      { card: 'border-slate-200',   badge: 'bg-slate-100 text-slate-600',     dot: 'bg-slate-400',               message: 'Waiting — check schedule' },
  Prepare:        { card: 'border-amber-400',   badge: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400',               message: 'Please prepare now!' },
  Next:           { card: 'border-blue-400',    badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-400',                message: 'You are NEXT — get ready!' },
  'In Progress':  { card: 'border-emerald-400', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400 animate-pulse', message: 'Currently competing' },
  Finished:       { card: 'border-green-400',   badge: 'bg-green-100 text-green-700',     dot: 'bg-green-400',               message: 'Run completed' },
  Absent:         { card: 'border-red-400',     badge: 'bg-red-100 text-red-600',         dot: 'bg-red-400',                 message: 'Marked as absent' },
  Delayed:        { card: 'border-orange-400',  badge: 'bg-orange-100 text-orange-600',   dot: 'bg-orange-400',              message: 'Delayed — will be called again' },
};

function TeamCard({
  p,
  getCatLabel,
  getTableLabel,
}: {
  p: Passation;
  getCatLabel: (p: Passation) => string;
  getTableLabel: (p: Passation) => string;
}) {
  const style = STATUS_STYLES[p.live_status] || STATUS_STYLES['Scheduled'];
  return (
    <div className={`bg-white rounded-2xl border-l-4 ${style.card} border border-slate-100 p-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-slate-800 truncate">{p.team_name}</h3>
          {p.student_names && <p className="text-sm text-slate-500 mt-0.5 truncate">{p.student_names}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              {getCatLabel(p)}
            </span>
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 6v12M14 6v12" />
              </svg>
              {getTableLabel(p)}
            </span>
            {p.scheduled_time && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {new Date(p.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${style.badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {p.live_status}
          </span>
          <p className="text-xs text-slate-400 mt-1.5 max-w-[140px] text-right">{style.message}</p>
        </div>
      </div>
    </div>
  );
}

export default function CoachPage() {
  const supabase = useMemo(() => createClient(), []);
  const [coachName, setCoachName] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searched, setSearched] = useState(false);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (name: string) => {
    if (!name) return;
    setLoading(true);
    const { data } = await supabase
      .from('passations')
      .select('*, category:categories(*), table:tables(*)')
      .ilike('coach_name', `%${name}%`)
      .order('scheduled_time');
    if (data) setPassations(data as unknown as Passation[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!searched || !coachName) return;
    const channel = supabase
      .channel('coach-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, () => loadData(coachName))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [searched, coachName, loadData, supabase]);

  function handleSearch() {
    const name = searchInput.trim();
    if (!name) return;
    setCoachName(name);
    setSearched(true);
    loadData(name);
  }

  const getCatLabel = (p: Passation) => {
    const c = (p as unknown as { category: Category }).category;
    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : '—';
  };
  const getTableLabel = (p: Passation) => {
    const t = (p as unknown as { table: Table }).table;
    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
  };

  const inProgress = passations.filter(p => p.live_status === 'In Progress');
  const urgent = passations.filter(p => p.live_status === 'Next' || p.live_status === 'Prepare');
  const rest = passations.filter(p => !['In Progress', 'Next', 'Prepare'].includes(p.live_status));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">Coach / Teacher View</h1>
              <p className="text-xs text-slate-400">Live team tracking</p>
            </div>
          </div>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 transition">← Home</Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-8">
          <p className="text-sm font-semibold text-slate-700 mb-3">Search by your name (as entered by the admin)</p>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition placeholder-slate-400"
                placeholder="Enter coach or teacher name…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <button onClick={handleSearch}
              className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-xl font-semibold text-sm transition whitespace-nowrap">
              Search
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Loading teams…</p>
          </div>
        )}

        {searched && !loading && passations.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
            <svg className="w-12 h-12 text-slate-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-600 font-semibold">No teams found for &ldquo;{coachName}&rdquo;</p>
            <p className="text-slate-400 text-sm mt-1">Check the spelling matches exactly what the admin entered</p>
          </div>
        )}

        {passations.length > 0 && (
          <div className="space-y-6">
            {inProgress.length > 0 && (
              <div>
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Currently Competing
                </p>
                <div className="space-y-3">
                  {inProgress.map(p => <TeamCard key={p.id} p={p} getCatLabel={getCatLabel} getTableLabel={getTableLabel} />)}
                </div>
              </div>
            )}
            {urgent.length > 0 && (
              <div>
                <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3">Action Required</p>
                <div className="space-y-3">
                  {urgent.map(p => <TeamCard key={p.id} p={p} getCatLabel={getCatLabel} getTableLabel={getTableLabel} />)}
                </div>
              </div>
            )}
            {rest.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">All Teams</p>
                <div className="space-y-3">
                  {rest.map(p => <TeamCard key={p.id} p={p} getCatLabel={getCatLabel} getTableLabel={getTableLabel} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
