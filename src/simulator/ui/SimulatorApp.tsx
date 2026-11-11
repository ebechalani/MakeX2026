'use client';

/**
 * The simulator screen: block workspace on the left, stage with its controls and panels on the
 * right (stacked on narrow screens). It works for any Game; what is special about one category
 * (its examples, rules, combination editor) is passed in as props - see
 * ./fire-rescue/FireRescueSimulator.tsx.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { DEG } from '../core/geometry';
import type { Game, Pose, ProgramJson, RobotConfig, Simulation } from '../core/types';
import { BatchDialog, type BatchPreset } from './BatchDialog';
import { BlocklyEditor, type BlocklyEditorHandle, type EditorStatus } from './BlocklyEditor';
import { CombinationPanel } from './CombinationPanel';
import { ConsolePanel } from './ConsolePanel';
import { ControlBar } from './ControlBar';
import { CyberPiPanel, HoldButton } from './CyberPiPanel';
import { EditorToolbar, type ExampleProgram } from './EditorToolbar';
import { formatNumber } from './format';
import { CentreIcon, HomeIcon, RotateLeftIcon, RotateRightIcon, RulesIcon, SensorsIcon, TestIcon, TrailIcon, ZonesIcon } from './icons';
import { blankProgram, hasRunnableScript, parseProgramFile, programFileName, serializeProgramFile } from './program-file';
import type { StageOptions } from './render';
import { ScoreSheet, StatusLine } from './ScoreSheet';
import { SensorDashboard } from './SensorDashboard';
import { StageCanvas } from './StageCanvas';
import { centredPose, headingDegrees, isPose, poseFits, rotatedPose } from './start-pose';
import { isRecord, loadJson, saveJson, storageKey } from './storage';
import { SPEEDS, useSimulation, type Speed } from './useSimulation';
import { button, Section, toggleClass, usePopover } from './widgets';

/** Folder (in /public) with Blockly's own pictures. */
const BLOCKLY_MEDIA = '/simulator/blockly-media/';

export interface RulesSection {
  title: string;
  items: string[];
}

export interface SimulatorAppProps<S> {
  game: Game<S>;
  robotConfig: RobotConfig;
  /** short name of the category for the header, e.g. "Fire Rescue" */
  title: string;
  /** what the start zone is called in this category, e.g. "Fire Station" */
  startZoneName: string;
  examples: ExampleProgram[];
  rules: RulesSection[];
  /** where the robot stands when nothing was saved (must fit the start zone) */
  initialStartPose: Pose;
  /** the category's own editor for a combination */
  renderCombinationEditor: (scenario: S, onChange: (next: S) => void) => ReactNode;
  batchPresets?: BatchPreset<S>[];
}

type SectionId = 'score' | 'combination' | 'sensors' | 'cyberpi' | 'console';

const DEFAULT_OPEN: Record<SectionId, boolean> = {
  score: false,
  combination: true,
  sensors: false,
  cyberpi: false,
  console: false,
};

const DEFAULT_VIEW: StageOptions = { overlays: false, sensors: true, trail: true };

const ROTATE_STEPS = [1, 15, 90] as const;

interface Notice {
  text: string;
  tone: 'info' | 'error';
}

/** What is remembered between visits (besides the blocks, which the editor saves itself). */
interface SavedSettings<S> {
  scenario: S;
  startPose: Pose;
  view: StageOptions;
  open: Record<SectionId, boolean>;
  speed: Speed;
  sound: boolean;
  rotateStep: number;
}

