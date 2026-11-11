'use client';

/**
 * The run loop of the on-screen match.
 *
 * The hook owns one Simulation at a time (kept in a ref, not in React state: it changes a
 * hundred times per simulated second). On every animation frame it
 *   1. advances the simulation by "real time passed x speed" ticks, never for longer than about
 *      12 ms, so the page stays responsive even at "max" speed,
 *   2. collects the engine's events (logs, sounds, grab / release ...),
 *   3. tells the stage that there is something new to draw (the canvas reads the simulation
 *      directly), and
 *   4. about 15 times per second copies the numbers the panels show (clock, score, sensors,
 *      variables) into React state.
 *
 * Before the start signal there is always a "ready" simulation with an empty program: it shows
 * the field of the chosen combination and lets the student place the robot. Pressing Start builds
 * a FRESH simulation from the blocks as they are at that moment; editing blocks afterwards does
 * not change the running match.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { loadRasterMatSampler } from '../core/mat';
import { createSimulation } from '../core/simulation';
import type {
  ButtonName,
  FinishReason,
  Game,
  MatSampler,
  Pose,
  ProbeName,
  ProbeReading,
  ProgramJson,
  RGB,
  RobotConfig,
  Scalar,
  ScoreReport,
  ScreenLabel,
  SensorSnapshot,
  ServoPort,
  SimEvent,
  Simulation,
} from '../core/types';
import { PROBE_NAMES, SERVO_PORTS } from '../core/types';
import { appendLog, describeEvent, type LogLine } from './format';
import { hasHatBlock, hasRunnableScript } from './program-file';
import { Trail } from './trail';

// =============================================================================================
// Types
// =============================================================================================

/**
 * ready    - before the start signal: the robot can be placed
 * running  - the match clock is running
 * paused   - frozen by the student (the match clock is frozen too)
 * stopped  - the student stopped the run; the field stays as it is
 * finished - the match is over (time up, "Finished" declared, or the program ended)
 */
export type RunState = 'ready' | 'running' | 'paused' | 'stopped' | 'finished';

export type Speed = 0.5 | 1 | 2 | 4 | 'max';
export const SPEEDS: Speed[] = [0.5, 1, 2, 4, 'max'];

/** Everything the panels around the stage show, copied out of the simulation ~15 times per second. */
export interface UiSnapshot {
  runState: RunState;
  /** simulated seconds since the start signal */
  time: number;
  timeLeft: number;
  score: ScoreReport;
  restarts: number;
  finishReason: FinishReason | null;
  sensors: SensorSnapshot;
  variables: Record<string, Scalar | Scalar[]>;
  leds: RGB[];
  screenLines: string[];
  screenLabels: ScreenLabel[];
  gripper: { height: number; gap: number; holding: string | null };
  servos: Record<ServoPort, number>;
  leftPower: number;
  rightPower: number;
  pose: Pose;
}

export interface UseSimulationOptions<S> {
  game: Game<S>;
  robotConfig: RobotConfig;
  /** the combination shown on the stage; a new object here resets the field */
  scenario: S;
  /** where the robot starts when the page opens (must fit the start zone) */
  initialStartPose: Pose;
  /** the blocks as they are right now; null while the editor is not ready */
  getProgram: () => ProgramJson | null;
  /** called about 10 times per second with the blocks being executed (empty when nothing runs) */
  onActiveBlocks?: (ids: string[]) => void;
}

export interface SimulationController<S> {
  /** the simulation on the stage right now (read it, do not keep it: Start and Reset replace it) */
  simRef: RefObject<Simulation<S>>;
  /** the path the robot has driven in this match */
  trail: Trail;
  /**
   * Run `listener` on every animation frame, after the simulation has been advanced.
   * `changed` is true when the picture may differ from the previous frame.
   */
  subscribeFrame: (listener: (changed: boolean) => void) => () => void;
  snapshot: UiSnapshot;
  logs: LogLine[];
  clearLogs: () => void;
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** the last legal start pose */
  startPose: Pose;
  /** true once the real mat picture is used by the floor sensors (before that: the drawn mat) */
  realMat: boolean;
  /** what the floor sensors read right now (for headless test runs that should match the stage) */
  getSampler: () => MatSampler | undefined;

