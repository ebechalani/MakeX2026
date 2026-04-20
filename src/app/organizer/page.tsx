'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import type { OrganizerTask, TaskStatus, TaskPriority } from '@/lib/types';

const CATEGORIES = [
  'Sponsors',
  'Venue & Logistics',
  'Teams & Registration',
  'Judges & Volunteers',
  'Marketing & Communication',
  'Budget & Finance',
  'Equipment & Materials',
  'Schedule & Program',
  'Awards & Certificates',
  'Media & Documentation',
  'Safety & Security',
  'General',
];

const ADMIN_PASSWORD = 'MakeX@2026';

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  todo:        { label: 'To Do',       color: 'bg-slate-600/80 text-slate-200' },
  in_progress: { label: 'In Progress', color: 'bg-blue-600/80 text-blue-100' },
  done:        { label: 'Done',        color: 'bg-green-600/80 text-green-100' },
  blocked:     { label: 'Blocked',     color: 'bg-red-600/80 text-red-100' },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; icon: string }> = {
  low:    { label: 'Low',    color: 'text-slate-400', icon: '' },
  medium: { label: 'Medium', color: 'text-yellow-400', icon: '🟡' },
  high:   { label: 'High',   color: 'text-orange-400', icon: '🟠' },
  urgent: { label: 'Urgent', color: 'text-red-400',    icon: '🔴' },
};