function readSettings<S>(game: Game<S>, robotConfig: RobotConfig, fallbackPose: Pose): SavedSettings<S> {
  const raw = loadJson(storageKey(game.id, 'settings'), isRecord) ?? {};
  const scenario = (typeof raw.scenario === 'string' ? game.decodeScenario(raw.scenario) : null) ?? game.defaultScenario();
  const safeFallback = poseFits(robotConfig, game.startZone, fallbackPose) ? fallbackPose : game.defaultStartPose;
  const startPose = isPose(raw.startPose) && poseFits(robotConfig, game.startZone, raw.startPose) ? raw.startPose : safeFallback;
  const view = { ...DEFAULT_VIEW };
  if (isRecord(raw.view)) {
    for (const key of ['overlays', 'sensors', 'trail'] as const) {
      if (typeof raw.view[key] === 'boolean') view[key] = raw.view[key];
    }
  }
  const open = { ...DEFAULT_OPEN };
  if (isRecord(raw.open)) {
    for (const key of Object.keys(DEFAULT_OPEN) as SectionId[]) {
      if (typeof raw.open[key] === 'boolean') open[key] = raw.open[key];
    }
  }
  const speed = SPEEDS.find((s) => s === raw.speed) ?? 1;
  const rotateStep = ROTATE_STEPS.find((s) => s === raw.rotateStep) ?? 90;
  return { scenario, startPose, view, open, speed, sound: raw.sound !== false, rotateStep };
}

