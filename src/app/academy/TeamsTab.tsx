'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Passation } from '@/lib/types';

type Props = {
  academyName: string;
  passations: Passation[];       // already filtered by academy + round 1
  categories: Category[];
  onChanged: () => void;          // ask parent to reload
};

// Categories where team-grouping applies. Add more keys here later if needed.
function isTeamableCategory(name: string): boolean {
  return /makex\s*starter|signal\s*rise/i.test(name);
}

// Browser-safe UUID v4
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function TeamsTab({ academyName, passations, categories, onChanged }: Props) {
  const supabase = useMemo(() => createClient(), []);

  // The eligible categories the academy is competing in
  const myTeamableCategories = useMemo(() => {
    const ids = new Set<string>();
    for (const p of passations) {
      const cat = categories.find(c => c.id === p.category_id);
      if (cat && isTeamableCategory(cat.name)) ids.add(cat.id);
    }
    return categories.filter(c => ids.has(c.id));
  }, [passations, categories]);

  if (myTeamableCategories.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
        Your academy has no students in a team-based category. The team builder appears automatically once you have students in <strong>MakeX Starter</strong> or <strong>Signal Rise</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-900">
        <strong>Team formation:</strong> in this category each team has <strong>1 or 2 students</strong>. Use the picker below to group your students into teams. You can re-group at any time before the event.
      </div>
      {myTeamableCategories.map(cat => (
        <CategoryTeams
          key={cat.id}
          category={cat}
          academyName={academyName}
          passations={passations.filter(p => p.category_id === cat.id)}
          supabase={supabase}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function CategoryTeams({
  category, academyName, passations, supabase, onChanged,
}: {
  category: Category;
  academyName: string;
  passations: Passation[];
  supabase: ReturnType<typeof createClient>;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [teamLabel, setTeamLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Add-new-team form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTeam, setNewTeam] = useState({
    label: '',
    s1_name: '', s1_dob: '',
    s2_name: '', s2_dob: '',
    coach_name: '', coach_contact: '',
  });
  const [addErr, setAddErr] = useState('');

  // Group existing teams
  const teams = useMemo(() => {
    const m = new Map<string, { id: string; label: string | null; members: Passation[] }>();
    for (const p of passations) {
      if (!p.team_group_id) continue;
      if (!m.has(p.team_group_id)) m.set(p.team_group_id, { id: p.team_group_id, label: p.team_label, members: [] });
      m.get(p.team_group_id)!.members.push(p);
    }
    return Array.from(m.values()).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }, [passations]);

  const ungrouped = passations.filter(p => !p.team_group_id).sort((a, b) => a.team_name.localeCompare(b.team_name));

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else if (n.size < 2) n.add(id);
      else setErr('Maximum 2 students per team. Uncheck one first.');
      return n;
    });
    setErr('');
  }

  async function createTeam() {
    setErr('');
    if (selected.size === 0) { setErr('Select 1 or 2 students to form a team.'); return; }
    setBusy(true);
    const id = uuid();
    const label = teamLabel.trim() || null;
    const { error } = await supabase
      .from('passations')
      .update({ team_group_id: id, team_label: label, updated_at: new Date().toISOString() })
      .in('id', Array.from(selected));
    setBusy(false);
    if (error) { setErr(error.message); return; }
    // Also update the matching round-2 rows so the team stays paired in R2
    // (R2 rows have same team_name + category + club but different round_number)
    const selectedRows = passations.filter(p => selected.has(p.id));
    for (const r1 of selectedRows) {
      const { data: r2rows } = await supabase
        .from('passations').select('id')
        .eq('category_id', r1.category_id)
        .eq('club_name', r1.club_name)
        .eq('team_name', r1.team_name)
        .eq('round_number', 2);
      if (r2rows && r2rows.length) {
        await supabase.from('passations')
          .update({ team_group_id: id, team_label: label, updated_at: new Date().toISOString() })
          .in('id', r2rows.map((r: { id: string }) => r.id));
      }
    }
    setSelected(new Set());
    setTeamLabel('');
    onChanged();
  }

  async function submitNewTeam() {
    setAddErr('');
    if (!newTeam.s1_name.trim()) { setAddErr('At least one student name is required.'); return; }
    setBusy(true);
    const teamId = uuid();
    const label = newTeam.label.trim() || null;
    const members = [
      { name: newTeam.s1_name.trim(), dob: newTeam.s1_dob || null },
      ...(newTeam.s2_name.trim() ? [{ name: newTeam.s2_name.trim(), dob: newTeam.s2_dob || null }] : []),
    ];
    const rowsToInsert = members.map(m => ({
      team_name: m.name,
      student_names: m.name,
      coach_name: newTeam.coach_name.trim() || null,
      parent_name: null,
      parent_contact: newTeam.coach_contact.trim() || null,
      club_name: academyName,
      date_of_birth: m.dob,
      category_id: category.id,
      // Placeholder — admin will schedule MakeX Starter manually
      // table_id intentionally not set here; if your schema requires non-null, see the comment below.
      live_status: 'Scheduled' as const,
      queue_position: 0,
      round_number: 1,
      team_group_id: teamId,
      team_label: label,
    }));
    // The schema requires table_id NOT NULL on passations. Use the first table of this category as a placeholder.
    const { data: tables } = await supabase.from('tables').select('id').eq('category_id', category.id).eq('active', true).order('table_number').limit(1);
    const placeholderTable = tables?.[0]?.id;
    if (!placeholderTable) {
      setBusy(false);
      setAddErr('No active table found for this category. Ask the admin to add one.');
      return;
    }
    const rowsWithTable = rowsToInsert.map(r => ({ ...r, table_id: placeholderTable }));
    const { error } = await supabase.from('passations').insert(rowsWithTable);
    setBusy(false);
    if (error) { setAddErr(error.message); return; }
    setNewTeam({ label: '', s1_name: '', s1_dob: '', s2_name: '', s2_dob: '', coach_name: '', coach_contact: '' });
    setShowAddForm(false);
    onChanged();
  }

  async function disbandTeam(teamId: string) {
    if (!confirm('Disband this team? Members will become ungrouped.')) return;
    setBusy(true);
    // Clear team_group_id on every passation (R1 and R2) with this team_group_id
    const { error } = await supabase
      .from('passations')
      .update({ team_group_id: null, team_label: null, updated_at: new Date().toISOString() })
      .eq('team_group_id', teamId);
    setBusy(false);
    if (error) { alert(error.message); return; }
    onChanged();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800">{category.name} <span className="text-slate-400 font-normal">{category.age_range_label}</span></h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {teams.length} team{teams.length === 1 ? '' : 's'} formed · {ungrouped.length} student{ungrouped.length === 1 ? '' : 's'} not yet in a team
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(s => !s)}
          className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg">
          {showAddForm ? 'Cancel' : '+ Add new team'}
        </button>
      </div>

      {showAddForm && (
        <div className="px-5 py-4 bg-indigo-50/40 border-b border-slate-100 space-y-3">
          <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Add a brand-new team to {category.name}</p>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Team name (optional)</label>
            <input value={newTeam.label} onChange={e => setNewTeam(n => ({ ...n, label: e.target.value }))}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="e.g. RoboHolic Alpha" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Student 1 name *</label>
              <input value={newTeam.s1_name} onChange={e => setNewTeam(n => ({ ...n, s1_name: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Student 1 DOB</label>
              <input type="date" value={newTeam.s1_dob} onChange={e => setNewTeam(n => ({ ...n, s1_dob: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Student 2 name (optional)</label>
              <input value={newTeam.s2_name} onChange={e => setNewTeam(n => ({ ...n, s2_name: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Leave blank for a 1-person team" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Student 2 DOB</label>
              <input type="date" value={newTeam.s2_dob} onChange={e => setNewTeam(n => ({ ...n, s2_dob: e.target.value }))}
                disabled={!newTeam.s2_name.trim()}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Coach name</label>
              <input value={newTeam.coach_name} onChange={e => setNewTeam(n => ({ ...n, coach_name: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Coach contact</label>
              <input value={newTeam.coach_contact} onChange={e => setNewTeam(n => ({ ...n, coach_contact: e.target.value }))}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Phone or email" />
            </div>
          </div>
          {addErr && <p className="text-xs text-red-600">{addErr}</p>}
          <div className="flex gap-2">
            <button onClick={submitNewTeam} disabled={busy || !newTeam.s1_name.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg">
              {busy ? 'Saving…' : 'Create team'}
            </button>
            <button onClick={() => { setShowAddForm(false); setAddErr(''); }}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Existing teams */}
      {teams.length > 0 && (
        <div className="divide-y divide-slate-100">
          {teams.map((t, i) => {
            const uniqMembers = Array.from(new Map(t.members.map(m => [m.team_name, m])).values());
            return (
              <div key={t.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-slate-800 text-sm">
                    <span className="text-slate-400 mr-1">#{i + 1}</span>
                    {t.label || <span className="italic text-slate-400">unnamed team</span>}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {uniqMembers.map(m => m.team_name).join(' · ')}
                  </p>
                </div>
                <button onClick={() => disbandTeam(t.id)} disabled={busy}
                  className="text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg disabled:opacity-40">
                  Disband
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Form a new team */}
      <div className="px-5 py-4 bg-slate-50/40 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Form a new team</p>
        {ungrouped.length === 0 ? (
          <p className="text-xs text-slate-400 italic">All your students in this category are already in a team. Disband one to reshuffle.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {ungrouped.map(p => {
                const checked = selected.has(p.id);
                return (
                  <button key={p.id} onClick={() => toggleSelect(p.id)}
                    className={`text-left text-sm border rounded-lg px-3 py-2 transition flex items-center gap-2 ${
                      checked ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}>
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                      checked ? 'border-indigo-500 bg-indigo-500 text-white text-[10px] font-bold' : 'border-slate-300'
                    }`}>{checked ? '✓' : ''}</span>
                    <span className="truncate flex-1">{p.team_name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={teamLabel} onChange={e => setTeamLabel(e.target.value)}
                placeholder="Team name (optional)"
                className="flex-1 min-w-[180px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
              <button onClick={createTeam} disabled={busy || selected.size === 0}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-lg">
                {busy ? 'Saving…' : `Form team (${selected.size}/2)`}
              </button>
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())}
                  className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Clear selection</button>
              )}
            </div>
            {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          </>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Note: this updates both round 1 and round 2 for each member, so the team stays paired across both runs.
        </p>
      </div>
    </div>
  );
}
