'use client';

/**
 * The referee's score sheet: every line of the ScoreReport with the reason it does or does not
 * score, in the referee's words, plus the status line shown above the stage.
 */
import type { ReactNode } from 'react';
import type { FinishReason, ScoreLine, ScoreReport } from '../core/types';
import { finishText, formatStamp, restartNote } from './format';
import { CheckIcon, CrossIcon } from './icons';
import type { RunState } from './useSimulation';

function LineRow({ line }: { line: ScoreLine }) {
  const isPenalty = line.max === 0;
  const lost = isPenalty && line.points < 0;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <span
        className={
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ' +
          (lost ? 'bg-rose-100 text-rose-700' : line.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')
        }
      >
        {lost || (!line.ok && !isPenalty) ? <CrossIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
        <span className="sr-only">{lost ? 'penalty' : line.ok ? 'done' : 'not done'}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{line.label}</p>
        <p className="text-xs leading-snug text-slate-500">{line.detail}</p>
      </div>
      <span
        className={
          'shrink-0 font-mono text-sm font-bold tabular-nums ' +
          (lost ? 'text-rose-600' : line.points > 0 ? 'text-emerald-700' : 'text-slate-400')
        }
      >
        {isPenalty ? line.points : `${line.points}/${line.max}`}
      </span>
    </li>
  );
}

export function ScoreSheet({ score }: { score: ScoreReport }) {
  const missions = score.lines.filter((line) => line.max > 0);
  const penalties = score.lines.filter((line) => line.max === 0);
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {missions.map((line) => (
          <LineRow key={line.id} line={line} />
        ))}
      </ul>
      {penalties.length > 0 && (
        <>
          <p className="mt-2 border-t border-slate-200 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500">Penalties</p>
          <ul className="divide-y divide-slate-100">
            {penalties.map((line) => (
              <LineRow key={line.id} line={line} />
            ))}
          </ul>
        </>
      )}
      <div className="mt-2 flex items-baseline justify-between border-t-2 border-slate-200 pt-2">
        <span className="text-sm font-bold text-slate-800">Total</span>
        <span className="font-mono text-lg font-bold tabular-nums text-slate-900">
          {score.total} <span className="text-sm font-medium text-slate-500">/ {score.max}</span>
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">The score is what the field is worth right now. It can never go below 0.</p>
    </div>
  );
}

export interface StatusLineProps {
  runState: RunState;
  finishReason: FinishReason | null;
  score: ScoreReport;
  /** simulated seconds on the match clock */
  time: number;
  /** restarts used in this match, and what each one costs (shown because a restart at 0 points does not change the score) */
  restarts?: number;
  restartPenalty?: number;
  /** what to tell the student before the start (how to place the robot) */
  readyHint: string;
  /** set when the robot is being put somewhere it may not start: shown in red instead of the hint */
  placingProblem: string | null;
  onShowSheet: () => void;
}

/**
 * One line above the stage that always says where the match stands: how to get ready, that it
 * is running, and - when it is over - the result and what to press next. It keeps the same
 * height in every state as long as the text fits on two lines, so the stage below it does not
 * jump; a longer text makes it taller (it is never squeezed: "shrink-0").
 */
export function StatusLine({ runState, finishReason, score, time, restarts = 0, restartPenalty = 0, readyHint, placingProblem, onShowSheet }: StatusLineProps) {
  const missions = score.lines.filter((line) => line.max > 0 && line.id !== 'bonus');
  const done = missions.filter((line) => line.ok).length;
  const penaltyNote = restartNote(restarts, restartPenalty);
  const points = (
    <span className="font-mono font-bold tabular-nums">
      {score.total} / {score.max}
    </span>
  );

  let tone = 'border-slate-200 bg-white text-slate-600';
  let content: ReactNode;
  let showSheet = false;
  if (runState === 'ready') {
    if (placingProblem) {
      tone = 'border-rose-300 bg-rose-50 text-rose-800';
      content = <span className="font-semibold">{placingProblem}</span>;
    } else {
      content = readyHint;
    }
  } else if (runState === 'running') {
    tone = 'border-sky-200 bg-sky-50 text-sky-950';
    content = (
      <>
        <span className="font-bold">Match running.</span> {done} of {missions.length} missions complete.
        {penaltyNote && <span className="font-semibold text-amber-800"> {penaltyNote}.</span>}
      </>
    );
  } else if (runState === 'paused') {
    tone = 'border-amber-300 bg-amber-50 text-amber-950';
    content = (
      <>
        <span className="font-bold">Paused</span> at {formatStamp(time)}. The match clock is paused too.
      </>
    );
  } else if (runState === 'stopped') {
    tone = 'border-slate-300 bg-slate-200 text-slate-800';
    showSheet = true;
    content = (
      <>
        <span className="font-bold">Stopped by you</span> at {formatStamp(time)} - no final score (so far {points}). Start tries again, Reset puts the
        field back.
      </>
    );
  } else {
    const perfect = score.total >= score.max;
    tone = perfect ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-sky-300 bg-sky-100 text-sky-950';
    showSheet = true;
    content = (
      <>
        <span className="font-bold">Match over.</span> {finishText(finishReason)} at {formatStamp(time)}. Final score: {points}
        {perfect ? ' - a perfect run!' : score.complete ? ' - every mission complete.' : ''}
        {penaltyNote && ` (${penaltyNote})`}
      </>
    );
  }

  return (
    <div className={`flex min-h-12 shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px] leading-snug ${tone}`}>
      <p role="status" aria-live="polite" className="min-w-0 flex-1">
        {content}
      </p>
      {showSheet && (
        <button
          type="button"
          onClick={onShowSheet}
          className="shrink-0 rounded-lg border border-current/30 bg-white/70 px-2.5 py-1 text-xs font-bold hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          Score sheet
        </button>
      )}
    </div>
  );
}