export function SimulatorApp<S>(props: SimulatorAppProps<S>) {
  const { game, robotConfig, startZoneName } = props;

  const [saved] = useState(() => readSettings(game, robotConfig, props.initialStartPose));
  const [scenario, setScenario] = useState<S>(saved.scenario);
  const [view, setView] = useState<StageOptions>(saved.view);
  const [open, setOpen] = useState<Record<SectionId, boolean>>(saved.open);
  const [rotateStep, setRotateStep] = useState<number>(saved.rotateStep);
  const [ghost, setGhost] = useState<Pose | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [editorStatus, setEditorStatus] = useState<EditorStatus>({ canUndo: false, canRedo: false, blocks: 0 });
  const rules = usePopover<HTMLDivElement>();

  // ------------------------------------------------------------------ the block editor
  const editorRef = useRef<BlocklyEditorHandle | null>(null);
  const onEditorReady = useCallback((handle: BlocklyEditorHandle | null) => {
    editorRef.current = handle;
    setEditorReady(handle !== null);
  }, []);
  const getProgram = useCallback((): ProgramJson | null => editorRef.current?.getProgram() ?? null, []);
  /**
   * True when the workspace was replaced (New, Examples, Open) while a match was on: the robot
   * still runs the program it was started with, which is no longer the one on screen. Blocks
   * of the two programs can carry the same ids, so until the next Start nothing lights up -
   * better than lighting up blocks the robot is not running.
   */
  const replacedDuringMatch = useRef(false);
  const highlightBlocks = useCallback((ids: string[]) => editorRef.current?.highlight(replacedDuringMatch.current ? [] : ids), []);

  // ------------------------------------------------------------------ the simulation
  const sim = useSimulation<S>({
    game,
    robotConfig,
    scenario,
    initialStartPose: saved.startPose,
    getProgram,
    onActiveBlocks: highlightBlocks,
  });
  const { snapshot, setSpeed, setSoundOn, setStartPose } = sim;
  const runState = snapshot.runState;
  const placing = runState === 'ready';
  const matchOn = runState === 'running' || runState === 'paused';

  // apply the remembered speed and sound once
  useEffect(() => {
    setSpeed(saved.speed);
    setSoundOn(saved.sound);
  }, [saved, setSoundOn, setSpeed]);

  // remember the settings for the next visit
  useEffect(() => {
    saveJson(storageKey(game.id, 'settings'), {
      scenario: game.encodeScenario(scenario),
      startPose: sim.startPose,
      view,
      open,
      speed: sim.speed,
      sound: sim.soundOn,
      rotateStep,
    });
  }, [game, scenario, sim.startPose, view, open, sim.speed, sim.soundOn, rotateStep]);

  // ------------------------------------------------------------------ small messages at the bottom of the screen
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ text, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), tone === 'error' ? 6000 : 3500);
  }, []);
  const hush = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(null);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  // ------------------------------------------------------------------ placing the robot
  const notAllowed = `The robot must be completely inside the ${startZoneName}.`;

  const onPlace = useCallback(
    (pose: Pose, phase: 'move' | 'end') => {
      if (setStartPose(pose)) setGhost(null);
      // while dragging, show where the robot would be; on release it snaps back to the last allowed place
      else setGhost(phase === 'move' ? pose : null);
    },
    [setStartPose],
  );

  const ghostRef = useRef<Pose | null>(null);
  const startPoseRef = useRef(sim.startPose);
  useEffect(() => {
    ghostRef.current = ghost;
    startPoseRef.current = sim.startPose;
  });

  const onRotate = useCallback(
    (degrees: number) => {
      const from = ghostRef.current ?? startPoseRef.current;
      const result = rotatedPose(robotConfig, game.startZone, from, from.heading + degrees * DEG);
      if (result.legal && setStartPose(result.pose)) setGhost(null);
      else setGhost(result.pose);
    },
    [game, robotConfig, setStartPose],
  );

  const centreRobot = () => {
    const from = ghost ?? sim.startPose;
    const pose = centredPose(robotConfig, game.startZone, from.heading);
    if (setStartPose(pose)) setGhost(null);
    else say(`${notAllowed} It does not fit at this angle.`, 'error');
  };

  const changeScenario = useCallback((next: S) => {
    setGhost(null);
    setScenario(next);
  }, []);

  // ------------------------------------------------------------------ match buttons
  const start = () => {
    setGhost(null);
    if (!sim.start()) {
      say('The block editor is still loading. Try again in a moment.', 'error');
      return;
    }
    replacedDuringMatch.current = false;
    // a program with nothing under its yellow block ends in the same moment: say why
    const program = getProgram();
    if (program && !hasRunnableScript(program)) {
      say('Nothing to run yet: snap blocks under the yellow "when CyberPi starts up" block, or open one of the Examples.');
    }
  };
  const reset = () => {
    setGhost(null);
    sim.reset();
  };

  // the first problem of a run opens the console, so that it is not missed
  const errorCount = useMemo(() => sim.logs.filter((line) => line.level === 'error').length, [sim.logs]);
  const hadErrors = useRef(false);
  useEffect(() => {
    if (errorCount > 0 && !hadErrors.current) setOpen((o) => ({ ...o, console: true }));
    hadErrors.current = errorCount > 0;
  }, [errorCount]);

  // ------------------------------------------------------------------ program buttons
  const replaceProgram = (program: ProgramJson, what: string): boolean => {
    const editor = editorRef.current;
    if (!editor) return false;
    if (editor.blockCount() > 1 && !window.confirm(`Replace the blocks in your workspace with ${what}?\n(You can get them back with Undo.)`)) {
      return false;
    }
    if (!editor.loadProgram(program)) {
      say('This program could not be shown. Your blocks were not changed.', 'error');
      return false;
    }
    if (matchOn) replacedDuringMatch.current = true;
    return true;
  };

  const onNew = () => {
    replaceProgram(blankProgram(), 'a new, empty program');
  };

  const onExample = (example: ExampleProgram) => {
    if (replaceProgram(example.program, `the example "${example.title}"`)) say(`Example loaded: ${example.title}. Press Start to watch it.`);
  };

  const onOpenFile = (text: string, fileName: string) => {
    const parsed = parseProgramFile(text);
    if (!parsed.ok) {
      say(parsed.error, 'error');
      return;
    }
    if (replaceProgram(parsed.program, `the program from "${fileName}"`)) say(`Opened ${fileName}.`);
  };

  const onSave = () => {
    const program = editorRef.current?.getProgram();
    if (!program) return;
    const blob = new Blob([serializeProgramFile(game.id, program)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = programFileName(game.id);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('Program saved to your downloads.');
  };

  const selectBlock = useCallback(
    (blockId: string) => {
      if (!editorRef.current?.selectBlock(blockId)) say('That block is no longer in your workspace.', 'error');
    },
    [say],
  );

  // ------------------------------------------------------------------ derived texts
  const overlays = useMemo(() => game.overlays(scenario), [game, scenario]);
  const missions = snapshot.score.lines.filter((line) => line.max > 0 && line.id !== 'bonus');
  const missionsDone = missions.filter((line) => line.ok).length;
  const shownPose = ghost ?? sim.startPose;
  const toggleSection = (id: SectionId) => (value: boolean) => setOpen((o) => ({ ...o, [id]: value }));

  /** Open the score sheet and bring it into view. */
  const scoreSheetRef = useRef<HTMLDivElement>(null);
  const showScoreSheet = () => {
    setOpen((o) => ({ ...o, score: true }));
    requestAnimationFrame(() => scoreSheetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const toggleView = (key: keyof StageOptions) => () => setView((v) => ({ ...v, [key]: !v[key] }));

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 text-slate-900 lg:h-dvh">
      {/* ================================================================ header */}
      <header className="relative z-30 flex h-12 shrink-0 items-center gap-2 bg-[#0a0f1e] px-3 text-white">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          aria-label="Back to the MakeX home page"
        >
          <HomeIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Home</span>
        </Link>
        <span className="h-5 w-px bg-white/20" aria-hidden="true" />
        {/* on a phone there is only room for the name of the category */}
        <h1 className="min-w-0 truncate text-sm font-bold sm:text-base">
          <span className="max-sm:hidden">mBot2 Simulator </span>
          <span className="font-medium text-sky-300">
            <span className="max-sm:hidden">- </span>
            {props.title}
          </span>
        </h1>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              hush();
              setBatchOpen(true);
            }}
            disabled={!editorReady}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-sm font-semibold hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40"
            title="Run your program on many starting combinations at once"
          >
            <TestIcon className="h-4 w-4" />
            <span className="hidden md:inline">Test on many combinations</span>
            <span className="md:hidden">Test</span>
          </button>
          <div className="relative" ref={rules.ref}>
            <button
              type="button"
              onClick={() => rules.setOpen(!rules.open)}
              aria-expanded={rules.open}
              aria-haspopup="true"
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-sm font-semibold hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <RulesIcon className="h-4 w-4" />
              Rules
            </button>
            {rules.open && (
              <div
                role="region"
                aria-label="Rules in short"
                className="absolute right-0 top-full z-40 mt-2 max-h-[80dvh] w-[min(30rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-2xl"
              >
                <p className="text-base font-bold text-slate-900">{props.title}: the rules in short</p>
                {props.rules.map((section) => (
                  <div key={section.title} className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-sky-700">{section.title}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-snug">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ============================================================== blocks */}
        {/* (side by side, the blocks get all the width the stage column does not need: see .mbot2-stage-column in simulator.css) */}
        <section aria-label="Your program" className="relative flex h-[72dvh] min-h-[26rem] flex-col border-b border-slate-300 bg-white lg:h-auto lg:min-h-0 lg:min-w-0 lg:flex-1 lg:border-b-0 lg:border-r">
          <EditorToolbar
            ready={editorReady}
            canUndo={editorStatus.canUndo}
            canRedo={editorStatus.canRedo}
            blocks={editorStatus.blocks}
            examples={props.examples}
            onNew={onNew}
            onExample={onExample}
            onOpenFile={onOpenFile}
            onSave={onSave}
            onUndo={() => editorRef.current?.undo()}
            onRedo={() => editorRef.current?.redo()}
          />
          <div className="relative isolate min-h-0 flex-1">
            <BlocklyEditor
              storageKey={storageKey(game.id, 'workspace')}
              initialProgram={blankProgram}
              mediaPath={BLOCKLY_MEDIA}
              onReady={onEditorReady}
              onStatus={setEditorStatus}
            />
            {/* An empty workspace says how to begin. The note lies under the open block palette
                (which has z-index 20) and lets clicks and drags through; it goes away with the
                first block that is added. Its left edge clears the list of block groups. */}
            {editorReady && editorStatus.blocks <= 1 && (
              <p className="pointer-events-none absolute left-[10.75rem] right-10 top-28 z-10 max-w-sm text-sm leading-relaxed text-slate-500">
                <span className="font-bold text-slate-700">Build your program here.</span> Click a group on the left (try{' '}
                <span className="font-semibold text-slate-700">mBot2 Chassis</span>), drag a block out and snap it under the yellow block. Then press{' '}
                <span className="font-semibold text-slate-700">Start</span>. Or open one of the <span className="font-semibold text-slate-700">Examples</span> to see how
                it is done.
              </p>
            )}
          </div>
        </section>

        {/* ============================================================== stage */}
        <section aria-label="Stage" className="mbot2-stage-column relative flex min-h-0 flex-col gap-2 p-3 lg:shrink-0 lg:overflow-y-auto">
          <ControlBar
            runState={runState}
            canStart={editorReady}
            timeLeft={snapshot.timeLeft}
            score={snapshot.score}
            restartPenalty={game.restartPenalty}
            speed={sim.speed}
            onSpeed={sim.setSpeed}
            onStart={start}
            onStop={sim.stop}
            onPause={sim.pause}
            onResume={sim.resume}
            onRestart={sim.restart}
            onFinished={sim.declareFinished}
            onReset={reset}
          />

          <StatusLine
            runState={runState}
            finishReason={snapshot.finishReason}
            score={snapshot.score}
            time={snapshot.time}
            restarts={snapshot.restarts}
            restartPenalty={game.restartPenalty}
            readyHint={`Ready. Drag the robot inside the ${startZoneName}; turn it with the buttons below the mat.`}
            placingProblem={placing && ghost ? `Not allowed: ${notAllowed.charAt(0).toLowerCase()}${notAllowed.slice(1)} It stays where it was.` : null}
            onShowSheet={showScoreSheet}
          />

          {/* as large as fits under the controls without scrolling (the width of the column follows this size: .mbot2-stage-column) */}
          <div className="mx-auto aspect-square w-full" style={{ maxWidth: 'max(17rem, min(100%, calc(100dvh - 17.75rem)))' }}>
            <StageCanvas
              simRef={sim.simRef as RefObject<Simulation<unknown>>}
              trail={sim.trail}
              subscribeFrame={sim.subscribeFrame}
              options={view}
              overlays={overlays}
              placing={placing}
              ghost={placing ? ghost : null}
              onPlace={onPlace}
              onRotate={onRotate}
            />
          </div>

          {/* what to show on the stage, and where the robot starts */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5" role="group" aria-label="Show on the stage">
              <button type="button" aria-pressed={view.overlays} onClick={toggleView('overlays')} className={toggleClass(view.overlays)} title="Colour the zones of this combination: start, people, water squares, tower areas">
                <ZonesIcon className="h-4 w-4" />
                Zones
              </button>
              <button type="button" aria-pressed={view.sensors} onClick={toggleView('sensors')} className={toggleClass(view.sensors)} title="Show what the line sensor and the ultrasonic sensor see">
                <SensorsIcon className="h-4 w-4" />
                Sensors
              </button>
              <button type="button" aria-pressed={view.trail} onClick={toggleView('trail')} className={toggleClass(view.trail)} title="Draw the path the robot has driven">
                <TrailIcon className="h-4 w-4" />
                Path
              </button>
            </div>

            {/* during a match the robot cannot be placed any more: its two buttons take that spot, so that
                "when button A pressed" programs can be started while watching the stage */}
            {matchOn && (
              <div className="ml-auto flex items-center gap-1.5" role="group" aria-label="CyberPi buttons">
                <span className="text-xs font-semibold text-slate-600" title="Hold a button down to press it on the robot. The joystick is in the CyberPi panel below.">
                  CyberPi
                </span>
                <HoldButton name="a" label="Button A" onButton={sim.setButton} className="h-9 w-9 rounded-full text-sm">
                  A
                </HoldButton>
                <HoldButton name="b" label="Button B" onButton={sim.setButton} className="h-9 w-9 rounded-full text-sm">
                  B
                </HoldButton>
              </div>
            )}

            <div className={matchOn ? 'hidden' : 'ml-auto flex items-center gap-1.5'} role="group" aria-label="Robot start position">
              <span className="font-mono text-xs tabular-nums text-slate-600" title="Direction the robot faces: 0° = up the mat, 90° = to the right">
                {headingDegrees(shownPose.heading)}°
              </span>
              <button type="button" onClick={() => onRotate(-rotateStep)} disabled={!placing} className={button.icon} aria-label={`Turn the robot ${rotateStep} degrees to the left`} title="Turn left (the mouse wheel on the robot turns it too)">
                <RotateLeftIcon className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => onRotate(rotateStep)} disabled={!placing} className={button.icon} aria-label={`Turn the robot ${rotateStep} degrees to the right`} title="Turn right (the mouse wheel on the robot turns it too)">
                <RotateRightIcon className="h-4 w-4" />
              </button>
              <label className="sr-only" htmlFor="rotate-step">
                Turning step
              </label>
              <select
                id="rotate-step"
                value={rotateStep}
                disabled={!placing}
                onChange={(event) => setRotateStep(Number(event.target.value))}
                className="h-9 rounded-lg border border-slate-300 bg-white px-1.5 text-xs font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-40"
                title="How far one press turns the robot"
              >
                {ROTATE_STEPS.map((step) => (
                  <option key={step} value={step}>
                    {step}°
                  </option>
                ))}
              </select>
              <button type="button" onClick={centreRobot} disabled={!placing} className={button.icon} aria-label={`Put the robot in the middle of the ${startZoneName}`} title={`Middle of the ${startZoneName}`}>
                <CentreIcon className="h-4 w-4" />
              </button>
            </div>

          </div>

          <div ref={scoreSheetRef} className="scroll-mb-3">
          <Section
            title="Score sheet"
            summary={`${snapshot.score.total} / ${snapshot.score.max} points · ${missionsDone} of ${missions.length} missions`}
            open={open.score}
            onToggle={toggleSection('score')}
          >
            <ScoreSheet score={snapshot.score} />
          </Section>
          </div>

          <Section title="Combination" summary={<span className="font-mono">{game.encodeScenario(scenario)}</span>} open={open.combination} onToggle={toggleSection('combination')}>
            <CombinationPanel game={game} scenario={scenario} onChange={changeScenario}>
              {props.renderCombinationEditor(scenario, changeScenario)}
            </CombinationPanel>
          </Section>

          <Section
            title="Sensors"
            summary={`line ${snapshot.sensors.lineStatus} · ${formatNumber(snapshot.sensors.ultrasonicCm)} cm · claw ${snapshot.sensors.frontColor === 'none' ? 'empty' : snapshot.sensors.frontColor}`}
            open={open.sensors}
            onToggle={toggleSection('sensors')}
          >
            <SensorDashboard snapshot={snapshot} robotConfig={robotConfig} />
            <p className="mt-2 text-xs text-slate-500">
              {sim.realMat
                ? 'The line sensor reads the real picture of the mat, illustrations included.'
                : 'The line sensor reads a simplified drawing of the mat (the real picture is still loading).'}
            </p>
          </Section>

          <Section title="CyberPi" summary="screen, LEDs, buttons A / B, joystick" open={open.cyberpi} onToggle={toggleSection('cyberpi')}>
            <CyberPiPanel
              lines={snapshot.screenLines}
              labels={snapshot.screenLabels}
              leds={snapshot.leds}
              onButton={sim.setButton}
              soundOn={sim.soundOn}
              onSound={sim.setSoundOn}
            />
          </Section>

          <Section
            title="Console"
            summary={
              errorCount > 0 ? (
                <span className="font-bold text-rose-700">
                  {errorCount} problem{errorCount === 1 ? '' : 's'}
                </span>
              ) : (
                `${sim.logs.length} message${sim.logs.length === 1 ? '' : 's'}`
              )
            }
            open={open.console}
            onToggle={toggleSection('console')}
          >
            <ConsolePanel logs={sim.logs} onClear={sim.clearLogs} onSelectBlock={selectBlock} />
          </Section>
        </section>
      </main>

      {/* ================================================================ floating message */}
      {/* (it lets clicks through: a message must never be in the way of a button below it) */}
      {/* (side by side, it sits at the bottom of the block workspace, where it covers no button of the stage) */}
      {notice && (
        <div className="mbot2-toast pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3">
          <p
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`max-w-xl rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${notice.tone === 'error' ? 'bg-rose-700' : 'bg-slate-900'}`}
          >
            {notice.text}
          </p>
        </div>
      )}

      {batchOpen && (
        <BatchDialog
          game={game}
          robotConfig={robotConfig}
          getProgram={getProgram}
          startPose={sim.startPose}
          getSampler={sim.getSampler}
          currentScenario={scenario}
          presets={props.batchPresets}
          onPick={(picked) => {
            setBatchOpen(false);
            changeScenario(picked);
            say('Combination loaded. Press Start to watch your program on it.');
          }}
          onClose={() => setBatchOpen(false)}
        />
      )}
    </div>
  );
}
