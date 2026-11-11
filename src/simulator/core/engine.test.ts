/**
 * Tests of the physics + sensor engine.
 *
 * They do not use the real block interpreter: a tiny fake VM runs a "script" (a generator
 * function) that talks to the engine through RobotIO, one step per simulation tick, exactly like
 * a student program would. `yield` means "wait for the next tick".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_STATION, MAT_VECTOR, PRINT_COLORS } from '../fire-rescue/field';
import { createEngineSimulation, SIM_DT, type VMFactory } from './engine';
import { classifyColor, lineOffsetOf, makeProbeReading } from './engine-sensors';
import { DEG, rectContainsOBB } from './geometry';
import type { RobotIO } from './io';
import {
  DEFAULT_ROBOT_CONFIG,
  clawGapForAngle,
  liftHeightForAngle,
  mmPerWheelDegree,
  robotFitsInRect,
  robotShapesAt,
  robotSize,
  wheelDegreesForDistance,
  wheelDegreesForTurn,
} from './robot';
import type {
  Body,
  ColorName,
  Game,
  Pose,
  RobotConfig,
  ScoreContext,
  ServoPort,
  SimEvent,
  Simulation,
  VM,
} from './types';

// =============================================================================================
// Helpers
// =============================================================================================

const CFG = DEFAULT_ROBOT_CONFIG;
const G = CFG.gripper;
const MM_PER_DEG = mmPerWheelDegree(CFG);

/** Where the Fire Rescue game puts the robot: in the Fire Station, facing up the mat. */
const START: Pose = { x: 625, y: 673.2, heading: 0 };

