'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation, LiveStatus } from '@/lib/types';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'bg-gray-100 text-gray-700',
  Prepare: 'bg-yellow-100 text-yellow-800',
  Next: 'bg-blue-100 text-blue-800',
  'In Progress': 'bg-green-100 text-green-800',
  Finished: 'bg-emerald-100 text-emerald-800',
  Absent: 'bg-red-100 text-red-800',
  Delayed: 'bg-orange-100 text-orange-800',
};

const LIVE_STATUSES: LiveStatus[] = ['Scheduled', 'Prepare', 'Next', 'In Progress', 'Finished', 'Absent', 'Delayed'];

export default function AdminPage() {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [activeTab, setActiveTab] = useState<'passations' | 'categories'>('passations');
  const [catForm, setCatForm] = useState({ name: '', age_range_label: '', table_count: 1 });
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [pasForm, setPasForm] = useState({
    team_name: '', student_names: '', coach_name: '', parent_name: '',
    parent_contact: '', category_id: '', table_id: '', scheduled_time: '',
    queue_position: 0, live_status: 'Scheduled' as LiveStatus,
    judge_name: '', score: '', time_seconds: '', notes: '',
  });
  const [editPasId, setEditPasId] = useState<string | null>(null);
  const [showPasForm, setShowPasForm] = useState(false);
  const [filteredTables, setFilteredTables] = useState<Table[]>([]);

  const load = useCallback(async () => {
    const [{ data: cats }, { data: tabs }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('tables').select('*').order('table_number'),
      supabase.from('passations').select('*, category:categories(*), table:tables(*)').order('scheduled_time').order('queue_position'),
    ]);
    if (cats) setCategories(cats);
    if (tabs) setTables(tabs);
    if (pas) setPassations(pas as any);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'passations' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

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
  }, [pasForm.category_id, categories, tables, pasForm.table_id]);

  async function syncTablesForCategory(catId: string, count: number) {
    for (let i = 1; i <= count; i++) {
      await supabase.from('tables').upsert(
        { category_id: catId, table_number: i, display_label: `Table ${i}`, active: true },
        { onConflict: 'category_id,table_number' }
      );
    }
    await supabase.from('tables').update({ active: false }).eq('category_id', catId).gt('table_number', count);
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
      team_name: '', student_names: '', coach_name: '', parent_name: '',
      parent_contact: '', category_id: '', table_id: '', scheduled_time: '',
      queue_position: 0, live_status: 'Scheduled', judge_name: '',
      score: '', time_seconds: '', notes: '',
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
    });
    setEditPasId(p.id);
    setShowPasForm(true);
  }

  async function deletePassation(id: string) {
    if (!confirm('Delete this passation?')) return;
    await supabase.from('passations').delete().eq('id', id);
    load();
  }

  const getCatLabel = (id: string) => {
    const c = categories.find(c => c.id === id);
    return c ? `${c.name}${c.age_range_label ? ` (${c.age_range_label})` : ''}` : id;
  };
  const getTableLabel = (id: string) => {
    const t = tables.find(t => t.id === id);
    return t ? (t.display_label || `Table ${t.table_number}`) : id;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <p className="text-blue-200 text-sm">MakeX 2026 — Lebanon</p>
        </div>
        <Link href="/" className="text-blue-200 hover:text-white text-sm">← Home</Link>
      </header>
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex gap-2 mb-6">
          {(['passations', 'categories'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg font-semibold capitalize transition ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border'}`}>
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'categories' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow p-6">
              <h2 className="text-xl font-bold mb-4">{editCatId ? 'Edit Category' : 'Add Category'}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input className="w-full border rounded-lg px-3 py-2" value={catForm.name}
                    onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. MakeX Starter" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Age Range Label</label>
                  <input className="w-full border rounded-lg px-3 py-2" value={catForm.age_range_label}
                    onChange={e => setCatForm(f => ({ ...f, age_range_label: e.target.value }))} placeholder="e.g. 11–13 years old" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Table Count *</label>
                  <input type="number" min={1} max={20} className="w-full border rounded-lg px-3 py-2"
                    value={catForm.table_count}
                    onChange={e => setCatForm(f => ({ ...f, table_count: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={saveCategory} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700">
                  {editCatId ? 'Update' : 'Add Category'}
                </button>
                {editCatId && (
                  <button onClick={() => { setCatForm({ name: '', age_range_label: '', table_count: 1 }); setEditCatId(null); }}
                    className="bg-gray-200 px-6 py-2 rounded-lg font-semibold hover:bg-gray-300">Cancel</button>
                )}
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Name</th>
                    <th className="text-left px-4 py-3 font-semibold">Age Range</th>
                    <th className="text-left px-4 py-3 font-semibold">Tables</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-right px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map(cat => (
                    <tr key={cat.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{cat.name}</td>
                      <td className="px-4 py-3 text-gray-500">{cat.age_range_label || '—'}</td>
                      <td className="px-4 py-3">{cat.table_count}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${cat.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {cat.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => editCategory(cat)} className="text-blue-600 hover:underline text-sm">Edit</button>
                          <button onClick={() => deleteCategory(cat.id)} className="text-red-500 hover:underline text-sm">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {categories.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">No categories yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'passations' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Passations ({passations.length})</h2>
              <button onClick={() => setShowPasForm(!showPasForm)}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-700">
                {showPasForm ? 'Hide Form' : '+ Add Passation'}
              </button>
            </div>

            {showPasForm && (
              <div className="bg-white rounded-2xl shadow p-6">
                <h3 className="text-lg font-bold mb-4">{editPasId ? 'Edit Passation' : 'New Passation'}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Team Name *</label>
                    <input className="w-full border rounded-lg px-3 py-2" value={pasForm.team_name}
                      onChange={e => setPasForm(f => ({ ...f, team_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Student Names</label>
                    <input className="w-full border rounded-lg px-3 py-2" value={pasForm.student_names}
                      onChange={e => setPasForm(f => ({ ...f, student_names: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Coach Name</label>
                    <input className="w-full border rounded-lg px-3 py-2" value={pasForm.coach_name}
                      onChange={e => setPasForm(f => ({ ...f, coach_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Parent Name</label>
                    <input className="w-full border rounded-lg px-3 py-2" value={pasForm.parent_name}
                      onChange={e => setPasForm(f => ({ ...f, parent_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Parent Contact</label>
                    <input className="w-full border rounded-lg px-3 py-2" value={pasForm.parent_contact}
                      onChange={e => setPasForm(f => ({ ...f, parent_contact: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Category *</label>
                    <select className="w-full border rounded-lg px-3 py-2" value={pasForm.category_id}
                      onChange={e => setPasForm(f => ({ ...f, category_id: e.target.value, table_id: '' }))}>
                      <option value="">Select category…</option>
                      {categories.filter(c => c.active).map(c => (
                        <option key={c.id} value={c.id}>{c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Table *</label>
                    <select className="w-full border rounded-lg px-3 py-2" value={pasForm.table_id}
                      onChange={e => setPasForm(f => ({ ...f, table_id: e.target.value }))}
                      disabled={!pasForm.category_id}>
                      <option value="">Select table…</option>
                      {filteredTables.map(t => (
                        <option key={t.id} value={t.id}>{t.display_label || `Table ${t.table_number}`}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Scheduled Time</label>
                    <input type="datetime-local" className="w-full border rounded-lg px-3 py-2" value={pasForm.scheduled_time}
                      onChange={e => setPasForm(f => ({ ...f, scheduled_time: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Queue Position</label>
                    <input type="number" min={0} className="w-full border rounded-lg px-3 py-2" value={pasForm.queue_position}
                      onChange={e => setPasForm(f => ({ ...f, queue_position: parseInt(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    <select className="w-full border rounded-lg px-3 py-2" value={pasForm.live_status}
                      onChange={e => setPasForm(f => ({ ...f, live_status: e.target.value as LiveStatus }))}>
                      {LIVE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Judge Name</label>
                    <input className="w-full border rounded-lg px-3 py-2" value={pasForm.judge_name}
                      onChange={e => setPasForm(f => ({ ...f, judge_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Score</label>
                    <input type="number" className="w-full border rounded-lg px-3 py-2" value={pasForm.score}
                      onChange={e => setPasForm(f => ({ ...f, score: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Time (seconds)</label>
                    <input type="number" className="w-full border rounded-lg px-3 py-2" value={pasForm.time_seconds}
                      onChange={e => setPasForm(f => ({ ...f, time_seconds: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1">Notes</label>
                    <textarea className="w-full border rounded-lg px-3 py-2" rows={2} value={pasForm.notes}
                      onChange={e => setPasForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <button onClick={savePassation} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700">
                    {editPasId ? 'Update' : 'Add'}
                  </button>
                  <button onClick={resetPasForm} className="bg-gray-200 px-6 py-2 rounded-lg font-semibold hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Team</th>
                    <th className="text-left px-4 py-3 font-semibold">Category</th>
                    <th className="text-left px-4 py-3 font-semibold">Table</th>
                    <th className="text-left px-4 py-3 font-semibold">Coach</th>
                    <th className="text-left px-4 py-3 font-semibold">Time</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-left px-4 py-3 font-semibold">Score</th>
                    <th className="text-left px-4 py-3 font-semibold">Judge</th>
                    <th className="text-left px-4 py-3 font-semibold">Sig</th>
                    <th className="text-right px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {passations.map(p => (
                    <tr key={p.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.team_name}</div>
                        {p.student_names && <div className="text-xs text-gray-400">{p.student_names}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{getCatLabel(p.category_id)}</td>
                      <td className="px-4 py-3">{getTableLabel(p.table_id)}</td>
                      <td className="px-4 py-3 text-gray-600">{p.coach_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {p.scheduled_time ? new Date(p.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[p.live_status] || 'bg-gray-100'}`}>
                          {p.live_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{p.score ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{p.judge_name || '—'}</td>
                      <td className="px-4 py-3">
                        {p.signature_image ? (
                          <img src={p.signature_image} alt="sig" className="h-8 w-16 object-contain border rounded" />
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => editPassation(p)} className="text-blue-600 hover:underline text-sm">Edit</button>
                          <button onClick={() => deletePassation(p.id)} className="text-red-500 hover:underline text-sm">Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {passations.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-8 text-gray-400">No passations yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
