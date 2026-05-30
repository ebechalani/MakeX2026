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

/** Returns true if two teams must NOT be paired in the same alliance */
function hasConflict(a: Team, b: Team): boolean {
  const isRobo      = (t: Team) => t.club.toLowerCase().includes('roboholic');
  const isMindscape = (t: Team) => t.club.toLowerCase().includes('mindscape');

  // No two Mindscape teams in the same alliance
  if (isMindscape(a) && isMindscape(b)) return true;

  // Roboholic team identities (matched by actual DB names)
  const isR1 = (t: Team) => isRobo(t) && anyMember(t, 'elio') && anyMember(t, 'alexander');
  // R2 = Jean Karam + Peter Derderian
  const isR2 = (t: Team) => isRobo(t) && anyMember(t, 'karam') && anyMember(t, 'peter');
  // R3 = Carlo Kafrouni + Jean Paul Mrad
  const isR3 = (t: Team) => isRobo(t) && anyMember(t, 'carlo') && anyMember(t, 'kafrouni');
  // R4 = any remaining Roboholic not R1/R2/R3
  const isR4 = (t: Team) => isRobo(t) && !isR1(t) && !isR2(t) && !isR3(t);

  if ((isR1(a) && isR2(b)) || (isR1(b) && isR2(a))) return true; // R1 ↔ R2
  if ((isR3(a) && isR4(b)) || (isR3(b) && isR4(a))) return true; // R3 ↔ R4

  // Angelina Chalouhy+Yara Dagher cannot be with Jason Bou Abboud+Jean Paul Semaan
  const isAY  = (t: Team) => anyMember(t, 'angelina') && anyMember(t, 'yara');
  const isJJP = (t: Team) => anyMember(t, 'jason') && anyMember(t, 'jean paul');
  if ((isAY(a) && isJJP(b)) || (isAY(b) && isJJP(a))) return true;

  // Elie Harb+Yasmina Khoury cannot be with Anthony Faddoul+Marcelino Bitar or Elie Bou Abboud+Kepriyano
  // NOTE: student name is "Elie Harb" (not "Elia") — identify by 'yasmina' which is unique
  const isElYas  = (t: Team) => anyMember(t, 'yasmina');
  // NOTE: student name is "Marcelino Bitar" (not "Marcelina") — use 'marcelin' to match both spellings
  const isAntMar = (t: Team) => anyMember(t, 'faddoul') || anyMember(t, 'marcelin');
  // Kepriyano youssef — 'kepriyano' is unique
  const isElKep  = (t: Team) => anyMember(t, 'kepriyano');
  if (isElYas(a) && (isAntMar(b) || isElKep(b))) return true;
  if (isElYas(b) && (isAntMar(a) || isElKep(a))) return true;

  return false;
}

/**
 * Pair reds with blues respecting hasConflict constraints.
 * Tries up to `attempts` random pairings, then falls back to greedy.
 */
function pairConstrained(
  reds: Team[],
  blues: Team[],
  attempts = 600,
): { red: Team; blue: Team }[] {
  const len = Math.min(reds.length, blues.length);

  // Random retry
  for (let i = 0; i < attempts; i++) {
    const rs = shuffleArr(reds);
    const bs = shuffleArr(blues);
    let ok = true;
    for (let j = 0; j < len; j++) {
      if (hasConflict(rs[j], bs[j])) { ok = false; break; }
    }
    if (ok) {
      const pairs = rs.slice(0, len).map((r, j) => ({ red: r, blue: bs[j] }));
      // Odd leftover on one side → pair same-colour teams together
      const leftRed  = rs.slice(len);
      const leftBlue = bs.slice(len);
      for (let j = 0; j + 1 < leftRed.length;  j += 2) pairs.push({ red: leftRed[j],  blue: leftRed[j + 1] });
      for (let j = 0; j + 1 < leftBlue.length; j += 2) pairs.push({ red: leftBlue[j], blue: leftBlue[j + 1] });
      return pairs;
    }
  }

  // Greedy fallback (guarantees a result even when solution space is tight)
  const rs = shuffleArr(reds);
  const bs = shuffleArr(blues);
  const usedB = new Set<number>();
  const pairs: { red: Team; blue: Team }[] = [];
  for (const r of rs) {
    let idx = -1;
    for (let j = 0; j < bs.length; j++) {
      if (!usedB.has(j) && !hasConflict(r, bs[j])) { idx = j; break; }
    }
    if (idx === -1) for (let j = 0; j < bs.length; j++) { if (!usedB.has(j)) { idx = j; break; } }
    if (idx !== -1) { pairs.push({ red: r, blue: bs[idx] }); usedB.add(idx); }
  }
  return pairs;
}

