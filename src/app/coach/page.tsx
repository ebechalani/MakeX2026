'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation } from '@/lib/types';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-gray-100 text-gray-700',
  Prepare: 'bg-yellow-100 text-yellow-800',
  Next: 'bg-blue-100 text-blue-800',
  'In Progress': 'bg-green-100 text-green-800 font-bold',
  Finished: 'bg-emerald-100 text-emerald-800',
  Absent: 'bg-red-100 text-red-800',
  Delayed: 'bg-orange-100 text-orange-800',
};

const STATUS_MESSAGES: Record<string, string> = {
  Scheduled: 'Waiting — check back later',
  Prepare: 'Please prepare now!',
  Next: 'You are NEXT — get ready!',
  'In Progress': 'Currently competing',
  Finished: 'Done',
  Absent: 'Marked absent',
  Delayed: 'Delayed — will be called again',
};

export default function CoachPage() {
  const supabase = useMemo(() => createClient(), []);
  const [coachName, setCoachName] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searched, setSearched] = useState(false);
  const [passations, setPassations] = useState<Passation[]>([]);

  const loadData = useCallback(async (name: string) => {
    if (!name) return;
    const { data } = await supabase
      .from('passations')
      .select('*, category:categories(*), table:tables(*)')
      .ilike('coach_name', `%${name}%`)
      .order('scheduled_time');
    if (data) setPassations(data as any);
  }, [supabase]);

  useEffect(() => {
    if (!searched || !coachName) return;
    loadData(coachName);
    const channel = supabase
      .channel('coach-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, () => loadData(coachName))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [searched, coachName, loadData]);

  function handleSearch() {
    const name = searchInput.trim();
    setCoachName(name);
    setSearched(true);
    loadData(name);
  }

  const getCatLabel = (p: Passation) => {
    const c = (p as any).category as Category;
    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : '';
  };
  const getTableLabel = (p: Passation) => {
    const t = (p as any).table as Table;
    return t ? (t.display_label || `Table ${t.table_number}`) : '';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-700 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-2xl font-bold">Coach / Teacher View</h1>
          <p className="text-purple-200 text-sm">Track your teams live</p>
        </div>
        <Link href="/" className="text-purple-200 hover:text-white text-sm">← Home</Link>
      </header>
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow p-6 mb-6">
          <label className="block text-sm font-medium mb-2">Search by Coach / Teacher Name</label>
          <div className="flex gap-3">
            <input className="flex-1 border rounded-xl px-4 py-2 text-lg" placeholder="Enter your name…"
              value={searchInput} onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()} />
            <button onClick={handleSearch} className="bg-purple-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-purple-700">Search</button>
          </div>
        </div>
        {searched && passations.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-xl">No teams found for &quot;{coachName}&quot;</p>
            <p className="text-sm mt-2">Make sure your name matches exactly what was entered by the admin.</p>
          </div>
        )}
        <div className="space-y-4">
          {passations.map(p => (
            <div key={p.id} className={`bg-white rounded-2xl shadow p-5 border-l-4 ${
              p.live_status === 'In Progress' ? 'border-green-500' :
              p.live_status === 'Next' ? 'border-blue-500' :
              p.live_status === 'Prepare' ? 'border-yellow-500' :
              p.live_status === 'Absent' ? 'border-red-500' :
              p.live_status === 'Finished' ? 'border-emerald-500' : 'border-gray-200'
            }`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold">{p.team_name}</h3>
                  {p.student_names && <p className="text-sm text-gray-500">{p.student_names}</p>}
                  <p className="text-sm text-gray-500 mt-1">{getCatLabel(p)} — {getTableLabel(p)}</p>
                  {p.scheduled_time && (
                    <p className="text-sm text-gray-400 mt-1">
                      Scheduled: {new Date(p.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[p.live_status] || 'bg-gray-100'}`}>{p.live_status}</span>
                  <p className="text-xs text-gray-400 mt-2 max-w-[160px]">{STATUS_MESSAGES[p.live_status]}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
