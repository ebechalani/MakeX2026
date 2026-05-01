'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation, LiveStatus, PendingChange, Academy } from '@/lib/types';
import Link from 'next/link';

const ADMIN_PASSWORD = 'MakeX@2026';

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-slate-100 text-slate-600',
  Prepare: 'bg-amber-100 text-amber-700',
  Next: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-emerald-100 text-emerald-700',
  Finished: 'bg-green-100 text-green-700',
  Absent: 'bg-red-100 text-red-600',
  Delayed: 'bg-orange-100 text-orange-600',
};

const STATUS_DOT: Record<string, string> = {
  Scheduled: 'bg-slate-400',
  Prepare: 'bg-amber-400',
  Next: 'bg-blue-400',
  'In Progress': 'bg-emerald-400',
  Finished: 'bg-green-400',
  Absent: 'bg-red-400',
  Delayed: 'bg-orange-400',
};

const LIVE_STATUSES: LiveStatus[] = ['Scheduled', 'Prepare', 'Next', 'In Progress', 'Finished', 'Absent', 'Delayed'];

// ── Password Gate ──────────────────────────────────────────────────────────────
function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [show, setShow] = useState(false);

  function attempt() {
    if (value === ADMIN_PASSWORD) {
      sessionStorage.setItem('admin_unlocked', 'true');
      onUnlock();
    } else {
      setError(true);
      setValue('');
      setTimeout(() => setError(false), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-slate-800 rounded-2xl mb-4 border border-slate-700">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">Admin Access</h1>
          <p className="text-slate-400 text-sm">Enter the admin password to continue</p>
        </div>

        <div className={`bg-slate-800 border rounded-2xl p-6 transition-all ${error ? 'border-red-500 shake' : 'border-slate-700'}`}>
          <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
          <div className="relative mb-4">
            <input
              type={show ? 'text' : 'password'}
              className={`w-full bg-slate-900 border rounded-xl px-4 py-3 text-white placeholder-slate-500 outline-none focus:ring-2 transition pr-10 ${
                error ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-600 focus:ring-blue-500/30 focus:border-blue-500'
              }`}
              placeholder="Enter password…"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && attempt()}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {show ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          {error && (
            <p className="text-red-400 text-sm mb-3 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Incorrect password. Try again.
            </p>
          )}
          <button
            onClick={attempt}
            disabled={!value}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition"
          >
            Unlock Admin Panel
          </button>
        </div>

        <div className="text-center mt-6">
          <Link href="/" className="text-slate-500 hover:text-slate-300 text-sm transition">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}

// ── Main Admin Panel ───────────────────────────────────────────────────────────
export default function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('admin_unlocked') === 'true') {
      setUnlocked(true);
    }
  }, []);

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [activeTab, setActiveTab] = useState<'passations' | 'categories' | 'approvals'>('passations');
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [catForm, setCatForm] = useState({ name: '', age_range_label: '', table_count: 1 });
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [pasForm, setPasForm] = useState({
    team_name: '', student_names: '', coach_name: '', parent_name: '', club_name: '',
    parent_contact: '', category_id: '', table_id: '', scheduled_time: '',
    queue_position: 0, live_status: 'Scheduled' as LiveStatus,
    judge_name: '', score: '', time_seconds: '', notes: '', date_of_birth: '',
  });
  const [editPasId, setEditPasId] = useState<string | null>(null);
  const [showPasForm, setShowPasForm] = useState(false);
  const [filteredTables, setFilteredTables] = useState<Table[]>([]);
  const [syncingAll, setSyncingAll] = useState(false);

  const load = useCallback(async () => {
    const [{ data: cats }, { data: tabs }, { data: pas }, { data: pcs }, { data: acs }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('tables').select('*').order('table_number'),
      supabase.from('passations').select('*, category:categories(*), table:tables(*)').order('scheduled_time').order('queue_position'),
      supabase.from('pending_changes').select('*, academy:academies(*), passation:passations(*)').order('created_at', { ascending: false }),
      supabase.from('academies').select('*').order('name'),
    ]);
    if (cats) setCategories(cats);
    if (tabs) setTables(tabs);
    if (pas) setPassations(pas as unknown as Passation[]);
    if (pcs) setPendingChanges(pcs as unknown as PendingChange[]);
    if (acs) setAcademies(acs);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_changes' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, supabase]);

  useEffect(() => {
    if (pasForm.category_id) {
      const cat = categories.find(c => c.id === pasForm.category_id);
      if (cat) {
        const filtered = tables.filter(t => t.category_id === pasForm.category_id && t.table_number <= cat.table_count && t.active);
        setFilteredTables(filtered);
        if (!filtered.find(t => t.id === pasForm.table_id)) {
          setPasForm(f => ({ ...f, table_id: '' }));
        }
      }
    } else {
      setFilteredTables([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasForm.category_id, categories, tables]);

  async function syncTablesForCategory(catId: string, count: number) {
    for (let i = 1; i <= count; i++) {
      await supabase.from('tables').upsert(
        { category_id: catId, table_number: i, display_label: `Table ${i}`, active: true },
        { onConflict: 'category_id,table_number' }
      );
    }
    await supabase.from('tables').update({ active: false }).eq('category_id', catId).gt('table_number', count);
  }

  async function syncAllTables() {
    setSyncingAll(true);
    for (const cat of categories) {
      await syncTablesForCategory(cat.id, cat.table_count);
    }
    await load();
    setSyncingAll(false);
  }

  async function saveCategory() {
    if (!catForm.name) return;
    if (editCatId) {
      await supabase.from('categories').update({ ...catForm, updated_at: new Date().toISOString() }).eq('id', editCatId);
      await syncTablesForCategory(editCatId, catForm.table_count);
    } else {
      const { data } = await supabase.from('categories').insert(catForm).select().single();
      if (data) await syncTablesForCategory(data.id, catForm.table_count);
    }
    setCatForm({ name: '', age_range_label: '', table_count: 1 });
    setEditCatId(null);
    load();
  }

  function editCategory(cat: Category) {
    setCatForm({ name: cat.name, age_range_label: cat.age_range_label || '', table_count: cat.table_count });
    setEditCatId(cat.id);
    setActiveTab('categories');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category? All its tables and passations will be removed.')) return;
    await supabase.from('categories').delete().eq('id', id);
    load();
  }

  async function savePassation() {
    if (!pasForm.team_name || !pasForm.category_id || !pasForm.table_id) return;
    const payload = {
      team_name: pasForm.team_name,
      student_names: pasForm.student_names || null,
      coach_name: pasForm.coach_name || null,
      parent_name: pasForm.parent_name || null,
      club_name: pasForm.club_name || null,
      parent_contact: pasForm.parent_contact || null,
      category_id: pasForm.category_id,
      table_id: pasForm.table_id,
      scheduled_time: pasForm.scheduled_time || null,
      queue_position: Number(pasForm.queue_position),
      live_status: pasForm.live_status,
      judge_name: pasForm.judge_name || null,
      score: pasForm.score ? Number(pasForm.score) : null,
      time_seconds: pasForm.time_seconds ? Number(pasForm.time_seconds) : null,
      notes: pasForm.notes || null,
      date_of_birth: pasForm.date_of_birth || null,
      updated_at: new Date().toISOString(),
    };
    if (editPasId) {
      await supabase.from('passations').update(payload).eq('id', editPasId);
    } else {
      await supabase.from('passations').insert(payload);
    }
    resetPasForm();
    load();
  }

  function resetPasForm() {
    setPasForm({
      team_name: '', student_names: '', coach_name: '', parent_name: '', club_name: '',
      parent_contact: '', category_id: '', table_id: '', scheduled_time: '',
      queue_position: 0, live_status: 'Scheduled', judge_name: '',
      score: '', time_seconds: '', notes: '', date_of_birth: '',
    });
    setEditPasId(null);
    setShowPasForm(false);
  }

  function editPassation(p: Passation) {
    setPasForm({
      team_name: p.team_name,
      student_names: p.student_names || '',
      coach_name: p.coach_name || '',
      parent_name: p.parent_name || '',
      club_name: p.club_name || '',
      parent_contact: p.parent_contact || '',
      category_id: p.category_id,
      table_id: p.table_id,
      scheduled_time: p.scheduled_time ? p.scheduled_time.slice(0, 16) : '',
      queue_position: p.queue_position,
      live_status: p.live_status,
      judge_name: p.judge_name || '',
      score: p.score?.toString() || '',
      time_seconds: p.time_seconds?.toString() || '',
      notes: p.notes || '',
      date_of_birth: p.date_of_birth || '',
    });
    setEditPasId(p.id);
    setShowPasForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deletePassation(id: string) {
    if (!confirm('Delete this passation?')) return;
    await supabase.from('passations').delete().eq('id', id);
    load();
  }

  async function approveChange(pc: PendingChange) {
    const payload = (pc.payload || {}) as Record<string, unknown>;
    let resultPasName = '';
    if (pc.action === 'add') {
      const insertRow = {
        team_name: payload.team_name as string,
        student_names: payload.student_names as string,
        coach_name: payload.coach_name as string | null,
        parent_name: payload.parent_name as string | null,
        parent_contact: payload.parent_contact as string | null,
        club_name: payload.club_name as string,
        category_id: payload.category_id as string,
        table_id: payload.table_id as string,
        notes: payload.notes as string | null,
        date_of_birth: (payload.date_of_birth as string | null) || null,
        live_status: 'Scheduled',
        queue_position: 0,
      };
      const { error } = await supabase.from('passations').insert(insertRow);
      if (error) { alert('Insert failed: ' + error.message); return; }
      resultPasName = String(payload.team_name);
    } else if (pc.action === 'update' && pc.passation_id) {
      const updateRow: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ['team_name', 'student_names', 'coach_name', 'parent_name', 'parent_contact', 'category_id', 'table_id', 'notes', 'date_of_birth']) {
        if (payload[k] !== undefined) updateRow[k] = payload[k];
      }
      const { error } = await supabase.from('passations').update(updateRow).eq('id', pc.passation_id);
      if (error) { alert('Update failed: ' + error.message); return; }
      resultPasName = String(payload.team_name || pc.passation?.team_name || '');
    } else if (pc.action === 'delete' && pc.passation_id) {
      const { error } = await supabase.from('passations').delete().eq('id', pc.passation_id);
      if (error) { alert('Delete failed: ' + error.message); return; }
      resultPasName = String(pc.passation?.team_name || payload.team_name || '');
    }
    await supabase.from('pending_changes').update({
      status: 'approved', reviewed_by: 'admin', reviewed_at: new Date().toISOString(),
    }).eq('id', pc.id);

    // Open WhatsApp prefilled message to coach
    const ac = pc.academy;
    if (ac?.whatsapp_number) {
      const num = ac.whatsapp_number.replace(/[^0-9]/g, '');
      const phone = num.startsWith('961') ? num : `961${num.replace(/^0+/, '')}`;
      const msg = encodeURIComponent(
        `Hello ${ac.coach_name || ac.name}, your ${pc.action} request${resultPasName ? ` for "${resultPasName}"` : ''} has been APPROVED for the MakeX 2026 competition.`
      );
      window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
    }
    load();
  }

  async function rejectChange(pc: PendingChange) {
    const reason = prompt('Reason for rejection (optional):') || '';
    await supabase.from('pending_changes').update({
      status: 'rejected', reviewer_notes: reason, reviewed_by: 'admin', reviewed_at: new Date().toISOString(),
    }).eq('id', pc.id);
    const ac = pc.academy;
    if (ac?.whatsapp_number) {
      const num = ac.whatsapp_number.replace(/[^0-9]/g, '');
      const phone = num.startsWith('961') ? num : `961${num.replace(/^0+/, '')}`;
      const team = (pc.payload as Record<string, string>)?.team_name || pc.passation?.team_name || '';
      const msg = encodeURIComponent(
        `Hello ${ac.coach_name || ac.name}, your ${pc.action} request${team ? ` for "${team}"` : ''} for MakeX 2026 was rejected.${reason ? ` Reason: ${reason}` : ''}`
      );
      window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
    }
    load();
  }

  function logout() {
    sessionStorage.removeItem('admin_unlocked');
    window.location.reload();
  }

  const getCatLabel = (id: string) => {
    const c = categories.find(c => c.id === id);
    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : '—';
  };
  const getTableLabel = (id: string) => {
    const t = tables.find(t => t.id === id);
    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
  };

  const tablesExist = tables.length > 0;

  const inputCls = 'w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition placeholder-slate-400';
  const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">Admin Panel</h1>
              <p className="text-xs text-slate-400">MakeX 2026 — Lebanon</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 transition">← Home</Link>
            <button onClick={logout}
              className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition">
              Lock
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Categories', value: categories.length, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Tables', value: tables.filter(t => t.active).length, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Passations', value: passations.length, color: 'text-violet-600', bg: 'bg-violet-50' },
            { label: 'Finished', value: passations.filter(p => p.live_status === 'Finished').length, color: 'text-green-600', bg: 'bg-green-50' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-2xl p-4 border border-white shadow-sm`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
              <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Tables warning */}
        {!tablesExist && categories.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-amber-800 font-medium">No tables found. Click Sync to generate tables for all categories.</p>
            </div>
            <button onClick={syncAllTables} disabled={syncingAll}
              className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition disabled:opacity-50">
              {syncingAll ? 'Syncing…' : 'Sync Tables'}
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1.5 mb-6 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-sm">
          {(['passations', 'categories', 'approvals'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg font-semibold text-sm capitalize transition ${
                activeTab === tab ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}>
              {tab}
              {tab === 'passations' && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-white/20' : 'bg-slate-100'}`}>
                  {passations.length}
                </span>
              )}
              {tab === 'categories' && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-white/20' : 'bg-slate-100'}`}>
                  {categories.length}
                </span>
              )}
              {tab === 'approvals' && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${pendingChanges.filter(p => p.status === 'pending').length > 0 ? 'bg-amber-500 text-white' : (activeTab === tab ? 'bg-white/20' : 'bg-slate-100')}`}>
                  {pendingChanges.filter(p => p.status === 'pending').length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── CATEGORIES TAB ── */}
        {activeTab === 'categories' && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-base font-bold text-slate-800 mb-5">
                {editCatId ? 'Edit Category' : 'New Category'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Category Name *</label>
                  <input className={inputCls} value={catForm.name}
                    onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. MakeX Starter" />
                </div>
                <div>
                  <label className={labelCls}>Age Range Label</label>
                  <input className={inputCls} value={catForm.age_range_label}
                    onChange={e => setCatForm(f => ({ ...f, age_range_label: e.target.value }))}
                    placeholder="e.g. 11–13 years old" />
                </div>
                <div>
                  <label className={labelCls}>Number of Tables *</label>
                  <input type="number" min={1} max={20} className={inputCls}
                    value={catForm.table_count}
                    onChange={e => setCatForm(f => ({ ...f, table_count: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={saveCategory}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition">
                  {editCatId ? 'Update Category' : 'Add Category'}
                </button>
                {editCatId && (
                  <button onClick={() => { setCatForm({ name: '', age_range_label: '', table_count: 1 }); setEditCatId(null); }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-6 py-2.5 rounded-xl font-semibold text-sm transition">
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">All Categories</h3>
                <button onClick={syncAllTables} disabled={syncingAll}
                  className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                  {syncingAll ? 'Syncing…' : 'Sync All Tables'}
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Age Range</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Tables</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {categories.map(cat => (
                    <tr key={cat.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-slate-800">{cat.name}</td>
                      <td className="px-6 py-4 text-slate-500">{cat.age_range_label || '—'}</td>
                      <td className="px-6 py-4">
                        <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2 py-0.5 rounded-md">
                          {cat.table_count} {cat.table_count === 1 ? 'table' : 'tables'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cat.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cat.active ? 'bg-emerald-400' : 'bg-slate-400'}`} />
                          {cat.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => editCategory(cat)}
                            className="text-blue-600 hover:text-blue-800 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-50 transition">Edit</button>
                          <button onClick={() => deleteCategory(cat.id)}
                            className="text-red-500 hover:text-red-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {categories.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-12 text-slate-400">No categories yet. Add one above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PASSATIONS TAB ── */}
        {activeTab === 'passations' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800">Passations</h2>
                <p className="text-xs text-slate-400 mt-0.5">{passations.length} total</p>
              </div>
              <button onClick={() => { resetPasForm(); setShowPasForm(!showPasForm); }}
                className="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition flex items-center gap-2">
                {showPasForm ? (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>Cancel</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Add Passation</>
                )}
              </button>
            </div>

            {showPasForm && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <h3 className="font-bold text-slate-800 mb-5">{editPasId ? 'Edit Passation' : 'New Passation'}</h3>

                <div className="mb-5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Student Info</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="sm:col-span-2 md:col-span-1">
                      <label className={labelCls}>Student Full Name *</label>
                      <p className="text-xs text-slate-400 -mt-1 mb-1.5">This name will appear on all screens</p>
                      <input className={inputCls} value={pasForm.team_name}
                        onChange={e => setPasForm(f => ({ ...f, team_name: e.target.value, student_names: e.target.value }))}
                        placeholder="e.g. Sara Khoury" />
                    </div>
                    <div>
                      <label className={labelCls}>Club / School</label>
                      <input className={inputCls} value={pasForm.club_name}
                        onChange={e => setPasForm(f => ({ ...f, club_name: e.target.value }))} placeholder="Club or school name" />
                    </div>
                    <div>
                      <label className={labelCls}>Date of Birth</label>
                      <input type="date" className={inputCls} value={pasForm.date_of_birth}
                        onChange={e => setPasForm(f => ({ ...f, date_of_birth: e.target.value }))} />
                      {pasForm.date_of_birth && (() => {
                        const dob = new Date(pasForm.date_of_birth);
                        const now = new Date();
                        let a = now.getFullYear() - dob.getFullYear();
                        const m = now.getMonth() - dob.getMonth();
                        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) a--;
                        return <p className="text-xs text-slate-500 mt-1">Age: {a} years</p>;
                      })()}
                    </div>
                    <div>
                      <label className={labelCls}>Coach Name</label>
                      <input className={inputCls} value={pasForm.coach_name}
                        onChange={e => setPasForm(f => ({ ...f, coach_name: e.target.value }))} placeholder="Coach name" />
                    </div>
                    <div>
                      <label className={labelCls}>Parent Name</label>
                      <input className={inputCls} value={pasForm.parent_name}
                        onChange={e => setPasForm(f => ({ ...f, parent_name: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Parent Contact</label>
                      <input className={inputCls} value={pasForm.parent_contact}
                        onChange={e => setPasForm(f => ({ ...f, parent_contact: e.target.value }))} placeholder="Phone or email" />
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5 mb-5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Assignment</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Category *</label>
                      <select className={inputCls} value={pasForm.category_id}
                        onChange={e => setPasForm(f => ({ ...f, category_id: e.target.value, table_id: '' }))}>
                        <option value="">Select category…</option>
                        {categories.filter(c => c.active).map(c => (
                          <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Table *</label>
                      <select className={inputCls} value={pasForm.table_id}
                        onChange={e => setPasForm(f => ({ ...f, table_id: e.target.value }))}
                        disabled={!pasForm.category_id}>
                        <option value="">{pasForm.category_id ? 'Select table…' : 'Select category first'}</option>
                        {filteredTables.map(t => (
                          <option key={t.id} value={t.id}>{t.display_label || `Table ${t.table_number}`}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Appointment Time</label>
                      <p className="text-xs text-slate-400 -mt-1 mb-1.5">When this team is scheduled to present</p>
                      <input type="datetime-local" className={inputCls} value={pasForm.scheduled_time}
                        onChange={e => setPasForm(f => ({ ...f, scheduled_time: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Queue Position</label>
                      <input type="number" min={0} className={inputCls} value={pasForm.queue_position}
                        onChange={e => setPasForm(f => ({ ...f, queue_position: parseInt(e.target.value) || 0 }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Status</label>
                      <select className={inputCls} value={pasForm.live_status}
                        onChange={e => setPasForm(f => ({ ...f, live_status: e.target.value as LiveStatus }))}>
                        {LIVE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Judge Name</label>
                      <input className={inputCls} value={pasForm.judge_name}
                        onChange={e => setPasForm(f => ({ ...f, judge_name: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-5 mb-5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Results (optional)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Score</label>
                      <input type="number" className={inputCls} value={pasForm.score}
                        onChange={e => setPasForm(f => ({ ...f, score: e.target.value }))} placeholder="0" />
                    </div>
                    <div>
                      <label className={labelCls}>Mission Duration (sec)</label>
                      <p className="text-xs text-slate-400 -mt-1 mb-1.5">How long the mission took to complete</p>
                      <input type="number" className={inputCls} value={pasForm.time_seconds}
                        onChange={e => setPasForm(f => ({ ...f, time_seconds: e.target.value }))} placeholder="0" />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelCls}>Notes</label>
                      <textarea className={inputCls} rows={2} value={pasForm.notes}
                        onChange={e => setPasForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={savePassation}
                    className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition">
                    {editPasId ? 'Update Passation' : 'Add Passation'}
                  </button>
                  <button onClick={resetPasForm}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-6 py-2.5 rounded-xl font-semibold text-sm transition">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Passations table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Student', 'Academy', 'DOB / Age', 'Category', 'Table', 'Coach', 'Appt. Time', 'Status', 'Score', 'Judge', 'Sig', ''].map(h => (
                        <th key={h} className={`px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider ${h === '' ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {passations.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-800">{p.team_name}</div>
                          {p.student_names && p.student_names !== p.team_name && <div className="text-xs text-slate-400 mt-0.5">{p.student_names}</div>}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 text-xs max-w-[160px]">{p.club_name || '—'}</td>
                        <td className="px-5 py-3.5 text-xs">
                          {p.date_of_birth ? (() => {
                            const dob = new Date(p.date_of_birth);
                            const now = new Date();
                            let a = now.getFullYear() - dob.getFullYear();
                            const m = now.getMonth() - dob.getMonth();
                            if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) a--;
                            return (
                              <>
                                <div className="text-slate-700">{dob.toLocaleDateString()}</div>
                                <div className="text-slate-400">{a} yrs</div>
                              </>
                            );
                          })() : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-xs max-w-[160px]">{getCatLabel(p.category_id)}</td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                            {getTableLabel(p.table_id)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-xs">{p.coach_name || '—'}</td>
                        <td className="px-5 py-3.5 text-slate-500 text-xs">
                          {p.scheduled_time ? new Date(p.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[p.live_status] || 'bg-slate-100 text-slate-600'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[p.live_status] || 'bg-slate-400'}`} />
                            {p.live_status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-700 font-mono text-xs">{p.score ?? '—'}</td>
                        <td className="px-5 py-3.5 text-slate-500 text-xs">{p.judge_name || '—'}</td>
                        <td className="px-5 py-3.5">
                          {p.signature_image ? (
                            <img src={p.signature_image} alt="sig" className="h-7 w-14 object-contain border border-slate-200 rounded-md bg-white" />
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <button onClick={() => editPassation(p)}
                              className="text-blue-600 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-blue-50 transition">Edit</button>
                            <button onClick={() => deletePassation(p.id)}
                              className="text-red-500 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {passations.length === 0 && (
                      <tr>
                        <td colSpan={12} className="text-center py-16">
                          <svg className="w-10 h-10 text-slate-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          <p className="text-slate-400 text-sm">No passations yet</p>
                          <p className="text-slate-300 text-xs mt-1">Click Add Passation to get started</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── APPROVALS TAB ── */}
        {activeTab === 'approvals' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-bold text-slate-800">Pending Approvals</h2>
              <p className="text-xs text-slate-400 mt-0.5">Academy-submitted changes awaiting your review</p>
            </div>

            {pendingChanges.filter(p => p.status === 'pending').length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
                No pending requests.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingChanges.filter(p => p.status === 'pending').map(pc => {
                  const pl = (pc.payload || {}) as Record<string, string>;
                  const cur = pc.passation;
                  const catLabel = (id?: string) => {
                    const c = categories.find(c => c.id === id);
                    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : '—';
                  };
                  const tabLabel = (id?: string) => {
                    const t = tables.find(t => t.id === id);
                    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
                  };
                  return (
                    <div key={pc.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-bold px-2 py-1 rounded-md uppercase ${
                              pc.action === 'add' ? 'bg-emerald-100 text-emerald-700' :
                              pc.action === 'update' ? 'bg-blue-100 text-blue-700' :
                              'bg-red-100 text-red-600'
                            }`}>{pc.action}</span>
                            <span className="text-sm font-bold text-slate-800">
                              {pl.team_name || cur?.team_name || '—'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {pc.academy?.name || '—'} · submitted {new Date(pc.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => approveChange(pc)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg">
                            Approve & Notify
                          </button>
                          <button onClick={() => rejectChange(pc)}
                            className="bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold px-4 py-2 rounded-lg">
                            Reject
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        {pc.action === 'update' && cur && (
                          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                            <p className="font-semibold text-slate-500 uppercase mb-2">Current</p>
                            <Row k="Name" v={cur.team_name} />
                            <Row k="Coach" v={cur.coach_name} />
                            <Row k="Contact" v={cur.parent_contact} />
                            <Row k="Category" v={catLabel(cur.category_id)} />
                            <Row k="Table" v={tabLabel(cur.table_id)} />
                          </div>
                        )}
                        {(pc.action === 'add' || pc.action === 'update') && (
                          <div className={`${pc.action === 'add' ? 'bg-emerald-50 border-emerald-100' : 'bg-blue-50 border-blue-100'} rounded-xl p-3 border`}>
                            <p className="font-semibold text-slate-500 uppercase mb-2">{pc.action === 'add' ? 'New' : 'Proposed'}</p>
                            <Row k="Name" v={pl.team_name} />
                            <Row k="Coach" v={pl.coach_name} />
                            <Row k="Contact" v={pl.parent_contact} />
                            <Row k="Category" v={catLabel(pl.category_id)} />
                            <Row k="Table" v={tabLabel(pl.table_id)} />
                            {pl.notes && <Row k="Notes" v={pl.notes} />}
                          </div>
                        )}
                        {pc.action === 'delete' && cur && (
                          <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                            <p className="font-semibold text-red-700 uppercase mb-2">Delete request</p>
                            <Row k="Name" v={cur.team_name} />
                            <Row k="Category" v={catLabel(cur.category_id)} />
                            <Row k="Table" v={tabLabel(cur.table_id)} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pendingChanges.filter(p => p.status !== 'pending').length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase">
                  Recent Decisions ({pendingChanges.filter(p => p.status !== 'pending').length})
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-50">
                    {pendingChanges.filter(p => p.status !== 'pending').slice(0, 20).map(pc => {
                      const pl = (pc.payload || {}) as Record<string, string>;
                      return (
                        <tr key={pc.id}>
                          <td className="px-5 py-3 text-xs uppercase font-semibold text-slate-500">{pc.action}</td>
                          <td className="px-5 py-3 text-xs">{pl.team_name || pc.passation?.team_name || '—'}</td>
                          <td className="px-5 py-3 text-xs text-slate-500">{pc.academy?.name || '—'}</td>
                          <td className="px-5 py-3"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${pc.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{pc.status}</span></td>
                          <td className="px-5 py-3 text-xs text-slate-500">{pc.reviewer_notes || ''}</td>
                          <td className="px-5 py-3 text-xs text-slate-400">{pc.reviewed_at ? new Date(pc.reviewed_at).toLocaleString() : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {academies.length > 0 && (
              <details className="bg-white rounded-2xl border border-slate-200 p-5">
                <summary className="cursor-pointer font-semibold text-slate-700 text-sm">Academy Credentials ({academies.length})</summary>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500 uppercase">
                      <tr><th className="text-left py-2 px-2">Name</th><th className="text-left py-2 px-2">Username</th><th className="text-left py-2 px-2">Password</th><th className="text-left py-2 px-2">Coach</th><th className="text-left py-2 px-2">WhatsApp</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {academies.map(a => (
                        <tr key={a.id}>
                          <td className="py-2 px-2 font-semibold">{a.name}</td>
                          <td className="py-2 px-2 font-mono">{a.username}</td>
                          <td className="py-2 px-2 font-mono">{a.password}</td>
                          <td className="py-2 px-2">{a.coach_name || '—'}</td>
                          <td className="py-2 px-2 font-mono">{a.whatsapp_number || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-slate-400 w-20 shrink-0">{k}:</span>
      <span className="text-slate-700 font-medium">{v || '—'}</span>
    </div>
  );
}