const near = (actual: number, expected: number, eps: number, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} is not within ${eps} of ${expected}`);

type Script = (io: RobotIO) => Generator<void, void, void>;

interface Harness {
  factory: VMFactory;
  /** the RobotIO the engine handed to the VM */
  io(): RobotIO;
  /** how often the program was started (1 + number of restarts) */
  starts(): number;
}

/** A fake VM that runs one script; it is idle once the script has ended. */
function scripted(script: Script): Harness {
  let io: RobotIO | null = null;
  let starts = 0;
  const factory: VMFactory = (_program, robotIO) => {
    io = robotIO;
    let run: Generator<void, void, void> | null = null;
    const vm: VM = {
      start() {
        starts++;
        run = script(robotIO);
      },
      step() {
        if (run && run.next().done) run = null;
      },
      stopAll() {
        run = null;
      },
      get running() {
        return run !== null;
      },
      get idle() {
        return run === null;
      },
      activeBlockIds: () => [],
      variables: () => ({}),
      errors: () => [],
    };
    return vm;
  };
  return {
    factory,
    io: () => {
      assert.ok(io, 'the VM was created');
      return io;
    },
    starts: () => starts,
  };
}

// ---- building blocks for scripts

function* waitUntil(condition: () => boolean): Generator<void, void, void> {
  while (!condition()) yield;
}

function* sleep(ticks: number): Generator<void, void, void> {
  for (let i = 0; i < ticks; i++) yield;
}

function* forever(): Generator<void, void, void> {
  for (;;) yield;
}

/** Drive straight by `mm` (negative = backwards) using the wheel encoders. */
function* drive(io: RobotIO, mm: number, rpm = 60): Generator<void, void, void> {
  const deg = wheelDegreesForDistance(io.config, mm);
  io.startMotion(deg, deg, rpm);
  yield* waitUntil(() => io.motionDone());
}

/** Turn on the spot by `degrees` (clockwise positive). */
function* turn(io: RobotIO, degrees: number, rpm = 40): Generator<void, void, void> {
  const deg = wheelDegreesForTurn(io.config, degrees);
  io.startMotion(deg, -deg, rpm);
  yield* waitUntil(() => io.motionDone());
}

function* servo(io: RobotIO, port: ServoPort, angle: number): Generator<void, void, void> {
  io.setServo(port, angle);
  yield* waitUntil(() => io.servoDone(port));
}

const armUp = (io: RobotIO) => servo(io, G.liftServo, G.liftUpAngle);
const armDown = (io: RobotIO) => servo(io, G.liftServo, G.liftDownAngle);
const closeClaw = (io: RobotIO) => servo(io, G.clawServo, G.clawClosedAngle);
const openClaw = (io: RobotIO) => servo(io, G.clawServo, G.clawOpenAngle);

// ---- game elements

function makeBody(part: Partial<Body> & Pick<Body, 'id' | 'x' | 'y' | 'w' | 'l' | 'h'>): Body {
  const z = part.z ?? 0;
  const restingOn = part.restingOn ?? null;
  return {
    kind: 'thing',
    label: part.id,
    fill: '#888',
    angle: 0,
    z,
    restingOn,
    held: false,
    grippable: false,
    platform: false,
    mass: 1,
    home: { x: part.x, y: part.y, angle: part.angle ?? 0, z, restingOn },
    ...part,
  };
}

const tower = (id: string, x: number, y: number): Body =>
  makeBody({ id, kind: 'tower', x, y, w: 70, l: 70, h: 50, platform: true, mass: 3 });

const bucketOn = (t: Body, color: ColorName = 'red'): Body =>
  makeBody({
    id: `bucket:${color}`,
    kind: 'bucket',
    colorName: color,
    x: t.x,
    y: t.y,
    w: 40,
    l: 40,
    h: 40,
    z: t.h,
    restingOn: t.id,
    grippable: true,
  });

const person = (x: number, y: number, color: ColorName = 'green'): Body =>
  makeBody({ id: `person:${color}`, kind: 'person', colorName: color, x, y, w: 40, l: 40, h: 60, grippable: true });

interface TestGameOptions {
  bodies?: Body[];
  duration?: number;
  onScore?: (ctx: ScoreContext<null>) => void;
}

/** A minimal game: the Fire Rescue mat and start zone, with only the bodies a test asks for. */
function makeGame(o: TestGameOptions = {}): Game<null> {
  const bodies = o.bodies ?? [];
  return {
    id: 'test',
    title: 'Test game',
    mat: { width: 1250, height: 1250, imageUrl: '', sensorImageUrl: '', vector: MAT_VECTOR },
    matchDuration: o.duration ?? 180,
    startZone: FIRE_STATION,
    defaultStartPose: START,
    restartPenalty: 5,
    defaultScenario: () => null,
    randomScenario: () => null,
    scenarioCount: () => 1,
    encodeScenario: () => '',
    decodeScenario: () => null,
    describeScenario: () => '',
    createBodies: () => bodies.map((b) => ({ ...b, home: { ...b.home } })),
    overlays: () => [],
    score: (ctx) => {
      o.onScore?.(ctx);
      return { total: 100 - 5 * ctx.restarts, max: 180, lines: [], complete: false };
    },
  };
}

interface SetupOptions extends TestGameOptions {
  startPose?: Pose;
  config?: RobotConfig;
  seed?: number;
}

function setup(script: Script, o: SetupOptions = {}) {
  const harness = scripted(script);
  const sim = createEngineSimulation(
    {
      game: makeGame(o),
      scenario: null,
      robotConfig: o.config ?? CFG,
      program: {},
      startPose: o.startPose,
      seed: o.seed,
    },
    harness.factory,
  );
  const body = (id: string): Body => {
    const b = sim.world.bodies.find((x) => x.id === id);
    assert.ok(b, `body ${id} exists`);
    return b;
  };
  return { sim, harness, body, robot: sim.world.robot };
}

/** Start the match and run it until it ends. Returns every event of the match. */
function runToEnd(sim: Simulation<null>, maxTicks = 20000): SimEvent[] {
  sim.start();
  sim.step(maxTicks);
  assert.equal(sim.status, 'finished', 'the match ended');
  return sim.drainEvents();
}

// =============================================================================================
// Robot description
// =============================================================================================

test('default robot: fits 250 x 250 mm and stands completely inside the Fire Station', () => {
  const size = robotSize(CFG);
  assert.ok(size.length <= 250, `length ${size.length}`);
  assert.ok(size.width <= 250, `width ${size.width}`);
  assert.ok(CFG.chassisHeight <= 250);
  assert.ok(robotFitsInRect(CFG, START, FIRE_STATION), 'fits at the Fire Rescue start pose');
  for (const shape of robotShapesAt(CFG, START)) assert.ok(rectContainsOBB(FIRE_STATION, shape));
  // one step too far up and the claw sticks out
  assert.ok(!robotFitsInRect(CFG, { ...START, y: START.y - 10 }, FIRE_STATION));
});

test('default robot: the gripper matches the size of the game elements', () => {
  // claw: open is wider than a 40 mm bucket / person, closed is narrower (so it clamps them)
  assert.ok(clawGapForAngle(G, G.clawOpenAngle) > 40);
  assert.ok(clawGapForAngle(G, G.clawClosedAngle) < 40);
  // an open claw does not fit around a 70 mm tower
  assert.ok(clawGapForAngle(G, G.clawOpenAngle) < 70);
  // arm down: the fingers are low enough for things standing on the mat
  const down = liftHeightForAngle(G, G.liftDownAngle);
  assert.ok(down < 40);
  // arm up: the fingers clear a 50 mm tower and reach a bucket standing on it (50..90 mm)
  const up = liftHeightForAngle(G, G.liftUpAngle);
  assert.ok(up >= 50 && up < 90);
  // a person gripped on the mat is lifted higher than a tower
  assert.ok(up - down > 50);
  // in between is linear, outside the range it stays at the end stops
  near(liftHeightForAngle(G, (G.liftDownAngle + G.liftUpAngle) / 2), (down + up) / 2, 1e-9);
  assert.equal(liftHeightForAngle(G, 180), up);
  // with the chassis touching a tower, the bucket in the middle of the tower is between the fingers
  const bucketCentre = CFG.chassisFront + 35;
  assert.ok(Math.abs(bucketCentre - G.gripForward) <= 5);
  assert.equal(SIM_DT, 0.01);
});

// =============================================================================================
// Driving
// =============================================================================================

test('driving straight: the distance matches the encoder maths', () => {
  const { sim, harness, robot } = setup(function* (io) {
    io.startMotion(720, 720, 90);
    yield* waitUntil(() => io.motionDone());
  });
  runToEnd(sim);
  assert.equal(sim.finishReason, 'program-ended');
  const io = harness.io();
  near(io.wheelAngle('left'), 720, 1e-6, 'left encoder');
  near(io.wheelAngle('right'), 720, 1e-6, 'right encoder');
  near(robot.pose.x, START.x, 1e-6, 'x');
  near(robot.pose.y, START.y - 720 * MM_PER_DEG, 1e-6, 'y'); // two wheel turns = 402 mm up the mat
  near(robot.pose.heading, 0, 1e-9, 'heading');
  assert.equal(io.wheelRpm('left'), 0);
});

test('driving at a set speed: the wheels speed up gradually, cruise, and brake', () => {
  let cruiseRpm = 0;
  let rpmAfterOneTick = 0;
  const { sim, harness, robot } = setup(function* (io) {
    io.setWheelRpm('left', 60);
    io.setWheelRpm('right', 60);
    yield;
    rpmAfterOneTick = io.wheelRpm('left');
    yield* sleep(100);
    cruiseRpm = io.wheelRpm('left');
    io.stopWheel('all');
  });
  runToEnd(sim);
  assert.equal(sim.finishReason, 'program-ended');
  near(rpmAfterOneTick, CFG.rpmPerSecond * SIM_DT, 1e-9, 'acceleration limit');
  assert.equal(cruiseRpm, 60);
  assert.equal(robot.left.rpm, 0, 'the match only ends once the wheels have stopped');
  const io = harness.io();
  const travelled = START.y - robot.pose.y;
  near(travelled, io.wheelAngle('left') * MM_PER_DEG, 1e-6, 'distance = encoder angle x mm per degree');
  // about one second at 60 RPM = 201 mm
  near(travelled, Math.PI * CFG.wheelDiameter, 15);
  // power mode: 50 % of the top speed
  io.setWheelPower('left', 50);
  assert.equal(robot.left.targetRpm, CFG.maxRpm / 2);
  assert.equal(io.wheelPower('left'), 50);
  // the speed limit of the motors
  io.setWheelRpm('right', 1000);
  assert.equal(robot.right.targetRpm, CFG.maxRpm);
});

test('turning on the spot by 90 degrees', () => {
  const { sim, harness, robot } = setup(function* (io) {
    yield* turn(io, 90);
  });
  runToEnd(sim);
  near(robot.pose.heading, 90 * DEG, 1e-9, 'heading');
  near(robot.yawDeg, 90, 1e-6, 'gyro');
  near(harness.io().yawDeg(), 90, 1e-6, 'gyro through RobotIO');
  near(robot.pose.x, START.x, 1e-9, 'x');
  near(robot.pose.y, START.y, 1e-9, 'y');
  near(harness.io().wheelAngle('left'), 157.5, 1e-6, 'left wheel: 90 x 112 / 64 degrees');
  near(harness.io().wheelAngle('right'), -157.5, 1e-6);
});

test('a curved encoder move: both wheels finish together', () => {
  const { sim, harness, robot } = setup(function* (io) {
    io.startMotion(600, 300, 80);
    yield;
    // the slower wheel runs at half the speed of the faster one
    near(io.wheelRpm('right') * 2, io.wheelRpm('left'), 1e-9, 'speed ratio');
    yield* waitUntil(() => io.motionDone());
  });
  runToEnd(sim);
  const io = harness.io();
  near(io.wheelAngle('left'), 600, 1e-6);
  near(io.wheelAngle('right'), 300, 1e-6);
  // left wheel went further -> the robot turned clockwise by (600 - 300) deg x mm/deg / track
  near(robot.yawDeg, ((300 * MM_PER_DEG) / CFG.trackWidth) / DEG, 1e-6, 'yaw');
  assert.ok(robot.pose.x > START.x + 20, 'curved to the right');
});

test('a new wheel command replaces an encoder move', () => {
  let doneAfterStop = false;
  const { sim, harness } = setup(function* (io) {
    io.startMotion(2000, 2000, 60);
    yield* sleep(30);
    assert.equal(io.motionDone(), false);
    io.stopWheel('all');
    doneAfterStop = io.motionDone();
  });
  runToEnd(sim);
  assert.equal(doneAfterStop, true);
  assert.ok(harness.io().wheelAngle('left') < 300, 'the move was cut short');
});

// =============================================================================================
// Pushing
// =============================================================================================

test('pushing a tower moves it (arm down: the claw is narrower than a tower)', () => {
  const t = tower('tower:T', 625, 400);
  const { sim, body, robot } = setup(
    function* (io) {
      yield* drive(io, 150);
    },
    { bodies: [t] },
  );
  sim.start();
  sim.step(70);
  assert.equal(robot.touching, true, 'pressing against the tower while pushing');
  sim.step(5000);
  assert.equal(sim.status, 'finished');
  // the finger tips started 506.2 - 435 = 71.2 mm away from the tower: it is pushed the other 78.8 mm
  const fingerTip = robot.pose.y - (G.gripForward + G.fingerLength / 2);
  near(body('tower:T').y + 35, fingerTip, 0.5, 'the tower sits right in front of the fingers');
  near(body('tower:T').y, 400 - 78.8, 1, 'tower y');
  near(body('tower:T').x, 625, 1, 'tower x');
  const bumps = sim.drainEvents().filter((e) => e.type === 'bump');
  assert.equal(bumps.length, 1, 'one bump event for one long push');
  assert.equal(bumps[0].type === 'bump' && bumps[0].bodyId, 'tower:T');
  assert.equal(robot.touching, false, 'not pressing any more once stopped');
});

test('a bucket standing on a pushed tower rides along', () => {
  const t = tower('tower:T', 625, 400);
  const { sim, body } = setup(
    function* (io) {
      yield* armUp(io); // fingers above the tower: now the chassis pushes it
      yield* drive(io, 200);
    },
    { bodies: [t, bucketOn(t)] },
  );
  runToEnd(sim);
  // chassis front started 568.2 - 435 = 133.2 mm away: the tower is pushed the other 66.8 mm
  near(body('tower:T').y, 400 - 66.8, 1, 'tower y');
  near(body('bucket:red').y, body('tower:T').y, 1e-6, 'bucket y follows');
  near(body('bucket:red').x, body('tower:T').x, 1e-6, 'bucket x follows');
  assert.equal(body('bucket:red').restingOn, 'tower:T');
  assert.equal(body('bucket:red').z, 50);
});

test('a bucket pushed off its tower falls to the mat', () => {
  const t = tower('tower:T', 625, 400);
  const { sim, body } = setup(
    function* (io) {
      yield* armUp(io);
      yield* drive(io, 125); // the right finger tip pushes the bucket across the tower
    },
    // stand 36 mm to the left, so that the right finger is in line with the bucket
    { bodies: [t, bucketOn(t)], startPose: { x: 625 - 36, y: START.y, heading: 0 } },
  );
  runToEnd(sim);
  const b = body('bucket:red');
  assert.equal(b.restingOn, null);
  assert.equal(b.z, 0);
  assert.ok(b.y + 20 <= body('tower:T').y - 35 + 1e-6, 'it lies on the mat beyond the tower, not inside it');
  near(body('tower:T').y, 400, 1e-6, 'the tower did not move');
});

test('things push each other, and a body jammed against the table wall stops the robot', () => {
  const t = tower('tower:T', 625, 300);
  const p = person(625, 200);
  const { sim, body, robot } = setup(
    function* (io) {
      io.setWheelRpm('left', 80);
      io.setWheelRpm('right', 80);
      yield* forever();
    },
    { bodies: [t, p], duration: 8 },
  );
  const events = runToEnd(sim);
  assert.equal(sim.finishReason, 'time');
  // the wall is 100 mm outside the mat: person (40) against the wall, tower (70) against the person
  near(body('person:green').y, -100 + 20, 1, 'person against the wall');
  near(body('tower:T').y, -100 + 40 + 35, 1, 'tower against the person');
  const fingerTip = robot.pose.y - (G.gripForward + G.fingerLength / 2);
  near(fingerTip, -100 + 40 + 70, 1.5, 'robot against the tower');
  assert.ok(events.some((e) => e.type === 'bump' && e.bodyId === 'tower:T'));
});

test('the robot cannot leave the table', () => {
  const { sim, robot } = setup(
    function* (io) {
      io.setWheelRpm('left', 150);
      io.setWheelRpm('right', 150);
      yield* forever();
    },
    { duration: 5 },
  );
  const events = runToEnd(sim);
  const fingerTip = robot.pose.y - (G.gripForward + G.fingerLength / 2);
  near(fingerTip, -100, 0.5, 'claw against the wall, 100 mm outside the mat');
  assert.ok(events.some((e) => e.type === 'bump' && e.bodyId === 'wall'));
  assert.equal(robot.touching, false, 'the finished robot stands still');
});

// =============================================================================================
// Gripper
// =============================================================================================

test('grab a person from the mat, lift it, carry it and put it on a tower', () => {
  const t = tower('tower:T', 625, 250);
  const seen: Record<string, unknown> = {};
  const { sim, body, robot } = setup(
    function* (io) {
      yield* drive(io, 51.2); // the person is now in the middle of the claw
      yield* closeClaw(io);
      seen.clawAngle = io.servoAngle(G.clawServo);
      seen.holding = robot.gripper.holding;
      yield* armUp(io);
      seen.liftedZ = body('person:green').z;
      yield* drive(io, 230); // carried above the tower
      seen.carriedY = body('person:green').y;
      yield* armDown(io); // the person comes down onto the tower top and stops the arm
      seen.restZ = body('person:green').z;
      seen.liftAngle = io.servoAngle(G.liftServo);
      seen.liftDone = io.servoDone(G.liftServo);
      yield* openClaw(io);
      yield* drive(io, -80);
    },
    { bodies: [t, person(625, 480)] },
  );
  const events = runToEnd(sim);
  const p = body('person:green');

  // the claw closed until it met the 40 mm person, then the servo was "done"
  near(seen.clawAngle as number, 60 * ((64 - 40) / (64 - 20)), 1e-6, 'claw servo stalls at the object');
  assert.equal(seen.holding, 'person:green');
  assert.equal(seen.liftedZ, 70, 'gripped at 5 mm, lifted with the arm to 75 mm');
  near(seen.carriedY as number, 250, 0.01, 'carried to above the tower centre');
  assert.equal(seen.restZ, 50, 'lowered until it stands on the tower');
  assert.equal(seen.liftDone, true);
  assert.ok((seen.liftAngle as number) > 60, 'the arm could not go all the way down');

  assert.equal(p.held, false);
  assert.equal(p.restingOn, 'tower:T');
  assert.equal(p.z, 50);
  near(p.x, 625, 0.01);
  near(p.y, 250, 0.01);
  assert.equal(robot.gripper.holding, null);
  near(body('tower:T').y, 250, 1e-6, 'the tower was not pushed');

  const story = events.filter((e) => e.type === 'grab' || e.type === 'release');
  assert.deepEqual(
    story.map((e) => (e.type === 'release' ? `release ${e.bodyId} onto ${e.onto}` : e.type === 'grab' ? `grab ${e.bodyId}` : '')),
    ['grab person:green', 'release person:green onto tower:T'],
  );
});

test('a person released high above a tower lands on it; released beside it, on the mat', () => {
  const t = tower('tower:T', 625, 250);
  const onto = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
      yield* armUp(io);
      yield* drive(io, 230);
      yield* openClaw(io); // dropped from 70 mm onto the 50 mm tower
    },
    { bodies: [t, person(625, 480)] },
  );
  runToEnd(onto.sim);
  assert.equal(onto.body('person:green').restingOn, 'tower:T');
  assert.equal(onto.body('person:green').z, 50);

  const beside = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
      yield* armUp(io);
      yield* drive(io, 100);
      yield* openClaw(io); // nowhere near the tower
    },
    { bodies: [t, person(625, 480)] },
  );
  runToEnd(beside.sim);
  assert.equal(beside.body('person:green').restingOn, null);
  assert.equal(beside.body('person:green').z, 0);
});

test('a carried person that is not lifted high enough cannot pass through a tower', () => {
  const t = tower('tower:T', 625, 250);
  const low = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
      // lift a little: the fingers (51.7 mm up) clear the 50 mm tower, the person's feet (46.7 mm) do not
      yield* servo(io, G.liftServo, 60);
      yield* drive(io, 230);
    },
    { bodies: [t, person(625, 480)] },
  );
  runToEnd(low.sim);
  const p = low.body('person:green');
  near(low.robot.gripper.height, 5 + (70 * 60) / 90, 1e-9, 'finger height');
  near(p.z, (70 * 60) / 90, 1e-9, 'person height');
  assert.equal(p.held, true);
  // the person ran into the tower and pushed it along
  assert.ok(low.body('tower:T').y < 250 - 30, `tower was pushed: ${low.body('tower:T').y}`);
  near(p.y - 20, low.body('tower:T').y + 35, 0.5, 'person against the tower');
});

test('grab a bucket from a 50 mm tower with the arm raised, put it on the mat', () => {
  const t = tower('tower:T', 625, 400);
  const seen: Record<string, unknown> = {};
  const { sim, body, robot } = setup(
    function* (io) {
      yield* armUp(io);
      yield* drive(io, 131.2); // chassis just short of the tower, bucket in the middle of the claw
      yield* closeClaw(io);
      seen.holding = robot.gripper.holding;
      seen.restingOn = body('bucket:red').restingOn;
      seen.z = body('bucket:red').z;
      yield* drive(io, -100);
      yield* armDown(io); // stops when the bucket stands on the mat
      seen.loweredZ = body('bucket:red').z;
      seen.gripperHeight = robot.gripper.height;
      yield* openClaw(io);
    },
    { bodies: [t, bucketOn(t)] },
  );
  const events = runToEnd(sim);
  assert.equal(seen.holding, 'bucket:red');
  assert.equal(seen.restingOn, null);
  assert.equal(seen.z, 50, 'gripped where it stood');
  assert.equal(seen.loweredZ, 0);
  near(seen.gripperHeight as number, 25, 1e-9, 'the arm stopped 25 mm up: the bucket was gripped near its top');
  const b = body('bucket:red');
  assert.equal(b.held, false);
  assert.equal(b.z, 0);
  assert.equal(b.restingOn, null);
  near(b.y, 400 + 100, 0.5, 'put down 100 mm in front of where it was');
  near(body('tower:T').y, 400, 1e-6, 'the tower stayed where it was');
  assert.ok(events.some((e) => e.type === 'release' && e.onto === null));
});

test('with the arm down the claw cannot reach a bucket on a tower', () => {
  const t = tower('tower:T', 625, 400);
  const { sim, body, robot } = setup(
    function* (io) {
      yield* drive(io, 131.2);
      yield* closeClaw(io);
    },
    { bodies: [t, bucketOn(t)] },
  );
  runToEnd(sim);
  assert.equal(robot.gripper.holding, null);
  assert.equal(robot.gripper.gap, G.clawClosedGap, 'the claw closed completely on nothing');
  assert.equal(body('bucket:red').restingOn, 'tower:T');
  assert.ok(body('tower:T').y < 400 - 30, 'the fingers pushed the tower away instead');
});

test('closing fingers centre an object that is off to one side, and square up a turned one', () => {
  const offCentre = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
    },
    { bodies: [person(625 + 9, 480)] },
  );
  runToEnd(offCentre.sim);
  assert.equal(offCentre.robot.gripper.holding, 'person:green');
  near(offCentre.body('person:green').x, 625, 1e-6, 'centred between the fingers');

  const turned = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
    },
    { bodies: [{ ...person(625, 480), angle: 30 * DEG }] },
  );
  runToEnd(turned.sim);
  assert.equal(turned.robot.gripper.holding, 'person:green');
  near(turned.body('person:green').angle, 0, 1e-9, 'squared up');
  near(turned.robot.gripper.gap, 40, 1e-9);
});

test('the claw works the same whichever way the robot faces, and the load swings round with it', () => {
  const { sim, body, robot } = setup(
    function* (io) {
      yield* drive(io, 30);
      yield* closeClaw(io);
      yield* armUp(io);
      yield* turn(io, 90);
    },
    // facing right (+x); the person stands 30 mm beyond the middle of the claw
    { bodies: [person(400 + G.gripForward + 30, 800)], startPose: { x: 400, y: 800, heading: 90 * DEG } },
  );
  runToEnd(sim);
  const p = body('person:green');
  assert.equal(robot.gripper.holding, 'person:green');
  near(Math.abs(robot.pose.heading), 180 * DEG, 1e-9, 'now facing down the mat');
  near(p.x, 430, 1e-6, 'person x');
  near(p.y, 800 + G.gripForward, 1e-6, 'person y: straight ahead of the robot');
  near(Math.cos(p.angle - 90 * DEG), 1, 1e-9, 'the person turned by 90 degrees, like the robot');
  assert.equal(p.z, 70);
});

test('the claw stops against a thing it cannot grip', () => {
  const block = makeBody({ id: 'block', x: 625, y: 480, w: 40, l: 40, h: 40 }); // not grippable
  const seen: Record<string, unknown> = {};
  const { sim, body, robot } = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
      seen.done = io.servoDone(G.clawServo);
      seen.angle = io.servoAngle(G.clawServo);
    },
    { bodies: [block] },
  );
  runToEnd(sim);
  assert.equal(sim.finishReason, 'program-ended', 'a stalled servo does not keep the match going');
  assert.equal(seen.done, true);
  assert.ok((seen.angle as number) < G.clawClosedAngle, 'the servo could not reach its target');
  assert.equal(robot.gripper.holding, null);
  assert.ok(robot.gripper.gap >= 40 && robot.gripper.gap < 41.5, `fingers rest against the block: gap ${robot.gripper.gap}`);
  near(body('block').x, 625, 1e-6);
  near(body('block').y, 480, 1e-6);
});

test('a box caught between the finger tips is pushed along, the robot does not get stuck', () => {
  // The claw holds a person (gap 40 mm). A bucket turned by 5 degrees is 43 mm wide: too wide
  // to slip between the finger tips, so it has to be shoved ahead of them.
  const bucket = makeBody({ id: 'bucket:blue', x: 625, y: 380, w: 40, l: 40, h: 40, angle: 5 * DEG, grippable: true });
  const { sim, body, robot } = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
      yield* drive(io, 120);
    },
    { bodies: [person(625, 480), bucket] },
  );
  runToEnd(sim);
  assert.equal(robot.gripper.holding, 'person:green');
  near(robot.pose.y, START.y - 51.2 - 120, 0.5, 'the robot drove the whole way');
  const fingerTip = robot.pose.y - (G.gripForward + G.fingerLength / 2);
  const b = body('bucket:blue');
  assert.ok(b.y < 380 - 50, `the bucket was pushed: ${b.y}`);
  assert.ok(b.y + 20 * (Math.cos(5 * DEG) + Math.sin(5 * DEG)) <= fingerTip + 3, 'it stays ahead of the finger tips');
});

// =============================================================================================
// Sensors
// =============================================================================================

test('colour names for the colours printed on the mat', () => {
  assert.equal(classifyColor(PRINT_COLORS.red), 'red');
  assert.equal(classifyColor(PRINT_COLORS.green), 'green');
  assert.equal(classifyColor(PRINT_COLORS.blue), 'blue', 'the light blue of the mat counts as blue');
  assert.equal(classifyColor(PRINT_COLORS.yellow), 'yellow');
  assert.equal(classifyColor(PRINT_COLORS.white), 'white');
  assert.equal(classifyColor({ r: 8, g: 7, b: 6 }), 'black');
  assert.equal(classifyColor({ r: 0, g: 0, b: 255 }), 'blue');
  assert.equal(classifyColor({ r: 0, g: 255, b: 255 }), 'cyan');
  assert.equal(classifyColor({ r: 160, g: 32, b: 240 }), 'purple');
  // only really dark things are "line": none of the game colours
  for (const name of ['red', 'green', 'blue', 'yellow', 'orange', 'white'] as const) {
    assert.equal(makeProbeReading(PRINT_COLORS[name], CFG.quadRgb.lineThreshold).onLine, false, name);
  }
  const black = makeProbeReading({ r: 8, g: 7, b: 6 }, CFG.quadRgb.lineThreshold);
  assert.equal(black.onLine, true);
  near(black.light + black.gray, 100, 1e-9);
});

test('line sensor: sees the black centre line of the Fire Rescue mat', () => {
  // The centre line runs along x = 625 (26 mm wide). The probes are 85 mm ahead of the axle.
  const at = (x: number) => setup(forever, { startPose: { x, y: 400, heading: 0 } });

  const centred = at(625);
  const io = centred.harness.io();
  assert.equal(io.lineStatus(), 0b0110, 'L1 and R1 on the line, L2 and R2 beside it');
  assert.equal(io.probe('L1').onLine, true);
  assert.equal(io.probe('L1').color, 'black');
  assert.ok(io.probe('L1').light < 10);
  assert.equal(io.probe('L2').onLine, false);
  assert.equal(io.probe('L2').color, 'white');
  assert.ok(io.probe('R2').light > 90);
  assert.equal(io.lineOffset(), 0);

  // robot 10 mm left of the line -> the line is under its right probes -> NEGATIVE deviation,
  // like on the real mBot2 ("-100 = the sensor is on the left of the line")
  const left = at(615).harness.io();
  assert.equal(left.lineStatus(), 0b0011);
  assert.ok(left.lineOffset() < -30, `offset ${left.lineOffset()}`);
  // robot 10 mm right of the line -> the line is under its left probes -> positive deviation
  const right = at(635).harness.io();
  assert.equal(right.lineStatus(), 0b1100);
  assert.ok(right.lineOffset() > 30, `offset ${right.lineOffset()}`);
  near(right.lineOffset(), -left.lineOffset(), 1e-6, 'mirror image');

  // no line at all
  const lost = at(500).harness.io();
  assert.equal(lost.lineStatus(), 0);
  assert.equal(lost.lineOffset(), 0);

  // the dashboard sees the same values
  const snapshot = centred.sim.readSensors();
  assert.equal(snapshot.lineStatus, 0b0110);
  assert.equal(snapshot.probes.R1.color, 'black');
  assert.equal(snapshot.probes.R2.color, 'white');
});

test('line sensor: yellow marker, and stopping at a line while driving', () => {
  // the yellow marker on the loop above the Fire Station: y = 395, x = 588 .. 659
  const onMarker = setup(forever, { startPose: { x: 625, y: 395 + CFG.quadRgb.forward, heading: 0 } });
  const io = onMarker.harness.io();
  for (const name of ['L2', 'L1', 'R1', 'R2'] as const) assert.equal(io.probe(name).color, 'yellow', name);
  assert.equal(io.lineStatus(), 0, 'yellow is not a line');

  // drive out of the Fire Station until the centre line (it starts at y = 500) is under L1 and R1
  const driving = setup(function* (robotIO) {
    robotIO.setWheelRpm('left', 40);
    robotIO.setWheelRpm('right', 40);
    yield* waitUntil(() => (robotIO.lineStatus() & 0b0110) === 0b0110);
    robotIO.stopWheel('all');
  });
  runToEnd(driving.sim);
  const probeY = driving.robot.pose.y - CFG.quadRgb.forward;
  assert.ok(probeY < 500 && probeY > 490, `stopped with the probes just on the line: ${probeY}`);
});

test('lineOffsetOf: weighted position of the dark probes, signed like the real Quad RGB sensor', () => {
  const dark = makeProbeReading({ r: 0, g: 0, b: 0 }, 35);
  const bright = makeProbeReading({ r: 255, g: 255, b: 255 }, 35);
  const offsets = CFG.quadRgb.probeOffsets;
  // the readings are in the order L2, L1, R1, R2 (the robot's left to its right)
  assert.equal(lineOffsetOf([dark, bright, bright, bright], offsets, 35), 100, 'line under L2: the sensor is far to the RIGHT of the line');
  assert.equal(lineOffsetOf([bright, bright, bright, dark], offsets, 35), -100, 'line under R2: the sensor is far to the LEFT of the line');
  assert.ok(lineOffsetOf([bright, dark, bright, bright], offsets, 35) > 0, 'line under L1: a little to the right of the line');
  assert.ok(lineOffsetOf([bright, bright, dark, bright], offsets, 35) < 0, 'line under R1: a little to the left of the line');
  assert.equal(lineOffsetOf([dark, dark, dark, dark], offsets, 35), 0);
  assert.equal(lineOffsetOf([bright, bright, bright, bright], offsets, 35), 0);
  // a centred line reads plain 0, not "-0" (which would print as "-0" on the screen)
  assert.ok(Object.is(lineOffsetOf([bright, dark, dark, bright], offsets, 35), 0), 'centred: 0, not -0');
});

test("line deviation: Makeblock's proportional line follower steers TOWARDS the line", () => {
  // The follower from Makeblock's mBot2 examples, word for word:
  //     left_power  =       base_power - kp * deviation        -> motor EM1 (left wheel)
  //     right_power = -1 * (base_power + kp * deviation)       -> motor EM2 (right wheel, mirrored)
  // EM2 is mounted mirrored: a NEGATIVE power drives the right wheel forward. RobotIO speaks
  // "wheel, + = robot forward", so the EM2 power changes sign on its way to the right wheel.
  const BASE_POWER = 20;
  const KP = 0.3;
  const LINE_X = 625; // the black centre line of the Fire Rescue mat: x = 625, from y = 500 up to y = 150
  const follower: Script = function* (io) {
    for (;;) {
      const deviation = io.lineOffset();
      const em1Power = BASE_POWER - KP * deviation;
      const em2Power = -1 * (BASE_POWER + KP * deviation);
      io.setWheelPower('left', em1Power);
      io.setWheelPower('right', -em2Power);
      yield;
    }
  };

  for (const startOffset of [-12, 12]) {
    const side = startOffset < 0 ? 'left' : 'right';
    // start beside the line, with the probes on its plain upper part (just past the loop that
    // crosses it at y = 395)
    const startY = 365 + CFG.quadRgb.forward;
    const s = setup(follower, { startPose: { x: LINE_X + startOffset, y: startY, heading: 0 } });
    const startDeviation = s.harness.io().lineOffset();
    assert.equal(Math.sign(startDeviation), Math.sign(startOffset), `robot ${side} of the line: sign of the deviation`);

    s.sim.start();
    // the first thing the robot does is turn towards the line ...
    s.sim.step(Math.round(0.3 / SIM_DT));
    assert.equal(
      Math.sign(s.robot.pose.heading),
      -Math.sign(startOffset),
      `robot ${side} of the line: turns towards it (heading ${(s.robot.pose.heading / DEG).toFixed(1)} deg)`,
    );
    // ... and one second later it has driven on, the line in the middle of the sensor
    s.sim.step(Math.round(1.0 / SIM_DT));
    const io = s.harness.io();
    assert.ok(startY - s.robot.pose.y > 100, `robot ${side} of the line: it kept driving forward (${(startY - s.robot.pose.y).toFixed(0)} mm)`);
    assert.ok(Math.abs(s.robot.pose.x - LINE_X) < Math.abs(startOffset), `robot ${side} of the line: closer to the line (x = ${s.robot.pose.x.toFixed(1)})`);
    assert.notEqual(io.lineStatus() & 0b0110, 0, `robot ${side} of the line: a middle probe is on the line`);
    assert.ok(Math.abs(io.lineOffset()) <= 50, `robot ${side} of the line: small deviation at the end (${io.lineOffset().toFixed(0)})`);
  }
});

test('ultrasonic: sees a tower, not a low object under the beam, nothing outside the beam', () => {
  const low = makeBody({ id: 'kerb', x: 625, y: 450, w: 60, l: 20, h: 20 });
  // the sensor is on the chassis front: y = 673.2 - 105 = 568.2; the tower's near face is at y = 335
  const withTower = setup(forever, { bodies: [tower('tower:T', 625, 300), low] });
  assert.equal(withTower.harness.io().ultrasonicCm(), 23.3);
  assert.equal(withTower.robot.lastUltrasonicCm, 23.3);
  assert.equal(withTower.sim.readSensors().ultrasonicCm, 23.3);

  const onlyLow = setup(forever, { bodies: [low] });
  assert.equal(onlyLow.harness.io().ultrasonicCm(), CFG.ultrasonic.maxRangeCm, 'the beam passes over a 20 mm object');

  const aside = setup(forever, { bodies: [tower('tower:T', 625 + 200, 300)] });
  assert.equal(aside.harness.io().ultrasonicCm(), CFG.ultrasonic.maxRangeCm, 'outside the 12 degree beam');

  const veryClose = setup(forever, { bodies: [person(625, 540)] });
  assert.equal(veryClose.harness.io().ultrasonicCm(), CFG.ultrasonic.minRangeCm, 'never less than the minimum range');

  // a bucket (40 mm) on the mat is tall enough; and the reading follows the robot
  const b = makeBody({ id: 'bucket:blue', x: 625, y: 300, w: 40, l: 40, h: 40, grippable: true });
  const moving = setup(
    function* (io) {
      assert.equal(io.ultrasonicCm(), 24.8);
      yield* drive(io, 100);
      assert.equal(io.ultrasonicCm(), 14.8);
    },
    { bodies: [b] },
  );
  runToEnd(moving.sim);
});

test('front colour sensor: names the object in, or just ahead of, the claw', () => {
  const seen: string[] = [];
  const onMat = setup(
    function* (io) {
      // the sensor sits at the back of the claw (y = 556.2) and sees 60 mm far: up to y = 496.2
      seen.push(io.frontColor()); // the person's near side is at y = 490: still out of range
      yield* drive(io, 20);
      seen.push(io.frontColor());
      yield* drive(io, 41.2);
      yield* closeClaw(io);
      yield* armUp(io);
      seen.push(io.frontColor()); // held
    },
    { bodies: [person(625, 470, 'yellow')] },
  );
  runToEnd(onMat.sim);
  assert.deepEqual(seen, ['none', 'yellow', 'yellow']);

  // the sensor rides on the arm: raised, it looks over a 60 mm person ...
  const seenOverPerson: string[] = [];
  const overPerson = setup(
    function* (io) {
      seenOverPerson.push(io.frontColor());
      yield* armUp(io);
      seenOverPerson.push(io.frontColor());
    },
    { bodies: [person(625, 520, 'red')] },
  );
  runToEnd(overPerson.sim);
  assert.deepEqual(seenOverPerson, ['red', 'none']);

  // ... but straight at a bucket standing on a tower
  const t = tower('tower:T', 625, 400);
  const seenOnTower: string[] = [];
  const onTower = setup(
    function* (io) {
      yield* armUp(io);
      seenOnTower.push(io.frontColor());
      yield* drive(io, 110);
      seenOnTower.push(io.frontColor());
    },
    { bodies: [t, bucketOn(t, 'blue')] },
  );
  runToEnd(onTower.sim);
  assert.deepEqual(seenOnTower, ['none', 'blue']);

  // not fitted -> always 'none'
  const noSensor = setup(forever, {
    bodies: [person(625, 500)],
    config: { ...CFG, frontColorSensor: { enabled: false, rangeMm: 35 } },
  });
  assert.equal(noSensor.harness.io().frontColor(), 'none');
});

test('CyberPi: buttons, LEDs, screen, tone, timer, log, random', () => {
  const { sim, harness, robot } = setup(forever);
  const io = harness.io();
  sim.start();
  sim.step(150);

  assert.equal(io.buttonDown('a'), false);
  sim.setButton('a', true);
  assert.equal(io.buttonDown('a'), true);
  sim.setButton('a', false);
  assert.equal(io.buttonDown('a'), false);

  io.setLed('all', { r: 10, g: 20, b: 30 });
  io.setLed(2, { r: 300, g: -5, b: 0 });
  assert.deepEqual(robot.leds[0], { r: 10, g: 20, b: 30 });
  assert.deepEqual(robot.leds[2], { r: 255, g: 0, b: 0 });
  assert.equal(robot.leds.length, 5);

  io.print('hello');
  io.showLabel('score', 10, 20, 16);
  io.showLabel('SCORE', 10, 20, 16);
  assert.deepEqual(robot.screen.lines, ['hello']);
  assert.deepEqual(robot.screen.labels, [{ text: 'SCORE', x: 10, y: 20, size: 16 }]);
  io.clearScreen();
  assert.deepEqual(robot.screen, { lines: [], labels: [] });

  near(io.timer(), 1.5, 1e-9, 'timer');
  near(io.time, 1.5, 1e-9, 'time');
  io.resetTimer();
  sim.step(50);
  near(io.timer(), 0.5, 1e-9, 'timer after reset');
  near(sim.readSensors().timer, 0.5, 1e-9);
  assert.equal(io.dt, SIM_DT);
  assert.equal(io.config, CFG);

  sim.drainEvents();
  io.tone(440, 0.25);
  io.log('warn', 'careful', 'block-1');
  assert.deepEqual(sim.drainEvents(), [
    { type: 'tone', frequency: 440, seconds: 0.25, time: 2 },
    { type: 'log', level: 'warn', text: 'careful', blockId: 'block-1', time: 2 },
  ]);
  assert.deepEqual(sim.drainEvents(), [], 'draining empties the list');

  const r = io.random();
  assert.ok(r >= 0 && r < 1);
  // same seed -> same random numbers
  const again = setup(forever).harness.io();
  assert.equal(again.random(), r);

  io.resetWheelAngle('all');
  io.resetYaw();
  assert.equal(io.wheelAngle('left'), 0);
  assert.equal(io.yawDeg(), 0);
});

// =============================================================================================
// Match flow
// =============================================================================================

test('the match ends when the time is up', () => {
  const { sim } = setup(forever, { duration: 2 });
  assert.equal(sim.status, 'ready');
  assert.equal(sim.timeLeft, 2);
  sim.step(50);
  assert.equal(sim.world.tick, 0, 'nothing happens before the start signal');
  sim.start();
  assert.equal(sim.status, 'running');
  sim.step(150);
  near(sim.timeLeft, 0.5, 1e-9);
  assert.equal(sim.status, 'running');
  sim.step(1000);
  assert.equal(sim.status, 'finished');
  assert.equal(sim.finishReason, 'time');
  assert.equal(sim.timeLeft, 0);
  assert.equal(sim.world.tick, 200);
  near(sim.world.time, 2, 1e-9);
  assert.deepEqual(
    sim.drainEvents().filter((e) => e.type === 'finish'),
    [{ type: 'finish', reason: 'time', time: 2 }],
  );
  sim.step(100);
  assert.equal(sim.world.tick, 200, 'a finished match does not go on');
});

test('the match ends when the program has ended and the robot stands still', () => {
  // wheels left running: the program is over but the robot is not at rest -> play on until time
  const running = setup(
    function* (io) {
      io.setWheelRpm('left', 20);
      io.setWheelRpm('right', -20);
      yield;
    },
    { duration: 3 },
  );
  runToEnd(running.sim);
  assert.equal(running.sim.finishReason, 'time');
  assert.equal(running.robot.left.rpm, 0, 'the referee stops the robot at the end');

  // a servo still moving: wait for it
  const moving = setup(function* (io) {
    io.setServo(G.liftServo, G.liftUpAngle);
    yield;
  });
  runToEnd(moving.sim);
  assert.equal(moving.sim.finishReason, 'program-ended');
  assert.equal(moving.robot.gripper.height, G.liftUpHeight);
  near(moving.sim.world.time, 0.5, 0.02, 'a 90 degree servo move takes half a second');
});

test('declaring "Finished" stops the robot and ends the match', () => {
  const { sim, harness, robot } = setup(function* (io) {
    io.setWheelRpm('left', 100);
    io.setWheelRpm('right', 100);
    yield* forever();
  });
  sim.declareFinished();
  assert.equal(sim.status, 'ready', 'cannot finish a match that has not started');
  sim.start();
  sim.step(100);
  sim.declareFinished();
  assert.equal(sim.status, 'finished');
  assert.equal(sim.finishReason, 'declared');
  assert.equal(robot.left.rpm, 0);
  assert.equal(harness.io().wheelRpm('right'), 0);
  const y = robot.pose.y;
  sim.step(100);
  assert.equal(robot.pose.y, y);
  assert.ok(sim.drainEvents().some((e) => e.type === 'finish' && e.reason === 'declared'));
});

test('restart: robot back in the start zone, carried bucket back on its tower, clock keeps running', () => {
  const t = tower('tower:T', 625, 400);
  let restartsSeenByScore = -1;
  const { sim, harness, body, robot } = setup(
    function* (io) {
      io.print('started');
      io.setLed('all', { r: 255, g: 0, b: 0 });
      yield* armUp(io);
      yield* drive(io, 131.2);
      yield* closeClaw(io);
      yield* drive(io, -60);
      yield* turn(io, 40);
      yield* forever();
    },
    { bodies: [t, bucketOn(t)], onScore: (ctx) => (restartsSeenByScore = ctx.restarts) },
  );
  sim.restart();
  assert.equal(sim.restarts, 0, 'no restart before the match has started');

  sim.start();
  sim.step(400);
  assert.equal(robot.gripper.holding, 'bucket:red');
  assert.equal(body('bucket:red').held, true);
  assert.ok(Math.abs(robot.pose.heading) > 0.5);
  const timeBefore = sim.world.time;
  sim.drainEvents();

  sim.restart();
  assert.equal(sim.restarts, 1);
  assert.equal(sim.status, 'running');
  assert.equal(sim.world.time, timeBefore, 'the clock is not reset');
  assert.deepEqual(robot.pose, START);
  assert.equal(robot.left.rpm, 0);
  assert.equal(robot.left.angleDeg, 0);
  assert.equal(robot.yawDeg, 0);
  assert.equal(robot.servos[G.liftServo].angle, G.liftDownAngle);
  assert.equal(robot.servos[G.clawServo].angle, G.clawOpenAngle);
  assert.equal(robot.gripper.height, G.liftDownHeight);
  assert.equal(robot.gripper.gap, G.clawOpenGap);
  assert.equal(robot.gripper.holding, null);
  assert.deepEqual(robot.screen.lines, []);
  assert.deepEqual(robot.leds[0], { r: 0, g: 0, b: 0 });
  assert.equal(harness.io().timer(), 0, 'the program timer starts again');

  const b = body('bucket:red');
  assert.equal(b.held, false);
  assert.equal(b.x, 625);
  assert.equal(b.y, 400);
  assert.equal(b.z, 50);
  assert.equal(b.restingOn, 'tower:T');
  assert.deepEqual(sim.drainEvents(), [{ type: 'restart', time: timeBefore }]);
  assert.equal(harness.starts(), 2, 'the program was started again');

  assert.equal(sim.score().total, 95);
  assert.equal(restartsSeenByScore, 1);

  // the program really runs again from the top
  sim.step(400);
  assert.equal(robot.gripper.holding, 'bucket:red');
  assert.deepEqual(robot.screen.lines, ['started']);
});

test('restart: if the tower has moved, or the place is taken, the bucket goes on the mat next to it', () => {
  const grabAndWait: Script = function* (io) {
    yield* armUp(io);
    yield* drive(io, 131.2);
    yield* closeClaw(io);
    yield* drive(io, -60);
    yield* forever();
  };

  // ---- the tower has moved away
  const t = tower('tower:T', 625, 400);
  const moved = setup(grabAndWait, { bodies: [t, bucketOn(t)] });
  moved.sim.start();
  moved.sim.step(300);
  assert.equal(moved.robot.gripper.holding, 'bucket:red');
  moved.body('tower:T').x += 100;
  moved.sim.restart();
  let b = moved.body('bucket:red');
  assert.equal(b.held, false);
  assert.equal(b.restingOn, null);
  assert.equal(b.z, 0);
  assert.equal(b.x, 625, 'on the mat where the tower used to be');
  assert.equal(b.y, 400);

  // ---- somebody else now stands on the tower
  const squatter = person(200, 200);
  const taken = setup(grabAndWait, { bodies: [t, bucketOn(t), squatter] });
  taken.sim.start();
  taken.sim.step(300);
  Object.assign(taken.body('person:green'), { x: 625, y: 400, z: 50, restingOn: 'tower:T' });
  taken.sim.restart();
  b = taken.body('bucket:red');
  assert.equal(b.restingOn, null);
  assert.equal(b.z, 0);
  const distance = Math.hypot(b.x - 625, b.y - 400);
  assert.ok(distance >= 55 && distance <= 90, `next to the tower: ${distance} mm from its centre`);
  near(taken.body('tower:T').y, 400, 1e-6, 'the tower is not disturbed');
  assert.equal(taken.body('person:green').restingOn, 'tower:T');
});

test('the start pose can only be chosen before the match and inside the start zone', () => {
  const { sim, robot } = setup(forever);
  assert.equal(sim.setStartPose({ x: 625, y: 660, heading: 0 }), false, 'the claw would stick out of the Fire Station');
  assert.deepEqual(robot.pose, START);
  assert.equal(sim.setStartPose({ x: 600, y: 675, heading: 0 }), true);
  assert.deepEqual(robot.pose, { x: 600, y: 675, heading: 0 });
  // facing down the mat, standing higher up
  assert.equal(sim.setStartPose({ x: 625, y: 580, heading: 180 * DEG }), true);
  assert.ok(sim.robotShapes().every((shape) => rectContainsOBB(FIRE_STATION, shape)));
  sim.start();
  assert.equal(sim.setStartPose(START), false, 'not once the match is running');
  // a restart brings the robot back to the chosen pose
  sim.step(10);
  sim.restart();
  near(robot.pose.y, 580, 1e-9);
  near(Math.abs(robot.pose.heading), Math.PI, 1e-9);
});

test('score() hands the referee the world, the robot footprint and the restarts', () => {
  let ctx: ScoreContext<null> | null = null;
  const { sim } = setup(forever, { onScore: (c) => (ctx = c) });
  const report = sim.score();
  assert.equal(report.total, 100);
  assert.ok(ctx);
  const seen = ctx as ScoreContext<null>;
  assert.equal(seen.world, sim.world);
  assert.equal(seen.robotConfig, CFG);
  assert.equal(seen.restarts, 0);
  assert.equal(seen.scenario, null);
  assert.equal(seen.robotShapes.length, 3, 'chassis and two fingers');
  assert.deepEqual(seen.robotShapes, robotShapesAt(CFG, START));
  assert.equal(sim.game.id, 'test');
  assert.equal(sim.robotConfig, CFG);
  assert.equal(sim.dt, SIM_DT);
});

test('a program that throws is stopped and reported, the match goes on to a clean end', () => {
  const { sim } = setup(function* (io) {
    io.setWheelRpm('left', 50);
    yield;
    throw new Error('boom');
  });
  sim.start();
  sim.step(2000);
  const errors = sim.drainEvents().filter((e) => e.type === 'log' && e.level === 'error');
  assert.equal(errors.length, 1);
  assert.equal(sim.status, 'running', 'the left wheel is still turning, so the robot is not at rest');
  sim.declareFinished();
  assert.equal(sim.status, 'finished');
});

// =============================================================================================
// Noise and determinism
// =============================================================================================

test('noise: the same seed gives the same match, and reading the dashboard changes nothing', () => {
  const noisy: RobotConfig = { ...CFG, noise: { wheelSlip: 0.04, sensor: 12, ultrasonicCm: 0.5 } };
  // follow the centre line with the line offset: sensor noise feeds back into the driving
  // (a negative offset = the robot is left of the line = steer to the right)
  const follow: Script = function* (io) {
    for (let i = 0; i < 300; i++) {
      const steer = -io.lineOffset() * 0.3 + (io.ultrasonicCm() < 10 ? 5 : 0);
      io.setWheelRpm('left', 60 + steer);
      io.setWheelRpm('right', 60 - steer);
      yield;
    }
    io.stopWheel('all');
  };
  const run = (seed: number, config: RobotConfig, watchDashboard: boolean) => {
    const s = setup(follow, { config, seed, bodies: [tower('tower:T', 600, 150)] });
    s.sim.start();
    while (s.sim.status === 'running') {
      s.sim.step(1);
      if (watchDashboard) s.sim.readSensors();
    }
    return s.robot.pose;
  };
  const a = run(7, noisy, false);
  const b = run(7, noisy, true);
  const c = run(8, noisy, false);
  const clean = run(7, CFG, false);
  assert.deepEqual(a, b, 'same seed, with and without a dashboard');
  assert.notDeepEqual(a, c, 'another seed, another match');
  assert.notDeepEqual(a, clean, 'noise makes a difference');
  near(a.y, clean.y, 20, 'but only a small one');

  // sensor noise stays within its amplitude
  const s = setup(forever, { config: noisy, startPose: { x: 625, y: 400, heading: 0 } });
  s.sim.start();
  for (let i = 0; i < 50; i++) {
    s.sim.step(1);
    const white = s.harness.io().probe('L2').rgb;
    assert.ok(white.r >= 255 - 12 && white.r <= 255, `white with noise: ${white.r}`);
    assert.equal(s.harness.io().probe('L1').onLine, true);
  }
});

// =============================================================================================
// Speed
// =============================================================================================

test('speed: a simulated minute costs far less than 150 ms', (t) => {
  const ticksPerMinute = 60 / SIM_DT;

  // idle robot, full field (8 towers, 4 buckets, 4 people)
  const field: Body[] = [];
  for (let i = 0; i < 8; i++) field.push(tower(`tower:${i}`, 150 + 130 * i, 150));
  for (let i = 0; i < 4; i++) field.push({ ...bucketOn(field[i]), id: `bucket:${i}` });
  for (let i = 0; i < 4; i++) field.push({ ...person(200 + 200 * i, 1100), id: `person:${i}` });
  const idle = setup(forever, { bodies: field });
  idle.sim.start();
  let t0 = performance.now();
  idle.sim.step(ticksPerMinute);
  const idleMs = performance.now() - t0;
  assert.equal(idle.sim.world.tick, ticksPerMinute);

  // busy robot: drives in circles, reads every sensor on every tick, pushes things around
  const busy = setup(
    function* (io) {
      io.setWheelRpm('left', 120);
      io.setWheelRpm('right', 80);
      for (;;) {
        io.lineStatus();
        io.ultrasonicCm();
        io.frontColor();
        yield;
      }
    },
    { bodies: field },
  );
  busy.sim.start();
  t0 = performance.now();
  busy.sim.step(ticksPerMinute);
  const busyMs = performance.now() - t0;

  t.diagnostic(`one simulated minute: idle robot ${idleMs.toFixed(1)} ms, busy robot ${busyMs.toFixed(1)} ms`);
  assert.ok(idleMs < 150, `idle robot: ${idleMs.toFixed(1)} ms per simulated minute`);
  assert.ok(busyMs < 1500, `busy robot: ${busyMs.toFixed(1)} ms per simulated minute`);
});
