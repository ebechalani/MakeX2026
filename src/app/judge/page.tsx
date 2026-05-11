'use client';
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation, LiveStatus } from '@/lib/types';
import { sheetForCategoryName, type Sheet } from '@/lib/scoresheets';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type SignatureCanvasType from 'react-signature-canvas';

const SignatureCanvas = dynamic(() => import('react-signature-canvas'), { ssr: false }) as unknown as React.ComponentType<{
  ref?: React.Ref<SignatureCanvasType>;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
  backgroundColor?: string;
}>;

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-slate-100 text-slate-600',
  Prepare: 'bg-amber-100 text-amber-700',
  Next: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-emerald-100 text-emerald-700',
  Finished: 'bg-green-100 text-green-700',
  Absent: 'bg-red-100 text-red-600',
  Delayed: 'bg-orange-100 text-orange-600',
};

type JudgeSession = { id: string; name: string; username: string; table_ids: string[] };
const JUDGE_SESSION_KEY = 'judge_session';

export default function JudgePage() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<JudgeSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem(JUDGE_SESSION_KEY) : null;
    if (raw) try { setSession(JSON.parse(raw)); } catch {}
    setHydrated(true);
  }, []);

  if (!hydrated) return null;
  if (!session) return <JudgeLogin onLogin={s => { sessionStorage.setItem(JUDGE_SESSION_KEY, JSON.stringify(s)); setSession(s); }} />;
  return <JudgeWorkspace session={session} onLogout={() => { sessionStorage.removeItem(JUDGE_SESSION_KEY); setSession(null); }} />;
}