  /** referee's start signal: fresh field, fresh program, clock starts. False when there is no program yet. */
  start: () => boolean;
  /** stop the run where it is (the field is not put back) */
  stop: () => void;
  pause: () => void;
  resume: () => void;
  /** rules restart: robot back to the start zone, -5 points, the clock keeps running */
  restart: () => void;
  /** the team declares "Finished" */
  declareFinished: () => void;
  /** put the field back to the start of the match */
  reset: () => void;
  /** place the robot before the start; false when it would not be completely inside the start zone */
  setStartPose: (pose: Pose) => boolean;
  setButton: (name: ButtonName, down: boolean) => void;
}

// =============================================================================================
// Helpers
// =============================================================================================

const EMPTY_PROGRAM: ProgramJson = {};

/** Longest stretch of real time one frame is allowed to make up for (after a hidden tab, a long task ...). */
const MAX_FRAME_SECONDS = 0.1;
/** Longest time one frame may spend simulating, in milliseconds. */
const FRAME_BUDGET_MS = 12;
/** Ticks simulated between two looks at the clock / two points of the trail. */
const TICKS_PER_CHUNK = 2;
/** Minimum time between two updates of the panels (about 15 per second). */
const UI_INTERVAL_MS = 66;
/** Minimum time between two updates of the block highlighting (about 10 per second). */
const HIGHLIGHT_INTERVAL_MS = 100;

function copyProbe(p: ProbeReading): ProbeReading {
  return { rgb: { ...p.rgb }, light: p.light, gray: p.gray, onLine: p.onLine, color: p.color };
}

function takeSnapshot<S>(sim: Simulation<S>, runState: RunState): UiSnapshot {
  const robot = sim.world.robot;
  const sensors = sim.readSensors();
  const probes = {} as Record<ProbeName, ProbeReading>;
  for (const name of PROBE_NAMES) probes[name] = copyProbe(sensors.probes[name]);
  const servos = {} as Record<ServoPort, number>;
  for (const port of SERVO_PORTS) servos[port] = robot.servos[port].angle;
  return {
    runState,
    time: sim.world.time,
    timeLeft: sim.timeLeft,
    score: sim.score(),
    restarts: sim.restarts,
    finishReason: sim.finishReason,
    sensors: { ...sensors, probes },
    variables: sim.vm.variables(),
    leds: robot.leds.map((led) => ({ ...led })),
    screenLines: [...robot.screen.lines],
    screenLabels: robot.screen.labels.map((label) => ({ ...label })),
    gripper: { ...robot.gripper },
    servos,
    leftPower: robot.left.power,
    rightPower: robot.right.power,
    pose: { ...robot.pose },
  };
}

// =============================================================================================
// The hook
// =============================================================================================

