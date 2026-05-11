'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SHEETS, type Sheet } from '@/lib/scoresheets';


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
