'use client';
import { useMemo, useState } from 'react';
import type { Category, Table, Passation } from '@/lib/types';
import {
  buildRankings, reRank, applyOverrides, readStarterTeams,
  betterResult, compareResults,
  type RankedStudent, type RoundResult,
} from '@/lib/ranking';

const RANK_LABEL: Record<number, string> = {
  1: '1st Place 🥇', 2: '2nd Place 🥈', 3: '3rd Place 🥉', 4: '4th Place', 5: '5th Place',
};

type CertEntry = {
  studentName: string;
  clubName: string;
  categoryName: string;
  ageGroupLabel: string;
  rank: number;
  pdfUrl: string;
};

function sanitize(str: string) {
  return (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}
function rankCertUrl(club: string, student: string, rank: number) {
  return `/api/rank-certificate/${encodeURIComponent(sanitize(club))}/${encodeURIComponent(sanitize(student))}/${rank}`;
}

function isSoccer (n: string) { return /capelli\s*soccer/i.test(n); }
function isStarter(n: string) { return /makex\s*starter/i.test(n); }
function isInspire(n: string) { return /capelli\s*inspire/i.test(n); }


export default function RankCertificatesModal({ academyName, passations, categories, tables, onClose }: {
  academyName: string;
  passations: Passation[];
  categories: Category[];
  tables: Table[];
  onClose: () => void;
}) {
  const certs = useMemo((): CertEntry[] => {
    const result: CertEntry[] = [];

    // Same normalisation logic as admin/page.tsx — strips accents, collapses
    // all non-alphanumeric chars to a single space so "RoboHolic" == "roboholic"
    // and "Lycée Charlemagne" == "Lycee Charlemagne" etc.
    const norm = (s: string | null | undefined): string =>
      (s || '').normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const acNorm = norm(academyName);

    // Collect all unique club_name values from passations that normalise to the
    // same key as academyName — this handles cases where the academy display name
    // slightly differs from what's stored in passation.club_name
    const matchingClubNames = new Set(
      passations
        .map(p => p.club_name)
        .filter((c): c is string => !!c && norm(c) === acNorm)
    );

    for (const cat of categories) {
      const catName = cat.name;
      const r1all = passations.filter(p => p.category_id === cat.id && (p.round_number ?? 1) === 1);
      const r2all = passations.filter(p => p.category_id === cat.id && p.round_number === 2);
      const { schools, clubs } = buildRankings(r1all, r2all, tables);

      // ── MakeX Starter: team pairing — override-only (same rule as Soccer) ──
      if (isStarter(catName)) {
        const teams    = readStarterTeams(cat.id);
        const allStuds = [...schools, ...clubs];
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
          return { key: team.id, teamName: team.name, studentNames: team.name, clubName: s1?.clubName || s2?.clubName || '', tableLabel: '—', type: 'Club' as const, age: null, r1, r2, best: betterResult(r1, r2), rank: i + 1, r1Id: null, r2Id: null };
        });

        const ranked = applyOverrides(teamRows, `${cat.id}-starter`);

        for (const row of ranked) {
          if (!row.isOverridden) continue;   // only teams you manually ranked
          if (row.displayRank > 5) continue;
          const team = teams.find(t => t.id === row.key);
          if (!team) continue;
          const s1 = allStuds.find(s => s.key === team.s1Key);
          const s2 = allStuds.find(s => s.key === team.s2Key);
          // Issue cert to each member whose club matches
          for (const me of [s1, s2]) {
            if (!me || (!matchingClubNames.has(me.clubName) && norm(me.clubName) !== acNorm)) continue;
            result.push({
              studentName:  me.studentNames || me.teamName,
              clubName:     me.clubName,
              categoryName: catName,
              ageGroupLabel: '',
              rank:          row.displayRank,
              pdfUrl:        rankCertUrl(me.clubName, me.studentNames || me.teamName, row.displayRank),
            });
          }
        }
        continue;
      }

      // ── Soccer: override-only — only emit rows the admin manually pinned ────
      if (isSoccer(catName)) {
        const combined = reRank([...schools, ...clubs]);
        const ranked   = applyOverrides(combined, `${cat.id}-unified`);
        for (const row of ranked) {
          if (!row.isOverridden) continue;
          if (row.displayRank > 5) continue;
          if (!matchingClubNames.has(row.clubName) && norm(row.clubName) !== acNorm) continue;
          const name = row.studentNames || row.teamName;
          result.push({ studentName: name, clubName: row.clubName, categoryName: catName, ageGroupLabel: '', rank: row.displayRank, pdfUrl: rankCertUrl(row.clubName, name, row.displayRank) });
        }
        continue;
      }

      // ── Capelli Inspire: age-split (including "other / unknown DOB" band) ─
      if (isInspire(catName)) {
        const pairs = [
          { rows: reRank(schools.filter(s => s.age != null && s.age <= 9)),                groupId: `${cat.id}-school-8-9`,    ageLabel: '8–9 years' },
          { rows: reRank(schools.filter(s => s.age != null && s.age >= 10 && s.age <= 13)),groupId: `${cat.id}-school-10-12`,  ageLabel: '10–12 years' },
          { rows: reRank(schools.filter(s => s.age == null || s.age > 13)),                groupId: `${cat.id}-school-other`,  ageLabel: '' },
          { rows: reRank(clubs.filter(s => s.age != null && s.age <= 9)),                  groupId: `${cat.id}-club-8-9`,      ageLabel: '8–9 years' },
          { rows: reRank(clubs.filter(s => s.age != null && s.age >= 10 && s.age <= 13)), groupId: `${cat.id}-club-10-12`,    ageLabel: '10–12 years' },
          { rows: reRank(clubs.filter(s => s.age == null || s.age > 13)),                  groupId: `${cat.id}-club-other`,    ageLabel: '' },
        ];
        for (const { rows, groupId, ageLabel } of pairs) {
          for (const row of applyOverrides(rows, groupId)) {
            if (row.displayRank > 5) continue;
            if (!matchingClubNames.has(row.clubName) && norm(row.clubName) !== acNorm) continue;
            const name = row.studentNames || row.teamName;
            result.push({ studentName: name, clubName: row.clubName, categoryName: catName, ageGroupLabel: ageLabel, rank: row.displayRank, pdfUrl: rankCertUrl(row.clubName, name, row.displayRank) });
          }
        }
        continue;
      }

      // ── Regular category: school + club ───────────────────────────────────
      for (const [group, tag] of [[schools, 'school'], [clubs, 'club']] as [RankedStudent[], string][]) {
        for (const row of applyOverrides(group, `${cat.id}-${tag}-all`)) {
          if (row.displayRank > 5) continue;
          if (!matchingClubNames.has(row.clubName) && norm(row.clubName) !== acNorm) continue;
          const name = row.studentNames || row.teamName;
          result.push({ studentName: name, clubName: row.clubName, categoryName: catName, ageGroupLabel: '', rank: row.displayRank, pdfUrl: rankCertUrl(row.clubName, name, row.displayRank) });
        }
      }
    }

    return result;
  }, [academyName, passations, categories, tables]);

  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);

  async function downloadAll() {
    if (certs.length === 0) return;
    setDownloading(true);
    setDlProgress(0);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (let i = 0; i < certs.length; i++) {
        const c = certs[i];
        const res = await fetch(c.pdfUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const rankLabel = c.rank === 1 ? '1st' : c.rank === 2 ? '2nd' : c.rank === 3 ? '3rd' : `${c.rank}th`;
          const fileName = `${rankLabel}_${sanitize(c.studentName)}_${sanitize(c.categoryName)}${c.ageGroupLabel ? `_${c.ageGroupLabel.replace(/[^0-9-]/g, '')}` : ''}.pdf`;
          zip.file(fileName, buf);
        }
        setDlProgress(i + 1);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RankCertificates_${sanitize(academyName)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
      setDlProgress(0);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '24px 16px' }}>
      <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 860, boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>🏆 Ranking Certificates — {academyName}</h2>
            <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
              {certs.length === 0
                ? 'No ranked students (rank 1–5) found for this academy.'
                : `${certs.length} certificate${certs.length !== 1 ? 's' : ''} · ranks 1–5 · click to open PDF`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {certs.length > 0 && (
              <button
                onClick={downloadAll}
                disabled={downloading}
                style={{ background: downloading ? '#e2e8f0' : '#0f172a', border: 'none', borderRadius: 10, padding: '9px 16px', fontWeight: 600, fontSize: '0.82rem', cursor: downloading ? 'default' : 'pointer', color: downloading ? '#94a3b8' : 'white', display: 'flex', alignItems: 'center', gap: 6 }}>
                {downloading ? `⏳ ${dlProgress}/${certs.length}…` : '⬇ Download All'}
              </button>
            )}
            <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', borderRadius: 10, padding: '9px 16px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', color: '#475569' }}>
              ✕ Close
            </button>
          </div>
        </div>

        {/* Certificate list — same card style as participation certs */}
        <div style={{ padding: 24 }}>
          {certs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🏅</div>
              <p style={{ fontWeight: 600 }}>No students from this academy placed in top 5.</p>
              <p style={{ fontSize: '0.82rem', marginTop: 6 }}>Make sure rankings have been set in the Results tab.</p>
            </div>
          ) : (
            <>
              <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', marginBottom: 20, fontSize: '0.8rem', color: '#92400e' }}>
                🎉 Congratulations! Your students placed in the top 5. Click each certificate to open the PDF.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {certs.map((c, i) => (
                  <a
                    key={i}
                    href={c.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: 'white', border: '1px solid #e2e8f0',
                      borderRadius: 16, padding: '14px 16px',
                      textDecoration: 'none', transition: 'all 0.15s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#3b82f6'; (e.currentTarget as HTMLAnchorElement).style.background = '#eff6ff'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLAnchorElement).style.background = 'white'; }}
                  >
                    {/* Certificate icon with rank badge */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>
                        📄
                      </div>
                      <div style={{
                        position: 'absolute', bottom: -4, right: -6,
                        background: c.rank <= 3 ? ['#f59e0b', '#94a3b8', '#c2410c'][c.rank - 1] : '#16a34a',
                        color: 'white', borderRadius: 99, fontSize: '0.55rem', fontWeight: 900,
                        padding: '1px 5px', border: '1.5px solid white', whiteSpace: 'nowrap',
                      }}>
                        {c.rank === 1 ? '1st' : c.rank === 2 ? '2nd' : c.rank === 3 ? '3rd' : `${c.rank}th`}
                      </div>
                    </div>

                    {/* Info */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.studentName}
                      </p>
                      <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.categoryName}{c.ageGroupLabel ? ` · ${c.ageGroupLabel}` : ''}
                      </p>
                      <p style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700, margin: '3px 0 0' }}>
                        {RANK_LABEL[c.rank] ?? `${c.rank}th Place`}
                      </p>
                    </div>

                    <span style={{ color: '#3b82f6', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>↗ PDF</span>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
