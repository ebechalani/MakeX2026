/**
 * The physics + sensor engine of the mBot2 simulator.
 *
 * It owns the World (robot + game elements), moves it forward in small fixed time steps and
 * answers every question the student's program asks through RobotIO (motors, servos, sensors).
 *
 * One tick (1/100 s) does, in this order:
 *   1. vm.step()      the program runs one step and sets motors / servos through RobotIO
 *   2. servos         the arm and the claw move a little; the claw may grab or let go
 *   3. wheels         the wheel speeds follow their commands (with an acceleration limit)
 *   4. drive          the robot moves; whatever it runs into is pushed, or blocks the robot
 *   5. clock + rules  the match ends on time, on "Finished", or when the program has ended
 *
 * The physics is "2.5-D": every thing is a box seen from above plus a height range. Two things
 * touch only when their footprints overlap AND their height ranges overlap. That is enough for
 * the game: fingers pass over a 50 mm tower when the arm is up, a lifted person can be carried
 * above a tower, a bucket rides on the tower it stands on.
 *
 * Nothing has speed or weight of its own ("kinematic"): the robot moves, and after every small
 * move the engine pushes apart whatever now overlaps - the robot pushes bodies, bodies push
 * bodies, the table wall pushes back. If that cannot be sorted out (things are jammed), the move
 * is simply taken back: the robot is stuck and its wheels spin, like on a real table.
 *
 * Plain TypeScript, no DOM: it runs in the browser and headless under Node.
 * Use createSimulation() from ./simulation.ts unless you want to plug in your own VM.
 */
import { boxesOverlap, makeContact, pointInBox, rayBoxDistance, type Contact } from './engine-collide';
import { fastVectorSampler, hashNoise, lineOffsetOf, lineStatusOf, makeProbeReading } from './engine-sensors';
import { clamp, DEG, makeRng, wrapAngle, type OBB } from './geometry';
import type { RobotIO } from './io';
import {
  clawAngleForGap,
  clawGapForAngle,
  initialServoAngles,
  liftAngleForHeight,
  liftHeightForAngle,
  mmPerWheelDegree,
  robotFitsInRect,
  robotShapesAt,
  widestClawGap,
} from './robot';
import {
  SERVO_PORTS,
  type Body,
  type ButtonName,
  type FinishReason,
  type Game,
  type MatSampler,
  type Pose,
  type ProbeName,
  type ProbeReading,
  type ProgramJson,
  type RGB,
  type RobotConfig,
  type RobotState,
  type ScoreReport,
  type SensorColor,
  type SensorSnapshot,
  type ServoPort,
  type ServoState,
  type SimEvent,
  type SimStatus,
  type Simulation,
  type SimulationOptions,
  type VM,
  type Wheel,
  type WheelState,
  type World,
} from './types';

/** Builds the interpreter that runs the student's program against the engine's RobotIO. */
export type VMFactory = (program: ProgramJson, io: RobotIO) => VM;

// =============================================================================================
// Tuning constants
// =============================================================================================

/** Fixed simulation time step: 100 ticks per simulated second. */
export const SIM_DT = 0.01;

/** The table continues this far (mm) around the mat; beyond it there is a wall. */
const TABLE_MARGIN = 100;
/** The robot never moves further than this (mm) between two collision checks. */
const MAX_SUBSTEP_MM = 2.5;
const MAX_SUBSTEPS = 10;
/** How many times per check the engine goes round "push, then see what that push hit". */
const RESOLVE_PASSES = 12;
/** Once the pushes of a round are all smaller than this (mm), everything counts as "apart". */
const SETTLE_TOLERANCE = 0.02;
/** Height ranges must overlap by more than this (mm) before two things can collide. */
const Z_EPS = 0.5;
/** A released object lands on a platform whose top is at most this far (mm) above its base. */
const PLATFORM_SNAP = 12;
/** A wheel that is told to stop brakes this many times harder than it accelerates. */
const BRAKE_FACTOR = 2;
/** After a 'bump' event the same contact stays quiet until it has been apart for this many ticks. */
const BUMP_QUIET_TICKS = 50;
/** Restart rule: a tower that moved less than this (mm) still counts as "has not moved". */
const HOME_TOLERANCE = 5;
/** The claw lets go once it is opened this much (mm) wider than the object it holds. */
const RELEASE_MARGIN = 1;
/** An object counts as "between the fingers" even if a finger has sunk this far (mm) into it. */
const GRIP_SLACK = 1;
/** The claw has "reached" an object when its gap is within this (mm) of the object's width. */
const GRIP_CONTACT = 0.5;
/** An object "fits between the fingers" when it leaves at least this much room (mm) on each side. */
const FINGER_PLAY = 0.5;
/** Number of rays in the ultrasonic beam. */
const ULTRASONIC_RAYS = 13;
/** The front colour sensor looks along three parallel lines this far apart (mm). */
const FRONT_EYE_SPREAD = 6;
/** Limits that keep a long batch run from filling the memory. */
const MAX_EVENTS = 4000;
const MAX_SCREEN_LINES = 30;
const MAX_SCREEN_LABELS = 50;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * "Backing": while the engine sorts out who pushes whom, it remembers for every body the
 * directions in which it cannot give way, because something is right behind it there:
 *   - SOFT backing: the robot (or a body the robot is pushing) is behind it. The body will not
 *     move back towards the robot, but another body in its way is pushed on instead.
 *   - HARD backing: the table wall (or a body that leans on the wall) is behind it. Nothing can
 *     push it further that way; whatever pushes has to yield - in the end the robot itself.
 */
const MAX_BACKINGS = 4;
const SOFT = 1;
const HARD = 2;
/** A push counts as "against a backing" when it points less than about 78 degrees away from it. */
const BACKING_COS = 0.2;
/** A body caught between two parts of the robot is pushed out by at most this much (mm) per pass. */
const MAX_SQUEEZE_OUT = 5;
/**
 * Things that cannot give way push the robot back, but never further than this (mm) in one go:
 * the robot cannot have driven deeper into them than one small step. If it would take more
 * (e.g. something is wedged between the fingers and the wall), that is a jam, not a push.
 */
const MAX_PUSH_BACK = 2 * MAX_SUBSTEP_MM;

/** Index of each Quad RGB probe in the engine's arrays (left to right). */
const PROBE_INDEX: Record<ProbeName, number> = { L2: 0, L1: 1, R1: 2, R2: 3 };

/** The parts of the robot that can touch things. */
const CHASSIS = 0;
const FINGER_LEFT = 1;
const FINGER_RIGHT = 2;
const CARRIED = 3;
const SHAPE_COUNT = 4;

/** A rotated rectangle with a height range: one colliding part of the robot. */
interface Box {
  x: number;
  y: number;
  /** half size across / along its heading */
  hw: number;
  hl: number;
  sin: number;
  cos: number;
  zmin: number;
  zmax: number;
}

const makeBox = (): Box => ({ x: 0, y: 0, hw: 0, hl: 0, sin: 0, cos: 1, zmin: 0, zmax: 0 });

// =============================================================================================
// Small helpers
// =============================================================================================

/** Replace NaN / Infinity (a program can compute anything) by 0. */
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/** Move `value` towards `target` by at most `maxStep`. */
function approach(value: number, target: number, maxStep: number): number {
  if (value < target) return Math.min(target, value + maxStep);
  return Math.max(target, value - maxStep);
}

function makeWheel(): WheelState {
  return { mode: 'stop', targetRpm: 0, rpm: 0, power: 0, angleDeg: 0 };
}

function haltWheel(w: WheelState): void {
  w.mode = 'stop';
  w.targetRpm = 0;
  w.power = 0;
}

function makeRobotState(config: RobotConfig, pose: Pose): RobotState {
  const angles = initialServoAngles(config);
  const servo = (port: ServoPort): ServoState => ({ angle: angles[port], target: angles[port] });
  const g = config.gripper;
  return {
    pose: { x: pose.x, y: pose.y, heading: pose.heading },
    left: makeWheel(),
    right: makeWheel(),
    servos: { S1: servo('S1'), S2: servo('S2'), S3: servo('S3'), S4: servo('S4') },
    gripper: {
      height: liftHeightForAngle(g, angles[g.liftServo]),
      gap: clawGapForAngle(g, angles[g.clawServo]),
      holding: null,
    },
    yawDeg: 0,
    leds: [0, 1, 2, 3, 4].map(() => ({ r: 0, g: 0, b: 0 })),
    screen: { lines: [], labels: [] },
    touching: false,
    lastUltrasonicCm: config.ultrasonic.maxRangeCm,
  };
}

// =============================================================================================
// The engine
// =============================================================================================

class EngineSimulation<S> implements Simulation<S> {
  readonly game: Game<S>;
  readonly scenario: S;
  readonly robotConfig: RobotConfig;
  readonly dt = SIM_DT;
  readonly world: World;
  readonly vm: VM;

  private readonly cfg: RobotConfig;
  private readonly robot: RobotState;
  private readonly bodies: Body[];
  private readonly sampler: MatSampler;
  private readonly io: RobotIO;
  private readonly seed: number;

  // ---- match state
  private currentStatus: SimStatus = 'ready';
  private currentFinishReason: FinishReason | null = null;
  private restartCount = 0;
  private startPose: Pose;
  private events: SimEvent[] = [];
  private readonly buttons: Record<ButtonName, boolean>;
  /** world.time at the last resetTimer() */
  private timerStart = 0;
  /** the program threw an exception and was stopped */
  private vmCrashed = false;

  // ---- drive
  private readonly mmPerDeg: number;
  /** encoder-controlled move in progress (startMotion); `done` and `total` are degrees of the faster wheel */
  private readonly motion = { active: false, leftDeg: 0, rightDeg: 0, total: 0, done: 0, speed: 0, maxSpeed: 0 };
  private readonly slip: number;
  private readonly slipBiasLeft: number;
  private readonly slipBiasRight: number;
  private readonly slipRandom: () => number;
  private readonly programRandom: () => number;
  /** the wheels moved the robot during this tick (used to decide whether a contact is a "bump") */
  private robotMoving = false;

  // ---- gripper
  private readonly servoList: ServoState[];
  private liftBlocked = false;
  private clawBlocked = false;
  /** index of the body in the claw, or -1 */
  private heldIndex = -1;
  /** where the held body sits in the robot frame */
  private heldForward = 0;
  private heldTurn = 0;
  /** held body's base height minus the gripper height */
  private heldLift = 0;
  /** width of the held body between the fingers */
  private heldWidth = 0;
  /** something was let go or fell off its tower during this tick */
  private cameDown = false;

