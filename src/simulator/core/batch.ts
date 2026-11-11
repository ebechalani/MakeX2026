/**
 * Run whole matches without a screen, as fast as the computer can ("test many combinations").
 *
 *   runMatch(opts)                 one match from the start signal to the end, returns its score
 *   runBatch(game, robot, program, scenarios)
 *                                  the same program on a list of combinations, one after the other
 *   runBatchAsync(args, options)   like runBatch, but it takes a short break every few milliseconds
 *                                  so that a web page stays responsive, and it can be cancelled
 *   batchRuns(args)                the same as a generator: one result per step, for callers that
 *                                  want to decide themselves when to take a break
 *   summarize(results)             average, best, worst and how often each mission succeeded
 *
 * A match here is exactly the match of the visible simulator: the same engine, the same
 * interpreter, the same referee. Nothing depends on the computer's clock, so the same program on
 * the same combination with the same seed always gives the same result.
 *
 * Plain TypeScript, no DOM: it runs in the browser and headless under Node.
 */
import { makeRng } from './geometry';
import { createSimulation } from './simulation';
import type {
  FinishReason,
  Game,
  ProgramJson,
  RobotConfig,
  ScoreLine,
  Simulation,
  SimulationOptions,
  VMError,
} from './types';

/** The outcome of one match. */
export interface BatchResult {
  /** the combination that was played, as the short code of game.encodeScenario() */
  scenarioCode: string;
  /** points at the end of the match */
  total: number;
  /** points that were available */
  max: number;
  /** every mission was complete */
  complete: boolean;
  restarts: number;
  /** simulated seconds on the match clock when the match ended */
  time: number;
  /** why the match ended ('declared' also when the match was cut short by `maxSeconds`) */
  finishReason: FinishReason | null;
  /** the referee's score sheet, line by line */
  lines: ScoreLine[];
  /** problems the interpreter found in the program (unknown block, empty slot ...); left out when there are none */
  errors?: VMError[];
}

/** How many ticks are simulated between two looks at the clock. */
const TICKS_PER_CHUNK = 500;

/** Turn the state of a simulation into a result line. */
export function resultOf<S>(sim: Simulation<S>): BatchResult {
  const report = sim.score();
  const result: BatchResult = {
    scenarioCode: sim.game.encodeScenario(sim.scenario),
    total: report.total,
    max: report.max,
    complete: report.complete,
    restarts: sim.restarts,
    time: sim.world.time,
    finishReason: sim.finishReason,
    lines: report.lines,
  };
  const errors = sim.vm.errors();
  if (errors.length > 0) result.errors = errors;
  return result;
}

/**
 * Play one whole match and return its score.
 *
 * The match ends by itself when the time is up or when the program has ended and the robot stands
 * still. With `maxSeconds` (simulated seconds) the match is cut short there: the team "declares
 * Finished", the robot stops and the field is scored as it is.
 */
export function runMatch<S>(opts: SimulationOptions<S>, maxSeconds?: number): BatchResult {
  const sim = createSimulation(opts);
  const limit =
    maxSeconds !== undefined && Number.isFinite(maxSeconds)
      ? Math.max(0, Math.min(maxSeconds, opts.game.matchDuration))
      : opts.game.matchDuration;
  const limitTicks = Math.round(limit / sim.dt);

  sim.start();
  while (sim.status === 'running' && sim.world.tick < limitTicks) {
    sim.step(Math.min(TICKS_PER_CHUNK, limitTicks - sim.world.tick));
    // nobody listens to the events of a headless match: throw them away so they do not pile up
    sim.drainEvents();
  }
  if (sim.status === 'running') sim.declareFinished();
  return resultOf(sim);
}

// =============================================================================================
// Many matches
// =============================================================================================

/** Settings shared by all matches of a batch; every one of them is optional. */
export interface BatchSettings<S> {
  /** cut every match short after this many simulated seconds (default: the full match) */
  maxSeconds?: number;
  /** seed of the noise generator; match number i uses seed + i (default 1) */
  seed?: number;
  /** where the robot starts (default: the game's default start pose) */
  startPose?: SimulationOptions<S>['startPose'];
  /** what the floor sensors see (default: the vector drawing of the mat) */
  sampler?: SimulationOptions<S>['sampler'];
}

/** Everything a batch needs to know. */
export interface BatchArgs<S> extends BatchSettings<S> {
  game: Game<S>;
  robotConfig: RobotConfig;
  program: ProgramJson;
  /** the combinations to play, in this order */
  scenarios: S[];
}

function optionsFor<S>(args: BatchArgs<S>, index: number): SimulationOptions<S> {
  return {
    game: args.game,
    scenario: args.scenarios[index],
    robotConfig: args.robotConfig,
    program: args.program,
    startPose: args.startPose,
    sampler: args.sampler,
    seed: (args.seed ?? 1) + index,
  };
}

/**
 * The batch as a generator: every `next()` plays one match and hands back its result.
 *
 *   for (const result of batchRuns(args)) { ... }
 */
export function* batchRuns<S>(args: BatchArgs<S>): Generator<BatchResult, void, void> {
  for (let i = 0; i < args.scenarios.length; i++) {
    yield runMatch(optionsFor(args, i), args.maxSeconds);
  }
}