export function useSimulation<S>(options: UseSimulationOptions<S>): SimulationController<S> {
  const { game, robotConfig, scenario } = options;

  // the latest callbacks, readable from the animation loop without restarting it
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const samplerRef = useRef<MatSampler | undefined>(undefined);
  const scenarioRef = useRef(scenario);
  const startPoseRef = useRef<Pose>(options.initialStartPose);
  const runStateRef = useRef<RunState>('ready');
  const speedRef = useRef<Speed>(1);
  const soundRef = useRef(true);
  const audioRef = useRef<AudioContext | null>(null);

  const build = useCallback(
    (program: ProgramJson, forScenario: S, pose: Pose): Simulation<S> =>
      createSimulation({ game, scenario: forScenario, robotConfig, program, startPose: pose, sampler: samplerRef.current }),
    [game, robotConfig],
  );

  const simRef = useRef<Simulation<S>>(null as unknown as Simulation<S>);
  if (simRef.current === null) simRef.current = build(EMPTY_PROGRAM, scenario, options.initialStartPose);

  const [trail] = useState(() => new Trail());
  const [snapshot, setSnapshot] = useState<UiSnapshot>(() => takeSnapshot(simRef.current, 'ready'));
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [speed, setSpeedState] = useState<Speed>(1);
  const [soundOn, setSoundState] = useState(true);
  const [startPose, setStartPoseState] = useState<Pose>(options.initialStartPose);
  const [realMat, setRealMat] = useState(false);

  // things the animation loop keeps between frames
  const logsRef = useRef<LogLine[]>([]);
  const logsChangedRef = useRef(false);
  const changedRef = useRef(true);
  const tickDebtRef = useRef(0);
  const listenersRef = useRef(new Set<(changed: boolean) => void>());
  const publishNowRef = useRef(false);

  const addLog = useCallback((entry: Omit<LogLine, 'n' | 'count'>) => {
    logsRef.current = appendLog(logsRef.current, entry);
    logsChangedRef.current = true;
  }, []);

  /** Copy the simulation's numbers into React state right away (used after every button press). */
  const publish = useCallback(() => {
    setSnapshot(takeSnapshot(simRef.current, runStateRef.current));
    if (logsChangedRef.current) {
      logsChangedRef.current = false;
      setLogs(logsRef.current);
    }
    changedRef.current = true;
  }, []);

  const playTone = useCallback((frequency: number, seconds: number) => {
    const speedNow = speedRef.current;
    if (!soundRef.current || speedNow === 'max' || speedNow > 2) return;
    if (!Number.isFinite(frequency) || !Number.isFinite(seconds) || seconds <= 0) return;
    try {
      const AudioCtor = window.AudioContext;
      if (!AudioCtor) return;
      const audio = audioRef.current ?? new AudioCtor();
      audioRef.current = audio;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = Math.max(40, Math.min(8000, frequency));
      gain.gain.value = 0.035;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + Math.min(3, seconds / speedNow));
    } catch {
      // no sound on this device: the program still runs
    }
  }, []);

  const handleEvents = useCallback(
    (events: SimEvent[]) => {
      for (const event of events) {
        if (event.type === 'tone') {
          playTone(event.frequency, event.seconds);
          continue;
        }
        if (event.type === 'restart') trail.breakLine();
        const line = describeEvent(event);
        if (line) addLog(line);
      }
    },
    [addLog, playTone, trail],
  );

  // ------------------------------------------------------------------ the animation loop
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastUi = 0;
    let lastHighlight = 0;
    let highlighted = false;

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const sim = simRef.current;
      const elapsed = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
      last = now;

      if (runStateRef.current === 'running') {
        if (sim.status === 'running') {
          const currentSpeed = speedRef.current;
          let wanted: number;
          if (currentSpeed === 'max') {
            wanted = Infinity;
          } else {
            tickDebtRef.current += (elapsed * currentSpeed) / sim.dt;
            wanted = Math.floor(tickDebtRef.current);
            tickDebtRef.current -= wanted;
          }
          const deadline = performance.now() + FRAME_BUDGET_MS;
          let done = 0;
          while (done < wanted && sim.status === 'running') {
            const n = Math.min(TICKS_PER_CHUNK, wanted - done);
            sim.step(n);
            done += n;
            const p = sim.world.robot.pose;
            trail.add(p.x, p.y);
            if (performance.now() >= deadline) {
              // too slow to keep up: forget the backlog instead of freezing the page
              tickDebtRef.current = 0;
              break;
            }
          }
          if (done > 0) changedRef.current = true;
        }
        handleEvents(sim.drainEvents());
        if (sim.status === 'finished') {
          runStateRef.current = 'finished';
          publishNowRef.current = true;
        }
      }

      // block highlighting, about 10 times per second
      const running = runStateRef.current === 'running';
      if (running && now - lastHighlight >= HIGHLIGHT_INTERVAL_MS) {
        lastHighlight = now;
        highlighted = true;
        optionsRef.current.onActiveBlocks?.(sim.vm.activeBlockIds());
      } else if (highlighted && runStateRef.current !== 'running' && runStateRef.current !== 'paused') {
        highlighted = false;
        optionsRef.current.onActiveBlocks?.([]);
      }

      // the panels, about 15 times per second
      if (publishNowRef.current || (running && now - lastUi >= UI_INTERVAL_MS)) {
        publishNowRef.current = false;
        lastUi = now;
        setSnapshot(takeSnapshot(sim, runStateRef.current));
        if (logsChangedRef.current) {
          logsChangedRef.current = false;
          setLogs(logsRef.current);
        }
      }

      const changed = changedRef.current;
      changedRef.current = false;
      for (const listener of listenersRef.current) listener(changed);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [handleEvents, trail]);

  useEffect(
    () => () => {
      void audioRef.current?.close().catch(() => undefined);
      audioRef.current = null;
    },
    [],
  );

  // ------------------------------------------------------------------ commands
  const reset = useCallback(() => {
    const sim = build(EMPTY_PROGRAM, scenarioRef.current, startPoseRef.current);
    sim.drainEvents();
    simRef.current = sim;
    runStateRef.current = 'ready';
    tickDebtRef.current = 0;
    trail.clear();
    publish();
  }, [build, publish, trail]);

  const start = useCallback((): boolean => {
    const program = optionsRef.current.getProgram();
    if (!program) return false;
    const pose = startPoseRef.current;
    const sim = build(program, scenarioRef.current, pose);
    simRef.current = sim;
    trail.clear();
    trail.add(pose.x, pose.y);
    tickDebtRef.current = 0;

    logsRef.current = [];
    addLog({ time: 0, level: 'info', text: `Start! Combination ${game.encodeScenario(scenarioRef.current)}.` });
    if (!hasHatBlock(program)) {
      addLog({
        time: 0,
        level: 'warn',
        text: 'Nothing will happen: the program has no yellow "when CyberPi starts up" block to begin with.',
      });
    } else if (!hasRunnableScript(program)) {
      addLog({
        time: 0,
        level: 'warn',
        text: 'Nothing will happen: no block is snapped under a yellow "when ..." block yet.',
      });
    }
    handleEvents(sim.drainEvents());

    sim.start();
    runStateRef.current = 'running';
    publish();
    return true;
  }, [addLog, build, game, handleEvents, publish, trail]);

  const stop = useCallback(() => {
    if (runStateRef.current !== 'running' && runStateRef.current !== 'paused') return;
    runStateRef.current = 'stopped';
    addLog({ time: simRef.current.world.time, level: 'info', text: 'Stopped by you. Press Start to try again.' });
    publish();
  }, [addLog, publish]);

  const pause = useCallback(() => {
    if (runStateRef.current !== 'running') return;
    runStateRef.current = 'paused';
    publish();
  }, [publish]);

  const resume = useCallback(() => {
    if (runStateRef.current !== 'paused') return;
    runStateRef.current = 'running';
    tickDebtRef.current = 0;
    publish();
  }, [publish]);

  const restart = useCallback(() => {
    if (runStateRef.current !== 'running' && runStateRef.current !== 'paused') return;
    const sim = simRef.current;
    sim.restart();
    handleEvents(sim.drainEvents());
    const p = sim.world.robot.pose;
    trail.add(p.x, p.y);
    runStateRef.current = 'running';
    tickDebtRef.current = 0;
    publish();
  }, [handleEvents, publish, trail]);

  const declareFinished = useCallback(() => {
    if (runStateRef.current !== 'running' && runStateRef.current !== 'paused') return;
    const sim = simRef.current;
    sim.declareFinished();
    handleEvents(sim.drainEvents());
    runStateRef.current = sim.status === 'finished' ? 'finished' : 'stopped';
    publish();
  }, [handleEvents, publish]);

  const setStartPose = useCallback(
    (pose: Pose): boolean => {
      if (runStateRef.current !== 'ready') return false;
      const sim = simRef.current;
      if (!sim.setStartPose(pose)) return false;
      const placed = { ...sim.world.robot.pose };
      startPoseRef.current = placed;
      setStartPoseState(placed);
      publish();
      return true;
    },
    [publish],
  );

  const setButton = useCallback((name: ButtonName, down: boolean) => {
    simRef.current.setButton(name, down);
  }, []);

  const setSpeed = useCallback((next: Speed) => {
    speedRef.current = next;
    tickDebtRef.current = 0;
    setSpeedState(next);
  }, []);

  const setSoundOn = useCallback((on: boolean) => {
    soundRef.current = on;
    setSoundState(on);
  }, []);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    logsChangedRef.current = false;
    setLogs([]);
  }, []);

  const subscribeFrame = useCallback((listener: (changed: boolean) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getSampler = useCallback(() => samplerRef.current, []);

  // ------------------------------------------------------------------ reactions
  // a new combination puts the field back to the start
  useEffect(() => {
    if (scenarioRef.current === scenario) return;
    scenarioRef.current = scenario;
    reset();
  }, [scenario, reset]);

  // the floor sensors read the real mat picture as soon as it has loaded
  useEffect(() => {
    let cancelled = false;
    loadRasterMatSampler(game.mat.sensorImageUrl, game.mat.width, game.mat.height, game.mat.vector.outside)
      .then((sampler) => {
        if (cancelled) return;
        samplerRef.current = sampler;
        setRealMat(true);
        // a match that is already running keeps the mat it started with
        if (runStateRef.current === 'ready') reset();
      })
      .catch(() => {
        if (cancelled) return;
        addLog({
          time: 0,
          level: 'warn',
          text: 'The mat picture could not be loaded: the floor sensors use the simplified drawing of the mat.',
        });
        publishNowRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [addLog, game, reset]);

  return {
    simRef,
    trail,
    subscribeFrame,
    snapshot,
    logs,
    clearLogs,
    speed,
    setSpeed,
    soundOn,
    setSoundOn,
    startPose,
    realMat,
    getSampler,
    start,
    stop,
    pause,
    resume,
    restart,
    declareFinished,
    reset,
    setStartPose,
    setButton,
  };
}