  // ---- collision
  private readonly shapes: Box[] = [makeBox(), makeBox(), makeBox(), makeBox()];
  private readonly shapeActive: boolean[] = [true, false, false, false];
  private readonly baseRadius: number;
  /** everything of the robot lies within this distance of its origin */
  private robotRadius: number;
  private readonly bodyRadius: Float64Array;
  /** per body: up to MAX_BACKINGS unit vectors (x, y), their kind (SOFT / HARD) and how many are in use */
  private readonly backing: Float64Array;
  private readonly backingKind: Uint8Array;
  private readonly backingCount: Uint8Array;
  /** bodies that moved and still have to be checked against the other bodies */
  private readonly dirty: Uint8Array;
  private unsettled = false;
  private bodiesShifted = false;
  /** counts every time a body is moved, so that a settling pass can tell whether it still moved something */
  private shiftCount = 0;
  /**
   * Some bodies were still nudged by a hair in the last settling pass. That is close enough to
   * count as settled, but they stay marked in `dirty`: the next round checks them against their
   * neighbours. (Otherwise many tiny nudges could add up to one body creeping into another.)
   */
  private leftover = false;
  private readonly lastBump: Int32Array;
  private lastWallBump = -BUMP_QUIET_TICKS - 1;
  private readonly indexById = new Map<string, number>();
  private readonly contact: Contact = makeContact();
  /** saveState(): x, y, angle of every body, and the robot's pose */
  private readonly savedBodies: Float64Array;
  private readonly savedPose: Pose = { x: 0, y: 0, heading: 0 };
  private readonly savedDirty: Uint8Array;
  private savedLeftover = false;
  private readonly tableMinX: number;
  private readonly tableMinY: number;
  private readonly tableMaxX: number;
  private readonly tableMaxY: number;

  // ---- sensors (values are cached so that reading a sensor twice in a tick is free)
  /** grows every time the robot's pose changes */
  private poseVersion = 0;
  /** grows when the world changes outside a tick (restart, new start pose) */
  private epoch = 0;
  private readonly probeClean = new Float64Array(12);
  private probeCleanVersion = -1;
  private probeTick = -1;
  private probeReadings: ProbeReading[] = [];
  private probeStatus = 0;
  private probeOffset = 0;
  private sonarTick = -1;
  private sonarEpoch = -1;
  private sonarCm = 0;
  private readonly raySin = new Float64Array(ULTRASONIC_RAYS);
  private readonly rayCos = new Float64Array(ULTRASONIC_RAYS);
  private readonly rayDirX = new Float64Array(ULTRASONIC_RAYS);
  private readonly rayDirY = new Float64Array(ULTRASONIC_RAYS);

  constructor(opts: SimulationOptions<S>, createVM: VMFactory) {
    const cfg = opts.robotConfig;
    const g = cfg.gripper;
    this.game = opts.game;
    this.scenario = opts.scenario;
    this.robotConfig = cfg;
    this.cfg = cfg;
    this.sampler = opts.sampler ?? fastVectorSampler(opts.game.mat.vector);
    this.seed = (opts.seed ?? 1) >>> 0;
    this.mmPerDeg = mmPerWheelDegree(cfg);

    // Separate random streams, so that e.g. a program asking for random numbers does not change
    // how the wheels slip.
    this.programRandom = makeRng(this.seed ^ 0x51ed270b);
    this.slipRandom = makeRng(this.seed ^ 0x2545f491);
    this.slip = Math.max(0, finite(cfg.noise.wheelSlip));
    // each wheel is a little "too big" or "too small" for the whole match ...
    this.slipBiasLeft = 0.6 * (this.slipRandom() * 2 - 1);
    this.slipBiasRight = 0.6 * (this.slipRandom() * 2 - 1);

    this.tableMinX = -TABLE_MARGIN;
    this.tableMinY = -TABLE_MARGIN;
    this.tableMaxX = opts.game.mat.width + TABLE_MARGIN;
    this.tableMaxY = opts.game.mat.height + TABLE_MARGIN;

    // ---- game elements
    const bodies = opts.game.createBodies(opts.scenario);
    const n = bodies.length;
    this.bodies = bodies;
    this.bodyRadius = new Float64Array(n);
    this.backing = new Float64Array(n * MAX_BACKINGS * 2);
    this.backingKind = new Uint8Array(n * MAX_BACKINGS);
    this.backingCount = new Uint8Array(n);
    this.dirty = new Uint8Array(n);
    this.lastBump = new Int32Array(n);
    this.savedBodies = new Float64Array(3 * n);
    this.savedDirty = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      this.indexById.set(b.id, i);
      this.bodyRadius[i] = Math.hypot(b.w, b.l) / 2;
      this.lastBump[i] = -BUMP_QUIET_TICKS - 1;
      this.dirty[i] = 1; // check once that nothing starts inside something else
    }
    this.unsettled = n > 0;

    // ---- robot
    const start = opts.startPose ?? opts.game.defaultStartPose;
    this.startPose = { x: start.x, y: start.y, heading: start.heading };
    this.robot = makeRobotState(cfg, this.startPose);
    this.world = { time: 0, tick: 0, robot: this.robot, bodies };
    this.servoList = SERVO_PORTS.map((port) => this.robot.servos[port]);
    this.buttons = { a: false, b: false, up: false, down: false, left: false, right: false, middle: false };

    const chassis = this.shapes[CHASSIS];
    chassis.hw = cfg.chassisWidth / 2;
    chassis.hl = (cfg.chassisFront + cfg.chassisRear) / 2;
    chassis.zmin = 0;
    chassis.zmax = cfg.chassisHeight;
    for (const finger of [this.shapes[FINGER_LEFT], this.shapes[FINGER_RIGHT]]) {
      finger.hw = g.fingerThickness / 2;
      finger.hl = g.fingerLength / 2;
    }
    this.shapeActive[FINGER_LEFT] = g.enabled;
    this.shapeActive[FINGER_RIGHT] = g.enabled;

    const halfWidth = cfg.chassisWidth / 2;
    let radius = Math.max(Math.hypot(cfg.chassisFront, halfWidth), Math.hypot(cfg.chassisRear, halfWidth));
    if (g.enabled) {
      radius = Math.max(
        radius,
        Math.hypot(g.gripForward + g.fingerLength / 2, widestClawGap(cfg) / 2 + g.fingerThickness),
      );
    }
    this.baseRadius = radius;
    this.robotRadius = radius;

    // ultrasonic beam: a fan of rays from -halfAngle to +halfAngle
    const half = Math.max(0, finite(cfg.ultrasonic.halfAngleDeg)) * DEG;
    for (let k = 0; k < ULTRASONIC_RAYS; k++) {
      const offset = -half + (2 * half * k) / (ULTRASONIC_RAYS - 1);
      this.raySin[k] = Math.sin(offset);
      this.rayCos[k] = Math.cos(offset);
    }

    this.updateShapes();
    if (!robotFitsInRect(cfg, this.startPose, opts.game.startZone, this.robot.gripper.gap)) {
      this.pushEvent({
        type: 'log',
        level: 'warn',
        text: 'The robot is not completely inside the start zone at its start position.',
        time: 0,
      });
    }

