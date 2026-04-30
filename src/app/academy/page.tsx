'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Academy, Category, Table, Passation, PendingChange } from '@/lib/types';
import Link from 'next/link';
import PracticeScoresheet from './PracticeScoresheet';

const SESSION_KEY = 'academy_session';

type Session = { id: string; name: string; username: string; whatsapp_number: string | null };

export default function AcademyPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) try { setSession(JSON.parse(raw)); } catch {}
    setHydrated(true);
  }, []);

  if (!hydrated) return null;
  if (!session) return <Login onLogin={s => { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); setSession(s); }} />;
  return <Dashboard session={session} onLogout={() => { sessionStorage.removeItem(SESSION_KEY); setSession(null); }} />;
}

// ── Login ──────────────────────────────────────────────────────────────────────
function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function attempt() {
    setBusy(true); setErr('');
    const { data, error } = await supabase
      .from('academies')
      .select('id, name, username, password, whatsapp_number')
      .eq('username', u.trim().toLowerCase())
      .maybeSingle();
    setBusy(false);
    if (error || !data || data.password !== p) { setErr('Invalid username or password'); return; }
    onLogin({ id: data.id, name: data.name, username: data.username, whatsapp_number: data.whatsapp_number });
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Academy Login</h1>
          <p className="text-slate-400 text-sm">Manage your team registrations</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
          <input value={u} onChange={e => setU(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500/30 mb-4"
            placeholder="academy-username" autoFocus />
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
          <input value={p} onChange={e => setP(e.target.value)} type="password"
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500/30 mb-4"
            onKeyDown={e => e.key === 'Enter' && attempt()} />
          {err && <p className="text-red-400 text-sm mb-3">{err}</p>}
          <button onClick={attempt} disabled={busy || !u || !p}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl">
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

// ── Dashboard ──────────────────────────────────────────────────────────────────
function Dashboard({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [tab, setTab] = useState<'students' | 'practice'>('students');
  const [showForm, setShowForm] = useState(false);
  const [editingPas, setEditingPas] = useState<Passation | null>(null);
  const [form, setForm] = useState({
    team_name: '', student_names: '', coach_name: '', parent_contact: '',
    category_id: '', table_id: '', notes: '',
  });

  const load = useCallback(async () => {
    const [pasRes, catRes, tabRes, pendRes] = await Promise.all([
      supabase.from('passations').select('*, category:categories(*), table:tables(*)')
        .eq('club_name', session.name).order('queue_position'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('tables').select('*').order('table_number'),
      supabase.from('pending_changes').select('*').eq('academy_id', session.id).order('created_at', { ascending: false }),
    ]);
    if (pasRes.data) setPassations(pasRes.data as unknown as Passation[]);
    if (catRes.data) setCategories(catRes.data);
    if (tabRes.data) setTables(tabRes.data);
    if (pendRes.data) setPending(pendRes.data as unknown as PendingChange[]);
  }, [supabase, session.id, session.name]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('academy-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_changes' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, supabase]);

  const filteredTables = tables.filter(t => t.category_id === form.category_id && t.active);
  const pendingByPasId = new Map(pending.filter(p => p.status === 'pending' && p.passation_id).map(p => [p.passation_id!, p]));
  const pendingAdds = pending.filter(p => p.status === 'pending' && p.action === 'add');

  function openAdd() {
    setEditingPas(null);
    setForm({ team_name: '', student_names: '', coach_name: '', parent_contact: '', category_id: '', table_id: '', notes: '' });
    setShowForm(true);
  }
  function openEdit(p: Passation) {
    setEditingPas(p);
    setForm({
      team_name: p.team_name,
      student_names: p.student_names || '',
      coach_name: p.coach_name || '',
      parent_contact: p.parent_contact || '',
      category_id: p.category_id,
      table_id: p.table_id,
      notes: '',
    });
    setShowForm(true);
  }

  async function submitChange(action: 'add' | 'update' | 'delete', passation_id: string | null, payload: Record<string, unknown> | null) {
    const { error } = await supabase.from('pending_changes').insert({
      academy_id: session.id, action, passation_id, payload, status: 'pending',
    });
    if (error) { alert('Failed: ' + error.message); return; }
    setShowForm(false); setEditingPas(null);
    load();
  }

  async function submitForm() {
    if (!form.team_name || !form.category_id || !form.table_id) { alert('Fill required fields'); return; }
    const payload: Record<string, unknown> = {
      team_name: form.team_name,
      student_names: form.student_names || form.team_name,
      coach_name: form.coach_name || null,
      parent_contact: form.parent_contact || null,
      category_id: form.category_id,
      table_id: form.table_id,
      notes: form.notes || null,
      club_name: session.name,
    };
    await submitChange(editingPas ? 'update' : 'add', editingPas?.id || null, payload);
  }

  async function requestDelete(p: Passation) {
    if (!confirm(`Request deletion of "${p.team_name}"? Admin must approve.`)) return;
    await submitChange('delete', p.id, { team_name: p.team_name });
  }

  async function cancelPending(id: string) {
    if (!confirm('Cancel this pending request?')) return;
    await supabase.from('pending_changes').delete().eq('id', id);
    load();
  }

  const catLabel = (id: string) => {
    const c = categories.find(c => c.id === id);
    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : '—';
  };
  const tableLabel = (id: string) => {
    const t = tables.find(t => t.id === id);
    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
  };
  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-700',
      approved: 'bg-emerald-100 text-emerald-700',
      rejected: 'bg-red-100 text-red-600',
    };
    return map[s] || 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-800">{session.name}</h1>
            <p className="text-xs text-slate-400">Academy Portal · @{session.username}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← Home</Link>
            <button onClick={onLogout} className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg">Sign out</button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex gap-2 border-b border-slate-200">
          <button
            onClick={() => setTab('students')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === 'students' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            My Students
          </button>
          <button
            onClick={() => setTab('practice')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === 'practice' ? 'border-cyan-600 text-cyan-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            🎯 Practice Scoresheet
          </button>
        </div>

        {tab === 'practice' ? (
          <PracticeScoresheet />
        ) : (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Your students" value={passations.length} color="text-blue-600" bg="bg-blue-50" />
          <Stat label="Pending requests" value={pending.filter(p => p.status === 'pending').length} color="text-amber-600" bg="bg-amber-50" />
          <Stat label="Approved" value={pending.filter(p => p.status === 'approved').length} color="text-emerald-600" bg="bg-emerald-50" />
          <Stat label="Rejected" value={pending.filter(p => p.status === 'rejected').length} color="text-red-600" bg="bg-red-50" />
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <strong>Note:</strong> All edits, deletions, and additions require admin approval before taking effect.
        </div>

        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-slate-800">Your Students</h2>
          <button onClick={openAdd} className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            + Request New Student
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="font-bold mb-4">{editingPas ? 'Request Edit' : 'Request New Student'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Student Name *">
                <input className={inputCls} value={form.team_name}
                  onChange={e => setForm(f => ({ ...f, team_name: e.target.value, student_names: e.target.value }))} />
              </Field>
              <Field label="Coach Name">
                <input className={inputCls} value={form.coach_name}
                  onChange={e => setForm(f => ({ ...f, coach_name: e.target.value }))} />
              </Field>
              <Field label="Coach Contact (phone/email)">
                <input className={inputCls} value={form.parent_contact}
                  onChange={e => setForm(f => ({ ...f, parent_contact: e.target.value }))} />
              </Field>
              <Field label="Category *">
                <select className={inputCls} value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value, table_id: '' }))}>
                  <option value="">Select…</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name} {c.age_range_label && `(${c.age_range_label})`}</option>)}
                </select>
              </Field>
              <Field label="Table *">
                <select className={inputCls} value={form.table_id}
                  onChange={e => setForm(f => ({ ...f, table_id: e.target.value }))} disabled={!form.category_id}>
                  <option value="">Select…</option>
                  {filteredTables.map(t => <option key={t.id} value={t.id}>{t.display_label || `Table ${t.table_number}`}</option>)}
                </select>
              </Field>
              <Field label="Notes (optional)">
                <input className={inputCls} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="DOB, T-shirt size, etc." />
              </Field>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={submitForm} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-sm font-semibold">Submit Request</button>
              <button onClick={() => setShowForm(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-5 py-2 rounded-xl text-sm font-semibold">Cancel</button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Student</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Category</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Table</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Coach</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {passations.map(p => {
                const pend = pendingByPasId.get(p.id);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-semibold text-slate-800">{p.team_name}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{catLabel(p.category_id)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{tableLabel(p.table_id)}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{p.coach_name || '—'}</td>
                    <td className="px-5 py-3">
                      {pend ? (
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusBadge('pending')}`}>
                          ⏳ {pend.action} pending
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => openEdit(p)} disabled={!!pend}
                          className="text-blue-600 text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-blue-50 disabled:opacity-30">Edit</button>
                        <button onClick={() => requestDelete(p)} disabled={!!pend}
                          className="text-red-500 text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-red-50 disabled:opacity-30">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {passations.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">No students yet. Submit a new student request above.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pendingAdds.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase">
              Pending New Student Requests
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-50">
                {pendingAdds.map(p => {
                  const pl = (p.payload as Record<string, string>) || {};
                  return (
                    <tr key={p.id}>
                      <td className="px-5 py-3 font-semibold">{pl.team_name}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{catLabel(pl.category_id)}</td>
                      <td className="px-5 py-3"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusBadge('pending')}`}>⏳ pending approval</span></td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => cancelPending(p.id)} className="text-red-500 text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-red-50">Cancel</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pending.filter(p => p.status !== 'pending').length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase">
              Recent Decisions
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-50">
                {pending.filter(p => p.status !== 'pending').slice(0, 10).map(p => {
                  const pl = (p.payload as Record<string, string>) || {};
                  return (
                    <tr key={p.id}>
                      <td className="px-5 py-3 text-xs">{p.action}</td>
                      <td className="px-5 py-3 text-xs">{pl.team_name || '—'}</td>
                      <td className="px-5 py-3"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusBadge(p.status)}`}>{p.status}</span></td>
                      <td className="px-5 py-3 text-xs text-slate-500">{p.reviewer_notes || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-2xl p-4 border border-white shadow-sm`}>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-3xl font-black ${color}`}>{value}</p>
    </div>
  );
}
