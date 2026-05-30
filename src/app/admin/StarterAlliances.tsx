'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import type { Category, Passation } from '@/lib/types';

interface Team {
  key: string;
  displayName: string;
  club: string;
  members: string[];
}

interface Alliance {
  num: number;
  red: Team;
  blue: Team;
}

function shuffleArr<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Check if joined member names contain ALL given fragments (case-insensitive) */
function anyMember(team: Team, ...frags: string[]): boolean {
  const all = team.members.join(' ').toLowerCase();
  return frags.some(f => all.includes(f.toLowerCase()));
}

function allMembers(team: Team, ...frags: string[]): boolean {
  const all = team.members.join(' ').toLowerCase();
  return frags.every(f => all.includes(f.toLowerCase()));
}

function pull(pool: Team[], pred: (t: Team) => boolean): Team | null {
  const i = pool.findIndex(pred);
  if (i === -1) return null;
  return pool.splice(i, 1)[0];
}

export default function StarterAlliances() {
  const supabase = useMemo(() => createClient(), []);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [loading, setLoading] = useState(true);
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [generated, setGenerated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cats } = await supabase.from('categories').select('*').ilike('name', '%makex starter%');
    const cat = (cats || [])[0] as Category | undefined;
    if (!cat) { setLoading(false); return; }
    const { data } = await supabase
      .from('passations')
      .select('*')
      .eq('category_id', cat.id)
      .or('round_number.eq.1,round_number.is.null')
      .order('club_name')
      .order('team_name');
    setPassations((data || []) as Passation[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  /** Group passations into teams of 2 */
  const teams = useMemo<Team[]>(() => {
    // First try team_group_id, then team_name, then club pairing
    const byGroupId = new Map<string, Passation[]>();
    const noGroup: Passation[] = [];

    for (const p of passations) {
      if (p.team_group_id) {
        if (!byGroupId.has(p.team_group_id)) byGroupId.set(p.team_group_id, []);
        byGroupId.get(p.team_group_id)!.push(p);
      } else {
        noGroup.push(p);
      }
    }

    const result: Team[] = [];

    // From group_id buckets
    for (const [gid, rows] of byGroupId) {
      result.push({
        key: gid,
        displayName: rows[0].team_name || rows[0].club_name || gid,
        club: rows[0].club_name || '',
        members: rows.map(r => r.student_names || r.team_name || '').filter(Boolean),
      });
    }

    // Group remaining by team_name (shared team name = same team)
    const byTeamName = new Map<string, Passation[]>();
    for (const p of noGroup) {
      const k = `${p.club_name || ''}::${p.team_name || p.id}`;
      if (!byTeamName.has(k)) byTeamName.set(k, []);
      byTeamName.get(k)!.push(p);
    }

    // If multiple rows share the same key → they're a team
    const singletons: Passation[] = [];
    for (const [k, rows] of byTeamName) {
      if (rows.length > 1) {
        result.push({
          key: k,
          displayName: rows[0].team_name || rows[0].club_name || k,
          club: rows[0].club_name || '',
          members: rows.map(r => r.student_names || r.team_name || '').filter(Boolean),
        });
      } else {
        singletons.push(rows[0]);
      }
    }

    // Pair singletons by club (first 2, next 2, …)
    const byClub = new Map<string, Passation[]>();
    for (const p of singletons) {
      const c = p.club_name || 'unknown';
      if (!byClub.has(c)) byClub.set(c, []);
      byClub.get(c)!.push(p);
    }
    for (const [club, rows] of byClub) {
      for (let i = 0; i < rows.length; i += 2) {
        const pair = rows.slice(i, i + 2);
        result.push({
          key: pair.map(p => p.id).join('|'),
          displayName: club,
          club,
          members: pair.map(p => p.student_names || p.team_name || '').filter(Boolean),
        });
      }
    }

    return result;
  }, [passations]);

  function generate() {
    const pool = [...teams];
    const fixed: { red: Team; blue: Team }[] = [];
    const freeRed: Team[] = [];
    const freeBlue: Team[] = [];

    // ── Fixed alliance 1: Roboholic (Elio+Alexander) RED ↔ Mindscape (Khoury+Matar) BLUE ──
    const rA = pull(pool, t =>
      t.club.toLowerCase().includes('roboholic') &&
      anyMember(t, 'elio') && anyMember(t, 'alexander')
    );
    const bA = pull(pool, t =>
      t.club.toLowerCase().includes('mindscape') &&
      (anyMember(t, 'khoury') || anyMember(t, 'matar'))
    );
    if (rA && bA) fixed.push({ red: rA, blue: bA });
    else { if (rA) pool.push(rA); if (bA) pool.push(bA); }

    // ── Fixed role: Roboholic (Jean+Peter) → RED ──
    const rB = pull(pool, t =>
      t.club.toLowerCase().includes('roboholic') &&
      anyMember(t, 'jean') && anyMember(t, 'peter')
    );
    if (rB) freeRed.push(rB);

    // ── Fixed role: Roboholic (Carlo+Jean Paul) → BLUE ──
    const bB = pull(pool, t =>
      t.club.toLowerCase().includes('roboholic') &&
      anyMember(t, 'carlo') && (anyMember(t, 'jean') || anyMember(t, 'jean paul'))
    );
    if (bB) freeBlue.push(bB);

    // ── Fixed role: (Johny/Johnny + Christopher) → BLUE ──
    const bC = pull(pool, t =>
      (anyMember(t, 'johny') || anyMember(t, 'johnny')) && anyMember(t, 'christopher')
    );
    if (bC) freeBlue.push(bC);

    // Remaining pool → shuffle, split into red/blue randomly
    const shuffled = shuffleArr(pool);
    for (let i = 0; i < shuffled.length; i++) {
      if (i % 2 === 0) freeRed.push(shuffled[i]);
      else freeBlue.push(shuffled[i]);
    }

    // Pair free reds with free blues
    const freeAlliances: { red: Team; blue: Team }[] = [];
    const redQ = shuffleArr(freeRed);
    const blueQ = shuffleArr(freeBlue);
    while (redQ.length > 0 && blueQ.length > 0) {
      freeAlliances.push({ red: redQ.pop()!, blue: blueQ.pop()! });
    }
    // Leftovers (odd numbers) — pair red+red or blue+blue
    const leftovers = [...redQ, ...blueQ];
    while (leftovers.length >= 2) {
      freeAlliances.push({ red: leftovers.pop()!, blue: leftovers.pop()! });
    }

    // Merge and shuffle so fixed alliances look random
    const all = shuffleArr([...fixed, ...freeAlliances]);
    setAlliances(all.map((a, i) => ({ num: i + 1, ...a })));
    setGenerated(true);
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [
      ['MakeX 2026 Lebanon — MakeX Starter Alliances'],
      [],
      ['Alliance #', 'Red Team', 'Red Members', 'Blue Team', 'Blue Members'],
      ...alliances.map(a => [
        a.num,
        a.red.displayName,
        a.red.members.join(' + '),
        a.blue.displayName,
        a.blue.members.join(' + '),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 38 }, { wch: 28 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Alliances');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MakeX2026_Starter_Alliances.xlsx';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="text-slate-400 text-sm py-8 text-center">Loading teams…</p>;
  if (teams.length === 0) return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
      No MakeX Starter teams found. Add passations in the Passations tab first.
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">MakeX Starter — Alliance Pairings</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {teams.length} teams · {Math.floor(teams.length / 2)} alliances
          </p>
        </div>
        <div className="flex gap-2">
          {generated && (
            <button onClick={exportExcel}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Excel
            </button>
          )}
          <button onClick={generate} disabled={teams.length < 2}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">
            {generated ? '↺ Re-generate' : 'Generate Alliances'}
          </button>
        </div>
      </div>

      {/* Teams list */}
      {!generated && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Teams detected ({teams.length})</p>
          </div>
          <div className="divide-y divide-slate-100">
            {teams.map(t => (
              <div key={t.key} className="px-5 py-2.5 flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-400 w-32 shrink-0">{t.club}</span>
                <span className="text-sm text-slate-700">{t.members.join(' + ') || t.displayName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alliance table */}
      {generated && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase w-10">#</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-red-500 uppercase">🔴 Red Alliance</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-red-400 uppercase hidden sm:table-cell">Members</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-blue-500 uppercase">🔵 Blue Alliance</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-blue-400 uppercase hidden sm:table-cell">Members</th>
              </tr>
            </thead>
            <tbody>
              {alliances.map(a => (
                <tr key={a.num} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td className="px-4 py-3 font-black text-slate-500">{a.num}</td>
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-800">{a.red.displayName}</p>
                    <p className="text-xs text-slate-400 sm:hidden">{a.red.members.join(' + ')}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden sm:table-cell">{a.red.members.join(' + ')}</td>
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-800">{a.blue.displayName}</p>
                    <p className="text-xs text-slate-400 sm:hidden">{a.blue.members.join(' + ')}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden sm:table-cell">{a.blue.members.join(' + ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