/** Called after every match of a batch. Return false to stop the batch early. */
export type BatchProgress = (done: number, total: number, result: BatchResult) => void | boolean;

/**
 * Play the same program on every combination of the list, one match after the other, without
 * pausing. Fine under Node and for short lists; in a web page use runBatchAsync() instead.
 */
export function runBatch<S>(
  game: Game<S>,
  robotConfig: RobotConfig,
  program: ProgramJson,
  scenarios: S[],
  onProgress?: BatchProgress,
  settings: BatchSettings<S> = {},
): BatchResult[] {
  const results: BatchResult[] = [];
  for (const result of batchRuns({ ...settings, game, robotConfig, program, scenarios })) {
    results.push(result);
    if (onProgress && onProgress(results.length, scenarios.length, result) === false) break;
  }
  return results;
}

export interface BatchAsyncOptions {
  /** take a break after this many milliseconds of computing (default 12, less than one screen frame) */
  yieldEvery?: number;
  /** abort this signal to stop the batch; the results so far are returned */
  signal?: { readonly aborted: boolean };
  /** called after every match */
  onResult?: (result: BatchResult, done: number, total: number) => void;
  /** how to take a break (default: a zero-length timer, which lets the browser draw and handle clicks) */
  pause?: () => Promise<void>;
  /** the clock used to measure `yieldEvery`, in milliseconds (default: Date.now) */
  now?: () => number;
}

const defaultPause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Like runBatch(), for a web page: after about `yieldEvery` milliseconds of work it lets go of
 * the processor for a moment, so the page can redraw and react to clicks. Resolves with the
 * results of the matches that were played (all of them, unless the signal was aborted).
 */
export async function runBatchAsync<S>(args: BatchArgs<S>, options: BatchAsyncOptions = {}): Promise<BatchResult[]> {
  const yieldEvery = Math.max(0, options.yieldEvery ?? 12);
  const pause = options.pause ?? defaultPause;
  const now = options.now ?? Date.now;
  const total = args.scenarios.length;
  const results: BatchResult[] = [];
  let sliceStart = now();

  for (let i = 0; i < total; i++) {
    if (options.signal?.aborted) break;
    const result = runMatch(optionsFor(args, i), args.maxSeconds);
    results.push(result);
    options.onResult?.(result, results.length, total);
    if (i < total - 1 && now() - sliceStart >= yieldEvery) {
      await pause();
      sliceStart = now();
    }
  }
  return results;
}

/**
 * Draw `count` different combinations at random (repeatable: the same seed gives the same list).
 * When the game has fewer combinations than asked for, all that could be drawn are returned.
 */
export function drawScenarios<S>(game: Game<S>, count: number, seed = 1): S[] {
  const rng = makeRng(seed);
  const wanted = Math.max(0, Math.min(Math.floor(count), game.scenarioCount()));
  const seen = new Set<string>();
  const out: S[] = [];
  // (the attempt limit only matters when nearly every combination of the game is asked for)
  for (let attempt = 0; out.length < wanted && attempt < wanted * 50 + 100; attempt++) {
    const scenario = game.randomScenario(rng);
    const code = game.encodeScenario(scenario);
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(scenario);
  }
  return out;
}

// =============================================================================================
// Summary
// =============================================================================================

export interface BatchLineSummary {
  id: string;
  label: string;
  /** share of the matches (0..1) in which this line was ok: mission done, or no penalty */
  successRate: number;
}

export interface BatchSummary {
  /** number of matches */
  runs: number;
  /** average points per match */
  average: number;
  /** highest and lowest points of a match */
  best: number;
  worst: number;
  /** matches in which every mission was complete */
  completeCount: number;
  /** per line of the score sheet, in the referee's order */
  perLine: BatchLineSummary[];
}

/** Boil a list of results down to the numbers a teacher wants to see. */
export function summarize(results: readonly BatchResult[]): BatchSummary {
  const runs = results.length;
  if (runs === 0) return { runs: 0, average: 0, best: 0, worst: 0, completeCount: 0, perLine: [] };

  let sum = 0;
  let best = -Infinity;
  let worst = Infinity;
  let completeCount = 0;
  const order: string[] = [];
  const perLine = new Map<string, { label: string; ok: number; seen: number }>();

  for (const result of results) {
    sum += result.total;
    if (result.total > best) best = result.total;
    if (result.total < worst) worst = result.total;
    if (result.complete) completeCount++;
    for (const line of result.lines) {
      let entry = perLine.get(line.id);
      if (!entry) {
        entry = { label: line.label, ok: 0, seen: 0 };
        perLine.set(line.id, entry);
        order.push(line.id);
      }
      entry.seen++;
      if (line.ok) entry.ok++;
    }
  }

  return {
    runs,
    average: sum / runs,
    best,
    worst,
    completeCount,
    perLine: order.map((id) => {
      const entry = perLine.get(id)!;
      return { id, label: entry.label, successRate: entry.seen > 0 ? entry.ok / entry.seen : 0 };
    }),
  };
}
