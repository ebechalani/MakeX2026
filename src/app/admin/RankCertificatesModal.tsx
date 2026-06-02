'use client';
import { useMemo, useRef } from 'react';
import type { Category, Table, Passation } from '@/lib/types';
import {
  buildRankings, reRank, applyOverrides, readStarterTeams,
  betterResult, compareResults, assignRanks,
  type RankedStudent, type RoundResult,
} from '@/lib/ranking';

const RANK_LABEL: Record<number, string> = { 1: '1st Place 🥇', 2: '2nd Place 🥈', 3: '3rd Place 🥉', 4: '4th Place', 5: '5th Place' };
const RANK_COLOR: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
  2: { bg: '#f8fafc', border: '#94a3b8', text: '#334155' },
  3: { bg: '#fff7ed', border: '#c2410c', text: '#7c2d12' },
  4: { bg: '#f0fdf4', border: '#16a34a', text: '#14532d' },
  5: { bg: '#f0f9ff', border: '#0284c7', text: '#0c4a6e' },
};

type CertEntry = {
  studentName: string;
  clubName: string;
  categoryName: string;
  ageGroupLabel: string;       // empty string if none
  rank: number;
  orgType: 'School' | 'Club';
  teamPartner?: string;        // for Starter paired teams
};

function isSoccer (n: string) { return /capelli\s*soccer/i.test(n); }
function isStarter(n: string) { return /makex\s*starter/i.test(n); }
function isInspire(n: string) { return /capelli\s*inspire/i.test(n); }
function isUnified(n: string) { return isSoccer(n) || isStarter(n); }