// ── Login ──────────────────────────────────────────────────────────────────
function JudgeLogin({ onLogin }: { onLogin: (s: JudgeSession) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);

  async function attempt() {
    const now = Date.now();
    if (now < lockUntil) {
      setErr(`Too many failed attempts — wait ${Math.ceil((lockUntil - now) / 1000)}s.`);
      return;
    }
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('verify_judge_login', {
      p_username: u.trim().toLowerCase(),
      p_password: p,
    });
    setBusy(false);
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      const newFails = fails + 1;
      setFails(newFails);
      if (newFails >= 3) {
        const lockSecs = 30 * Math.pow(2, newFails - 3);
        setLockUntil(Date.now() + lockSecs * 1000);
        setErr(`Too many failed attempts — locked for ${lockSecs}s.`);
      } else {
        setErr(`Invalid username or password (${3 - newFails} left).`);
      }
      return;
    }
    setFails(0); setLockUntil(0);
    onLogin({ id: row.id, name: row.name, username: row.username, table_ids: row.table_ids || [] });
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Judge Login</h1>
          <p className="text-slate-400 text-sm">Sign in to access your assigned table</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
          <input value={u} onChange={e => setU(e.target.value)} autoFocus
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/30 mb-4"
            placeholder="judge-1" />
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
          <input value={p} onChange={e => setP(e.target.value)} type="password"
            onKeyDown={e => e.key === 'Enter' && attempt()}
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/30 mb-4" />
          {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
          <button onClick={attempt} disabled={busy || !u || !p}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl">
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </div>
        <div className="text-center mt-6">
          <Link href="/" className="text-slate-500 hover:text-slate-300 text-sm">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}

// ── Workspace (the original judge UI) ─────────────────────────────────────
function JudgeWorkspace({ session, onLogout }: { session: JudgeSession; onLogout: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [selectedTableId, setSelectedTableId] = useState('');
  const judgeName = session.name;
  const [setup, setSetup] = useState(false);
  // Structured scoring state for the current passation
  const [vals, setVals] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<Passation[]>([]);
  const [current, setCurrent] = useState<Passation | null>(null);
  const [score, setScore] = useState('');
  const [timeVal, setTimeVal] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [sigError, setSigError] = useState('');
  const sigRef = useRef<SignatureCanvasType>(null);

  // Only show tables this judge is actually assigned to
  const assignedTables = tables.filter(t => session.table_ids.includes(t.id) && t.active);
  const filteredTables = assignedTables.filter(t => t.category_id === selectedCatId);

  // If the judge has exactly one assigned table, auto-select it once tables load
  useEffect(() => {
    if (assignedTables.length === 1 && !selectedTableId) {
      const t = assignedTables[0];
      setSelectedCatId(t.category_id);
      setSelectedTableId(t.id);
    }
  }, [assignedTables, selectedTableId]);

  // Categories actually relevant to this judge (only the ones whose tables they own)
  const relevantCategoryIds = new Set(assignedTables.map(t => t.category_id));
  const visibleCategories = categories.filter(c => relevantCategoryIds.has(c.id));

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
  }, [setup, loadQueue, supabase]);

  useEffect(() => {
    supabase.from('categories').select('*').eq('active', true).order('name').then((res: { data: Category[] | null }) => {
      if (res.data) setCategories(res.data);
    });
    supabase.from('tables').select('*').eq('active', true).order('table_number').then((res: { data: Table[] | null }) => {
      if (res.data) setTables(res.data);
    });
  }, [supabase]);

  useEffect(() => {
    if (sigRef.current) sigRef.current.clear();
    setSigError('');
    // Reset the structured scoring form for the new passation
    setVals({});
    setCounts({});
  }, [current?.id]);

  // Derive the scoresheet for the current passation's category
  const currentSheet: Sheet | undefined = useMemo(() => {
    if (!current?.category_id) return undefined;
    const cat = categories.find(c => c.id === current.category_id);
    if (!cat) return undefined;
    return sheetForCategoryName(cat.name);
  }, [current?.category_id, categories]);

  const isVoid = currentSheet?.voidIds?.some(id => {
    if (vals[id] === -9999) return true;
    if (id === 'red_us' && (counts[id] ?? 0) >= 1) return true;
    return false;
  }) ?? false;
  const computedScore = currentSheet ? (isVoid ? 0 : currentSheet.formula({ ...vals, ...counts })) : null;

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
    if (!sig) { setSigError('A team signature is required before finishing.'); return; }
    setSigError('');
    setLoading(true);
    // Use the structured scoresheet's computed total when available; otherwise fall back to manual score
    const finalScore = computedScore != null ? computedScore : (score ? Number(score) : null);
    const breakdown = currentSheet ? JSON.stringify({ sheet: currentSheet.key, void: isVoid, vals, counts }) : null;
    const combinedNotes = [notes, breakdown ? `[score-breakdown: ${breakdown}]` : ''].filter(Boolean).join('\n\n') || null;
    await supabase.from('passations').update({
      live_status: 'Finished' as LiveStatus,
      final_result_status: isVoid ? 'Void' : 'Finished',
      score: finalScore,
      time_seconds: timeVal ? Number(timeVal) : null,
      notes: combinedNotes,
      signature_image: sig,
      judge_name: judgeName,
      finalized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', current.id);
    const next = queue[0];
    if (next) await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', next.id);
    setScore(''); setTimeVal(''); setNotes('');
    setVals({}); setCounts({});
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
    if (next) await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', next.id);
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
    if (next) await supabase.from('passations').update({ live_status: 'In Progress' as LiveStatus, updated_at: new Date().toISOString() }).eq('id', next.id);
    setScore(''); setTimeVal(''); setNotes('');
    if (sigRef.current) sigRef.current.clear();
    setLoading(false);
    loadQueue();
  }

  const inputCls = 'w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition placeholder-slate-400';

  // ── Setup screen ──
  if (!setup) {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 bg-emerald-900/40 border border-emerald-700/50 rounded-2xl mb-4">
              <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">Welcome, {session.name}</h1>
            <p className="text-slate-400 text-sm">
              {assignedTables.length === 0 ? 'No tables assigned yet — ask the admin.' :
               assignedTables.length === 1 ? 'Confirm to start judging your assigned table.' :
               'Pick which of your assigned tables to start with.'}
            </p>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Category</label>
              <select className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
                value={selectedCatId}
                onChange={e => { setSelectedCatId(e.target.value); setSelectedTableId(''); }}
                disabled={visibleCategories.length === 0}>
                <option value="">Select category…</option>
                {visibleCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
                ))}
              </select>
              {visibleCategories.length === 0 && (
                <p className="text-amber-400 text-xs mt-1.5">No assigned tables yet. Ask the admin to assign you a table in the Judges tab.</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Table</label>
              <select
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition disabled:opacity-40"
                value={selectedTableId}
                onChange={e => setSelectedTableId(e.target.value)}
                disabled={!selectedCatId}>
                <option value="">{selectedCatId ? 'Select table…' : 'Select a category first'}</option>
                {filteredTables.map(t => (
                  <option key={t.id} value={t.id}>{t.display_label || `Table ${t.table_number}`}</option>
                ))}
              </select>
              {selectedCatId && filteredTables.length === 0 && (
                <p className="text-amber-400 text-xs mt-1.5">No tables found for this category. Ask admin to sync tables.</p>
              )}
            </div>

            <button
              disabled={!selectedTableId}
              onClick={() => setSetup(true)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-3.5 rounded-xl text-base transition">
              Start Judging
            </button>

            <button onClick={onLogout} className="block w-full text-center text-sm text-red-400 hover:text-red-300 transition">Sign out</button>
            <Link href="/" className="block text-center text-sm text-slate-500 hover:text-slate-300 transition">← Back to home</Link>
          </div>
        </div>
      </div>
    );
  }

  const catLabel = categories.find(c => c.id === selectedCatId);
  const tableLabel = tables.find(t => t.id === selectedTableId);

  // ── Judge active screen ──
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <p className="font-bold text-slate-800 leading-tight">{judgeName}</p>
              <p className="text-xs text-slate-400">
                {catLabel?.name}{catLabel?.age_range_label ? ` · ${catLabel.age_range_label}` : ''} · {tableLabel?.display_label || `Table ${tableLabel?.table_number}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSetup(false)}
              className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg transition">
              {session.table_ids.length > 1 ? 'Change Table' : 'Settings'}
            </button>
            <button onClick={onLogout}
              className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg transition">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-8">

        {/* Current team card */}
        {current ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Team header */}
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-emerald-200 text-xs font-semibold uppercase tracking-wider mb-1">Now Competing</p>
                  <h2 className="text-2xl font-black text-white leading-tight">{current.student_names || current.team_name}</h2>
                </div>
                <span className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${STATUS_COLORS[current.live_status] || 'bg-white/20 text-white'}`}>
                  {current.live_status}
                </span>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Mark in progress */}
              {current.live_status !== 'In Progress' && (
                <button onClick={() => markInProgress(current)}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Mark as In Progress
                </button>
              )}

              {/* Live computed score */}
              {currentSheet && (
                <div className={`rounded-xl p-4 flex items-center justify-between ${isVoid ? 'bg-red-50 border border-red-200' : 'bg-slate-100 border border-slate-200'}`}>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{currentSheet.name}</p>
                    <p className="text-xs text-slate-500">{currentSheet.tag} · {currentSheet.duration}</p>
                  </div>
                  <div className={`text-3xl font-black tabular-nums ${isVoid ? 'text-red-600' : 'text-slate-800'}`}>
                    {isVoid ? 'VOID' : computedScore}
                  </div>
                </div>
              )}

              {/* Structured scoresheet */}
              {currentSheet ? (
                <div className="space-y-3">
                  {currentSheet.sections.map((sec, i) => (
                    <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                        <p className="font-bold text-sm text-slate-800">{sec.title}</p>
                        {sec.subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{sec.subtitle}</p>}
                      </div>
                      <div className="divide-y divide-slate-50">
                        {sec.items.map(item => {
                          if (item.kind === 'counter') {
                            const c = counts[item.id] ?? 0;
                            const min = item.min ?? 0;
                            const max = item.max ?? 99;
                            return (
                              <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
                                <div className="flex-1">
                                  <p className="font-semibold text-sm text-slate-800">{item.title}</p>
                                  {item.description && <p className="text-[11px] text-slate-500 mt-0.5">{item.description}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setCounts(x => ({ ...x, [item.id]: Math.max(min, c - 1) }))} disabled={c <= min}
                                    className="w-8 h-8 rounded-lg border border-slate-300 text-slate-700 font-bold disabled:opacity-30">−</button>
                                  <span className="w-8 text-center font-mono font-bold text-slate-800">{c}</span>
                                  <button onClick={() => setCounts(x => ({ ...x, [item.id]: Math.min(max, c + 1) }))} disabled={c >= max}
                                    className="w-8 h-8 rounded-lg border border-slate-300 text-slate-700 font-bold disabled:opacity-30">+</button>
                                </div>
                              </div>
                            );
                          }
                          const sel = vals[item.id];
                          return (
                            <div key={item.id} className="px-4 py-2.5">
                              <p className="font-semibold text-sm text-slate-800 mb-2">{item.title}</p>
                              {item.description && <p className="text-[11px] text-slate-500 -mt-1.5 mb-2">{item.description}</p>}
                              <div className="grid grid-cols-2 gap-1.5">
                                {item.choices.map((ch, ci) => {
                                  const chosen = sel === ch.value;
                                  const isVoidChoice = ch.value === -9999;
                                  return (
                                    <button key={ci}
                                      onClick={() => setVals(x => ({ ...x, [item.id]: ch.value }))}
                                      className={`text-left text-xs px-3 py-2 rounded-lg border transition ${
                                        chosen
                                          ? isVoidChoice
                                            ? 'border-red-500 bg-red-50 text-red-900 font-bold'
                                            : 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold'
                                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                                      }`}>
                                      {ch.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // Fallback: free-form score if no sheet matches this category (e.g. MakeX Starter)
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Score</label>
                    <input type="number" className={inputCls + ' text-xl font-bold'}
                      value={score} onChange={e => setScore(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Mission Duration <span className="font-normal normal-case text-slate-400">(s)</span></label>
                    <input type="number" className={inputCls + ' text-xl font-bold'}
                      value={timeVal} onChange={e => setTimeVal(e.target.value)} placeholder="0" />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notes</label>
                <textarea className={inputCls + ' resize-none'} rows={2}
                  value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional observations…" />
              </div>

              {/* Signature pad */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Team Signature <span className="text-red-500 normal-case">*required</span>
                  </label>
                  <button onClick={() => { if (sigRef.current) sigRef.current.clear(); setSigError(''); }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Clear
                  </button>
                </div>
                <div className={`border-2 rounded-xl overflow-hidden transition ${sigError ? 'border-red-400 bg-red-50' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                  <SignatureCanvas
                    ref={sigRef}
                    canvasProps={{ width: 600, height: 160, className: 'w-full h-[160px] touch-none' }}
                    backgroundColor={sigError ? 'rgb(254,242,242)' : 'rgb(248,250,252)'}
                  />
                </div>
                {sigError ? (
                  <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {sigError}
                  </p>
                ) : (
                  <p className="text-slate-400 text-xs mt-1.5">The team representative signs above</p>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <button onClick={handleFinish} disabled={loading}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white py-4 rounded-2xl font-bold text-base transition flex flex-col items-center gap-1 shadow-sm shadow-emerald-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Finish
                </button>
                <button onClick={handleAbsent} disabled={loading}
                  className="bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white py-4 rounded-2xl font-bold text-base transition flex flex-col items-center gap-1 shadow-sm shadow-red-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Absent
                </button>
                <button onClick={handleDelay} disabled={loading}
                  className="bg-orange-500 hover:bg-orange-400 disabled:opacity-40 text-white py-4 rounded-2xl font-bold text-base transition flex flex-col items-center gap-1 shadow-sm shadow-orange-200">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Delay
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <svg className="w-12 h-12 text-slate-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-500 font-semibold">No team in queue</p>
            <p className="text-slate-400 text-sm mt-1">Waiting for passations to be assigned to this table</p>
          </div>
        )}

        {/* Queue */}
        {queue.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider mb-4">
              Queue · {queue.length} {queue.length === 1 ? 'team' : 'teams'}
            </h3>
            <div className="space-y-2">
              {queue.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">{p.student_names || p.team_name}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[p.live_status] || 'bg-slate-100 text-slate-600'}`}>
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
