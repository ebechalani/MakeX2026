'use client';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation, LiveStatus } from '@/lib/types';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type SignatureCanvasType from 'react-signature-canvas';

const SignatureCanvas = dynamic(() => import('react-signature-canvas'), { ssr: false }) as unknown as React.ComponentType<{
  ref?: React.Ref<SignatureCanvasType>;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
  backgroundColor?: string;
}>;

export default function JudgePage() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');
  const [judgeName, setJudgeName] = useState('');
  const [setup, setSetup] = useState(false);
  const [queue, setQueue] = useState<Passation[]>([]);
  const [current, setCurrent] = useState<Passation | null>(null);
  const [score, setScore] = useState('');
  const [timeVal, setTimeVal] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [sigError, setSigError] = useState('');
  const sigRef = useRef<SignatureCanvasType>(null);

  const filteredTables = tables.filter(t => t.category_id === selectedCatId && t.active);

  const loadQueue = useCallback(async () => {
    if (!selectedTableId) return;
    const { data } = await supabase
      .from('passations')
      .select('*, category:categories(*), table:tables(*)')
      .eq('table_id', selectedTableId)
      .not('live_status', 'in', '("Finished","Absent")')
      .order('queue_position')
      .order('scheduled_time');
    if (data) {
      const inProgress = (data as Passation[]).find(p => p.live_status === 'In Progress');
      const rest = (data as Passation[]).filter(p => p.live_status !== 'In Progress');
      const sorted = inProgress ? [inProgress, ...rest] : (data as Passation[]);
      const cur = sorted[0] || null;
      setCurrent(cur);
      setQueue(sorted.slice(1));
      if (cur) {
        setScore(cur.score?.toString() || '');
        setTimeVal(cur.time_seconds?.toString() || '');
        setNotes(cur.notes || '');
      }
    }
  }, [selectedTableId, supabase]);

  useEffect(() => {
    if (!setup) return;
    loadQueue();
    const channel = supabase
      .channel('judge-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, loadQueue)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [setup, loadQueue]);

  useEffect(() => {
    supabase.from('categories').select('*').eq('active', true).order('name').then(({ data }: { data: Category[] | null }) => {
      if (data) setCategories(data);
    });
    supabase.from('tables').select('*').eq('active', true).order('table_number').then(({ data }: { data: Table[] | null }) => {
      if (data) setTables(data);
    });
  }, [supabase]);

  useEffect(() => {
    if (sigRef.current) sigRef.current.clear();
    setSigError('');
  }, [current?.id]);

  function getSignatureDataUrl(): string | null {
    if (!sigRef.current) return null;
    if (sigRef.current.isEmpty()) return null;
    return sigRef.current.toDataURL('image/png');
  }

  async function markInProgress(p: Passation) {
    await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', p.id);
    loadQueue();
  }

  async function handleFinish() {
    if (!current) return;
    const sig = getSignatureDataUrl();
    if (!sig) { setSigError('Signature is required before finishing.'); return; }
    setSigError('');
    setLoading(true);
    await supabase.from('passations').update({
      live_status: 'Finished' as LiveStatus,
      final_result_status: 'Finished',
      score: score ? Number(score) : null,
      time_seconds: timeVal ? Number(timeVal) : null,
      notes: notes || null,
      signature_image: sig,
      judge_name: judgeName,
      finalized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', current.id);
    const next = queue[0];
    if (next) {
      await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', next.id);
    }
    setScore(''); setTimeVal(''); setNotes('');
    if (sigRef.current) sigRef.current.clear();
    setLoading(false);
    loadQueue();
  }

  async function handleAbsent() {
    if (!current) return;
    setLoading(true);
    await supabase.from('passations').update({
      live_status: 'Absent' as LiveStatus,
      final_result_status: 'Absent',
      judge_name: judgeName,
      finalized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', current.id);
    const next = queue[0];
    if (next) {
      await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', next.id);
    }
    setScore(''); setTimeVal(''); setNotes('');
    if (sigRef.current) sigRef.current.clear();
    setLoading(false);
    loadQueue();
  }

  async function handleDelay() {
    if (!current) return;
    setLoading(true);
    const maxPos = queue.length > 0 ? Math.max(...queue.map(p => p.queue_position)) + 1 : current.queue_position + 1;
    await supabase.from('passations').update({
      live_status: 'Delayed' as LiveStatus,
      queue_position: maxPos,
      updated_at: new Date().toISOString(),
    }).eq('id', current.id);
    const next = queue[0];
    if (next) {
      await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', next.id);
    }
    setScore(''); setTimeVal(''); setNotes('');
    if (sigRef.current) sigRef.current.clear();
    setLoading(false);
    loadQueue();
  }

  if (!setup) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold mb-6 text-center">Judge Setup</h1>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Your Name</label>
              <input className="w-full border rounded-lg px-3 py-2" placeholder="Judge name"
                value={judgeName} onChange={e => setJudgeName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select className="w-full border rounded-lg px-3 py-2" value={selectedCatId}
                onChange={e => { setSelectedCatId(e.target.value); setSelectedTableId(''); }}>
                <option value="">Select category…</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Table</label>
              <select className="w-full border rounded-lg px-3 py-2" value={selectedTableId}
                onChange={e => setSelectedTableId(e.target.value)} disabled={!selectedCatId}>
                <option value="">Select table…</option>
                {filteredTables.map(t => (
                  <option key={t.id} value={t.id}>{t.display_label || `Table ${t.table_number}`}</option>
                ))}
              </select>
            </div>
            <button disabled={!judgeName || !selectedTableId} onClick={() => setSetup(true)}
              className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-40">
              Start Judging
            </button>
            <Link href="/" className="block text-center text-sm text-gray-400 hover:text-gray-600">← Back to home</Link>
          </div>
        </div>
      </div>
    );
  }

  const catLabel = categories.find(c => c.id === selectedCatId);
  const tableLabel = tables.find(t => t.id === selectedTableId);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-green-700 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-xl font-bold">Judge: {judgeName}</h1>
          <p className="text-green-200 text-sm">
            {catLabel?.name}{catLabel?.age_range_label ? ` (${catLabel.age_range_label})` : ''} — {tableLabel?.display_label || `Table ${tableLabel?.table_number}`}
          </p>
        </div>
        <button onClick={() => setSetup(false)} className="text-green-200 hover:text-white text-sm">Change Table</button>
      </header>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {current ? (
          <div className="bg-white rounded-2xl shadow-lg p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Now Competing</p>
                <h2 className="text-2xl font-black">{current.team_name}</h2>
                {current.student_names && <p className="text-gray-500 text-sm mt-1">{current.student_names}</p>}
              </div>
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">{current.live_status}</span>
            </div>
            {current.live_status !== 'In Progress' && (
              <button onClick={() => markInProgress(current)}
                className="w-full bg-blue-600 text-white py-2 rounded-lg font-semibold mb-4 hover:bg-blue-700">
                Mark as In Progress
              </button>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">Score</label>
                <input type="number" className="w-full border rounded-lg px-3 py-2 text-lg font-bold"
                  value={score} onChange={e => setScore(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Time (seconds)</label>
                <input type="number" className="w-full border rounded-lg px-3 py-2 text-lg font-bold"
                  value={timeVal} onChange={e => setTimeVal(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea className="w-full border rounded-lg px-3 py-2" rows={2}
                value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Team Signature <span className="text-red-500">*</span></label>
              <div className="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-gray-50">
                <SignatureCanvas ref={sigRef}
                  canvasProps={{ width: 500, height: 150, className: 'w-full h-[150px]' }}
                  backgroundColor="rgb(249,250,251)" />
              </div>
              <button onClick={() => { if (sigRef.current) sigRef.current.clear(); setSigError(''); }}
                className="text-xs text-gray-400 hover:text-gray-600 mt-1">Clear signature</button>
              {sigError && <p className="text-red-500 text-sm mt-1">{sigError}</p>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={handleFinish} disabled={loading}
                className="bg-green-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-40">Finish</button>
              <button onClick={handleAbsent} disabled={loading}
                className="bg-red-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-red-600 disabled:opacity-40">Absent</button>
              <button onClick={handleDelay} disabled={loading}
                className="bg-orange-500 text-white py-3 rounded-xl font-bold text-lg hover:bg-orange-600 disabled:opacity-40">Delay</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow p-8 text-center text-gray-400">
            <p className="text-xl">No team currently in queue</p>
            <p className="text-sm mt-2">Waiting for passations to be assigned to this table</p>
          </div>
        )}
        {queue.length > 0 && (
          <div className="bg-white rounded-2xl shadow p-4">
            <h3 className="font-bold text-gray-700 mb-3">Queue ({queue.length})</h3>
            <div className="space-y-2">
              {queue.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <div>
                      <p className="font-medium text-sm">{p.team_name}</p>
                      {p.student_names && <p className="text-xs text-gray-400">{p.student_names}</p>}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.live_status === 'Delayed' ? 'bg-orange-100 text-orange-800' : p.live_status === 'Next' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}>
                    {p.live_status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