const CATEGORY_COLORS: Record<string, string> = {
  'Sponsors':                   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'Venue & Logistics':          'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Teams & Registration':       'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'Judges & Volunteers':        'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Marketing & Communication':  'bg-pink-500/20 text-pink-300 border-pink-500/30',
  'Budget & Finance':           'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'Equipment & Materials':      'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Schedule & Program':         'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  'Awards & Certificates':      'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  'Media & Documentation':      'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'Safety & Security':          'bg-red-500/20 text-red-300 border-red-500/30',
  'General':                    'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const defaultForm = {
  title: '',
  description: '',
  category: 'General',
  priority: 'medium' as TaskPriority,
  status: 'todo' as TaskStatus,
  due_date: '',
  notes: '',
};

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
  blocked: 'todo',
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function OrganizerPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const [tasks, setTasks] = useState<OrganizerTask[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<OrganizerTask | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  useEffect(() => {
    if (authenticated) loadTasks();
  }, [authenticated]);

  async function loadTasks() {
    setLoading(true);
    const { data } = await supabase
      .from('organizer_tasks')
      .select('*')
      .order('created_at', { ascending: false });
    setTasks((data as OrganizerTask[]) || []);
    setLoading(false);
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      setAuthenticated(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
    }
  }

  const filteredTasks = useMemo(() => {
    const q = search.toLowerCase();
    return tasks.filter(t => {
      if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      return true;
    });
  }, [tasks, search, filterCategory, filterPriority, filterStatus]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;
    const todo = tasks.filter(t => t.status === 'todo').length;
    const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date()).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, blocked, todo, overdue, progress };
  }, [tasks]);

  const groupedTasks = useMemo(() => {
    const groups: Record<string, OrganizerTask[]> = {};
    filteredTasks.forEach(t => {
      if (!groups[t.category]) groups[t.category] = [];
      groups[t.category].push(t);
    });
    Object.values(groups).forEach(arr =>
      arr.sort((a, b) => {
        if (a.status === 'blocked' && b.status !== 'blocked') return -1;
        if (b.status === 'blocked' && a.status !== 'blocked') return 1;
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (b.status === 'done' && a.status !== 'done') return -1;
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      }),
    );
    return groups;
  }, [filteredTasks]);

  function openAddModal() {
    setEditingTask(null);
    setForm(defaultForm);
    setSaveError(null);
    setModalOpen(true);
  }

  function openEditModal(task: OrganizerTask) {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description || '',
      category: task.category,
      priority: task.priority,
      status: task.status,
      due_date: task.due_date || '',
      notes: task.notes || '',
    });
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category,
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editingTask) {
      ({ error } = await supabase.from('organizer_tasks').update(payload).eq('id', editingTask.id));
    } else {
      ({ error } = await supabase.from('organizer_tasks').insert(payload));
    }
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setModalOpen(false);
    await loadTasks();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this task?')) return;
    await supabase.from('organizer_tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  async function cycleStatus(task: OrganizerTask) {
    const next = STATUS_CYCLE[task.status];
    await supabase
      .from('organizer_tasks')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t));
  }

  const categoryColorFor = (cat: string) =>
    CATEGORY_COLORS[cat] ?? 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  // ── Password gate ──────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <main className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-white/60 text-sm font-medium">Organizer Access</span>
            </div>
            <h1 className="text-3xl font-black text-white mb-1">Task Dashboard</h1>
            <p className="text-white/40 text-sm">MakeX 2026 · National Organizer</p>
          </div>
          <form onSubmit={handleLogin} className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
            <div>
              <label className="text-white/60 text-sm font-medium block mb-2">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={e => { setPasswordInput(e.target.value); setPasswordError(false); }}
                className={`w-full bg-white/5 border ${passwordError ? 'border-red-500' : 'border-white/10'} rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 transition-colors`}
                placeholder="Enter password"
                autoFocus
              />
              {passwordError && <p className="text-red-400 text-xs mt-1">Incorrect password</p>}
            </div>
            <button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl transition-colors">
              Enter
            </button>
            <Link href="/" className="block text-center text-white/30 text-sm hover:text-white/60 transition-colors">
              ← Back to home
            </Link>
          </form>
        </div>
      </main>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────────
  const allCategories = [
    ...CATEGORIES.filter(c => groupedTasks[c]?.length),
    ...Object.keys(groupedTasks).filter(c => !CATEGORIES.includes(c)),
  ];

  return (
    <main className="min-h-screen bg-[#0a0f1e] p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-white/40 hover:text-white/70 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-black text-white">Organizer Dashboard</h1>
              <p className="text-white/40 text-sm">MakeX 2026 · National Competition Tasks</p>
            </div>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Task
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5">
          {[
            { label: 'Total',       value: stats.total,      color: 'text-white' },
            { label: 'Done',        value: stats.done,       color: 'text-green-400' },
            { label: 'In Progress', value: stats.inProgress, color: 'text-blue-400' },
            { label: 'To Do',       value: stats.todo,       color: 'text-slate-400' },
            { label: 'Blocked',     value: stats.blocked,    color: 'text-red-400' },
            { label: 'Overdue',     value: stats.overdue,    color: 'text-orange-400' },
          ].map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
              <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-white/40 text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-3 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white/50 text-sm">Overall Progress</span>
            <span className="text-white font-bold text-sm">{stats.progress}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-green-500 h-2 rounded-full transition-all duration-700"
              style={{ width: `${stats.progress}%` }}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="flex-1 min-w-[180px] bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 text-sm transition-colors"
          />
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white/70 text-sm focus:outline-none focus:border-purple-500 transition-colors [&>option]:bg-[#0f1629]"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white/70 text-sm focus:outline-none focus:border-purple-500 transition-colors [&>option]:bg-[#0f1629]"
          >
            <option value="">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white/70 text-sm focus:outline-none focus:border-purple-500 transition-colors [&>option]:bg-[#0f1629]"
          >
            <option value="">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="blocked">Blocked</option>
          </select>
          {(search || filterCategory || filterPriority || filterStatus) && (
            <button
              onClick={() => { setSearch(''); setFilterCategory(''); setFilterPriority(''); setFilterStatus(''); }}
              className="text-white/40 hover:text-white/70 text-sm px-3 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Task list */}
        {loading ? (
          <div className="text-center text-white/40 py-24">Loading tasks…</div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center text-white/40 py-24">
            <p className="text-lg mb-2">{tasks.length === 0 ? 'No tasks yet' : 'No tasks match your filters'}</p>
            {tasks.length === 0 && (
              <button onClick={openAddModal} className="text-purple-400 hover:text-purple-300 transition-colors text-sm">
                Add your first task →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-7">
            {allCategories.map(category => (
              <div key={category}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-2.5">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${categoryColorFor(category)}`}>
                    {category}
                  </span>
                  <span className="text-white/30 text-xs">
                    {groupedTasks[category].filter(t => t.status === 'done').length}/{groupedTasks[category].length} done
                  </span>
                  <div className="flex-1 border-t border-white/5" />
                </div>
                {/* Task cards */}
                <div className="space-y-1.5">
                  {groupedTasks[category].map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onEdit={() => openEditModal(task)}
                      onDelete={() => handleDelete(task.id)}
                      onCycleStatus={() => cycleStatus(task)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f1629] border border-white/10 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-white">{editingTask ? 'Edit Task' : 'New Task'}</h2>
                <button onClick={() => setModalOpen(false)} className="text-white/40 hover:text-white transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="text-white/60 text-xs font-medium block mb-1.5">Title *</label>
                  <input
                    type="text"
                    required
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 text-sm transition-colors"
                    placeholder="What needs to be done?"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-white/60 text-xs font-medium block mb-1.5">Description</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 text-sm transition-colors resize-none"
                    placeholder="Short description (optional)"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/60 text-xs font-medium block mb-1.5">Category</label>
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full bg-[#0f1629] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-white/60 text-xs font-medium block mb-1.5">Priority</label>
                    <select
                      value={form.priority}
                      onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
                      className="w-full bg-[#0f1629] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/60 text-xs font-medium block mb-1.5">Status</label>
                    <select
                      value={form.status}
                      onChange={e => setForm(f => ({ ...f, status: e.target.value as TaskStatus }))}
                      className="w-full bg-[#0f1629] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
                    >
                      <option value="todo">To Do</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-white/60 text-xs font-medium block mb-1.5">Due Date</label>
                    <input
                      type="date"
                      value={form.due_date}
                      onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                      className="w-full bg-[#0f1629] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-white/60 text-xs font-medium block mb-1.5">Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-purple-500 text-sm transition-colors resize-none"
                    placeholder="Contacts, links, details…"
                  />
                </div>

                {saveError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                    <strong>Error:</strong> {saveError}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white/70 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                  >
                    {saving ? 'Saving…' : editingTask ? 'Save Changes' : 'Add Task'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Task Card ──────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onEdit,
  onDelete,
  onCycleStatus,
}: {
  task: OrganizerTask;
  onEdit: () => void;
  onDelete: () => void;
  onCycleStatus: () => void;
}) {
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date();
  const statusCfg = STATUS_CONFIG[task.status];
  const priorityCfg = PRIORITY_CONFIG[task.priority];

  const statusBtnClass =
    task.status === 'done'
      ? 'bg-green-500 border-green-500'
      : task.status === 'in_progress'
      ? 'border-blue-400 bg-blue-400/20'
      : task.status === 'blocked'
      ? 'border-red-400 bg-red-400/20'
      : 'border-white/30 hover:border-white/60';

  return (
    <div
      className={`group bg-white/5 border rounded-xl px-4 py-3 flex items-start gap-3 hover:bg-white/[0.07] transition-colors ${
        task.status === 'blocked'
          ? 'border-red-500/30'
          : task.status === 'done'
          ? 'border-green-500/15'
          : 'border-white/10'
      }`}
    >
      {/* Status circle — click to cycle */}
      <button
        onClick={onCycleStatus}
        title="Cycle status (Todo → In Progress → Done)"
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${statusBtnClass}`}
      >
        {task.status === 'done' && (
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {task.status === 'in_progress' && <span className="w-2 h-2 rounded-full bg-blue-400" />}
        {task.status === 'blocked' && <span className="w-2 h-2 rounded-full bg-red-400" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium text-sm ${task.status === 'done' ? 'text-white/35 line-through' : 'text-white'}`}>
            {task.title}
          </span>
          {task.priority !== 'low' && (
            <span className={`text-xs font-semibold ${priorityCfg.color}`}>
              {priorityCfg.icon} {priorityCfg.label}
            </span>
          )}
        </div>
        {task.description && (
          <p className="text-white/40 text-xs mt-0.5 truncate">{task.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
            {statusCfg.label}
          </span>
          {task.due_date && (
            <span className={`text-xs ${isOverdue ? 'text-orange-400 font-semibold' : 'text-white/40'}`}>
              {isOverdue ? '⚠ Overdue · ' : 'Due '}
              {new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
          {task.notes && <span className="text-white/25 text-xs">· notes</span>}
        </div>
      </div>

      {/* Actions — visible on hover */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={onEdit}
          title="Edit"
          className="p-1.5 text-white/40 hover:text-white/80 hover:bg-white/10 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}
