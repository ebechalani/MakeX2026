'use client';

/**
 * The match controls above the stage: the referee's start signal (green flag), Stop, Pause,
 * the rules "Restart" (-5 points), the team's "Finished" call, Reset field, the match clock,
 * the live score and the speed of the simulation.
 */
import type { ScoreReport } from '../core/types';
import { formatClock } from './format';
import { FinishIcon, FlagIcon, PauseIcon, PlayIcon, ResetIcon, RestartIcon, StopIcon } from './icons';
import { SPEEDS, type RunState, type Speed } from './useSimulation';
import { button } from './widgets';

export interface ControlBarProps {
  runState: RunState;
  /** false while the block editor is still loading: there is no program to start yet */
  canStart: boolean;
  timeLeft: number;
  score: ScoreReport;
  restartPenalty: number;
  speed: Speed;
  onSpeed: (speed: Speed) => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onFinished: () => void;
  onReset: () => void;
}

/*
 * The bar adapts to the width of its own column, not to the width of the screen: on a tablet the
 * stage column is narrow although the screen is not. That is what the "@[34rem]:" classes do
 * (container queries): they apply once the bar itself is at least 34rem (544 px) wide.
 * (They are written out in full everywhere because Tailwind only finds complete class names.)
 */

const BIG =
  'inline-flex h-11 select-none items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white shadow-sm transition ' +
  `@[34rem]:h-12 @[34rem]:px-5 @[34rem]:text-base ` +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40';

/** Smaller buttons of the second row; their icons are dropped when the column is narrow. */
const SMALL = `${button.plain} px-2`;
const SMALL_ICON = `hidden h-4 w-4 @[34rem]:block`;

function speedLabel(speed: Speed): string {
  return speed === 'max' ? 'Max' : `${speed}×`;
}

export function ControlBar(props: ControlBarProps) {
  const { runState, timeLeft, score, speed } = props;
  const active = runState === 'running' || runState === 'paused';
  const lowTime = active && timeLeft <= 30;

  const speedPicker = (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs font-semibold uppercase tracking-wide text-slate-500 @[42rem]:inline" aria-hidden="true">
        Speed
      </span>
      <div
        role="radiogroup"
        aria-label="Speed of the simulation"
        title="Speed of the simulation (the match clock runs at the same speed)"
        className="flex overflow-hidden rounded-lg border border-slate-300"
      >
        {SPEEDS.map((option) => {
          const selected = option === speed;
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => props.onSpeed(option)}
              className={
                'min-w-7 border-l border-slate-300 px-1 py-2 text-xs font-bold @[34rem]:px-1.5 first:border-l-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 ' +
                (selected ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
              }
            >
              {speedLabel(option)}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="@container flex flex-col gap-2">
      {/* the referee's signal, the clock and the score */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onStart}
          disabled={active || !props.canStart}
          className={`${BIG} bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500 active:bg-emerald-800`}
          title="The referee's start signal: the field is set up fresh and your program starts from the top"
        >
          <FlagIcon className="h-6 w-6" />
          Start
        </button>
        <button
          type="button"
          onClick={props.onStop}
          disabled={!active}
          className={`${BIG} bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500 active:bg-rose-800 @[34rem]:px-4`}
          title="Stop the program and the robot where they are"
        >
          <StopIcon className="h-5 w-5" />
          Stop
        </button>
        <button
          type="button"
          onClick={runState === 'paused' ? props.onResume : props.onPause}
          disabled={!active}
          aria-label={runState === 'paused' ? 'Continue' : 'Pause'}
          title={runState === 'paused' ? 'Continue' : 'Pause (the match clock pauses too)'}
          className={`${button.icon} h-11 w-11 rounded-xl @[34rem]:h-12 @[34rem]:w-12`}
        >
          {runState === 'paused' ? <PlayIcon className="h-5 w-5" /> : <PauseIcon className="h-5 w-5" />}
        </button>

        <div className={`ml-auto flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-2.5 py-1 shadow-sm @[34rem]:gap-4 @[34rem]:px-3 @[34rem]:py-1.5`}>
          <div
            className={`flex flex-col leading-none @[34rem]:flex-row @[34rem]:items-baseline @[34rem]:gap-1.5`}
            role="timer"
            aria-label={`Match clock: ${formatClock(timeLeft)} left`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Time</span>
            <span className={`font-mono text-xl font-bold tabular-nums @[34rem]:text-2xl ${lowTime ? 'text-rose-600' : 'text-slate-900'}`}>
              {formatClock(timeLeft)}
            </span>
          </div>
          <div
            className={`flex flex-col leading-none @[34rem]:flex-row @[34rem]:items-baseline @[34rem]:gap-1.5`}
            aria-label={`Score: ${score.total} of ${score.max} points`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Score</span>
            <span className="flex items-baseline gap-1">
              <span className={`font-mono text-xl font-bold tabular-nums text-slate-900 @[34rem]:text-2xl`}>{score.total}</span>
              <span className="text-xs font-medium text-slate-500">/ {score.max}</span>
            </span>
          </div>
        </div>
      </div>

      {/* what the team may do during a match, and how fast the simulation runs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onRestart}
          disabled={!active}
          className={SMALL}
          title={`Rules restart: the robot goes back into the start zone, whatever it carries goes back to where it came from, the clock keeps running. Costs ${props.restartPenalty} points.`}
        >
          <RestartIcon className={`${SMALL_ICON} text-amber-600`} />
          Restart
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">-{props.restartPenalty}</span>
        </button>
        <button
          type="button"
          onClick={props.onFinished}
          disabled={!active}
          className={SMALL}
          title='Tell the referee "Finished": the robot stops and the field is scored as it is'
        >
          <FinishIcon className={`${SMALL_ICON} text-slate-500`} />
          Finished
        </button>
        <button
          type="button"
          onClick={props.onReset}
          disabled={runState === 'ready'}
          className={SMALL}
          aria-label="Reset field"
          title="Put every tower, bucket and person back and the robot into the start zone"
        >
          <ResetIcon className={`${SMALL_ICON} text-slate-500`} />
          Reset<span className={`hidden @[34rem]:inline`}>field</span>
        </button>
        <div className="ml-auto">{speedPicker}</div>
      </div>
    </div>
  );
}