export default function RankCertificatesModal({ academyName, passations, categories, tables, onClose }: {
  academyName: string;
  passations: Passation[];
  categories: Category[];
  tables: Table[];
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  const certs = useMemo((): CertEntry[] => {
    const result: CertEntry[] = [];
    const acLow = academyName.toLowerCase();

    for (const cat of categories) {
      const catName = cat.name;
      const r1all = passations.filter(p => p.category_id === cat.id && (p.round_number ?? 1) === 1);
      const r2all = passations.filter(p => p.category_id === cat.id && p.round_number === 2);
      const { schools, clubs } = buildRankings(r1all, r2all, tables);

      // ── MakeX Starter: team pairing ──────────────────────────────────────
      if (isStarter(catName)) {
        const teams   = readStarterTeams(cat.id);
        const allStuds = [...schools, ...clubs];
        const ov       = readOverrides(`${cat.id}-starter`);
        const none: RoundResult = { score: null, time: null, status: '—' };

        const teamRows: RankedStudent[] = teams.map((team, i) => {
          const s1 = allStuds.find(s => s.key === team.s1Key);
          const s2 = allStuds.find(s => s.key === team.s2Key);
          const combine = (a: RoundResult, b: RoundResult): RoundResult => ({
            score: (a.score ?? 0) + (b.score ?? 0) || null,
            time:  a.time != null && b.time != null ? a.time + b.time : null,
            status: a.score != null ? a.status : b.status,
          });
          const r1 = combine(s1?.r1 ?? none, s2?.r1 ?? none);
          const r2 = combine(s1?.r2 ?? none, s2?.r2 ?? none);
          return { key: team.id, teamName: team.name, clubName: s1?.clubName || s2?.clubName || '', tableLabel: '—', type: 'Club' as const, age: null, r1, r2, best: betterResult(r1, r2), rank: i + 1, r1Id: null, r2Id: null };
        });

        const sorted = teamRows.map(s => ({ ...s, displayRank: ov[s.key] ?? s.rank, isOverridden: s.key in ov })).sort((a, b) => a.displayRank !== b.displayRank ? a.displayRank - b.displayRank : compareResults(a.best, b.best));

        for (const row of sorted) {
          if (row.displayRank > 5) continue;
          const team = teams.find(t => t.id === row.key);
          if (!team) continue;
          const s1 = allStuds.find(s => s.key === team.s1Key);
          const s2 = allStuds.find(s => s.key === team.s2Key);
          const bothMatch = [s1, s2].every(s => s?.clubName?.toLowerCase() === acLow);
          const anyMatch  = [s1, s2].some(s => s?.clubName?.toLowerCase() === acLow);
          if (!anyMatch) continue;

          // Issue cert to each matching member
          for (const [me, partner] of [[s1, s2], [s2, s1]] as [RankedStudent | undefined, RankedStudent | undefined][]) {
            if (!me) continue;
            if (me.clubName.toLowerCase() !== acLow) continue;
            result.push({
              studentName:  me.teamName,
              clubName:     me.clubName,
              categoryName: catName,
              ageGroupLabel: '',
              rank:          row.displayRank,
              orgType:       me.type,
              teamPartner:  partner?.teamName,
            });
          }
        }
        continue;
      }

      // ── Soccer: override-only ─────────────────────────────────────────────
      if (isSoccer(catName)) {
        const combined = reRank([...schools, ...clubs]);
        const ranked   = applyOverrides(combined, `${cat.id}-unified`);
        for (const row of ranked) {
          if (row.displayRank > 5) continue;
          if (row.clubName.toLowerCase() !== acLow) continue;
          result.push({ studentName: row.teamName, clubName: row.clubName, categoryName: catName, ageGroupLabel: '', rank: row.displayRank, orgType: row.type });
        }
        continue;
      }

      // ── Capelli Inspire: age-split sub-groups ─────────────────────────────
      if (isInspire(catName)) {
        const ageBands: { label: string; tag: string; rows: RankedStudent[] }[] = [];
        const young = reRank(schools.concat(clubs).filter(s => s.age != null && s.age <= 9));  // school+club together by age
        // Actually Inspire splits schools/clubs separately AND by age
        const schYoung = reRank(schools.filter(s => s.age != null && s.age <= 9));
        const schOld   = reRank(schools.filter(s => s.age != null && s.age >= 10 && s.age <= 13));
        const clbYoung = reRank(clubs.filter(s => s.age != null && s.age <= 9));
        const clbOld   = reRank(clubs.filter(s => s.age != null && s.age >= 10 && s.age <= 13));

        const pairs: { rows: RankedStudent[]; groupId: string; ageLabel: string }[] = [
          { rows: schYoung, groupId: `${cat.id}-school-8-9`,   ageLabel: '8–9 years' },
          { rows: schOld,   groupId: `${cat.id}-school-10-12`, ageLabel: '10–12 years' },
          { rows: clbYoung, groupId: `${cat.id}-club-8-9`,     ageLabel: '8–9 years' },
          { rows: clbOld,   groupId: `${cat.id}-club-10-12`,   ageLabel: '10–12 years' },
        ];
        for (const { rows, groupId, ageLabel } of pairs) {
          const ranked = applyOverrides(rows, groupId);
          for (const row of ranked) {
            if (row.displayRank > 5) continue;
            if (row.clubName.toLowerCase() !== acLow) continue;
            result.push({ studentName: row.teamName, clubName: row.clubName, categoryName: catName, ageGroupLabel: ageLabel, rank: row.displayRank, orgType: row.type });
          }
        }
        continue;
      }

      // ── Regular category: school + club ───────────────────────────────────
      for (const [group, tag] of [[schools, 'school'], [clubs, 'club']] as [RankedStudent[], string][]) {
        const ranked = applyOverrides(group, `${cat.id}-${tag}-all`);
        for (const row of ranked) {
          if (row.displayRank > 5) continue;
          if (row.clubName.toLowerCase() !== acLow) continue;
          result.push({ studentName: row.teamName, clubName: row.clubName, categoryName: catName, ageGroupLabel: '', rank: row.displayRank, orgType: row.type });
        }
      }
    }

    return result;
  }, [academyName, passations, categories, tables]);

  function handlePrint() {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Ranking Certificates — ${academyName}</title><style>
      @page { size: A4 landscape; margin: 10mm; }
      body { margin: 0; padding: 0; font-family: 'Georgia', serif; background: white; }
      .cert-page { width: 100%; page-break-after: always; page-break-inside: avoid; }
      .cert-page:last-child { page-break-after: auto; }
      @media print { .no-print { display: none !important; } }
    </style></head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px 16px' }}>
      <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 900, boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>🏆 Ranking Certificates — {academyName}</h2>
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
              {certs.length === 0 ? 'No ranked students (rank 1–5) found for this academy.' : `${certs.length} certificate${certs.length !== 1 ? 's' : ''} · ranks 1–5`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {certs.length > 0 && (
              <button onClick={handlePrint} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: '9px 20px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                🖨 Print All
              </button>
            )}
            <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 10, padding: '9px 16px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', color: '#475569' }}>
              ✕ Close
            </button>
          </div>
        </div>

        {/* Certificates grid */}
        <div style={{ padding: 24 }} ref={printRef}>
          {certs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏅</div>
              <p style={{ fontWeight: 600 }}>No students from this academy placed in top 5.</p>
              <p style={{ fontSize: '0.82rem', marginTop: 6 }}>Make sure rankings have been set in the Results tab.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
              {certs.map((c, i) => <Certificate key={i} entry={c} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Certificate({ entry }: { entry: CertEntry }) {
  const pal = RANK_COLOR[entry.rank] ?? RANK_COLOR[5];
  const ordinal = RANK_LABEL[entry.rank] ?? `${entry.rank}th Place`;

  return (
    <div className="cert-page" style={{
      border: `3px solid ${pal.border}`,
      borderRadius: 16,
      background: pal.bg,
      padding: '28px 30px 24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background watermark */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: '9rem', opacity: 0.04, pointerEvents: 'none', userSelect: 'none' }}>
        🏆
      </div>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <p style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: pal.border, margin: 0 }}>
            MakeX 2026 · Lebanon
          </p>
          <p style={{ fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8', margin: '2px 0 0' }}>
            Certificate of Achievement
          </p>
        </div>
        {/* Rank badge */}
        <div style={{
          background: pal.border, color: 'white',
          borderRadius: 10, padding: '5px 14px',
          fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}>
          {ordinal}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${pal.border}, transparent)`, marginBottom: 16, borderRadius: 2 }} />

      {/* Student name */}
      <p style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0f172a', margin: '0 0 4px', lineHeight: 1.2 }}>
        {entry.studentName}
      </p>

      {/* Team partner (Starter) */}
      {entry.teamPartner && (
        <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 10px', fontWeight: 600 }}>
          Paired with <span style={{ color: '#334155', fontWeight: 700 }}>{entry.teamPartner}</span>
        </p>
      )}

      {/* Category & age group */}
      <p style={{ fontSize: '0.82rem', fontWeight: 700, color: pal.text, margin: '8px 0 2px' }}>
        {entry.categoryName}
        {entry.ageGroupLabel && <span style={{ fontWeight: 400, color: '#94a3b8' }}> · {entry.ageGroupLabel}</span>}
      </p>

      {/* Club / School */}
      <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: '0.65rem', background: entry.orgType === 'School' ? '#dbeafe' : '#f0fdf4', color: entry.orgType === 'School' ? '#1d4ed8' : '#15803d', padding: '1px 7px', borderRadius: 99, fontWeight: 700, letterSpacing: '0.06em' }}>
          {entry.orgType === 'School' ? '🏫 School' : '🏢 Club'}
        </span>
        {entry.clubName}
      </p>
    </div>
  );
}

// re-export so modal can use it without importing from ranking.ts
function readOverrides(groupId: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(`makex2026:rankOverrides:${groupId}`) || '{}'); } catch { return {}; }
}
