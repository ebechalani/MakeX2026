import type { Passation, Table } from '@/lib/types';

// ── Hardcoded category remaps (misregistered students) ─────────────────────────
// Add an entry here when a student was registered under the wrong category.
// studentName: lowercase substring that must appear in student_names or team_name.
// fromCat / toCat: regex matched against category.name.
export const STUDENT_CAT_REMAPS: Array<{
  studentName: string;
  fromCat: RegExp;
  toCat:   RegExp;
}> = [
  { studentName: 'roy haddad', fromCat: /makex\s*inspire/i, toCat: /capelli\s*inspire/i },
];

/** Returns a copy of passations with any misregistered students reassigned to their correct category. */
export function remapPassations(
  passations: Passation[],
  categories: { id: string; name: string }[],
): Passation[] {
  if (STUDENT_CAT_REMAPS.length === 0) return passations;
  return passations.map(p => {
    const nm = ((p.student_names?.trim()) || p.team_name || '').toLowerCase();
    for (const remap of STUDENT_CAT_REMAPS) {
      if (!nm.includes(remap.studentName)) continue;
      const fromCat = categories.find(c => remap.fromCat.test(c.name));
      const toCat   = categories.find(c => remap.toCat.test(c.name));
      if (fromCat && toCat && p.category_id === fromCat.id) {
        return { ...p, category_id: toCat.id };
      }
    }
    return p;
  });
}

// ── School name set ────────────────────────────────────────────────────────────
export const SCHOOL_NAMES = new Set([
  'Carmelites', 'CCJ', 'CND Steam Club',
  'College Maristes Notre Dame de Lourdes', 'Ecole De La Mission éDucative',
  'Ecole des Soeurs de la Croix - Hrajel', 'Ecole Saint Elie - SFM Zahle',
  'ESJ Capucins Batroun', 'IC Ain Aar',
  'Lycée Charlemagne', 'Lycee Charlemagne',
  'Lycée Montaigne', 'Lycee Montaigne',
  'Mont La Salle',
  'Sainte Famille Francaise Jounieh', 'SJS Robotics Club', 'SSCC Kfardebian',
]);

export function orgType(clubName: string | null): 'School' | 'Club' {
  if (!clubName) return 'Club';
  if (SCHOOL_NAMES.has(clubName)) return 'School';
  const norm = clubName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  for (const s of SCHOOL_NAMES) {
    if (s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() === norm) return 'School';
  }
  return 'Club';
}

// ── Core types ─────────────────────────────────────────────────────────────────
export type RoundResult = { score: number | null; time: number | null; status: string };

export type RankedStudent = {
  key: string;
  teamName: string;       // raw team_name column
  studentNames: string;   // student_names ?? team_name — preferred for cert lookup
  clubName: string;
  tableLabel: string;
  type: 'School' | 'Club';
  age: number | null;
  r1: RoundResult;
  r2: RoundResult;
  best: RoundResult;
  rank: number;
  r1Id: string | null;
  r2Id: string | null;
};

export type CategoryRankings = { schools: RankedStudent[]; clubs: RankedStudent[] };

// ── Helpers ────────────────────────────────────────────────────────────────────
export function calcAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

export function roundResult(p: Passation | undefined): RoundResult {
  if (!p) return { score: null, time: null, status: '—' };
  if (p.live_status === 'Absent') return { score: null, time: null, status: 'Absent' };
  if (p.final_result_status === 'Void') return { score: null, time: null, status: 'Void' };
  return { score: p.score ?? null, time: p.time_seconds ?? null, status: p.final_result_status || p.live_status || '—' };
}

export function betterResult(a: RoundResult, b: RoundResult): RoundResult {
  const sa = a.score ?? -1, sb = b.score ?? -1;
  if (sa !== sb) return sa > sb ? a : b;
  if (a.time == null && b.time == null) return a;
  if (a.time == null) return b;
  if (b.time == null) return a;
  return a.time <= b.time ? a : b;
}

export function compareResults(a: RoundResult, b: RoundResult): number {
  const sa = a.score ?? -1, sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  if (a.time == null && b.time == null) return 0;
  if (a.time == null) return 1;
  if (b.time == null) return -1;
  return a.time - b.time;
}

export function assignRanks<T extends { best: RoundResult }>(sorted: T[]): (T & { rank: number })[] {
  const result: (T & { rank: number })[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { result.push({ ...sorted[i], rank: 1 }); }
    else {
      const tied = compareResults(sorted[i].best, sorted[i - 1].best) === 0;
      result.push({ ...sorted[i], rank: tied ? result[i - 1].rank : i + 1 });
    }
  }
  return result;
}

export function reRank(students: RankedStudent[]): RankedStudent[] {
  const sorted = students.slice().sort((a, b) => compareResults(a.best, b.best));
  return assignRanks(sorted);
}

export function buildRankings(r1rows: Passation[], r2rows: Passation[], tables: Table[]): CategoryRankings {
  const getTableLabel = (tableId: string | null | undefined) => {
    if (!tableId) return '—';
    const t = tables.find(t => t.id === tableId);
    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
  };
  const r1map = new Map<string, Passation>();
  const r2map = new Map<string, Passation>();
  const key = (p: Passation) => `${p.team_name}|${p.club_name}`.toLowerCase();
  for (const p of r1rows) r1map.set(key(p), p);
  for (const p of r2rows) r2map.set(key(p), p);
  const allKeys = new Set([...r1map.keys(), ...r2map.keys()]);
  const schools: Omit<RankedStudent, 'rank'>[] = [];
  const clubs:   Omit<RankedStudent, 'rank'>[] = [];
  for (const k of allKeys) {
    const r1p = r1map.get(k), r2p = r2map.get(k);
    const ref = r1p || r2p!;
    const r1res = roundResult(r1p), r2res = roundResult(r2p);
    const best = betterResult(r1res, r2res);
    const entry = { key: k, teamName: ref.team_name, studentNames: ref.student_names?.trim() || ref.team_name || '', clubName: ref.club_name || '', tableLabel: getTableLabel(r1p?.table_id || r2p?.table_id), type: orgType(ref.club_name), age: calcAge(ref.date_of_birth), r1: r1res, r2: r2res, best, r1Id: r1p?.id ?? null, r2Id: r2p?.id ?? null };
    if (entry.type === 'School') schools.push(entry); else clubs.push(entry);
  }
  const rank = (arr: Omit<RankedStudent, 'rank'>[]): RankedStudent[] => { arr.sort((a, b) => compareResults(a.best, b.best)); return assignRanks(arr); };
  return { schools: rank(schools), clubs: rank(clubs) };
}

// ── localStorage override helpers ──────────────────────────────────────────────
export function readOverrides(groupId: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(`makex2026:rankOverrides:${groupId}`) || '{}'); } catch { return {}; }
}

export function applyOverrides(rows: RankedStudent[], groupId: string): (RankedStudent & { displayRank: number; isOverridden: boolean })[] {
  const ov = readOverrides(groupId);
  return rows
    .map(s => ({ ...s, displayRank: ov[s.key] ?? s.rank, isOverridden: s.key in ov }))
    .sort((a, b) => a.displayRank !== b.displayRank ? a.displayRank - b.displayRank : compareResults(a.best, b.best));
}

export type StarterTeam = { id: string; name: string; s1Key: string; s2Key: string };

export function readStarterTeams(catId: string): StarterTeam[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(`makex2026:starterTeams:${catId}`) || '[]'); } catch { return []; }
}
