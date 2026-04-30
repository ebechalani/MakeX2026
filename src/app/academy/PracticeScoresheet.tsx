'use client';
import { useMemo, useState } from 'react';

type Choice = { label: string; value: number };
type Item = { id: string; title: string; description?: string; choices: Choice[] };
type Section = { title: string; subtitle?: string; items: Item[] };
type Sheet = {
  key: string;
  name: string;
  tag: string;
  ages: string;
  duration: string;
  color: string;
  sections: Section[];
  voidIds?: string[];
  formula: (vals: Record<string, number>) => number;
};

const SHEETS: Sheet[] = [
  // ── SportsWonderland ──────────────────────────────────────────────
  {
    key: 'sportswonderland',
    name: 'SportsWonderland — All-Star Pickup',
    tag: 'SportsWonderland 4–5 / 6–7',
    ages: '4–5 (Manual) · 6–7 (Autonomous)',
    duration: '120 seconds',
    color: 'from-pink-600 to-rose-700',
    sections: [
      {
        title: 'Token Collection',
        subtitle: 'Mark which tokens were collected. Only collected tokens score points.',
        items: [
          { id: 'helmet', title: 'Helmet (5 pts)', choices: [{ label: 'Collected', value: 5 }, { label: 'Not collected', value: 0 }] },
          { id: 'whistle', title: 'Whistle (4 pts)', choices: [{ label: 'Collected', value: 4 }, { label: 'Not collected', value: 0 }] },
          { id: 'basketball', title: 'Basketball (3 pts)', choices: [{ label: 'Collected', value: 3 }, { label: 'Not collected', value: 0 }] },
          { id: 'volleyball', title: 'Volleyball (2 pts)', choices: [{ label: 'Collected', value: 2 }, { label: 'Not collected', value: 0 }] },
          { id: 'tennis', title: 'Tennis Ball (1 pt)', choices: [{ label: 'Collected', value: 1 }, { label: 'Not collected', value: 0 }] },
        ],
      },
      {
        title: 'Huddle Pad Bonus',
        subtitle: 'Robot fully inside dashed Start/Huddle Pad at STOP.',
        items: [
          { id: 'huddle', title: 'Huddle Pad', choices: [{ label: 'Awarded (+5)', value: 5 }, { label: 'Not awarded', value: 0 }] },
        ],
      },
      {
        title: 'Penalties (–1 each)',
        subtitle: 'Each occurrence deducts 1 point.',
        items: [
          { id: 'p_robot', title: 'Illegal touch of robot', choices: [{ label: 'No', value: 0 }, { label: '1', value: -1 }, { label: '2', value: -2 }, { label: '3+', value: -3 }] },
          { id: 'p_token', title: 'Illegal touch of token', choices: [{ label: 'No', value: 0 }, { label: '1', value: -1 }, { label: '2', value: -2 }, { label: '3+', value: -3 }] },
          { id: 'p_reset', title: 'Field reset / repositioning', choices: [{ label: 'No', value: 0 }, { label: '1', value: -1 }, { label: '2', value: -2 }] },
          { id: 'p_damage', title: 'Damage to field or tokens', choices: [{ label: 'No', value: 0 }, { label: '1', value: -1 }, { label: '2', value: -2 }] },
          { id: 'p_other', title: 'Other', choices: [{ label: 'No', value: 0 }, { label: '1', value: -1 }, { label: '2', value: -2 }] },
        ],
      },
    ],
    formula: v => Object.values(v).reduce((a, b) => a + b, 0),
  },

  // ── SmartLogistics ────────────────────────────────────────────────
  {
    key: 'smartlogistics',
    name: 'Smart Logistics — Capelli Inspire',
    tag: 'Capelli Inspire 8–12',
    ages: '8–12 · Fully autonomous',
    duration: '150 seconds',
    color: 'from-blue-600 to-cyan-700',
    sections: [
      {
        title: 'Mission Cube Deliveries',
        subtitle: 'Correct = fully inside matching colored bay (RED → Home, GREEN → Training).',
        items: [
          { id: 'cube1', title: 'Cube 1', choices: [{ label: 'Correct (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'cube2', title: 'Cube 2', choices: [{ label: 'Correct (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'cube3', title: 'Cube 3', choices: [{ label: 'Correct (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
        ],
      },
      {
        title: 'Blue Cube Status',
        items: [
          {
            id: 'blue', title: 'BLUE cube',
            choices: [
              { label: 'Untouched (+10)', value: 10 },
              { label: 'Moved but inside locker (0)', value: 0 },
              { label: 'Outside locker (−20)', value: -20 },
            ],
          },
        ],
      },
      {
        title: 'Park / Finish Bonus',
        subtitle: 'Robot partially or completely inside Finish zone at STOP.',
        items: [
          { id: 'park', title: 'Park / Finish', choices: [{ label: 'Awarded (+10)', value: 10 }, { label: 'Not awarded', value: 0 }] },
        ],
      },
      {
        title: 'Field Protection & Autonomy',
        subtitle: 'Confirmed violation voids the run.',
        items: [
          { id: 'void_dmg', title: 'Damage to map/lockers/bays', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
          { id: 'void_help', title: 'Illegal assistance after GO', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
        ],
      },
    ],
    voidIds: ['void_dmg', 'void_help'],
    formula: v => Object.values(v).reduce((a, b) => a + b, 0),
  },

  // ── LockerRoom ────────────────────────────────────────────────────
  {
    key: 'lockerroom',
    name: 'Locker Room — Capelli Starter',
    tag: 'Capelli Starter 13–15',
    ages: '13–15 · Fully autonomous',
    duration: 'Match',
    color: 'from-emerald-600 to-teal-700',
    sections: [
      {
        title: 'Mission Phases',
        subtitle: 'Phase 4 (Gate bonus) only counts if Phase 3 was a correct delivery.',
        items: [
          { id: 'p1', title: '1. Left Locker Room with Team Box', choices: [{ label: '+5', value: 5 }, { label: '0', value: 0 }] },
          { id: 'p2a', title: '2a. Reached Scan Station with Team Box', choices: [{ label: '+10', value: 10 }, { label: '0', value: 0 }] },
          { id: 'p2b', title: '2b. Coach approval — Team Box lifted', choices: [{ label: '+15', value: 15 }, { label: '0', value: 0 }] },
          { id: 'p2c', title: '2c. 4-second pause maintained', choices: [{ label: 'Yes (no penalty)', value: 0 }, { label: 'No (+10s penalty)', value: 0 }] },
          { id: 'p3', title: '3. Team-color cube delivery', choices: [{ label: 'Correct (+20)', value: 20 }, { label: 'Wrong bay (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'p4', title: '4. Stadium gate opened (only if P3 correct)', choices: [{ label: 'Awarded (+5)', value: 5 }, { label: 'Not awarded', value: 0 }] },
        ],
      },
      {
        title: 'Maze Sorting',
        subtitle: 'Each token must end fully inside its matching colored target.',
        items: [
          { id: 'mz_red', title: 'RED token', choices: [{ label: 'Correct (+10)', value: 10 }, { label: 'Wrong (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'mz_grn', title: 'GREEN token', choices: [{ label: 'Correct (+10)', value: 10 }, { label: 'Wrong (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
          { id: 'mz_blu', title: 'BLUE token', choices: [{ label: 'Correct (+10)', value: 10 }, { label: 'Wrong (−10)', value: -10 }, { label: 'Not delivered', value: 0 }] },
        ],
      },
      {
        title: 'Field Protection & Autonomy',
        items: [
          { id: 'v_dmg', title: 'Robot damaged field/locker/maze/barriers', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
          { id: 'v_help', title: 'Illegal human assistance after GO', choices: [{ label: 'No', value: 0 }, { label: 'Yes → VOID', value: -9999 }] },
          { id: 'v_gate', title: 'Robot touched the gate', choices: [{ label: 'No', value: 0 }, { label: 'Yes (−10)', value: -10 }] },
        ],
      },
    ],
    voidIds: ['v_dmg', 'v_help'],
    formula: v => {
      // Gate bonus only if P3 correct
      const copy = { ...v };
      if ((copy.p3 ?? 0) !== 20) copy.p4 = 0;
      return Object.values(copy).reduce((a, b) => a + b, 0);
    },
  },
];

export default function PracticeScoresheet() {
  const [active, setActive] = useState(SHEETS[0].key);
  const sheet = useMemo(() => SHEETS.find(s => s.key === active)!, [active]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [studentName, setStudentName] = useState('');

  const isVoid = sheet.voidIds?.some(id => vals[id] === -9999) ?? false;
  const total = isVoid ? 0 : sheet.formula(vals);

  function reset() {
    setVals({});
    setStudentName('');
  }

  function switchSheet(k: string) {
    setActive(k);
    setVals({});
  }

  return (
    <div className="space-y-6">
      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-sm text-cyan-900">
        <strong>Trial mode:</strong> Use this to practice with your students. Nothing is saved to the database.
      </div>

      {/* Category selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <div className="text-xs text-slate-500 mt-1">{s.ages} · {s.duration}</div>
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
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider opacity-75">{isVoid ? 'Run Voided' : 'Live Score'}</div>
          <div className={`text-5xl font-black ${isVoid ? 'text-red-200' : ''}`}>{isVoid ? 'VOID' : total}</div>
        </div>
        <button onClick={reset} className="bg-white/15 hover:bg-white/25 border border-white/20 rounded-xl px-4 py-2 text-sm font-semibold">
          Reset
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
        Practice scoresheet · MakeX Lebanon 2026 · No data is stored
      </div>
    </div>
  );
}