export default function StarterAlliances() {
  const supabase = useMemo(() => createClient(), []);
  const [passations, setPassations] = useState<Passation[]>([]);
  const [loading, setLoading] = useState(true);
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [generated, setGenerated] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

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

    // ── Hardcoded teams that must always exist (even if not yet in DB) ────────
    // These are injected only when not already covered by group_id or team_name matching.
    const HARDCODED_TEAMS: { club: string; members: string[]; key: string }[] = [
      { key: '__hc_carlo_jp__', club: 'Roboholic', members: ['Carlo Kafrouni', 'Jean Paul Mrad'] },
    ];
    for (const hc of HARDCODED_TEAMS) {
      // Skip only if the FULL name (all words) of a member already appears in result
      const fullMatch = (needle: string, hay: string) => {
        const parts = needle.toLowerCase().split(' ').filter(Boolean);
        const h = hay.toLowerCase();
        return parts.every(p => h.includes(p));
      };
      const alreadyIn = result.some(t =>
        hc.members.some(m => t.members.some(tm => fullMatch(m, tm)))
      );
      // Remove any singleton that is one of these members (avoid duplicates if they later appear in DB)
      if (!alreadyIn) {
        for (const m of hc.members) {
          const idx = singletons.findIndex(p => fullMatch(m, p.student_names || p.team_name || ''));
          if (idx !== -1) singletons.splice(idx, 1);
        }
        result.push({ key: hc.key, displayName: hc.club, club: hc.club, members: hc.members });
      }
    }

    // Pair remaining singletons by club (first 2, next 2, …)
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

    // ── Fixed alliance 1: Elio Azar+Alexander Rabbat (RoboHolic) RED ↔ Mindscape team BLUE ──
    // Joe Hicham Khoury and Anthony Matar are on SEPARATE Mindscape teams in the DB.
    // Using OR so whichever team has either surname becomes the fixed Blue partner.
    const rA = pull(pool, t =>
      t.club.toLowerCase().includes('roboholic') &&
      anyMember(t, 'elio') && anyMember(t, 'alexander')
    );
    const bA = pull(pool, t =>
      t.club.toLowerCase().includes('mindscape') &&
      anyMember(t, 'matar') && anyMember(t, 'saliba')
    );
    if (rA && bA) fixed.push({ red: rA, blue: bA });
    else { if (rA) pool.push(rA); if (bA) pool.push(bA); }

    // ── Fixed role: Jean Karam + Peter Derderian (RoboHolic) → RED ──
    const rB = pull(pool, t =>
      t.club.toLowerCase().includes('roboholic') &&
      anyMember(t, 'karam') && anyMember(t, 'peter')
    );
    if (rB) freeRed.push(rB);

    // ── Fixed role: Carlo Kafrouni + Jean Paul Mrad (RoboHolic) → BLUE ──
    const bB = pull(pool, t =>
      t.club.toLowerCase().includes('roboholic') &&
      anyMember(t, 'carlo') && anyMember(t, 'kafrouni')
    );
    if (bB) freeBlue.push(bB);

    // ── Fixed role: Johnny Boutros + Christopher Sader → BLUE ──
    const bC = pull(pool, t =>
      anyMember(t, 'johnny') && anyMember(t, 'christopher')
    );
    if (bC) freeBlue.push(bC);

    // Try multiple red/blue splits of the remaining pool, pick one that allows
    // a fully constraint-free pairing (up to 80 outer attempts × 600 inner).
    let freeAlliances: { red: Team; blue: Team }[] = [];
    let solved = false;

    for (let outer = 0; outer < 80 && !solved; outer++) {
      const shuffled = shuffleArr(pool);
      const tryRed  = [...freeRed];
      const tryBlue = [...freeBlue];
      for (let i = 0; i < shuffled.length; i++) {
        if (i % 2 === 0) tryRed.push(shuffled[i]);
        else tryBlue.push(shuffled[i]);
      }

      // Quick check: can we find a zero-conflict pairing?
      const len = Math.min(tryRed.length, tryBlue.length);
      let found = false;
      for (let inner = 0; inner < 600 && !found; inner++) {
        const rs = shuffleArr(tryRed);
        const bs = shuffleArr(tryBlue);
        let ok = true;
        for (let j = 0; j < len; j++) {
          if (hasConflict(rs[j], bs[j])) { ok = false; break; }
        }
        if (ok) {
          freeAlliances = rs.slice(0, len).map((r, j) => ({ red: r, blue: bs[j] }));
          const leftRed  = rs.slice(len);
          const leftBlue = bs.slice(len);
          for (let j = 0; j + 1 < leftRed.length;  j += 2) freeAlliances.push({ red: leftRed[j],  blue: leftRed[j + 1] });
          for (let j = 0; j + 1 < leftBlue.length; j += 2) freeAlliances.push({ red: leftBlue[j], blue: leftBlue[j + 1] });
          found = true;
          solved = true;
        }
      }
      if (!found && outer === 79) {
        // Last-resort greedy so we always produce a result
        freeAlliances = pairConstrained(tryRed, tryBlue, 0);
      }
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
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
        No MakeX Starter teams found. Add passations in the Passations tab first.
      </div>
      <button onClick={() => setShowDebug(v => !v)} className="text-xs text-slate-400 underline">{showDebug ? 'Hide' : 'Show'} raw DB data</button>
      {showDebug && (
        <div className="bg-slate-900 text-green-300 text-xs font-mono rounded-xl p-4 overflow-auto max-h-96">
          <p className="text-slate-400 mb-2">Passations loaded: {passations.length}</p>
          {passations.map(p => (
            <div key={p.id} className="mb-1 border-b border-slate-700 pb-1">
              <span className="text-yellow-300">id:</span> {p.id} | <span className="text-yellow-300">club:</span> {p.club_name} | <span className="text-yellow-300">team_name:</span> {p.team_name} | <span className="text-yellow-300">student_names:</span> {p.student_names} | <span className="text-yellow-300">group_id:</span> {p.team_group_id ?? '–'}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">MakeX Starter — Alliance Pairings</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {teams.length} teams ({passations.length} passation rows) · {Math.floor(teams.length / 2)} alliances
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowDebug(v => !v)} className="text-xs text-slate-400 border border-slate-200 px-2 py-1 rounded-lg hover:bg-slate-50">
            🔍 Debug
          </button>
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

      {/* Debug panel */}
      {showDebug && (
        <div className="bg-slate-900 text-green-300 text-xs font-mono rounded-xl p-4 overflow-auto max-h-96 space-y-1">
          <p className="text-slate-400 font-bold mb-2">RAW PASSATIONS ({passations.length} rows)</p>
          {passations.map(p => (
            <div key={p.id} className="border-b border-slate-700 pb-1">
              <span className="text-yellow-300">club:</span> {p.club_name ?? '–'} | <span className="text-yellow-300">team_name:</span> {p.team_name ?? '–'} | <span className="text-yellow-300">student_names:</span> {p.student_names ?? '–'} | <span className="text-yellow-300">group_id:</span> {p.team_group_id ?? '–'}
            </div>
          ))}
          <p className="text-slate-400 font-bold mt-3 mb-2">DERIVED TEAMS ({teams.length})</p>
          {teams.map(t => (
            <div key={t.key} className="border-b border-slate-700 pb-1">
              <span className="text-cyan-300">{t.club}</span> → {t.members.join(' + ')} <span className="text-slate-500">[key:{t.key.slice(0, 20)}]</span>
            </div>
          ))}
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