    this.io = this.createIO();
    this.vm = createVM(opts.program, this.io);
  }

  // ===========================================================================================
  // Simulation facade
  // ===========================================================================================

  get status(): SimStatus {
    return this.currentStatus;
  }

  get finishReason(): FinishReason | null {
    return this.currentFinishReason;
  }

  get restarts(): number {
    return this.restartCount;
  }

  get timeLeft(): number {
    return Math.max(0, this.game.matchDuration - this.world.time);
  }

  start(): void {
    if (this.currentStatus !== 'ready') return;
    this.currentStatus = 'running';
    this.timerStart = this.world.time;
    this.vmCrashed = false;
    this.vm.start();
  }

  step(ticks = 1): void {
    for (let i = 0; i < ticks; i++) {
      if (this.currentStatus !== 'running') return;
      this.tick();
    }
  }

  restart(): void {
    if (this.currentStatus !== 'running') return;
    this.restartCount++;

    // the referee takes whatever the robot is carrying out of the claw ...
    const carried = this.heldIndex;
    if (carried >= 0) this.letGo();

    // ... the team puts the robot back in the start zone, exactly as it started ...
    this.resetRobot();

    // ... and the carried object goes back to where it started the match
    if (carried >= 0) this.returnHome(carried);

    // nothing may end up inside something else (a tower that was pushed into the start zone
    // is nudged out from under the robot; that can take a few rounds)
    this.dirty.fill(1);
    this.unsettled = this.bodies.length > 0;
    this.robotMoving = false;
    for (let k = 0; k < 10 && (this.unsettled || this.leftover); k++) {
      this.resolveContacts();
      if (this.bodiesShifted) this.dropUnsupported();
    }
    this.robot.touching = false;

    this.pushEvent({ type: 'restart', time: this.world.time });

    // the clock keeps running; the program starts again from the top
    this.vm.stopAll();
    this.vmCrashed = false;
    this.vm.start();
  }

  declareFinished(): void {
    if (this.currentStatus === 'running') this.finish('declared');
  }

  setButton(name: ButtonName, down: boolean): void {
    if (name in this.buttons) this.buttons[name] = down;
  }

  setStartPose(pose: Pose): boolean {
    if (this.currentStatus !== 'ready') return false;
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.heading)) return false;
    const next: Pose = { x: pose.x, y: pose.y, heading: wrapAngle(pose.heading) };
    if (!robotFitsInRect(this.cfg, next, this.game.startZone, this.robot.gripper.gap)) return false;
    this.startPose = next;
    const p = this.robot.pose;
    p.x = next.x;
    p.y = next.y;
    p.heading = next.heading;
    this.robot.yawDeg = 0;
    this.poseVersion++;
    this.epoch++;
    this.updateShapes();
    // if something stands where the robot was put, it is nudged aside on the first tick
    this.dirty.fill(1);
    this.unsettled = this.bodies.length > 0;
    return true;
  }

  score(): ScoreReport {
    return this.game.score({
      scenario: this.scenario,
      world: this.world,
      robotConfig: this.cfg,
      restarts: this.restartCount,
      robotShapes: this.robotShapes(),
    });
  }

  robotShapes(): OBB[] {
    return robotShapesAt(this.cfg, this.robot.pose, this.robot.gripper.gap);
  }

  readSensors(): SensorSnapshot {
    this.refreshProbes();
    const r = this.probeReadings;
    const robot = this.robot;
    return {
      probes: { L2: r[0], L1: r[1], R1: r[2], R2: r[3] },
      lineStatus: this.probeStatus,
      lineOffset: this.probeOffset,
      ultrasonicCm: this.measureUltrasonic(),
      frontColor: this.lookAtClaw(),
      yawDeg: robot.yawDeg,
      leftAngleDeg: robot.left.angleDeg,
      rightAngleDeg: robot.right.angleDeg,
      leftRpm: robot.left.rpm,
      rightRpm: robot.right.rpm,
      timer: this.world.time - this.timerStart,
    };
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ===========================================================================================
  // One tick
  // ===========================================================================================

  private tick(): void {
    const world = this.world;

    // 1. the program
    if (!this.vmCrashed) {
      try {
        this.vm.step();
      } catch (err) {
        this.vmCrashed = true;
        const message = err instanceof Error ? err.message : String(err);
        this.pushEvent({ type: 'log', level: 'error', text: `The program stopped: ${message}`, time: world.time });
        try {
          this.vm.stopAll();
        } catch {
          // the VM is already broken; there is nothing more to stop
        }
      }
    }

    // 2. - 4. the robot
    this.physicsTick();

    // 5. the clock and the end of the match
    world.tick++;
    world.time = world.tick * this.dt;
    if (world.time >= this.game.matchDuration - 1e-9) this.finish('time');
    else if ((this.vmCrashed || this.vm.idle) && this.robotAtRest()) this.finish('program-ended');
  }

  private finish(reason: FinishReason): void {
    this.currentStatus = 'finished';
    this.currentFinishReason = reason;
    try {
      this.vm.stopAll();
    } catch {
      // a broken program must not keep the match from ending
    }
    // the robot stands still from now on
    this.motion.active = false;
    haltWheel(this.robot.left);
    haltWheel(this.robot.right);
    this.robot.left.rpm = 0;
    this.robot.right.rpm = 0;
    // let anything that was just dropped or nudged come to rest before the referee looks
    this.robotMoving = false;
    for (let k = 0; k < 10 && (this.unsettled || this.leftover); k++) {
      this.resolveContacts();
      if (this.bodiesShifted) this.dropUnsupported();
    }
    this.robot.touching = false;
    this.pushEvent({ type: 'finish', reason, time: this.world.time });
  }

  /** Wheels stopped and every servo where it should be (or held up by what it grips / rests on). */
  private robotAtRest(): boolean {
    const { left, right } = this.robot;
    if (this.motion.active) return false;
    if (left.rpm !== 0 || right.rpm !== 0 || left.targetRpm !== 0 || right.targetRpm !== 0) return false;
    const g = this.cfg.gripper;
    for (let i = 0; i < SERVO_PORTS.length; i++) {
      const s = this.servoList[i];
      if (s.angle === s.target) continue;
      const port = SERVO_PORTS[i];
      if (g.enabled && port === g.liftServo && this.liftBlocked) continue;
      if (g.enabled && port === g.clawServo && this.clawBlocked) continue;
      return false;
    }
    return true;
  }

  private physicsTick(): void {
    const robot = this.robot;
    this.robotMoving = false;
    this.cameDown = false;
    robot.touching = false;
    this.moveGripper();
    // (from here on `touching` collects whether anything was pressed against during this tick)
    let touching = robot.touching;

    // how far each wheel turns during this tick (degrees)
    let leftDeg: number;
    let rightDeg: number;
    if (this.motion.active) {
      const m = this.motion;
      const before = m.done;
      const finished = this.advanceMotion();
      const part = (m.done - before) / m.total;
      leftDeg = m.leftDeg * part;
      rightDeg = m.rightDeg * part;
      robot.left.angleDeg += leftDeg;
      robot.right.angleDeg += rightDeg;
      if (finished) {
        m.active = false;
        haltWheel(robot.left);
        haltWheel(robot.right);
        robot.left.rpm = 0;
        robot.right.rpm = 0;
      } else {
        robot.left.rpm = ((m.leftDeg / m.total) * m.speed) / 6;
        robot.right.rpm = ((m.rightDeg / m.total) * m.speed) / 6;
      }
    } else {
      leftDeg = this.advanceWheel(robot.left);
      rightDeg = this.advanceWheel(robot.right);
    }

    if (leftDeg !== 0 || rightDeg !== 0) {
      // wheel rotation -> distance rolled on the mat
      let leftMm = leftDeg * this.mmPerDeg;
      let rightMm = rightDeg * this.mmPerDeg;
      if (this.slip > 0) {
        // ... and it also slips a little, differently on every tick
        leftMm *= 1 + this.slip * (this.slipBiasLeft + 0.4 * (this.slipRandom() * 2 - 1));
        rightMm *= 1 + this.slip * (this.slipBiasRight + 0.4 * (this.slipRandom() * 2 - 1));
      }
      // differential drive: the average moves the robot, the difference turns it
      const forward = (leftMm + rightMm) / 2;
      const turn = (leftMm - rightMm) / this.cfg.trackWidth;

      // move in small steps so that fast moves cannot jump over (or deep into) things
      const reach = Math.abs(forward) + Math.abs(turn) * this.robotRadius;
      const steps = reach > MAX_SUBSTEP_MM ? Math.min(MAX_SUBSTEPS, Math.ceil(reach / MAX_SUBSTEP_MM)) : 1;
      const stepForward = forward / steps;
      const stepTurn = turn / steps;
      const pose = robot.pose;
      this.robotMoving = true;
      let turned = 0;
      for (let k = 0; k < steps; k++) {
        // If everything was neatly apart before this step, the step can be taken back.
        const canUndo = !this.unsettled;
        if (canUndo) this.saveState();
        const mid = pose.heading + stepTurn / 2;
        pose.x += stepForward * Math.sin(mid);
        pose.y -= stepForward * Math.cos(mid);
        pose.heading += stepTurn;
        this.updateShapes();
        const settled = this.resolveContacts();
        if (robot.touching) touching = true;
        if (!settled && canUndo) {
          // The things in the way are jammed (against the wall or each other) and cannot give
          // way: the step is taken back. The robot is stuck, its wheels spin on the spot.
          // (The remaining small steps of this tick would end the same way.)
          this.restoreState();
          break;
        }
        if (this.bodiesShifted) this.dropUnsupported();
        turned += stepTurn;
      }
      robot.touching = touching;
      pose.heading = wrapAngle(pose.heading);
      robot.yawDeg += turned * RAD_TO_DEG; // the gyro only feels a turn that really happened
      this.poseVersion++;
    } else if (this.unsettled || this.leftover) {
      // nobody is driving, but something was dropped or squeezed: let it find its place
      this.resolveContacts();
      if (this.bodiesShifted) this.dropUnsupported();
      if (touching) robot.touching = true;
    }

    // Something came down during this tick and has not found its place yet (there was no room
    // where it landed): sort that out now, so that nothing is left inside something else, or
    // over the edge of the table, between two ticks.
    if (this.cameDown && this.unsettled) {
      touching = robot.touching;
      for (let k = 0; k < 4 && this.unsettled; k++) {
        this.resolveContacts();
        if (this.bodiesShifted) this.dropUnsupported();
      }
      if (touching) robot.touching = true;
    }
  }

  /**
   * Step 2 of a tick: the servos move the arm and the claw. Fingers push things aside; if a
   * finger presses something against the wall (or anything else that cannot give way), the servo
   * simply does not get any further on this tick.
   */
  private moveGripper(): void {
    const servos = this.servoList;
    let moving = false;
    for (let i = 0; i < servos.length; i++) {
      if (servos[i].angle !== servos[i].target) {
        moving = true;
        break;
      }
    }
    if (!moving) return;

    const g = this.cfg.gripper;
    const gripper = this.robot.gripper;
    const lift = this.robot.servos[g.liftServo];
    const claw = this.robot.servos[g.clawServo];
    const canUndo = g.enabled && !this.unsettled;
    const heldBefore = this.heldIndex;
    const heightBefore = gripper.height;
    const gapBefore = gripper.gap;
    const liftBefore = lift.angle;
    const clawBefore = claw.angle;
    if (canUndo) this.saveState();

    if (!this.updateServos()) return;
    const settled = this.resolveContacts();
    if (!settled && canUndo && this.heldIndex === heldBefore) {
      if (gripper.height !== heightBefore) {
        gripper.height = heightBefore;
        lift.angle = liftBefore;
        this.liftBlocked = true;
      }
      if (gripper.gap !== gapBefore) {
        gripper.gap = gapBefore;
        claw.angle = clawBefore;
        this.clawBlocked = true;
      }
      this.restoreState();
    } else if (this.bodiesShifted) {
      this.dropUnsupported();
    }
  }

  // ===========================================================================================
  // Wheels
  // ===========================================================================================

  /** A wheel in speed / power / stop mode: follow the commanded speed. Returns the degrees turned. */
  private advanceWheel(w: WheelState): number {
    const target = w.mode === 'stop' ? 0 : w.targetRpm;
    const before = w.rpm;
    if (before === 0 && target === 0) return 0;
    const limit = this.cfg.rpmPerSecond > 0 ? this.cfg.rpmPerSecond : Infinity;
    const maxChange = limit * this.dt * (w.mode === 'stop' ? BRAKE_FACTOR : 1);
    const after = approach(before, target, maxChange);
    w.rpm = after;
    // 1 RPM = 6 degrees per second; use the average speed over the tick
    const turned = (before + after) * 0.5 * 6 * this.dt;
    w.angleDeg += turned;
    return turned;
  }

  /**
   * Encoder-controlled move: speed up, cruise, and slow down so that the wheels stop exactly on
   * their target angles. Returns true when the move is complete.
   */
  private advanceMotion(): boolean {
    const m = this.motion;
    const dt = this.dt;
    const remaining = m.total - m.done;
    const accel = this.cfg.rpmPerSecond > 0 ? this.cfg.rpmPerSecond * 6 : Infinity; // degrees / s^2
    let speed: number;
    if (accel === Infinity) {
      speed = m.maxSpeed;
    } else {
      speed = Math.min(m.speed + accel * dt, m.maxSpeed);
      // never faster than what can still be braked away before the target
      const brakingSpeed = Math.sqrt(2 * accel * remaining);
      if (speed > brakingSpeed) speed = brakingSpeed;
      // ... but always keep creeping forward, so that the move ends
      const creep = Math.min(m.maxSpeed, accel * dt);
      if (speed < creep) speed = creep;
    }
    m.speed = speed;
    const step = speed * dt;
    if (step >= remaining - 1e-9) {
      m.done = m.total;
      return true;
    }
    m.done += step;
    return false;
  }

  private cancelMotion(): void {
    if (!this.motion.active) return;
    this.motion.active = false;
    const { left, right } = this.robot;
    if (left.mode === 'motion') haltWheel(left);
    if (right.mode === 'motion') haltWheel(right);
  }

  // ===========================================================================================
  // Servos and gripper
  // ===========================================================================================

  /** Move every servo a little towards its target. Returns true when the arm or the claw changed. */
  private updateServos(): boolean {
    const g = this.cfg.gripper;
    const maxStep = Math.max(0, this.cfg.servoSpeed) * this.dt;
    let gripperChanged = false;
    for (let i = 0; i < SERVO_PORTS.length; i++) {
      const s = this.servoList[i];
      if (s.angle === s.target) continue;
      const next = approach(s.angle, s.target, maxStep);
      const port = SERVO_PORTS[i];
      if (g.enabled && port === g.liftServo) {
        if (this.moveLift(s, next)) gripperChanged = true;
      } else if (g.enabled && port === g.clawServo) {
        if (this.moveClaw(s, next)) gripperChanged = true;
      } else {
        s.angle = next;
      }
    }
    if (gripperChanged) this.updateShapes();
    return gripperChanged;
  }

  /** The lift servo wants to go to `next`. Lowering the arm onto something stops it there. */
  private moveLift(s: ServoState, next: number): boolean {
    const g = this.cfg.gripper;
    const gripper = this.robot.gripper;
    let height = liftHeightForAngle(g, next);
    this.liftBlocked = false;
    if (height < gripper.height) {
      const floor = this.lowestArmHeight();
      if (height < floor) {
        height = Math.min(gripper.height, floor);
        next = liftAngleForHeight(g, height);
        this.liftBlocked = true;
      }
    }
    s.angle = next;
    if (height === gripper.height) return false;
    gripper.height = height;
    return true;
  }

  /** The claw servo wants to go to `next`: this is where things are grabbed and let go. */
  private moveClaw(s: ServoState, next: number): boolean {
    const g = this.cfg.gripper;
    const gripper = this.robot.gripper;
    let gap = clawGapForAngle(g, next);
    let changed = false;
    this.clawBlocked = false;

    if (this.heldIndex >= 0) {
      const fullyOpen = gap >= widestClawGap(this.cfg) - 1e-9;
      if (gap > this.heldWidth + RELEASE_MARGIN || (fullyOpen && gap > this.heldWidth)) {
        this.release();
        changed = true;
      } else if (gap < this.heldWidth) {
        // the object is in the way: the claw cannot close any further
        gap = this.heldWidth;
        next = clawAngleForGap(g, gap);
        this.clawBlocked = true;
      }
    } else if (gap < gripper.gap) {
      const candidate = this.findGrabCandidate(gripper.gap, gap);
      if (candidate >= 0) {
        // the closing fingers first turn the object until its sides lie flat against them ...
        const width = this.squareUpInClaw(candidate);
        // ... and grip it as soon as they have closed down to its width
        if (gap <= width + GRIP_CONTACT) {
          this.grab(candidate);
          changed = true;
          if (gap < this.heldWidth) {
            gap = this.heldWidth;
            next = clawAngleForGap(g, gap);
            this.clawBlocked = true;
          }
        }
      }
      if (this.heldIndex < 0 && this.clawWouldPinch(gap)) {
        // something the claw cannot grip is caught between the fingers: they stop against it
        gap = gripper.gap;
        next = s.angle;
        this.clawBlocked = true;
      }
    }

    s.angle = next;
    if (gap !== gripper.gap) {
      gripper.gap = gap;
      changed = true;
    }
    return changed;
  }

  /**
   * How low the arm can go right now: it stops when a finger, or the object in the claw, comes
   * down onto something (or when the carried object stands on the mat).
   */
  private lowestArmHeight(): number {
    const bodies = this.bodies;
    const shapes = this.shapes;
    const hit = this.contact;
    const pose = this.robot.pose;
    const fingerBottom = this.robot.gripper.height;
    const held = this.heldIndex >= 0 ? bodies[this.heldIndex] : null;
    const carried = shapes[CARRIED];
    let floor = held ? -this.heldLift : -Infinity;

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.held) continue;
      const dx = b.x - pose.x;
      const dy = b.y - pose.y;
      const far = this.robotRadius + this.bodyRadius[i];
      if (dx * dx + dy * dy > far * far) continue;
      const top = b.z + b.h;
      const hw = b.w / 2;
      const hl = b.l / 2;
      const bs = Math.sin(b.angle);
      const bc = Math.cos(b.angle);

      // something under a finger?
      if (top <= fingerBottom + Z_EPS && top > floor) {
        for (let f = FINGER_LEFT; f <= FINGER_RIGHT; f++) {
          const sh = shapes[f];
          if (boxesOverlap(sh.x, sh.y, sh.hw, sh.hl, sh.sin, sh.cos, b.x, b.y, hw, hl, bs, bc, hit)) {
            floor = top;
            break;
          }
        }
      }
      // something under the carried object?
      if (held && top <= held.z + Z_EPS && top - this.heldLift > floor) {
        if (
          boxesOverlap(carried.x, carried.y, carried.hw, carried.hl, carried.sin, carried.cos, b.x, b.y, hw, hl, bs, bc, hit)
        ) {
          floor = top - this.heldLift;
        }
      }
    }
    return floor;
  }

  /**
   * Which body would the closing claw grip? It must be grippable, at the height of the fingers,
   * between the two fingers (its centre no further along than the fingers reach), and the gap
   * must have closed down to its width. Returns the body's index or -1.
   */
  private findGrabCandidate(gapBefore: number, gapAfter: number): number {
    const g = this.cfg.gripper;
    const bodies = this.bodies;
    const pose = this.robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const fingerBottom = this.robot.gripper.height;
    const fingerTop = fingerBottom + g.fingerHeight;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.grippable || b.held) continue;
      if (fingerBottom >= b.z + b.h - Z_EPS || b.z >= fingerTop - Z_EPS) continue;
      // centre of the body in the robot frame
      const dx = b.x - pose.x;
      const dy = b.y - pose.y;
      const along = dx * s - dy * c - g.gripForward;
      const across = dx * c + dy * s;
      if (Math.abs(along) > g.fingerLength / 2) continue;
      // how wide the body is between the fingers (a turned square is wider)
      const turn = b.angle - pose.heading;
      const halfWidth = (b.w * Math.abs(Math.cos(turn)) + b.l * Math.abs(Math.sin(turn))) / 2;
      if (Math.abs(across) + halfWidth > gapBefore / 2 + GRIP_SLACK) continue; // not between the fingers
      if (gapAfter > 2 * halfWidth + GRIP_CONTACT) continue; // the fingers have not reached it yet
      const distance = along * along + across * across;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Closing fingers turn a box until its sides lie flat against them: square body i up to the
   * claw and centre it between the fingers. Returns its width between the fingers afterwards.
   */
  private squareUpInClaw(i: number): number {
    const b = this.bodies[i];
    const pose = this.robot.pose;
    const turn = wrapAngle(b.angle - pose.heading);
    const quarterTurns = Math.round(turn / (Math.PI / 2));
    const width = quarterTurns % 2 === 0 ? b.w : b.l;
    if (Math.abs(turn - quarterTurns * (Math.PI / 2)) < 1e-9) return width; // already square
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const along = (b.x - pose.x) * s - (b.y - pose.y) * c;
    b.angle = pose.heading + quarterTurns * (Math.PI / 2);
    b.x = pose.x + along * s;
    b.y = pose.y - along * c;
    this.dirty[i] = 1;
    this.unsettled = true;
    return width;
  }

  /**
   * Body i is being squeezed between the two fingers of the open (or half-closed) claw, e.g.
   * because the robot turns with a box between its fingers. If the box would fit between the
   * fingers when it stands straight, they turn it straight and centre it - so it swings round
   * with the claw instead of being squeezed out. Returns false when the body is not between
   * the fingers or is too wide for them.
   */
  private straightenBetweenFingers(i: number): boolean {
    if (this.heldIndex >= 0) return false; // the claw is full
    const b = this.bodies[i];
    const pose = this.robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const gap = this.robot.gripper.gap;
    const across = (b.x - pose.x) * c + (b.y - pose.y) * s;
    if (Math.abs(across) >= gap / 2) return false; // its middle is not between the fingers
    const quarterTurns = Math.round(wrapAngle(b.angle - pose.heading) / (Math.PI / 2));
    const width = quarterTurns % 2 === 0 ? b.w : b.l;
    if (width + 2 * FINGER_PLAY > gap) return false; // too wide: it has to be pushed out
    const along = (b.x - pose.x) * s - (b.y - pose.y) * c;
    b.angle = pose.heading + quarterTurns * (Math.PI / 2);
    b.x = pose.x + along * s;
    b.y = pose.y - along * c;
    this.dirty[i] = 1;
    this.unsettled = true;
    this.bodiesShifted = true;
    this.shiftCount++;
    return true;
  }

  /**
   * Would both fingers press into the same body if the claw closed to `gap`? Then the claw is
   * stuck on something it cannot grip (too big, not grippable, or only caught by its end).
   */
  private clawWouldPinch(gap: number): boolean {
    const g = this.cfg.gripper;
    const bodies = this.bodies;
    const hit = this.contact;
    const pose = this.robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const fingerBottom = this.robot.gripper.height;
    const fingerTop = fingerBottom + g.fingerHeight;
    // where the two fingers would be
    const f = g.gripForward;
    const r = gap / 2 + g.fingerThickness / 2;
    const hw = g.fingerThickness / 2;
    const hl = g.fingerLength / 2;
    const lx = pose.x + f * s - r * c;
    const ly = pose.y - f * c - r * s;
    const rx = pose.x + f * s + r * c;
    const ry = pose.y - f * c + r * s;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.held) continue;
      if (fingerBottom >= b.z + b.h - Z_EPS || b.z >= fingerTop - Z_EPS) continue;
      const dx = b.x - pose.x;
      const dy = b.y - pose.y;
      const far = this.robotRadius + this.bodyRadius[i];
      if (dx * dx + dy * dy > far * far) continue;
      const bs = Math.sin(b.angle);
      const bc = Math.cos(b.angle);
      if (
        boxesOverlap(lx, ly, hw, hl, s, c, b.x, b.y, b.w / 2, b.l / 2, bs, bc, hit) &&
        boxesOverlap(rx, ry, hw, hl, s, c, b.x, b.y, b.w / 2, b.l / 2, bs, bc, hit)
      ) {
        return true;
      }
    }
    return false;
  }

  /** The claw closes on body i: from now on it moves with the robot and rises / sinks with the arm. */
  private grab(i: number): void {
    const b = this.bodies[i];
    const pose = this.robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const quarterTurns = Math.round(wrapAngle(b.angle - pose.heading) / (Math.PI / 2));
    this.heldIndex = i;
    this.heldForward = (b.x - pose.x) * s - (b.y - pose.y) * c;
    this.heldTurn = quarterTurns * (Math.PI / 2);
    this.heldLift = b.z - this.robot.gripper.height;
    this.heldWidth = quarterTurns % 2 === 0 ? b.w : b.l;
    b.held = true;
    b.restingOn = null;
    this.robot.gripper.holding = b.id;
    if (b.platform) {
      // whatever stood on top of it does not come along
      for (let j = 0; j < this.bodies.length; j++) {
        const rider = this.bodies[j];
        if (rider.restingOn !== b.id) continue;
        rider.restingOn = null;
        rider.z = 0;
        this.dirty[j] = 1;
        this.unsettled = true;
      }
    }

    const carried = this.shapes[CARRIED];
    carried.hw = b.w / 2;
    carried.hl = b.l / 2;
    this.shapeActive[CARRIED] = true;
    this.robotRadius = Math.max(this.baseRadius, Math.abs(this.heldForward) + this.bodyRadius[i]);
    this.dirty[i] = 0;
    this.pushEvent({ type: 'grab', bodyId: b.id, time: this.world.time });
  }

  /** Take the held body out of the claw without deciding where it goes. Returns its index. */
  private letGo(): number {
    const i = this.heldIndex;
    if (i < 0) return -1;
    this.bodies[i].held = false;
    this.heldIndex = -1;
    this.shapeActive[CARRIED] = false;
    this.robotRadius = this.baseRadius;
    this.robot.gripper.holding = null;
    this.clawBlocked = false;
    return i;
  }

  /**
   * The claw opens: the object comes to rest on the platform (tower) under its centre, or it
   * drops to the mat.
   */
  private release(): void {
    const i = this.letGo();
    if (i < 0) return;
    const b = this.bodies[i];
    const support = this.comeDown(i, PLATFORM_SNAP);
    this.pushEvent({ type: 'release', bodyId: b.id, onto: support ? support.id : null, time: this.world.time });
  }

  /**
   * Body i has lost what held it up (the claw let go, or it was pushed off its tower): it comes
   * to rest on the platform under its centre, or it drops to the mat.
   * `reach` is how far (mm) the top of that platform may be above the body's base.
   * Returns the platform it now stands on, or null for the mat.
   */
  private comeDown(i: number, reach: number): Body | null {
    const bodies = this.bodies;
    const b = bodies[i];
    let support: Body | null = null;
    let supportTop = -Infinity;
    for (let j = 0; j < bodies.length; j++) {
      const p = bodies[j];
      if (j === i || !p.platform || p.held) continue;
      const top = p.z + p.h;
      if (top > b.z + reach || top <= supportTop) continue;
      if (!pointInBox(b.x, b.y, p.x, p.y, p.w / 2, p.l / 2, Math.sin(p.angle), Math.cos(p.angle))) continue;
      support = p;
      supportTop = top;
    }
    if (support) {
      b.z = supportTop;
      b.restingOn = support.id;
    } else {
      b.z = 0;
      b.restingOn = null;
      this.slideOffWhatIsUnder(i);
    }
    this.dirty[i] = 1;
    this.unsettled = true;
    this.cameDown = true;
    return support;
  }

  /**
   * A thing that drops to the mat cannot come down INSIDE something: it slides off whatever is
   * under it (the edge of a tower, another object, a part of the robot) and lands beside it.
   * Only the falling thing moves; what it falls onto stays where it is.
   */
  private slideOffWhatIsUnder(i: number): void {
    const bodies = this.bodies;
    const b = bodies[i];
    const hit = this.contact;
    const hw = b.w / 2;
    const hl = b.l / 2;
    const bs = Math.sin(b.angle);
    const bc = Math.cos(b.angle);
    const top = b.z + b.h;
    // sliding off one thing may land it on the next one: a few rounds sort that out
    for (let round = 0; round < 4; round++) {
      let moved = false;
      for (let j = 0; j < bodies.length; j++) {
        const o = bodies[j];
        if (j === i || o.held) continue;
        if (b.z >= o.z + o.h - Z_EPS || o.z >= top - Z_EPS) continue;
        if (boxesOverlap(o.x, o.y, o.w / 2, o.l / 2, Math.sin(o.angle), Math.cos(o.angle), b.x, b.y, hw, hl, bs, bc, hit)) {
          b.x += hit.nx * hit.depth;
          b.y += hit.ny * hit.depth;
          moved = true;
        }
      }
      for (let k = 0; k < SHAPE_COUNT; k++) {
        if (!this.shapeActive[k]) continue;
        const sh = this.shapes[k];
        if (b.z >= sh.zmax - Z_EPS || sh.zmin >= top - Z_EPS) continue;
        if (boxesOverlap(sh.x, sh.y, sh.hw, sh.hl, sh.sin, sh.cos, b.x, b.y, hw, hl, bs, bc, hit)) {
          b.x += hit.nx * hit.depth;
          b.y += hit.ny * hit.depth;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // ===========================================================================================
  // Collisions
  // ===========================================================================================

  /** Recompute where the robot's colliding parts (and the object in its claw) are. */
  private updateShapes(): void {
    const cfg = this.cfg;
    const robot = this.robot;
    const pose = robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const shapes = this.shapes;

    // a point `f` mm ahead and `r` mm to the right of the origin is at
    //   x = pose.x + f * s + r * c,   y = pose.y - f * c + r * s
    const chassis = shapes[CHASSIS];
    const chassisCentre = (cfg.chassisFront - cfg.chassisRear) / 2;
    chassis.x = pose.x + chassisCentre * s;
    chassis.y = pose.y - chassisCentre * c;
    chassis.sin = s;
    chassis.cos = c;

    const g = cfg.gripper;
    if (g.enabled) {
      const f = g.gripForward;
      const r = robot.gripper.gap / 2 + g.fingerThickness / 2;
      const zmin = robot.gripper.height;
      const zmax = zmin + g.fingerHeight;
      const left = shapes[FINGER_LEFT];
      left.x = pose.x + f * s - r * c;
      left.y = pose.y - f * c - r * s;
      left.sin = s;
      left.cos = c;
      left.zmin = zmin;
      left.zmax = zmax;
      const right = shapes[FINGER_RIGHT];
      right.x = pose.x + f * s + r * c;
      right.y = pose.y - f * c + r * s;
      right.sin = s;
      right.cos = c;
      right.zmin = zmin;
      right.zmax = zmax;
    }

    if (this.heldIndex >= 0) {
      // the object in the claw is rigidly attached to the robot
      const b = this.bodies[this.heldIndex];
      b.x = pose.x + this.heldForward * s;
      b.y = pose.y - this.heldForward * c;
      b.angle = pose.heading + this.heldTurn;
      b.z = robot.gripper.height + this.heldLift;
      const carried = shapes[CARRIED];
      carried.x = b.x;
      carried.y = b.y;
      carried.sin = Math.sin(b.angle);
      carried.cos = Math.cos(b.angle);
      carried.zmin = b.z;
      carried.zmax = b.z + b.h;
    }
  }

  /** Slide the whole robot (with what it carries) sideways without turning it. */
  private shiftRobot(dx: number, dy: number): void {
    const pose = this.robot.pose;
    pose.x += dx;
    pose.y += dy;
    for (let s = 0; s < SHAPE_COUNT; s++) {
      if (!this.shapeActive[s]) continue;
      this.shapes[s].x += dx;
      this.shapes[s].y += dy;
    }
    if (this.heldIndex >= 0) {
      const b = this.bodies[this.heldIndex];
      b.x += dx;
      b.y += dy;
    }
    this.poseVersion++;
  }

  /** Slide a body; whatever stands on top of it rides along. */
  private shiftBody(i: number, dx: number, dy: number): void {
    const bodies = this.bodies;
    const b = bodies[i];
    b.x += dx;
    b.y += dy;
    this.dirty[i] = 1;
    this.unsettled = true;
    this.bodiesShifted = true;
    this.shiftCount++;
    if (!b.platform) return;
    for (let j = 0; j < bodies.length; j++) {
      const rider = bodies[j];
      if (j !== i && rider.restingOn === b.id && !rider.held) this.shiftBody(j, dx, dy);
    }
  }

  /**
   * Keep a body on the table: a body that is pushed through the wall is moved back and is now
   * backed by the wall. Returns how far (mm) it had to be moved back.
   */
  private clampBodyToTable(i: number): number {
    const b = this.bodies[i];
    const s = Math.abs(Math.sin(b.angle));
    const c = Math.abs(Math.cos(b.angle));
    // half size of the body's bounding box along x and y
    const ex = (b.w * c + b.l * s) / 2;
    const ey = (b.w * s + b.l * c) / 2;
    let dx = 0;
    let dy = 0;
    if (b.x - ex < this.tableMinX) dx = this.tableMinX - (b.x - ex);
    else if (b.x + ex > this.tableMaxX) dx = this.tableMaxX - (b.x + ex);
    if (b.y - ey < this.tableMinY) dy = this.tableMinY - (b.y - ey);
    else if (b.y + ey > this.tableMaxY) dy = this.tableMaxY - (b.y + ey);
    if (dx === 0 && dy === 0) return 0;
    this.shiftBody(i, dx, dy);
    if (dx !== 0) this.addBacking(i, dx > 0 ? -1 : 1, 0, HARD);
    if (dy !== 0) this.addBacking(i, 0, dy > 0 ? -1 : 1, HARD);
    return Math.max(Math.abs(dx), Math.abs(dy));
  }

  /** Remember that body i cannot give way in direction (ux, uy), and why (SOFT: robot behind it, HARD: wall). */
  private addBacking(i: number, ux: number, uy: number, kind: number): void {
    const list = this.backing;
    const kinds = this.backingKind;
    const count = this.backingCount[i];
    const at = i * MAX_BACKINGS;
    for (let k = 0; k < count; k++) {
      if (ux * list[2 * (at + k)] + uy * list[2 * (at + k) + 1] > 0.98) {
        // this direction is known already; a wall behind it counts more than the robot
        if (kind > kinds[at + k]) kinds[at + k] = kind;
        return;
      }
    }
    if (count >= MAX_BACKINGS) return;
    list[2 * (at + count)] = ux;
    list[2 * (at + count) + 1] = uy;
    kinds[at + count] = kind;
    this.backingCount[i] = count + 1;
  }

  /**
   * Would a push in direction (ux, uy) press body i against something behind it?
   * Returns 0 (no), SOFT (the robot is behind it) or HARD (the wall is behind it).
   */
  private backingAgainst(i: number, ux: number, uy: number): number {
    const list = this.backing;
    const kinds = this.backingKind;
    const count = this.backingCount[i];
    const at = i * MAX_BACKINGS;
    let found = 0;
    for (let k = 0; k < count; k++) {
      if (ux * list[2 * (at + k)] + uy * list[2 * (at + k) + 1] > BACKING_COS && kinds[at + k] > found) {
        found = kinds[at + k];
      }
    }
    return found;
  }

  /** Keep the robot (and what it carries) on the table. Returns how far (mm) it had to be moved back. */
  private clampRobotToTable(): number {
    let dx = 0;
    let dy = 0;
    for (let k = 0; k < SHAPE_COUNT; k++) {
      if (!this.shapeActive[k]) continue;
      const sh = this.shapes[k];
      const s = Math.abs(sh.sin);
      const c = Math.abs(sh.cos);
      const ex = sh.hw * c + sh.hl * s;
      const ey = sh.hw * s + sh.hl * c;
      if (sh.x - ex + dx < this.tableMinX) dx = this.tableMinX - (sh.x - ex);
      else if (sh.x + ex + dx > this.tableMaxX) dx = this.tableMaxX - (sh.x + ex);
      if (sh.y - ey + dy < this.tableMinY) dy = this.tableMinY - (sh.y - ey);
      else if (sh.y + ey + dy > this.tableMaxY) dy = this.tableMaxY - (sh.y + ey);
    }
    if (dx === 0 && dy === 0) return 0;
    this.shiftRobot(dx, dy);
    return Math.max(Math.abs(dx), Math.abs(dy));
  }

  /**
   * Make sure nothing is inside anything else.
   *
   * Each pass: the robot pushes the bodies it overlaps, those bodies push the bodies they now
   * overlap, and so on. A body pressed against the table wall cannot give way; then the push
   * travels back and it is the robot that is stopped.
   *
   * Returns true when everything ended up apart, false when things are jammed.
   */
  private resolveContacts(): boolean {
    const bodies = this.bodies;
    const n = bodies.length;
    const dirty = this.dirty;
    const hit = this.contact;
    const shapes = this.shapes;
    const active = this.shapeActive;
    const pose = this.robot.pose;
    const radius = this.bodyRadius;
    let touching = false;
    let settled = false;
    // the last pass still moved a body (by less than the tolerance)
    let nudged = false;
    // where the robot stood before anything pushed it back
    const fromX = pose.x;
    const fromY = pose.y;
    this.backingCount.fill(0);
    this.bodiesShifted = false;

    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      // the deepest overlap found in this pass
      let deepest = 0;
      const shiftsBefore = this.shiftCount;

      // ---- the robot against every body near it
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        if (b.held) continue;
        const dx = b.x - pose.x;
        const dy = b.y - pose.y;
        const far = this.robotRadius + radius[i];
        if (dx * dx + dy * dy > far * far) continue;
        const top = b.z + b.h;
        const hw = b.w / 2;
        const hl = b.l / 2;
        const bs = Math.sin(b.angle);
        const bc = Math.cos(b.angle);
        for (let k = 0; k < SHAPE_COUNT; k++) {
          if (!active[k]) continue;
          const sh = shapes[k];
          if (sh.zmin >= top - Z_EPS || b.z >= sh.zmax - Z_EPS) continue; // one passes above the other
          if (!boxesOverlap(sh.x, sh.y, sh.hw, sh.hl, sh.sin, sh.cos, b.x, b.y, hw, hl, bs, bc, hit)) continue;
          if (hit.depth > deepest) deepest = hit.depth;
          touching = true;
          this.noteBump(i);
          let nx = hit.nx;
          let ny = hit.ny;
          let depth = hit.depth;
          let behind = this.backingAgainst(i, nx, ny);
          if (behind === SOFT) {
            // Another part of the robot is on the other side. If the body stands askew between
            // the two fingers but would fit between them, they simply turn it straight ...
            if ((k === FINGER_LEFT || k === FINGER_RIGHT) && this.straightenBetweenFingers(i)) {
              break; // (it is looked at again, where it stands now, in the next pass)
            }
            // ... otherwise (e.g. a box caught between the two finger tips): instead of
            // squeezing it, push it out, straight away from the robot.
            const away = Math.hypot(dx, dy);
            if (away > 1e-6) {
              nx = (b.x - pose.x) / away;
              ny = (b.y - pose.y) / away;
              // how far the body must move along (nx, ny) to be clear of this part of the robot
              const reachShape = sh.hl * Math.abs(nx * sh.sin - ny * sh.cos) + sh.hw * Math.abs(nx * sh.cos + ny * sh.sin);
              const reachBody = hl * Math.abs(nx * bs - ny * bc) + hw * Math.abs(nx * bc + ny * bs);
              const apart = (b.x - sh.x) * nx + (b.y - sh.y) * ny;
              depth = Math.min(Math.max(reachShape + reachBody - apart, hit.depth), MAX_SQUEEZE_OUT);
              behind = this.backingAgainst(i, nx, ny);
            }
          }
          const px = nx * depth;
          const py = ny * depth;
          if (behind === HARD) {
            this.shiftRobot(-px, -py); // the body cannot give way: the robot is stopped
          } else {
            this.shiftBody(i, px, py);
            this.addBacking(i, -nx, -ny, SOFT); // it will not come back: the robot is there
            this.clampBodyToTable(i);
          }
        }
      }

      // ---- bodies that moved against the other bodies
      if (this.unsettled || this.leftover) {
        for (let i = 0; i < n; i++) {
          if (!dirty[i]) continue;
          const a = bodies[i];
          if (a.held) continue;
          // A thing that was moved without being pushed (it rides on a pushed tower, the claw
          // turned it, it was just put down) may stick out over the edge of the table.
          const overWall = this.clampBodyToTable(i);
          if (overWall > deepest) deepest = overWall;
          for (let j = 0; j < n; j++) {
            if (j === i || (dirty[j] && j < i)) continue; // (a pair of moved bodies is looked at once)
            const b = bodies[j];
            if (b.held) continue;
            if (a.z >= b.z + b.h - Z_EPS || b.z >= a.z + a.h - Z_EPS) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const far = radius[i] + radius[j];
            if (dx * dx + dy * dy >= far * far) continue;
            if (
              !boxesOverlap(
                a.x,
                a.y,
                a.w / 2,
                a.l / 2,
                Math.sin(a.angle),
                Math.cos(a.angle),
                b.x,
                b.y,
                b.w / 2,
                b.l / 2,
                Math.sin(b.angle),
                Math.cos(b.angle),
                hit,
              )
            ) {
              continue;
            }
            if (hit.depth > deepest) deepest = hit.depth;
            this.separateBodies(i, j, hit.nx, hit.ny, hit.depth);
          }
        }
      }

      // ---- the robot against the edge of the table
      const overEdge = this.clampRobotToTable();
      if (overEdge > 0) {
        if (overEdge > deepest) deepest = overEdge;
        touching = true;
        this.noteWallBump();
      }

      // The robot is being pushed back further than it can have driven in: it is jammed.
      // (Without this, something wedged between the fingers and the wall would throw the
      // robot back by centimetres in a single tick.)
      if (Math.hypot(pose.x - fromX, pose.y - fromY) > MAX_PUSH_BACK) break;

      // Two things that are both pushed by the robot push each other half-way back, so the
      // overlaps halve from pass to pass; once they are tiny, that is good enough.
      if (deepest <= SETTLE_TOLERANCE) {
        settled = true;
        nudged = this.shiftCount !== shiftsBefore;
        break;
      }
    }

    this.robot.touching = touching;
    if (!settled) {
      // something is still overlapping (a tight squeeze): the caller takes the move back, or the
      // engine keeps working on it during the next ticks
      this.unsettled = true;
      return false;
    }
    if (nudged) {
      // Close enough - but what was nudged in this last pass has not been checked against
      // everything around it yet. It keeps its mark and is looked at first thing next time.
      this.leftover = true;
    } else if (this.unsettled || this.leftover) {
      dirty.fill(0);
      this.leftover = false;
    }
    this.unsettled = false;
    return true;
  }

  /** Remember where the robot and every body are, so that a move that ends in a jam can be taken back. */
  private saveState(): void {
    const bodies = this.bodies;
    const saved = this.savedBodies;
    for (let i = 0; i < bodies.length; i++) {
      saved[3 * i] = bodies[i].x;
      saved[3 * i + 1] = bodies[i].y;
      saved[3 * i + 2] = bodies[i].angle;
    }
    const pose = this.robot.pose;
    this.savedPose.x = pose.x;
    this.savedPose.y = pose.y;
    this.savedPose.heading = pose.heading;
    // (only taken while everything is settled: the marks are those of `leftover`)
    this.savedDirty.set(this.dirty);
    this.savedLeftover = this.leftover;
  }

  /** Put the robot and every body back where saveState() found them. */
  private restoreState(): void {
    const bodies = this.bodies;
    const saved = this.savedBodies;
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].x = saved[3 * i];
      bodies[i].y = saved[3 * i + 1];
      bodies[i].angle = saved[3 * i + 2];
    }
    const pose = this.robot.pose;
    pose.x = this.savedPose.x;
    pose.y = this.savedPose.y;
    pose.heading = this.savedPose.heading;
    this.updateShapes();
    this.dirty.set(this.savedDirty);
    this.leftover = this.savedLeftover;
    this.unsettled = false;
  }

  /**
   * Bodies i and j overlap: moving j by `depth` mm in direction (ux, uy) would separate them.
   * Decide who gives way.
   */
  private separateBodies(i: number, j: number, ux: number, uy: number, depth: number): void {
    const px = ux * depth;
    const py = uy * depth;
    const behindJ = this.backingAgainst(j, ux, uy); // what stops j from moving away from i
    const behindI = this.backingAgainst(i, -ux, -uy); // what stops i from moving away from j
    if (behindI > behindJ) {
      // i is held more firmly (the wall behind it, or the robot pushing it): j gives way,
      // and from now on j is backed by i
      this.shiftBody(j, px, py);
      this.addBacking(j, -ux, -uy, behindI);
    } else if (behindJ > behindI) {
      this.shiftBody(i, -px, -py);
      this.addBacking(i, ux, uy, behindJ);
    } else {
      // both are equally free (or equally stuck): they share the way, the lighter one moves further
      const mi = Math.max(this.bodies[i].mass, 1e-3);
      const mj = Math.max(this.bodies[j].mass, 1e-3);
      const shareJ = mi / (mi + mj);
      this.shiftBody(j, px * shareJ, py * shareJ);
      this.shiftBody(i, -px * (1 - shareJ), -py * (1 - shareJ));
    }
    this.clampBodyToTable(i);
    this.clampBodyToTable(j);
  }

  /**
   * A body whose centre is no longer over the platform it stood on comes down: onto another
   * platform of the same height that stands right there (it slides across), or onto the mat
   * beside the platform.
   */
  private dropUnsupported(): void {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.held || b.restingOn === null) continue;
      const pi = this.indexById.get(b.restingOn);
      const p = pi === undefined ? null : bodies[pi];
      if (p && pointInBox(b.x, b.y, p.x, p.y, p.w / 2, p.l / 2, Math.sin(p.angle), Math.cos(p.angle))) {
        b.z = p.z + p.h;
        continue;
      }
      this.comeDown(i, Z_EPS);
    }
  }

  /** The robot is driving into body i: report it once, then stay quiet while the contact lasts. */
  private noteBump(i: number): void {
    if (!this.robotMoving) return; // (the claw closing on something is not a bump)
    const tick = this.world.tick;
    if (tick - this.lastBump[i] > BUMP_QUIET_TICKS) {
      this.pushEvent({ type: 'bump', bodyId: this.bodies[i].id, time: this.world.time });
    }
    this.lastBump[i] = tick;
  }

  private noteWallBump(): void {
    if (!this.robotMoving) return;
    const tick = this.world.tick;
    if (tick - this.lastWallBump > BUMP_QUIET_TICKS) {
      this.pushEvent({ type: 'bump', bodyId: 'wall', time: this.world.time });
    }
    this.lastWallBump = tick;
  }

  // ===========================================================================================
  // Restart rule
  // ===========================================================================================

  /** Put the robot back exactly as it was at the start of the match (pose, motors, servos, screen ...). */
  private resetRobot(): void {
    const cfg = this.cfg;
    const robot = this.robot;
    const fresh = makeRobotState(cfg, this.startPose);
    robot.pose.x = fresh.pose.x;
    robot.pose.y = fresh.pose.y;
    robot.pose.heading = fresh.pose.heading;
    Object.assign(robot.left, fresh.left);
    Object.assign(robot.right, fresh.right);
    for (const port of SERVO_PORTS) Object.assign(robot.servos[port], fresh.servos[port]);
    robot.gripper.height = fresh.gripper.height;
    robot.gripper.gap = fresh.gripper.gap;
    robot.gripper.holding = null;
    robot.yawDeg = 0;
    robot.leds = fresh.leds;
    robot.screen = fresh.screen;
    robot.touching = false;
    robot.lastUltrasonicCm = fresh.lastUltrasonicCm;
    this.motion.active = false;
    this.liftBlocked = false;
    this.clawBlocked = false;
    this.timerStart = this.world.time;
    this.poseVersion++;
    this.epoch++;
    this.updateShapes();
  }

  /**
   * Restart rule for a carried object: back to its original starting position. If that place is
   * taken, or the tower it stood on has moved, it is put on the mat as close to it as possible.
   */
  private returnHome(i: number): void {
    const b = this.bodies[i];
    const home = b.home;
    let homeIsUsable: boolean;
    if (home.restingOn !== null) {
      const pi = this.indexById.get(home.restingOn);
      const p = pi === undefined ? null : this.bodies[pi];
      homeIsUsable =
        p !== null &&
        !p.held &&
        Math.hypot(p.x - p.home.x, p.y - p.home.y) <= HOME_TOLERANCE &&
        Math.abs(p.z - p.home.z) < 1;
    } else {
      homeIsUsable = true;
    }
    if (homeIsUsable && this.spotIsFree(i, home.x, home.y, home.angle, home.z)) {
      this.placeBody(i, home.x, home.y, home.angle, home.z, home.restingOn);
      return;
    }

    // look for free mat in growing circles around the home position
    const mat = this.game.mat;
    const half = this.bodyRadius[i];
    for (let ring = 0; ring <= 40; ring++) {
      const r = ring * 10;
      const count = ring === 0 ? 1 : 16;
      for (let k = 0; k < count; k++) {
        const direction = (k * 2 * Math.PI) / count;
        const x = home.x + r * Math.sin(direction);
        const y = home.y - r * Math.cos(direction);
        if (x < half || y < half || x > mat.width - half || y > mat.height - half) continue;
        if (this.spotIsFree(i, x, y, home.angle, 0)) {
          this.placeBody(i, x, y, home.angle, 0, null);
          return;
        }
      }
    }
    // the mat is full (this cannot really happen): put it down anyway, it will be nudged free
    this.placeBody(i, home.x, home.y, home.angle, 0, null);
  }

  /** Could body i stand at (x, y, z) without being inside another body or the robot? */
  private spotIsFree(i: number, x: number, y: number, angle: number, z: number): boolean {
    const bodies = this.bodies;
    const b = bodies[i];
    const hit = this.contact;
    const hw = b.w / 2;
    const hl = b.l / 2;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    const top = z + b.h;
    for (let j = 0; j < bodies.length; j++) {
      const o = bodies[j];
      if (j === i || o.held) continue;
      if (z >= o.z + o.h - Z_EPS || o.z >= top - Z_EPS) continue;
      if (boxesOverlap(x, y, hw, hl, s, c, o.x, o.y, o.w / 2, o.l / 2, Math.sin(o.angle), Math.cos(o.angle), hit)) {
        return false;
      }
    }
    for (let k = 0; k < SHAPE_COUNT; k++) {
      if (!this.shapeActive[k]) continue;
      const sh = this.shapes[k];
      if (z >= sh.zmax - Z_EPS || sh.zmin >= top - Z_EPS) continue;
      if (boxesOverlap(x, y, hw, hl, s, c, sh.x, sh.y, sh.hw, sh.hl, sh.sin, sh.cos, hit)) return false;
    }
    return true;
  }

  private placeBody(i: number, x: number, y: number, angle: number, z: number, restingOn: string | null): void {
    const b = this.bodies[i];
    b.x = x;
    b.y = y;
    b.angle = angle;
    b.z = z;
    b.restingOn = restingOn;
    b.held = false;
    this.dirty[i] = 1;
    this.unsettled = true;
  }

  // ===========================================================================================
  // Sensors
  // ===========================================================================================

  /** Read the four Quad RGB probes (at most once per tick; nothing is recomputed while the robot stands still). */
  private refreshProbes(): void {
    const tick = this.world.tick;
    const noise = this.cfg.noise.sensor;
    const moved = this.probeCleanVersion !== this.poseVersion;
    if (!moved && (this.probeTick === tick || !(noise > 0))) return;

    const q = this.cfg.quadRgb;
    const clean = this.probeClean;
    if (moved) {
      const pose = this.robot.pose;
      const s = Math.sin(pose.heading);
      const c = Math.cos(pose.heading);
      const sampler = this.sampler;
      const spread = q.spotRadius * 0.6;
      for (let k = 0; k < 4; k++) {
        const right = q.probeOffsets[k];
        const x = pose.x + q.forward * s + right * c;
        const y = pose.y - q.forward * c + right * s;
        // average the colour over a small spot: its centre and four points around it
        let rgb = sampler.sample(x, y);
        let r = rgb.r;
        let g = rgb.g;
        let b = rgb.b;
        if (spread > 0) {
          rgb = sampler.sample(x - spread, y);
          r += rgb.r;
          g += rgb.g;
          b += rgb.b;
          rgb = sampler.sample(x + spread, y);
          r += rgb.r;
          g += rgb.g;
          b += rgb.b;
          rgb = sampler.sample(x, y - spread);
          r += rgb.r;
          g += rgb.g;
          b += rgb.b;
          rgb = sampler.sample(x, y + spread);
          r += rgb.r;
          g += rgb.g;
          b += rgb.b;
          r /= 5;
          g /= 5;
          b /= 5;
        }
        clean[k * 3] = r;
        clean[k * 3 + 1] = g;
        clean[k * 3 + 2] = b;
      }
      this.probeCleanVersion = this.poseVersion;
    }

    const readings: ProbeReading[] = [];
    for (let k = 0; k < 4; k++) {
      let r = clean[k * 3];
      let g = clean[k * 3 + 1];
      let b = clean[k * 3 + 2];
      if (noise > 0) {
        r = clamp(r + noise * hashNoise(this.seed, tick, k * 3), 0, 255);
        g = clamp(g + noise * hashNoise(this.seed, tick, k * 3 + 1), 0, 255);
        b = clamp(b + noise * hashNoise(this.seed, tick, k * 3 + 2), 0, 255);
      }
      readings.push(makeProbeReading({ r, g, b }, q.lineThreshold));
    }
    this.probeReadings = readings;
    this.probeStatus = lineStatusOf(readings);
    this.probeOffset = lineOffsetOf(readings, q.probeOffsets, q.lineThreshold);
    this.probeTick = tick;
  }

  /**
   * Ultrasonic sensor: distance (cm) to the nearest body inside the beam that is tall enough to
   * reach the beam. The object in the claw is not seen (the sensor looks past it).
   */
  private measureUltrasonic(): number {
    const tick = this.world.tick;
    if (this.sonarTick === tick && this.sonarEpoch === this.epoch) return this.sonarCm;
    const u = this.cfg.ultrasonic;
    const bodies = this.bodies;
    const pose = this.robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const ox = pose.x + u.forward * s;
    const oy = pose.y - u.forward * c;
    const dirX = this.rayDirX;
    const dirY = this.rayDirY;
    for (let k = 0; k < ULTRASONIC_RAYS; k++) {
      // direction of a ray that is turned by its offset angle from the robot's heading
      dirX[k] = s * this.rayCos[k] + c * this.raySin[k];
      dirY[k] = -(c * this.rayCos[k] - s * this.raySin[k]);
    }
    const maxMm = u.maxRangeCm * 10;
    let best = maxMm;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.held) continue;
      if (b.z > u.height || b.z + b.h < u.height) continue; // the beam passes over or under it
      const dx = b.x - ox;
      const dy = b.y - oy;
      const far = best + this.bodyRadius[i];
      if (dx * dx + dy * dy > far * far) continue;
      const hw = b.w / 2;
      const hl = b.l / 2;
      const bs = Math.sin(b.angle);
      const bc = Math.cos(b.angle);
      for (let k = 0; k < ULTRASONIC_RAYS; k++) {
        const d = rayBoxDistance(ox, oy, dirX[k], dirY[k], b.x, b.y, hw, hl, bs, bc);
        if (d >= 0 && d < best) best = d;
      }
    }
    let cm = best / 10;
    const noise = this.cfg.noise.ultrasonicCm;
    if (noise > 0 && best < maxMm) cm += noise * hashNoise(this.seed, tick, 100);
    cm = Math.round(clamp(cm, u.minRangeCm, u.maxRangeCm) * 10) / 10;
    this.sonarTick = tick;
    this.sonarEpoch = this.epoch;
    this.sonarCm = cm;
    this.robot.lastUltrasonicCm = cm;
    return cm;
  }

  /**
   * Front colour sensor: the colour of the object held in the claw, or of the nearest grippable
   * object straight ahead, between the fingers or up to rangeMm beyond the gripping centre.
   * The sensor sits on the arm, so it only sees things at the height of the fingers.
   */
  private lookAtClaw(): SensorColor | 'none' {
    const cfg = this.cfg;
    if (!cfg.frontColorSensor.enabled) return 'none';
    const bodies = this.bodies;
    if (this.heldIndex >= 0) return bodies[this.heldIndex].colorName ?? 'none';

    const g = cfg.gripper;
    const pose = this.robot.pose;
    const s = Math.sin(pose.heading);
    const c = Math.cos(pose.heading);
    const eyeForward = g.enabled ? g.gripForward - g.fingerLength / 2 : cfg.chassisFront;
    const eyeHeight = g.enabled ? this.robot.gripper.height + g.fingerHeight / 2 : cfg.ultrasonic.height;
    const reach = (g.enabled ? g.fingerLength / 2 : 0) + Math.max(0, cfg.frontColorSensor.rangeMm);
    const ex = pose.x + eyeForward * s;
    const ey = pose.y - eyeForward * c;
    let best = reach;
    let seen: Body | null = null;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.grippable || b.held) continue;
      if (b.z > eyeHeight || b.z + b.h < eyeHeight) continue;
      const dx = b.x - ex;
      const dy = b.y - ey;
      const far = reach + FRONT_EYE_SPREAD + this.bodyRadius[i];
      if (dx * dx + dy * dy > far * far) continue;
      const bs = Math.sin(b.angle);
      const bc = Math.cos(b.angle);
      for (let k = -1; k <= 1; k++) {
        const side = k * FRONT_EYE_SPREAD;
        const d = rayBoxDistance(ex + side * c, ey + side * s, s, -c, b.x, b.y, b.w / 2, b.l / 2, bs, bc);
        if (d >= 0 && d <= best) {
          best = d;
          seen = b;
        }
      }
    }
    return seen?.colorName ?? 'none';
  }

  // ===========================================================================================
  // Events
  // ===========================================================================================

  private pushEvent(event: SimEvent): void {
    const events = this.events;
    events.push(event);
    // nobody is draining the events (batch run): forget the oldest half
    if (events.length > MAX_EVENTS) events.splice(0, MAX_EVENTS / 2);
  }

  // ===========================================================================================
  // RobotIO: what the student's program can do
  // ===========================================================================================

  private createIO(): RobotIO {
    // (arrow functions, so that `this` inside them is the engine)
    const cfg = this.cfg;
    const robot = this.robot;
    const world = this.world;
    const wheelOf = (wheel: Wheel): WheelState => (wheel === 'right' ? robot.right : robot.left);
    const servoOf = (port: ServoPort): ServoState | undefined => robot.servos[port];

    return {
      dt: SIM_DT,
      get time(): number {
        return world.time;
      },
      config: cfg,

      // ---------------------------------------------------------------- drive
      setWheelRpm: (wheel: Wheel, rpm: number): void => {
        this.cancelMotion();
        const w = wheelOf(wheel);
        w.mode = 'speed';
        w.targetRpm = clamp(finite(rpm), -cfg.maxRpm, cfg.maxRpm);
        w.power = cfg.maxRpm > 0 ? (w.targetRpm / cfg.maxRpm) * 100 : 0;
      },
      setWheelPower: (wheel: Wheel, power: number): void => {
        this.cancelMotion();
        const w = wheelOf(wheel);
        w.mode = 'power';
        w.power = clamp(finite(power), -100, 100);
        w.targetRpm = (w.power / 100) * cfg.maxRpm;
      },
      stopWheel: (wheel: Wheel | 'all'): void => {
        this.cancelMotion();
        if (wheel === 'all' || wheel === 'left') haltWheel(robot.left);
        if (wheel === 'all' || wheel === 'right') haltWheel(robot.right);
      },
      startMotion: (leftDeg: number, rightDeg: number, rpm: number): void => {
        this.cancelMotion();
        const l = finite(leftDeg);
        const r = finite(rightDeg);
        const speed = Math.min(Math.abs(finite(rpm)), cfg.maxRpm);
        const total = Math.max(Math.abs(l), Math.abs(r));
        if (!(total > 1e-9) || !(speed > 0)) {
          // nothing to do: the move is "done" straight away and the wheels stop
          haltWheel(robot.left);
          haltWheel(robot.right);
          return;
        }
        const m = this.motion;
        m.active = true;
        m.leftDeg = l;
        m.rightDeg = r;
        m.total = total;
        m.done = 0;
        m.maxSpeed = speed * 6;
        // keep the speed the faster wheel already has in the direction of the move
        const leftLeads = Math.abs(l) >= Math.abs(r);
        const lead = leftLeads ? robot.left : robot.right;
        const direction = (leftLeads ? l : r) > 0 ? 1 : -1;
        m.speed = clamp(direction * lead.rpm * 6, 0, m.maxSpeed);
        // the slower wheel runs proportionally slower, so both finish together
        const assign = (w: WheelState, deg: number): void => {
          w.mode = 'motion';
          w.targetRpm = (speed * deg) / total;
          w.power = cfg.maxRpm > 0 ? (w.targetRpm / cfg.maxRpm) * 100 : 0;
        };
        assign(robot.left, l);
        assign(robot.right, r);
      },
      motionDone: (): boolean => {
        return !this.motion.active;
      },
      wheelAngle: (wheel: Wheel): number => {
        return wheelOf(wheel).angleDeg;
      },
      resetWheelAngle: (wheel: Wheel | 'all'): void => {
        if (wheel === 'all' || wheel === 'left') robot.left.angleDeg = 0;
        if (wheel === 'all' || wheel === 'right') robot.right.angleDeg = 0;
      },
      wheelRpm: (wheel: Wheel): number => {
        return wheelOf(wheel).rpm;
      },
      wheelPower: (wheel: Wheel): number => {
        return wheelOf(wheel).power;
      },

      // ---------------------------------------------------------------- servos
      setServo: (port: ServoPort, angle: number): void => {
        const s = servoOf(port);
        if (!s) return;
        s.target = clamp(finite(angle), 0, 180);
        // a new command: the servo tries again, even if it was held up before
        if (port === cfg.gripper.liftServo) this.liftBlocked = false;
        if (port === cfg.gripper.clawServo) this.clawBlocked = false;
      },
      servoAngle: (port: ServoPort): number => {
        return servoOf(port)?.angle ?? 0;
      },
      servoDone: (port: ServoPort): boolean => {
        const s = servoOf(port);
        if (!s || s.angle === s.target) return true;
        if (!cfg.gripper.enabled) return false;
        if (port === cfg.gripper.liftServo) return this.liftBlocked;
        if (port === cfg.gripper.clawServo) return this.clawBlocked;
        return false;
      },

      // ---------------------------------------------------------------- sensors
      probe: (name: ProbeName): ProbeReading => {
        this.refreshProbes();
        return this.probeReadings[PROBE_INDEX[name] ?? 0];
      },
      lineStatus: (): number => {
        this.refreshProbes();
        return this.probeStatus;
      },
      lineOffset: (): number => {
        this.refreshProbes();
        return this.probeOffset;
      },
      ultrasonicCm: (): number => {
        return this.measureUltrasonic();
      },
      frontColor: (): SensorColor | 'none' => {
        return this.lookAtClaw();
      },
      yawDeg: (): number => {
        return robot.yawDeg;
      },
      resetYaw: (): void => {
        robot.yawDeg = 0;
      },

      // ---------------------------------------------------------------- CyberPi
      buttonDown: (name: ButtonName): boolean => {
        return this.buttons[name] === true;
      },
      setLed: (index: number | 'all', color: RGB): void => {
        const led: RGB = {
          r: clamp(Math.round(finite(color.r)), 0, 255),
          g: clamp(Math.round(finite(color.g)), 0, 255),
          b: clamp(Math.round(finite(color.b)), 0, 255),
        };
        if (index === 'all') {
          for (let i = 0; i < robot.leds.length; i++) robot.leds[i] = { ...led };
        } else {
          const i = Math.floor(index);
          if (i >= 0 && i < robot.leds.length) robot.leds[i] = led;
        }
      },
      print: (text: string): void => {
        const lines = robot.screen.lines;
        lines.push(String(text));
        if (lines.length > MAX_SCREEN_LINES) lines.splice(0, lines.length - MAX_SCREEN_LINES);
      },
      showLabel: (text: string, x: number, y: number, size: number): void => {
        const labels = robot.screen.labels;
        const label = { text: String(text), x: finite(x), y: finite(y), size: finite(size) };
        // a label written at the same place replaces the old one
        const at = labels.findIndex((l) => l.x === label.x && l.y === label.y);
        if (at >= 0) labels[at] = label;
        else labels.push(label);
        if (labels.length > MAX_SCREEN_LABELS) labels.splice(0, labels.length - MAX_SCREEN_LABELS);
      },
      clearScreen: (): void => {
        robot.screen.lines = [];
        robot.screen.labels = [];
      },
      tone: (frequency: number, seconds: number): void => {
        this.pushEvent({
          type: 'tone',
          frequency: Math.max(0, finite(frequency)),
          seconds: Math.max(0, finite(seconds)),
          time: world.time,
        });
      },
      timer: (): number => {
        return world.time - this.timerStart;
      },
      resetTimer: (): void => {
        this.timerStart = world.time;
      },

      // ---------------------------------------------------------------- misc
      random: (): number => {
        return this.programRandom();
      },
      log: (level: 'info' | 'warn' | 'error', text: string, blockId?: string): void => {
        this.pushEvent({ type: 'log', level, text: String(text), blockId, time: world.time });
      },
    };
  }
}

/**
 * Create a simulation that runs the program with the given VM.
 * Most code should call createSimulation() from ./simulation.ts, which plugs in the real VM;
 * tests pass their own small fake here.
 */
export function createEngineSimulation<S>(opts: SimulationOptions<S>, createVM: VMFactory): Simulation<S> {
  return new EngineSimulation<S>(opts, createVM);
}
