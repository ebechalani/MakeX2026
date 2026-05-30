'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation, SoccerMatch } from '@/lib/types';

const ROUND_NAMES: Record<number, string> = {
  1: 'Round of 32',
  2: 'Round of 16',
  3: 'Quarterfinals',
  4: 'Semifinals',
  5: 'Final',
};

const MATCH_SLOT_MIN = 8; // 7 min play + 1 min transition
const ROUND_GAP_MIN = 5;  // gap between rounds
const FIRST_ROUND_START = '2026-05-31T10:00:00';

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function SoccerBracket() {
  const supabase = useMemo(() => createClient(), []);
  const [matches, setMatches] = useState<SoccerMatch[]>([]);
  const [teams, setTeams] = useState<Passation[]>([]); // Capelli Soccer round-1 passations
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Find Capelli Soccer category
    const { data: cats } = await supabase.from('categories').select('*').ilike('name', 'Capelli Soccer');
    const cat = (cats || [])[0] as Category | undefined;
    if (!cat) { setLoading(false); return; }
    const [{ data: passData }, { data: tabData }, { data: matchData }] = await Promise.all([
      supabase.from('passations').select('*').eq('category_id', cat.id).eq('round_number', 1).order('team_name'),
      supabase.from('tables').select('*').eq('category_id', cat.id).eq('active', true).order('table_number'),
      supabase.from('soccer_matches').select('*, team_a:team_a_id(*), team_b:team_b_id(*), winner:winner_id(*), table:table_id(*)').order('round_number').order('match_number'),
    ]);
    setTeams((passData || []) as Passation[]);
    setTables((tabData || []) as Table[]);
    setMatches((matchData || []) as unknown as SoccerMatch[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase.channel('soccer-bracket')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'soccer_matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, supabase]);

  const matchesByRound = useMemo(() => {
    const m = new Map<number, SoccerMatch[]>();
    for (const x of matches) {
      if (!m.has(x.round_number)) m.set(x.round_number, []);
      m.get(x.round_number)!.push(x);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.match_number - b.match_number);
    return m;
  }, [matches]);

  function startTimeForRound(roundNumber: number): Date {
    const start = new Date(FIRST_ROUND_START);
    let offset = 0;
    for (let r = 1; r < roundNumber; r++) {
      const prev = matchesByRound.get(r) || [];
      const matchesPerTable = Math.ceil(prev.length / Math.max(1, tables.length));
      offset += matchesPerTable * MATCH_SLOT_MIN + ROUND_GAP_MIN;
    }
    return new Date(start.getTime() + offset * 60000);
  }

  async function generateRound1() {
    if (!confirm(`Generate Round 1 by random pairing of ${teams.length} teams? Existing soccer matches will be cleared.`)) return;
    setBusy(true);
    // Clear all existing matches
    await supabase.from('soccer_matches').delete().not('id', 'is', null);
    const shuffled = shuffle(teams);
    const startMs = new Date(FIRST_ROUND_START).getTime();
    const rows = [] as Omit<SoccerMatch, 'id' | 'created_at' | 'updated_at' | 'team_a' | 'team_b' | 'winner' | 'table'>[];
    for (let i = 0; i < shuffled.length; i += 2) {
      const matchIdx = i / 2;
      const tableIx = matchIdx % Math.max(1, tables.length);
      const matchOnTable = Math.floor(matchIdx / Math.max(1, tables.length));
      const slotMs = startMs + matchOnTable * MATCH_SLOT_MIN * 60000;
      rows.push({
        round_number: 1,
        match_number: matchIdx + 1,
        table_id: tables[tableIx]?.id ?? null,
        scheduled_time: new Date(slotMs).toISOString(),
        team_a_id: shuffled[i].id,
        team_b_id: shuffled[i + 1]?.id ?? null,
        score_a: null,
        score_b: null,
        winner_id: null,
        status: 'scheduled',
        notes: null,
      });
    }
    const { error } = await supabase.from('soccer_matches').insert(rows);
    setBusy(false);
    if (error) { alert('Insert failed: ' + error.message); return; }
    load();
  }

  async function generateNextRound() {
    const lastRound = Math.max(...matches.map(m => m.round_number));
    const lastMatches = matchesByRound.get(lastRound) || [];
    const allFinished = lastMatches.every(m => m.status === 'finished' && m.winner_id);
    if (!allFinished) { alert('All matches in the last round must be finished with a winner before generating the next round.'); return; }
    const winners = lastMatches.map(m => m.winner_id!).filter(Boolean);
    if (winners.length < 2) { alert('Tournament is over.'); return; }
    const newRound = lastRound + 1;
    if (!confirm(`Generate Round ${newRound} (${ROUND_NAMES[newRound] || `Round ${newRound}`}) — ${winners.length / 2} matches?`)) return;
    setBusy(true);
    const startMs = startTimeForRound(newRound).getTime();
    const rows = [] as Omit<SoccerMatch, 'id' | 'created_at' | 'updated_at' | 'team_a' | 'team_b' | 'winner' | 'table'>[];
    for (let i = 0; i < winners.length; i += 2) {
      const matchIdx = i / 2;
      const tableIx = matchIdx % Math.max(1, tables.length);
      const matchOnTable = Math.floor(matchIdx / Math.max(1, tables.length));
      const slotMs = startMs + matchOnTable * MATCH_SLOT_MIN * 60000;
      rows.push({
        round_number: newRound,
        match_number: matchIdx + 1,
        table_id: tables[tableIx]?.id ?? null,
        scheduled_time: new Date(slotMs).toISOString(),
        team_a_id: winners[i],
        team_b_id: winners[i + 1] ?? null,
        score_a: null,
        score_b: null,
        winner_id: null,
        status: 'scheduled',
        notes: null,
      });
    }
    const { error } = await supabase.from('soccer_matches').insert(rows);
    setBusy(false);
    if (error) { alert('Insert failed: ' + error.message); return; }
    load();
  }

  async function patchMatch(id: string, patch: Partial<SoccerMatch>) {
    const { error } = await supabase.from('soccer_matches').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert('Save failed: ' + error.message); return; }
    load();
  }

  function fmtTime(s: string | null) {
    return s ? new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  }

  if (loading) return <p className="text-slate-400 text-sm">Loading bracket…</p>;

  const lastRound = matches.length ? Math.max(...matches.map(m => m.round_number)) : 0;
  const lastFinished = lastRound > 0 && (matchesByRound.get(lastRound) || []).every(m => m.status === 'finished' && m.winner_id);
  const tournamentChampion = matches.find(m => m.round_number === 5 && m.status === 'finished');

  function exportScoresheet() {
    const wb = XLSX.utils.book_new();
    const rows: (string | number)[][] = [
      ['MakeX 2026 Lebanon — Capelli Soccer Scoresheet'],
      [],
      [
        'Round', 'Match #', 'Table', 'Time',
        'Team A', 'Team B',
        'Score A', 'Score B',
        'Penalty A', 'Penalty B',
        'Winner', 'Notes', 'Referee',
      ],
    ];

    // Sort matches by round then match number
    const sorted = [...matches].sort((a, b) =>
      a.round_number !== b.round_number ? a.round_number - b.round_number : a.match_number - b.match_number
    );

    for (const m of sorted) {
      const teamA = (m.team_a as Passation | undefined);
      const teamB = (m.team_b as Passation | undefined);
      const winner = (m.winner as Passation | undefined);
      const tableLabel = (m.table as Table | undefined)?.display_label
        || (m.table as Table | undefined)?.table_number?.toString()
        || '';
      const time = m.scheduled_time
        ? new Date(m.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      rows.push([
        ROUND_NAMES[m.round_number] || `Round ${m.round_number}`,
        m.match_number,
        tableLabel,
        time,
        teamA?.student_names || teamA?.team_name || '',
        teamB?.student_names || teamB?.team_name || '',
        m.score_a ?? '',
        m.score_b ?? '',
        '',  // penalty A — blank for manual fill
        '',  // penalty B — blank for manual fill
        winner?.student_names || winner?.team_name || '',
        m.notes || '',
        '',  // referee — blank
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
      { wch: 28 }, { wch: 28 },
      { wch: 9 }, { wch: 9 },
      { wch: 10 }, { wch: 10 },
      { wch: 28 }, { wch: 20 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Scoresheet');

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MakeX2026_Soccer_Scoresheet.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">Capelli Soccer — Bracket</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {teams.length} teams · {tables.length} tables · {MATCH_SLOT_MIN}-min slots · first round starts {fmtTime(FIRST_ROUND_START)}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportScoresheet} disabled={matches.length === 0}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 rounded-xl transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Scoresheet
          </button>
          {matches.length === 0 ? (
            <button onClick={generateRound1} disabled={busy || teams.length < 2}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">
              🎲 Generate Round 1 ({Math.floor(teams.length / 2)} matches)
            </button>
          ) : (
            <>
              <button onClick={generateNextRound} disabled={busy || !lastFinished || lastRound >= 5}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-30">
                ▶ Generate next round
              </button>
              <button onClick={generateRound1} disabled={busy}
                className="bg-amber-100 hover:bg-amber-200 text-amber-900 text-sm font-semibold px-3 py-2 rounded-xl border border-amber-300">
                🔄 Re-shuffle Round 1
              </button>
            </>
          )}
        </div>
      </div>

      {tournamentChampion && tournamentChampion.winner && (
        <div className="bg-gradient-to-r from-amber-400 to-yellow-500 border border-amber-500 text-white rounded-2xl p-5 text-center shadow-lg">
          <p className="text-xs uppercase font-bold tracking-widest opacity-90">🏆 Tournament Champion</p>
          <p className="text-2xl font-black mt-1">{tournamentChampion.winner.team_name}</p>
          <p className="text-sm opacity-90">{tournamentChampion.winner.club_name}</p>
        </div>
      )}

      {matches.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
          No bracket generated yet. Click <strong>🎲 Generate Round 1</strong> to randomly pair the {teams.length} teams.
        </div>
      )}

      {[1, 2, 3, 4, 5].map(round => {
        const list = matchesByRound.get(round) || [];
        if (list.length === 0) return null;
        return (
          <div key={round} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">{ROUND_NAMES[round]}</h3>
              <p className="text-xs text-slate-500">{list.length} {list.length === 1 ? 'match' : 'matches'}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {list.map(m => <MatchRow key={m.id} m={m} onPatch={patchMatch} fmtTime={fmtTime} tables={tables} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchRow({ m, onPatch, fmtTime, tables }: {
  m: SoccerMatch;
  onPatch: (id: string, patch: Partial<SoccerMatch>) => Promise<void>;
  fmtTime: (s: string | null) => string;
  tables: Table[];
}) {
  const [scoreA, setScoreA] = useState(m.score_a?.toString() ?? '');
  const [scoreB, setScoreB] = useState(m.score_b?.toString() ?? '');

  useEffect(() => { setScoreA(m.score_a?.toString() ?? ''); setScoreB(m.score_b?.toString() ?? ''); }, [m.score_a, m.score_b]);

  function tableLabel(id: string | null) {
    if (!id) return '—';
    const t = tables.find(t => t.id === id);
    return t ? (t.display_label || `Table ${t.table_number}`) : '—';
  }

  async function saveScores() {
    const sa = scoreA === '' ? null : Number(scoreA);
    const sb = scoreB === '' ? null : Number(scoreB);
    if (sa == null || sb == null) { alert('Enter both scores.'); return; }
    if (sa === sb) { alert('Soccer match cannot end in a tie at this stage. Use penalty shootout to break the tie and enter the final goal counts.'); return; }
    const winnerId = sa > sb ? m.team_a_id : m.team_b_id;
    await onPatch(m.id, { score_a: sa, score_b: sb, winner_id: winnerId, status: 'finished' });
  }

  async function reopen() {
    if (!confirm('Reopen this match? Score and winner will be cleared.')) return;
    await onPatch(m.id, { score_a: null, score_b: null, winner_id: null, status: 'scheduled' });
  }

  const winnerSide = m.winner_id === m.team_a_id ? 'a' : m.winner_id === m.team_b_id ? 'b' : null;
  const teamCell = (passation: Passation | undefined, isWinner: boolean) => (
    <div className={`text-sm ${isWinner ? 'font-bold text-emerald-700' : 'text-slate-700'}`}>
      {passation ? (
        <>
          <p className="leading-tight">{passation.team_name} {isWinner && <span className="text-xs">🏆</span>}</p>
          <p className="text-[10px] text-slate-400">{passation.club_name}</p>
        </>
      ) : (
        <p className="text-slate-300 italic">— bye —</p>
      )}
    </div>
  );

  return (
    <div className="px-4 py-3 hover:bg-slate-50/60">
      <div className="grid grid-cols-12 gap-3 items-center">
        <div className="col-span-1 text-xs font-bold text-slate-400">#{m.match_number}</div>
        <div className="col-span-2 text-xs">
          <p className="font-mono font-bold text-blue-700">{fmtTime(m.scheduled_time)}</p>
          <p className="text-[10px] text-slate-500">{tableLabel(m.table_id)}</p>
        </div>
        <div className="col-span-3">{teamCell(m.team_a, winnerSide === 'a')}</div>
        <div className="col-span-2 flex gap-1 items-center justify-center">
          <input type="number" min={0} value={scoreA} onChange={e => setScoreA(e.target.value)}
            disabled={m.status === 'finished'}
            className="w-12 text-center bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-sm font-bold disabled:bg-slate-100" />
          <span className="text-slate-300">·</span>
          <input type="number" min={0} value={scoreB} onChange={e => setScoreB(e.target.value)}
            disabled={m.status === 'finished'}
            className="w-12 text-center bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-sm font-bold disabled:bg-slate-100" />
        </div>
        <div className="col-span-3">{teamCell(m.team_b, winnerSide === 'b')}</div>
        <div className="col-span-1 text-right">
          {m.status === 'finished' ? (
            <button onClick={reopen} className="text-xs text-slate-500 hover:text-slate-700 underline">Reopen</button>
          ) : (
            <button onClick={saveScores} disabled={!m.team_a_id || !m.team_b_id}
              className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-30">
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
