'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

type Choice = { label: string; value: number };
type Item =
  | { id: string; kind?: 'choices'; title: string; description?: string; choices: Choice[] }
  | { id: string; kind: 'counter'; title: string; description?: string; min?: number; max?: number; step?: number; perUnit: number };
type Section = { title: string; subtitle?: string; items: Item[] };
type Sheet = {
  key: string;
  name: string;
  tag: string;
  ages: string;
  duration: string;
  durationSec: number;
  color: string;
  sections: Section[];
  voidIds?: string[];
  formula: (vals: Record<string, number>) => number;
  customLayout?: 'soccer';
};

const SHEETS: Sheet[] = [
  // ── SportsWonderland — All-Star Pickup ─────────────────────────────────
  {
    key: 'sportswonderland',
    name: 'SportsWonderland — All-Star Pickup',
    tag: 'Capelli SportsWonderland 4–7',
    ages: '4–5 (Manual) · 6–7 (Autonomous)',
    duration: '120 seconds',
    durationSec: 120,
    color: 'from-pink-600 to-rose-700',
    sections: [
      {
        title: '1. Token Collection',
        subtitle: 'All 5 tokens are present every match. Mark which were collected — only collected tokens score.',
        items: [
          { id: 'helmet', title: '🪖 Helmet (5 pts)', choices: [{ label: 'Collected (+5)', value: 5 }, { label: 'Not collected', value: 0 }] },
          { id: 'whistle', title: '🥏 Whistle (4 pts)', choices: [{ label: 'Collected (+4)', value: 4 }, { label: 'Not collected', value: 0 }] },
          { id: 'basketball', title: '🏀 Basketball (3 pts)', choices: [{ label: 'Collected (+3)', value: 3 }, { label: 'Not collected', value: 0 }] },
          { id: 'volleyball', title: '🏐 Volleyball (2 pts)', choices: [{ label: 'Collected (+2)', value: 2 }, { label: 'Not collected', value: 0 }] },
          { id: 'tennis', title: '🎾 Tennis Ball (1 pt)', choices: [{ label: 'Collected (+1)', value: 1 }, { label: 'Not collected', value: 0 }] },
        ],
      },
      {
        title: '2. Cone Penalties',
        subtitle: 'Each cone touch = −1 pt. Referee resets the robot while the timer keeps running.',
        items: [
          { id: 'cones', title: 'Cone touches (−1 each, up to 4)', choices: [
            { label: '0 touches', value: 0 },
            { label: '1 touch (−1)', value: -1 },
            { label: '2 touches (−2)', value: -2 },
            { label: '3 touches (−3)', value: -3 },
            { label: '4 touches (−4)', value: -4 },
          ] },
        ],
      },
      {
        title: '3. Huddle Pad Bonus',
        subtitle: 'Robot fully inside the dashed Huddle Pad at STOP.',
        items: [
          { id: 'huddle', title: 'Huddle Pad bonus', choices: [{ label: 'Awarded (+5)', value: 5 }, { label: 'Not awarded', value: 0 }] },
        ],
      },
      {
        title: '4. Run Validity',
        subtitle: 'If anyone except the referee touches the robot or items during the match, the team loses the round.',
        items: [
          { id: 'sw_void', title: 'Illegal touch (robot or items) after GO', choices: [{ label: 'No', value: 0 }, { label: 'Yes → ROUND LOST', value: -9999 }] },
        ],
      },
    ],
    voidIds: ['sw_void'],
    formula: v => Object.values(v).reduce((a, b) => a + b, 0),
  },

  // ── SmartLogistics — Capelli Inspire ───────────────────────────────────
  {
    key: 'smartlogistics',
    name: 'Smart Logistics',
    tag: 'Capelli Inspire 8–12',
    ages: '8–12 · Fully autonomous',
    duration: '150 seconds',
    durationSec: 150,
    color: 'from-blue-600 to-cyan-700',
    sections: [
      {
        title: '1. Mission Cube Deliveries',
        subtitle: 'Correct = cube fully inside its matching colored bay. RED → Home, GREEN → Training.',
        items: [
          { id: 'cube1', title: 'Cube 1', choices: [{ label: 'Correct bay (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'cube2', title: 'Cube 2', choices: [{ label: 'Correct bay (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'cube3', title: 'Cube 3', choices: [{ label: 'Correct bay (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
        ],
      },
      {
        title: '2. BLUE Cube Status',
        subtitle: 'BLUE cube must stay in its locker.',
        items: [
          {
            id: 'blue', title: 'BLUE cube position',
            choices: [
              { label: 'Untouched (+10)', value: 10 },
              { label: 'Moved, still inside locker (0)', value: 0 },
              { label: 'Fully outside locker (−20)', value: -20 },
            ],
          },
        ],
      },
      {
        title: '3. Park / Finish Bonus',
        subtitle: 'Robot partially or completely inside the Finish zone at STOP.',
        items: [
          { id: 'park', title: 'Finish zone bonus', choices: [{ label: 'Awarded (+10)', value: 10 }, { label: 'Not awarded', value: 0 }] },
        ],
      },
      {
        title: '4. Run Validity',
        subtitle: 'A confirmed breach voids the run (score = 0).',
        items: [
          { id: 'sl_void_touch', title: 'Anyone except referee touched robot/cubes/field after GO', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
          { id: 'sl_void_remote', title: 'Student used remote / joystick / manual control', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
        ],
      },
    ],
    voidIds: ['sl_void_touch', 'sl_void_remote'],
    formula: v => Object.values(v).reduce((a, b) => a + b, 0),
  },

  // ── LockerRoom — Capelli Starter ───────────────────────────────────────
  {
    key: 'lockerroom',
    name: 'Locker Room Mission',
    tag: 'Capelli Starter 13–15',
    ages: '13–15 · Fully autonomous',
    duration: '150 seconds',
    durationSec: 150,
    color: 'from-emerald-600 to-teal-700',
    sections: [
      {
        title: '1. Mission Phases',
        subtitle: 'Phase 4 (Stadium Gate) only counts if Phase 3 is a correct delivery.',
        items: [
          { id: 'p1', title: '1 · Left Locker Room with Team Box', choices: [{ label: 'Yes (+5)', value: 5 }, { label: 'No (0)', value: 0 }] },
          { id: 'p2a', title: '2a · Reached Scan Station with Team Box', choices: [{ label: 'Yes (+10)', value: 10 }, { label: 'No (0)', value: 0 }] },
          { id: 'p2b', title: '2b · Coach Approval — Team Box lifted by referee', choices: [{ label: 'Yes (+15)', value: 15 }, { label: 'No (0)', value: 0 }] },
          { id: 'p3', title: '3 · Team-color cube delivered to matching big circle', choices: [{ label: 'Correct (+20)', value: 20 }, { label: 'Wrong circle (−10)', value: -10 }, { label: 'Not delivered (0)', value: 0 }] },
          { id: 'p4', title: '4 · Stadium Gate opened (auto-zero unless Phase 3 correct)', choices: [{ label: 'Awarded (+5)', value: 5 }, { label: 'Not awarded', value: 0 }] },
        ],
      },
      {
        title: '2. Maze Sorting (3 tokens)',
        subtitle: 'Each colored token must end inside its matching color target. Fully inside = +10, partially inside = +5, wrong target = −10.',
        items: [
          { id: 'mz_red', title: '🟥 RED token', choices: [
            { label: 'Fully inside (+10)', value: 10 },
            { label: 'Partially inside (+5)', value: 5 },
            { label: 'Wrong target (−10)', value: -10 },
            { label: 'Not delivered (0)', value: 0 },
          ] },
          { id: 'mz_grn', title: '🟩 GREEN token', choices: [
            { label: 'Fully inside (+10)', value: 10 },
            { label: 'Partially inside (+5)', value: 5 },
            { label: 'Wrong target (−10)', value: -10 },
            { label: 'Not delivered (0)', value: 0 },
          ] },
          { id: 'mz_blu', title: '🟦 BLUE token', choices: [
            { label: 'Fully inside (+10)', value: 10 },
            { label: 'Partially inside (+5)', value: 5 },
            { label: 'Wrong target (−10)', value: -10 },
            { label: 'Not delivered (0)', value: 0 },
          ] },
        ],
      },
      {
        title: '3. Penalties & Run Validity',
        subtitle: 'Note: the 4-second pause is no longer scored — it is only a recommendation so the referee can lift the Team Box.',
        items: [
          { id: 'lr_gate', title: 'Robot touched the Stadium Gate', choices: [{ label: 'No', value: 0 }, { label: 'Yes (−10)', value: -10 }] },
          { id: 'lr_void_touch', title: 'Anyone except referee touched robot/field after GO', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
          { id: 'lr_void_remote', title: 'Student used remote / joystick', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
        ],
      },
    ],
    voidIds: ['lr_void_touch', 'lr_void_remote'],
    formula: v => {
      // Phase 4 only counts if Phase 3 was correct (+20)
      const copy = { ...v };
      if ((copy.p3 ?? 0) !== 20) copy.p4 = 0;
      return Object.values(copy).reduce((a, b) => a + b, 0);
    },
  },

  // ── MakeX Inspire — Code Courier ───────────────────────────────────────
  {
    key: 'codecourier',
    name: 'Code Courier',
    tag: 'MakeX Inspire 8–12',
    ages: '8–12 · Fully autonomous',
    duration: '150 seconds',
    durationSec: 150,
    color: 'from-purple-600 to-indigo-700',
    sections: [
      {
        title: '1. Rings on Signal Towers (+50 each)',
        subtitle: 'Ring color matches the tower, ring fully inserted onto the matching tower, upright, no contact with the robot at end. 4 rings of each color × 4 colors = max 16 rings × 50 = 800 pts.',
        items: [
          { id: 'tower_red',    title: '🔴 Red rings on red tower', choices: [
            { label: '0', value: 0 }, { label: '1 (+50)', value: 50 }, { label: '2 (+100)', value: 100 }, { label: '3 (+150)', value: 150 }, { label: '4 (+200)', value: 200 },
          ] },
          { id: 'tower_yellow', title: '🟡 Yellow rings on yellow tower', choices: [
            { label: '0', value: 0 }, { label: '1 (+50)', value: 50 }, { label: '2 (+100)', value: 100 }, { label: '3 (+150)', value: 150 }, { label: '4 (+200)', value: 200 },
          ] },
          { id: 'tower_blue',   title: '🔵 Blue rings on blue tower', choices: [
            { label: '0', value: 0 }, { label: '1 (+50)', value: 50 }, { label: '2 (+100)', value: 100 }, { label: '3 (+150)', value: 150 }, { label: '4 (+200)', value: 200 },
          ] },
          { id: 'tower_green',  title: '🟢 Green rings on green tower', choices: [
            { label: '0', value: 0 }, { label: '1 (+50)', value: 50 }, { label: '2 (+100)', value: 100 }, { label: '3 (+150)', value: 150 }, { label: '4 (+200)', value: 200 },
          ] },
        ],
      },
      {
        title: '2. Rings in Matching Color Zone (+10 each)',
        subtitle: 'Ring color matches, ring upright inside the matching delivery area, no robot contact — but NOT inserted onto the tower. Don\'t double-count rings already counted above.',
        items: [
          { id: 'zone_red',    title: '🔴 Red rings in red zone (not on tower)', choices: [
            { label: '0', value: 0 }, { label: '1 (+10)', value: 10 }, { label: '2 (+20)', value: 20 }, { label: '3 (+30)', value: 30 }, { label: '4 (+40)', value: 40 },
          ] },
          { id: 'zone_yellow', title: '🟡 Yellow rings in yellow zone (not on tower)', choices: [
            { label: '0', value: 0 }, { label: '1 (+10)', value: 10 }, { label: '2 (+20)', value: 20 }, { label: '3 (+30)', value: 30 }, { label: '4 (+40)', value: 40 },
          ] },
          { id: 'zone_blue',   title: '🔵 Blue rings in blue zone (not on tower)', choices: [
            { label: '0', value: 0 }, { label: '1 (+10)', value: 10 }, { label: '2 (+20)', value: 20 }, { label: '3 (+30)', value: 30 }, { label: '4 (+40)', value: 40 },
          ] },
          { id: 'zone_green',  title: '🟢 Green rings in green zone (not on tower)', choices: [
            { label: '0', value: 0 }, { label: '1 (+10)', value: 10 }, { label: '2 (+20)', value: 20 }, { label: '3 (+30)', value: 30 }, { label: '4 (+40)', value: 40 },
          ] },
        ],
      },
      {
        title: '3. Penalties (E02 Violations)',
        subtitle: 'Each confirmed rule violation deducts 20 points. Warnings (E01) do NOT deduct points.',
        items: [
          { id: 'cc_violations', title: 'Confirmed violations × −20', choices: [
            { label: '0', value: 0 },
            { label: '1 (−20)', value: -20 },
            { label: '2 (−40)', value: -40 },
            { label: '3 (−60)', value: -60 },
            { label: '4 (−80)', value: -80 },
            { label: '5+ (−100)', value: -100 },
          ] },
        ],
      },
      {
        title: '4. Match Validity',
        subtitle: 'E04 — team violates the rules and the match is disqualified; E03 invalid prop already removed from scoring.',
        items: [
          { id: 'cc_void', title: 'Disqualified by referee (E04)', choices: [{ label: 'No', value: 0 }, { label: 'Yes → MATCH SCORE = 0', value: -9999 }] },
        ],
      },
    ],
    voidIds: ['cc_void'],
    formula: v => Object.values(v).reduce((a, b) => a + b, 0),
  },

  // ── Soccer — Capelli Cup ───────────────────────────────────────────────
  {
    key: 'soccer',
    name: 'Capelli Sport Cup — Soccer',
    tag: 'Capelli Soccer 1v1',
    ages: '2 halves × 2 min · Speed cap 40 RPM',
    duration: '2 min / half',
    durationSec: 120,
    color: 'from-orange-600 to-amber-700',
    customLayout: 'soccer',
    sections: [
      {
        title: 'Goals (Half 1)',
        items: [
          { id: 'h1_us', kind: 'counter', title: 'Our team — Half 1', perUnit: 1, min: 0, max: 20 },
          { id: 'h1_them', kind: 'counter', title: 'Opponent — Half 1', perUnit: -1, min: 0, max: 20 },
        ],
      },
      {
        title: 'Goals (Half 2)',
        items: [
          { id: 'h2_us', kind: 'counter', title: 'Our team — Half 2', perUnit: 1, min: 0, max: 20 },
          { id: 'h2_them', kind: 'counter', title: 'Opponent — Half 2', perUnit: -1, min: 0, max: 20 },
        ],
      },
      {
        title: 'Fouls & Cards (informational, do not affect score)',
        subtitle: '2 minor fouls in same half = 1 yellow. 2 yellows in same match = red (disqualification).',
        items: [
          { id: 'minor_us', kind: 'counter', title: 'Our minor fouls', perUnit: 0, min: 0, max: 20 },
          { id: 'yellow_us', kind: 'counter', title: 'Our yellow cards', perUnit: 0, min: 0, max: 5 },
          { id: 'red_us', kind: 'counter', title: 'Our red cards', perUnit: 0, min: 0, max: 2 },
        ],
      },
      {
        title: 'Pre-Match Inspection',
        subtitle: 'All items must pass before kickoff.',
        items: [
          { id: 'ins_size', title: 'Footprint ≤ 22 × 22 cm', choices: [{ label: 'Pass', value: 0 }, { label: 'Fail → not eligible', value: -9999 }] },
          { id: 'ins_weight', title: 'Weight ≤ 1.5 kg', choices: [{ label: 'Pass', value: 0 }, { label: 'Fail → not eligible', value: -9999 }] },
          { id: 'ins_speed', title: 'Speed test ≥ 7 sec across field (40 RPM cap)', choices: [{ label: 'Pass', value: 0 }, { label: 'Fail → not eligible', value: -9999 }] },
          { id: 'ins_attach', title: 'No forbidden attachments (no traps, magnets, sharps, blades)', choices: [{ label: 'Pass', value: 0 }, { label: 'Fail → not eligible', value: -9999 }] },
        ],
      },
    ],
    voidIds: ['ins_size', 'ins_weight', 'ins_speed', 'ins_attach', 'red_us'],
    formula: v => {
      const usH1 = v.h1_us ?? 0;
      const themH1 = v.h1_them ?? 0;
      const usH2 = v.h2_us ?? 0;
      const themH2 = v.h2_them ?? 0;
      // value displayed = goal differential (positive if our team leading)
      return (usH1 + usH2) - (themH1 + themH2);
    },
  },
];

export default function PracticeScoresheet() {
  const [active, setActive] = useState(SHEETS[0].key);
  const sheet = useMemo(() => SHEETS.find(s => s.key === active)!, [active]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<Record<string, number>>({}); // raw counts for counter items
  const [studentName, setStudentName] = useState('');
  const [remaining, setRemaining] = useState(sheet.durationSec);
  const [running, setRunning] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Soft-void: red card disqualifies in soccer (we treat 1+ red as VOID)
  const isVoid = sheet.voidIds?.some(id => {
    const v = vals[id];
    if (v === -9999) return true;
    // For soccer: red_us is a counter; treat ≥1 as VOID
    if (id === 'red_us' && (counts[id] ?? 0) >= 1) return true;
    return false;
  }) ?? false;

  const total = isVoid ? 0 : sheet.formula({ ...vals, ...counts });

  useEffect(() => {
    if (!running) return;
    tickRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          setRunning(false);
          try { new Audio('data:audio/wav;base64,UklGRl9vAQBXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==').play().catch(() => {}); } catch {}
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [running]);

  function startPause() {
    if (remaining === 0) setRemaining(sheet.durationSec);
    setRunning(r => !r);
  }
  function resetTimer() {
    setRunning(false);
    setRemaining(sheet.durationSec);
  }

  function reset() {
    setVals({});
    setCounts({});
    setStudentName('');
    resetTimer();
  }

  function switchSheet(k: string) {
    setActive(k);
    setVals({});
    setCounts({});
    setRunning(false);
    const next = SHEETS.find(s => s.key === k)!;
    setRemaining(next.durationSec);
  }

  function bumpCounter(id: string, delta: number, min: number, max: number) {
    setCounts(c => ({ ...c, [id]: Math.max(min, Math.min(max, (c[id] ?? 0) + delta)) }));
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const timerWarn = remaining > 0 && remaining <= 10;
  const timerDone = remaining === 0;

  return (
    <div className="space-y-6">
      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-sm text-cyan-900">
        <strong>Trial mode:</strong> Use this to practice with your students.
      </div>

      {/* Category selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SHEETS.map(s => (
          <button
            key={s.key}
            onClick={() => switchSheet(s.key)}
            className={`text-left rounded-2xl p-4 border-2 transition-all ${
              active === s.key
                ? 'border-blue-500 bg-white shadow-md'
                : 'border-transparent bg-white/60 hover:bg-white'
            }`}
          >
            <div className={`inline-block bg-gradient-to-r ${s.color} text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded mb-2`}>
              {s.tag}
            </div>
            <div className="font-bold text-slate-800 text-sm leading-tight">{s.name}</div>
            <div className="text-xs text-slate-500 mt-1">{s.ages}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{s.duration}</div>
          </button>
        ))}
      </div>

      {/* Sticky total */}
      <div className={`sticky top-[72px] z-20 rounded-2xl shadow-lg p-5 bg-gradient-to-r ${sheet.color} text-white flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <div className="text-xs uppercase tracking-wider opacity-75">{sheet.name}</div>
          <input
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="Student / team name (optional)"
            className="bg-white/10 border border-white/20 rounded-lg px-3 py-1.5 text-sm placeholder-white/50 mt-1 focus:outline-none focus:bg-white/20"
          />
        </div>

        {/* Timer */}
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider opacity-75">{sheet.customLayout === 'soccer' ? 'Half Timer' : 'Match Timer'}</div>
          <div className={`text-5xl font-black tabular-nums ${timerDone ? 'text-red-300' : timerWarn ? 'text-amber-200 animate-pulse' : ''}`}>
            {mm}:{ss}
          </div>
          <div className="flex gap-1.5 justify-center mt-1.5">
            <button
              onClick={startPause}
              className="bg-white/15 hover:bg-white/25 border border-white/20 rounded-lg px-3 py-1 text-xs font-semibold"
            >
              {running ? '⏸ Pause' : timerDone ? '↻ Restart' : remaining < sheet.durationSec ? '▶ Resume' : '▶ Start'}
            </button>
            <button
              onClick={resetTimer}
              className="bg-white/15 hover:bg-white/25 border border-white/20 rounded-lg px-3 py-1 text-xs font-semibold"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs uppercase tracking-wider opacity-75">
            {isVoid ? 'Run Voided' : sheet.customLayout === 'soccer' ? 'Goal Differential' : 'Live Score'}
          </div>
          <div className={`text-5xl font-black ${isVoid ? 'text-red-200' : ''}`}>
            {isVoid ? 'VOID' : (sheet.customLayout === 'soccer' && total > 0 ? '+' : '') + total}
          </div>
          {sheet.customLayout === 'soccer' && !isVoid && (
            <div className="text-xs opacity-75 mt-0.5">
              Us {(counts.h1_us ?? 0) + (counts.h2_us ?? 0)} – {(counts.h1_them ?? 0) + (counts.h2_them ?? 0)} Them
            </div>
          )}
        </div>
        <button onClick={reset} className="bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl px-4 py-2 text-sm font-semibold">
          Reset All
        </button>
      </div>

      {/* Sections */}
      {sheet.sections.map((sec, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
            <div className="font-bold text-slate-800 text-sm">{sec.title}</div>
            {sec.subtitle && <div className="text-xs text-slate-500 mt-0.5">{sec.subtitle}</div>}
          </div>
          <div className="divide-y divide-slate-50">
            {sec.items.map(item => {
              if (item.kind === 'counter') {
                const c = counts[item.id] ?? 0;
                const min = item.min ?? 0;
                const max = item.max ?? 99;
                return (
                  <div key={item.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-sm text-slate-800">{item.title}</div>
                      {item.description && <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => bumpCounter(item.id, -1, min, max)}
                        disabled={c <= min}
                        className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-lg font-bold text-slate-700"
                      >−</button>
                      <div className="min-w-[3rem] text-center text-2xl font-black tabular-nums text-slate-800">{c}</div>
                      <button
                        onClick={() => bumpCounter(item.id, 1, min, max)}
                        disabled={c >= max}
                        className="w-9 h-9 rounded-lg bg-blue-100 hover:bg-blue-200 disabled:opacity-30 text-lg font-bold text-blue-700"
                      >+</button>
                    </div>
                  </div>
                );
              }
              const cur = vals[item.id];
              return (
                <div key={item.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-slate-800">{item.title}</div>
                    {item.description && <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.choices.map((c, ci) => {
                      const selected = cur === c.value && vals[item.id] !== undefined;
                      const isVoidChoice = c.value === -9999;
                      return (
                        <button
                          key={ci}
                          onClick={() => setVals(v => ({ ...v, [item.id]: c.value }))}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                            selected
                              ? isVoidChoice
                                ? 'bg-red-600 text-white border-red-600'
                                : c.value > 0
                                  ? 'bg-emerald-600 text-white border-emerald-600'
                                  : c.value < 0
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'bg-slate-700 text-white border-slate-700'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
                          }`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="text-center text-xs text-slate-400 py-4">
        Practice scoresheet · MakeX Lebanon 2026
      </div>
    </div>
  );
}
