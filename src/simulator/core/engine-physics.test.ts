/**
 * "Can the physics be tricked?" - tests of the engine's corner cases, fuzz tests, and the engine
 * together with the real Fire Rescue referee.
 *
 *  - The first tests each set up one awkward situation (a bucket pushed off its tower onto a
 *    neighbour, a person wedged against the table wall, a row of towers pushed very slowly ...)
 *    and check that nothing ends up inside something else, nothing leaves the table and nothing
 *    jumps.
 *  - The fuzz tests let random "programs" loose on random combinations of the real field and
 *    check after EVERY tick that the world still makes sense.
 *  - The last tests check that "almost" earns no points: a person hanging over the edge of its
 *    tower, a bucket half a millimetre over the line, a bucket the robot still touches.
 *
 * Like engine.test.ts most of these tests use a tiny fake VM: a script (generator function) that
 * talks to the engine through RobotIO, one step per tick; `yield` means "wait for the next tick".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireRescueGame } from '../fire-rescue/game';
import { FIRE_STATION, MAT_VECTOR } from '../fire-rescue/field';
import { scenarioFromIndex } from '../fire-rescue/scenario';
import { createEngineSimulation, type VMFactory } from './engine';
import { DEG, makeRng, obbOverlap, pointInOBB, wrapAngle, type OBB } from './geometry';
import type { RobotIO } from './io';
import { DEFAULT_ROBOT_CONFIG, wheelDegreesForDistance, wheelDegreesForTurn } from './robot';
import { createSimulation } from './simulation';
import type { Body, ColorName, Game, Pose, ServoPort, Simulation, VM } from './types';
import * as blocks from '../vm/builder';

const CFG = DEFAULT_ROBOT_CONFIG;
const G = CFG.gripper;

/** The table wall stands 100 mm outside the 1250 mm mat. */
const TABLE_MIN = -100;
const TABLE_MAX = 1350;

// =============================================================================================
// Helpers
// =============================================================================================

type Script = (io: RobotIO) => Generator<void, void, void>;

/** A fake VM that runs one script; it is idle once the script has ended. */
function scriptedVM(script: Script): VMFactory {
  return (_program, io) => {
    let run: Generator<void, void, void> | null = null;
    const vm: VM = {
      start() {
        run = script(io);
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
}

function* waitUntil(condition: () => boolean): Generator<void, void, void> {
  while (!condition()) yield;
}

function* drive(io: RobotIO, mm: number, rpm = 60): Generator<void, void, void> {
  const deg = wheelDegreesForDistance(io.config, mm);
  io.startMotion(deg, deg, rpm);
  yield* waitUntil(() => io.motionDone());
}

/** Turn on the spot, clockwise positive. */
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
const closeClaw = (io: RobotIO) => servo(io, G.clawServo, G.clawClosedAngle);
const openClaw = (io: RobotIO) => servo(io, G.clawServo, G.clawOpenAngle);

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

/** A bucket standing on tower `t`, `dx` / `dy` mm away from the middle of its top. */
const bucketOn = (t: Body, dx = 0, dy = 0, color: ColorName = 'red'): Body =>
  makeBody({
    id: `bucket:${color}`,
    kind: 'bucket',
    colorName: color,
    x: t.x + dx,
    y: t.y + dy,
    w: 40,
    l: 40,
    h: 40,
    z: t.h,
    restingOn: t.id,
    grippable: true,
  });

const person = (x: number, y: number, color: ColorName = 'green'): Body =>
  makeBody({ id: `person:${color}`, kind: 'person', colorName: color, x, y, w: 40, l: 40, h: 60, grippable: true });

/** A minimal game on the Fire Rescue mat with only the bodies a test asks for. */
function makeGame(bodies: Body[]): Game<null> {
  return {
    id: 'test',
    title: 'Test game',
    mat: { width: 1250, height: 1250, imageUrl: '', sensorImageUrl: '', vector: MAT_VECTOR },
    matchDuration: 180,
    startZone: FIRE_STATION,
    defaultStartPose: { x: 625, y: 673.2, heading: 0 },
    restartPenalty: 5,
    defaultScenario: () => null,
    randomScenario: () => null,
    scenarioCount: () => 1,
    encodeScenario: () => '',
    decodeScenario: () => null,
    describeScenario: () => '',
    createBodies: () => bodies.map((b) => ({ ...b, home: { ...b.home } })),
    overlays: () => [],
    score: () => ({ total: 0, max: 180, lines: [], complete: false }),
  };
}

function setup(script: Script, bodies: Body[], startPose?: Pose) {
  const sim = createEngineSimulation(
    { game: makeGame(bodies), scenario: null, robotConfig: CFG, program: {}, startPose },
    scriptedVM(script),
  );
  const body = (id: string): Body => {
    const b = sim.world.bodies.find((x) => x.id === id);
    assert.ok(b, `body ${id} exists`);
    return b;
  };
  return { sim, body, robot: sim.world.robot };
}

const footprintOf = (b: Body): OBB => ({ x: b.x, y: b.y, w: b.w, l: b.l, angle: b.angle });

/** True when the whole box is on the table (inside the wall). */
function onTable(o: OBB): boolean {
  const eps = 0.01;
  const s = Math.abs(Math.sin(o.angle));
  const c = Math.abs(Math.cos(o.angle));
  // half size of the box's bounding rectangle along x and y
  const ex = (o.w * c + o.l * s) / 2;
  const ey = (o.w * s + o.l * c) / 2;
  return o.x - ex >= TABLE_MIN - eps && o.x + ex <= TABLE_MAX + eps && o.y - ey >= TABLE_MIN - eps && o.y + ey <= TABLE_MAX + eps;
}

/**
 * How deep (mm) the deepest overlap in the world is right now: between two game elements, or
 * between a part of the robot (chassis, fingers, the thing in the claw) and a game element.
 * Things at different heights (a bucket on a tower, fingers above a tower) do not count.
 */
function deepestOverlap<S>(sim: Simulation<S>): { depth: number; what: string } {
  const { robot, bodies } = sim.world;
  const heightsMeet = (low: number, high: number, b: Body) => low < b.z + b.h - 0.5 && b.z < high - 0.5;
  const fingerLow = robot.gripper.height;
  const fingerHigh = fingerLow + sim.robotConfig.gripper.fingerHeight;
  const parts: Array<{ name: string; shape: OBB; low: number; high: number }> = sim
    .robotShapes()
    .map((shape, k) =>
      k === 0
        ? { name: 'chassis', shape, low: 0, high: sim.robotConfig.chassisHeight }
        : { name: 'finger', shape, low: fingerLow, high: fingerHigh },
    );
  const carried = bodies.find((b) => b.held);
  if (carried) parts.push({ name: carried.id, shape: carried, low: carried.z, high: carried.z + carried.h });

  let worst = { depth: 0, what: '' };
  // (a Body has x, y, w, l and angle, so it can be used as its own footprint)
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.held) continue;
    // the robot is at most 250 mm long: nothing further away than that can touch it
    if (Math.abs(b.x - robot.pose.x) < 320 && Math.abs(b.y - robot.pose.y) < 320) {
      for (const part of parts) {
        if (!heightsMeet(part.low, part.high, b)) continue;
        const o = obbOverlap(part.shape, b);
        if (o && o.depth > worst.depth) worst = { depth: o.depth, what: `${part.name} in ${b.id}` };
      }
    }
    for (let j = i + 1; j < bodies.length; j++) {
      const c = bodies[j];
      if (c.held || Math.abs(b.x - c.x) > 100 || Math.abs(b.y - c.y) > 100) continue;
      if (!heightsMeet(c.z, c.z + c.h, b)) continue;
      const o = obbOverlap(b, c);
      if (o && o.depth > worst.depth) worst = { depth: o.depth, what: `${b.id} in ${c.id}` };
    }
  }
  return worst;
}

/** Things that must be true at every moment of every match. `where` is only called when something is wrong. */
function checkWorld<S>(sim: Simulation<S>, where: string | (() => string)): void {
  const fail = (what: string): never => assert.fail(`${typeof where === 'string' ? where : where()}: ${what}`);
  const { robot, bodies } = sim.world;
  const robotNumbers = [
    robot.pose.x,
    robot.pose.y,
    robot.pose.heading,
    robot.gripper.height,
    robot.gripper.gap,
    robot.yawDeg,
    robot.left.rpm,
    robot.right.rpm,
    robot.left.angleDeg,
    robot.right.angleDeg,
  ];
  if (!robotNumbers.every(Number.isFinite)) fail("the robot's numbers are not finite");
  if (!sim.robotShapes().every(onTable)) fail('the robot is not on the table');

  let held = 0;
  for (const b of bodies) {
    if (!(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && Number.isFinite(b.angle))) {
      fail(`${b.id} has no finite position`);
    }
    if (!onTable(b)) fail(`${b.id} is not on the table (${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
    if (b.held) {
      held++;
      if (robot.gripper.holding !== b.id) fail(`${b.id} is held, but the claw holds ${robot.gripper.holding}`);
      if (b.restingOn !== null) fail(`${b.id} is carried, yet stands on ${b.restingOn}`);
      if (b.z < -1e-9) fail(`${b.id} is carried below the mat`);
    } else if (b.restingOn !== null) {
      const under = bodies.find((x) => x.id === b.restingOn);
      if (!under || !under.platform || under.held) {
        fail(`${b.id} stands on ${b.restingOn}, which is not a platform`);
      } else {
        if (Math.abs(b.z - (under.z + under.h)) > 1e-9) fail(`${b.id} does not stand on top of ${under.id}`);
        if (!pointInOBB(b, under, 1e-6)) fail(`the centre of ${b.id} is not over ${under.id}`);
      }
    } else if (b.z !== 0) {
      fail(`${b.id} floats ${b.z} mm above the mat`);
    }
  }
  if (held !== (robot.gripper.holding === null ? 0 : 1)) fail('more than one thing in the claw, or the claw holds nothing real');
}

/** Run the match tick by tick; after every tick nothing may be (deeper than `tolerance` mm) inside anything else. */
function runWatching<S>(sim: Simulation<S>, maxTicks: number, tolerance = 0.1): void {
  sim.start();
  for (let i = 0; i < maxTicks && sim.status === 'running'; i++) {
    sim.step(1);
    checkWorld(sim, `tick ${i}`);
    const worst = deepestOverlap(sim);
    if (worst.depth > tolerance) assert.fail(`tick ${i}: ${worst.what} by ${worst.depth.toFixed(2)} mm`);
  }
  assert.equal(sim.status, 'finished', 'the match ended');
}

// =============================================================================================
// The table wall
// =============================================================================================

test('a bucket riding on a tower that is pushed against the table wall stays on the table', () => {
  // The bucket stands near the edge of the tower top, on the side of the wall: it sticks out 15 mm.
  const t = tower('tower:1', 1250, 625);
  const { sim, body } = setup(
    function* (io) {
      yield* closeClaw(io); // (the two finger tips together push like a bumper)
      yield* drive(io, 300);
    },
    [t, bucketOn(t, 30)],
    { x: 1000, y: 625, heading: 90 * DEG },
  );
  runWatching(sim, 3000);
  const bucket = body('bucket:red');
  assert.ok(Math.abs(body('tower:1').x - (TABLE_MAX - 35)) < 0.1, `the tower stands against the wall: ${body('tower:1').x}`);
  assert.equal(bucket.restingOn, 'tower:1', 'the bucket is still on the tower');
  assert.ok(bucket.x + 20 <= TABLE_MAX + 0.01, `the wall held the bucket back: its edge is at ${bucket.x + 20}`);
});

// =============================================================================================
// Things that fall or are dropped
// =============================================================================================

/** Arm up, claw closed, then drive: the finger tips shove a bucket 37 mm across the top of its tower. */
function* shoveBucketAcross(io: RobotIO): Generator<void, void, void> {
  yield* armUp(io);
  yield* closeClaw(io);
  yield* drive(io, 77, 30);
}

test('a bucket pushed off its tower onto a tower standing right next to it slides onto that tower', () => {
  const t1 = tower('tower:1', 625, 300);
  const t2 = tower('tower:2', 695, 300); // flush against tower 1
  const { sim, body } = setup(shoveBucketAcross, [t1, t2, bucketOn(t1)], { x: 400, y: 300, heading: 90 * DEG });
  runWatching(sim, 3000);
  const bucket = body('bucket:red');
  assert.ok(bucket.x > 660, `the middle of the bucket is past the edge of tower 1: ${bucket.x}`);
  assert.equal(bucket.restingOn, 'tower:2');
  assert.equal(bucket.z, 50);
  assert.equal(body('tower:1').x, 625, 'tower 1 did not move');
  assert.equal(body('tower:2').x, 695, 'tower 2 did not move');
});

test('a bucket pushed off its tower lands beside whatever stands there, never inside it', () => {
  const t1 = tower('tower:1', 625, 300);
  // another bucket stands on the mat 2 mm from the tower, right where the first one comes down
  const bystander = makeBody({ id: 'bucket:blue', kind: 'bucket', x: 682, y: 310, w: 40, l: 40, h: 40, grippable: true });
  const { sim, body } = setup(shoveBucketAcross, [t1, bystander, bucketOn(t1)], { x: 400, y: 300, heading: 90 * DEG });
  runWatching(sim, 3000); // (checks after every tick that nothing is inside anything else)
  const bucket = body('bucket:red');
  assert.equal(bucket.z, 0, 'the bucket is on the mat');
  assert.equal(bucket.restingOn, null);
  assert.equal(body('tower:1').x, 625, 'the tower did not move');
  assert.deepEqual([body('bucket:blue').x, body('bucket:blue').y], [682, 310], 'the other bucket was not knocked away');
});

test('a bucket that falls where there is no room wedges itself in: things are nudged apart, never overlapping', () => {
  const t1 = tower('tower:1', 625, 300);
  // A person (60 mm) is taller than the tower (50 mm): the sliding bucket first pushes it along,
  // then drops into the gap between tower and person, which is too narrow for it.
  const { sim, body } = setup(shoveBucketAcross, [t1, person(682, 310), bucketOn(t1)], { x: 400, y: 300, heading: 90 * DEG });
  runWatching(sim, 3000, 1); // never more than 1 mm inside anything, not even while it lands
  assert.equal(body('bucket:red').z, 0, 'the bucket is on the mat');
  assert.ok(Math.abs(body('tower:1').x - 625) < 10, `the heavy tower hardly moved: ${body('tower:1').x}`);
  assert.ok(deepestOverlap(sim).depth < 0.1, 'everything is apart at the end');
});

test('a person let go at the very edge of a tower slides down beside it and does not shove the tower', () => {
  const t = tower('tower:1', 625, 300); // its near face is at y = 335
  const { sim, body } = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* closeClaw(io);
      yield* armUp(io);
      yield* drive(io, 135); // the middle of the person is now 10 mm short of the tower
      yield* openClaw(io);
    },
    [t, person(625, 480)],
  );
  runWatching(sim, 3000);
  const p = body('person:green');
  assert.equal(p.restingOn, null);
  assert.equal(p.z, 0);
  assert.ok(Math.abs(p.y - 355) < 0.01, `the person stands against the tower's face: ${p.y}`);
  assert.deepEqual([body('tower:1').x, body('tower:1').y], [625, 300], 'the tower did not move');
});

// =============================================================================================
// Jams and squeezes
// =============================================================================================

test('a box loosely between the fingers swings round with the turning robot, it is not shot out', () => {
  // Claw half closed: 45.7 mm between the fingers, the person is 40 mm wide - not gripped.
  const { sim, robot, body } = setup(
    function* (io) {
      yield* drive(io, 51.2);
      yield* servo(io, G.clawServo, 25);
      yield* turn(io, 90);
    },
    [person(625, 480)],
  );
  sim.start();
  const p = body('person:green');
  let last = { x: p.x, y: p.y };
  let biggestJump = 0;
  for (let i = 0; i < 3000 && sim.status === 'running'; i++) {
    sim.step(1);
    checkWorld(sim, `tick ${i}`);
    assert.ok(deepestOverlap(sim).depth <= 0.1, `tick ${i}: ${deepestOverlap(sim).what}`);
    biggestJump = Math.max(biggestJump, Math.hypot(p.x - last.x, p.y - last.y));
    last = { x: p.x, y: p.y };
  }
  assert.equal(sim.status, 'finished');
  assert.equal(robot.gripper.holding, null, 'the claw never gripped it');
  // the claw sweeps 3.4 mm per tick at this speed
  assert.ok(biggestJump < 6, `the person moved ${biggestJump.toFixed(1)} mm in one tick`);
  // it is still between the fingers, which now point to the right
  assert.ok(Math.abs(wrapAngle(robot.pose.heading - 90 * DEG)) < 1 * DEG, 'the robot turned by 90 degrees');
  const along = p.x - robot.pose.x - G.gripForward;
  const across = p.y - robot.pose.y;
  assert.ok(Math.abs(along) < 25 && Math.abs(across) < 3, `the person is in the claw: ${along.toFixed(1)} along, ${across.toFixed(1)} across`);
});

/**
 * A person stands against the top wall, between the fingers of the half-closed claw (not gripped).
 * The robot tries to turn by 20 degrees, then backs straight out. Returns what happened.
 */
function turnAtTheWall(clawAngle: number) {
  const { sim, robot, body } = setup(
    function* (io) {
      yield* servo(io, G.clawServo, clawAngle);
      yield* turn(io, 20);
      yield* drive(io, -60); // straight back out is always possible
    },
    [person(625, -80)],
    { x: 625, y: 67.5, heading: 0 },
  );
  sim.start();
  const p = body('person:green');
  let lastRobot = { x: robot.pose.x, y: robot.pose.y };
  let lastPerson = { x: p.x, y: p.y };
  let robotJump = 0;
  let personJump = 0;
  let turned = 0;
  for (let i = 0; i < 3000 && sim.status === 'running'; i++) {
    sim.step(1);
    checkWorld(sim, `tick ${i}`);
    robotJump = Math.max(robotJump, Math.hypot(robot.pose.x - lastRobot.x, robot.pose.y - lastRobot.y));
    personJump = Math.max(personJump, Math.hypot(p.x - lastPerson.x, p.y - lastPerson.y));
    turned = Math.max(turned, Math.abs(wrapAngle(robot.pose.heading)) / DEG);
    lastRobot = { x: robot.pose.x, y: robot.pose.y };
    lastPerson = { x: p.x, y: p.y };
  }
  assert.equal(sim.status, 'finished');
  assert.equal(robot.gripper.holding, null, 'the claw never gripped the person');
  assert.ok(deepestOverlap(sim).depth < 0.1, 'nothing overlaps at the end');
  assert.ok(robot.pose.y > 67.5 + 50, `the robot backed out: y = ${robot.pose.y}`);
  return { robotJump, personJump, turned, gap: robot.gripper.gap };
}

test('a person loosely between the fingers at the table wall: the robot turns, nothing is thrown', () => {
  const seen = turnAtTheWall(30); // 42 mm between the fingers, the person is 40 mm wide
  // at 40 RPM the claw sweeps 3.4 mm per tick; a jump of several centimetres would be a teleport
  assert.ok(seen.robotJump < 6, `the robot moved ${seen.robotJump.toFixed(1)} mm in one tick`);
  assert.ok(seen.personJump < 6, `the person moved ${seen.personJump.toFixed(1)} mm in one tick`);
  assert.ok(seen.turned > 19, `the robot turned: ${seen.turned.toFixed(1)} degrees`);
});

test('a person wedged tightly between the fingers and the table wall blocks the turn; the robot is not thrown back', () => {
  const seen = turnAtTheWall(31.7); // 40.75 mm between the fingers: no room to turn the person
  assert.ok(seen.gap > 40.5 && seen.gap < 41, `gap ${seen.gap}`);
  assert.ok(seen.robotJump < 6, `the robot moved ${seen.robotJump.toFixed(1)} mm in one tick`);
  assert.ok(seen.personJump < 6, `the person moved ${seen.personJump.toFixed(1)} mm in one tick`);
  assert.ok(seen.turned < 8, `the turn was blocked: ${seen.turned.toFixed(1)} degrees`);
});

test('pushing a row of towers very slowly moves the whole row; no tower sinks into the next one', () => {
  // Three towers in a row ahead of the finger tips (70 mm wide: they do not fit into the claw).
  // The robot creeps at half a turn of the wheels per minute: 0.017 mm per tick.
  // (The towers are listed from the far end of the row to the near end on purpose.)
  const row = [tower('tower:far', 625, 330.2), tower('tower:middle', 625, 400.2), tower('tower:near', 625, 470.2)];
  const { sim, body, robot } = setup(function* (io) {
    io.setWheelRpm('left', 0.5);
    io.setWheelRpm('right', 0.5);
    for (let i = 0; i < 6000; i++) yield;
    io.stopWheel('all');
  }, row);
  runWatching(sim, 7000);
  const pushed = 673.2 - robot.pose.y - 1; // (the finger tips start 1 mm from the first tower)
  assert.ok(pushed > 95, `the robot crept forward: ${pushed.toFixed(1)} mm`);
  for (const t of row) {
    const moved = t.y - body(t.id).y;
    assert.ok(Math.abs(moved - pushed) < 0.5, `${t.id} was pushed ${moved.toFixed(2)} mm, the robot pushed ${pushed.toFixed(2)} mm`);
  }
});

// =============================================================================================
// The claw
// =============================================================================================

test('the claw only grips what is at the height of its fingers, and never through a tower', () => {
  // (1) arm up: the fingers (75..95 mm) close in the air above a 60 mm person
  const above = setup(
    function* (io) {
      yield* armUp(io);
      yield* drive(io, 51.2); // the person is now exactly between the fingers, seen from above
      yield* closeClaw(io);
      yield* drive(io, -50);
    },
    [person(625, 480)],
  );
  runWatching(above.sim, 3000);
  assert.equal(above.robot.gripper.holding, null);
  assert.equal(above.robot.gripper.gap, G.clawClosedGap, 'the claw closed completely');
  assert.deepEqual([above.body('person:green').x, above.body('person:green').y], [625, 480], 'the person was not touched');

  // (2) arm down: a person stands right behind a tower; the fingers cannot reach through the tower
  const behind = setup(
    function* (io) {
      yield* drive(io, 60); // the finger tips run into the tower and push it (and the person) along
      yield* closeClaw(io);
      yield* drive(io, -50);
    },
    [tower('tower:1', 625, 440), person(625, 384)],
  );
  runWatching(behind.sim, 3000);
  assert.equal(behind.robot.gripper.holding, null);
  assert.ok(behind.body('tower:1').y < 440 - 20, `the tower was pushed: ${behind.body('tower:1').y}`);
  assert.ok(behind.body('person:green').y < 384 - 20, 'the person was pushed along by the tower, not carried back');
  assert.equal(behind.body('person:green').held, false);
});

// =============================================================================================
// Fuzz tests: random programs on random combinations of the real Fire Rescue field
// =============================================================================================

/**
 * What a robot may do in one tick (1/100 s) at most: at full speed it rolls 6 mm; spinning at
 * full speed with its claw against something that cannot give way, it levers itself away by up
 * to about 20 mm. Anything beyond that would be a teleport.
 */
const MAX_ROBOT_MM_PER_TICK = 30;

/** Watches one match tick by tick and fails as soon as the world stops making sense. */
function makeWatcher<S>(sim: Simulation<S>, name: string) {
  const pose = sim.world.robot.pose;
  const last = { x: pose.x, y: pose.y };
  return {
    /** call after every sim.step(1) */
    afterTick(tick: number): void {
      const where = () => `${name}, tick ${tick}`;
      checkWorld(sim, where);
      const worst = deepestOverlap(sim);
      if (worst.depth > 1) assert.fail(`${where()}: ${worst.what} by ${worst.depth.toFixed(2)} mm`);
      const moved = Math.hypot(pose.x - last.x, pose.y - last.y);
      if (moved > MAX_ROBOT_MM_PER_TICK) assert.fail(`${where()}: the robot jumped ${moved.toFixed(1)} mm`);
      last.x = pose.x;
      last.y = pose.y;
    },
    /** call after sim.restart(): the robot was carried back to the start zone */
    afterRestart(tick: number): void {
      const where = `${name}, restart at tick ${tick}`;
      checkWorld(sim, where);
      const worst = deepestOverlap(sim);
      assert.ok(worst.depth <= 1, `${where}: ${worst.what} by ${worst.depth.toFixed(2)} mm`);
      last.x = pose.x;
      last.y = pose.y;
    },
    /** call once the match is over */
    atEnd(): void {
      const where = `${name}, end`;
      checkWorld(sim, where);
      const worst = deepestOverlap(sim);
      assert.ok(worst.depth <= 0.1, `${where}: ${worst.what} by ${worst.depth.toFixed(2)} mm`);
      const report = sim.score();
      assert.ok(Number.isFinite(report.total) && report.total >= 0 && report.total <= report.max, `${where}: score ${report.total}`);
    },
  };
}

/**
 * A "program" that does random things through RobotIO: wild wheel speeds, encoder moves, arm and
 * claw commands at any moment, nonsense values (NaN, Infinity). So that a lot of contact really
 * happens, it often heads straight for a random game element, and now and then it fetches a
 * bucket or a person and carries it to a tower. (It peeks at the world to find its way; a
 * student's program cannot do that.)
 */
function randomCommands(sim: () => Simulation<unknown>, rng: () => number): Script {
  function* pause(ticks: number): Generator<void, void, void> {
    for (let i = 0; i < ticks; i++) yield;
  }
  /** Steer towards `target` and stop `stopAt` mm before it (or when `maxTicks` are used up). */
  function* goTo(io: RobotIO, target: { x: number; y: number }, stopAt: number, maxTicks: number, speed: number) {
    const pose = sim().world.robot.pose;
    for (let n = 0; n < maxTicks; n++) {
      const dx = target.x - pose.x;
      const dy = target.y - pose.y;
      const remaining = Math.hypot(dx, dy) - stopAt;
      const error = wrapAngle(Math.atan2(dx, -dy) - pose.heading);
      if (Math.abs(remaining) < 2 && Math.abs(error) < 0.05) break;
      const forward = Math.abs(error) < 0.3 ? Math.max(-speed, Math.min(speed, remaining * 2)) : 0;
      const steer = Math.max(-80, Math.min(80, error * 200));
      io.setWheelRpm('left', forward + steer);
      io.setWheelRpm('right', forward - steer);
      yield;
    }
  }
  return function* (io) {
    for (;;) {
      const r = rng();
      const { bodies, robot } = sim().world;
      if (r < 0.2) {
        // fetch a bucket or a person (usually with the arm at the right height) ...
        const things = bodies.filter((b) => b.grippable && !b.held);
        if (things.length > 0 && robot.gripper.holding === null) {
          const thing = things[Math.floor(rng() * things.length)];
          const wantUp = thing.z > 0 ? rng() < 0.9 : rng() < 0.1;
          io.setServo(G.clawServo, G.clawOpenAngle);
          io.setServo(G.liftServo, wantUp ? G.liftUpAngle : G.liftDownAngle);
          yield* goTo(io, thing, G.gripForward, 500, 120);
          io.stopWheel('all');
          yield* pause(15);
          io.setServo(G.clawServo, G.clawClosedAngle);
          yield* pause(40);
        }
        // ... and, if that worked, carry it to a tower and let go there
        if (robot.gripper.holding !== null && rng() < 0.7) {
          const towers = bodies.filter((b) => b.platform);
          const goal = towers[Math.floor(rng() * towers.length)];
          io.setServo(G.liftServo, rng() < 0.85 ? G.liftUpAngle : rng() * 90);
          yield* pause(50);
          yield* goTo(io, goal, G.gripForward + (rng() < 0.3 ? (rng() - 0.5) * 60 : 0), 500, 100);
          io.stopWheel('all');
          yield* pause(15);
          io.setServo(G.clawServo, G.clawOpenAngle);
          yield* pause(40);
        }
      } else if (r < 0.4) {
        // head for a game element, then stop short of it, at claw distance, or ram it
        const target = bodies[Math.floor(rng() * bodies.length)];
        yield* goTo(io, target, rng() < 0.5 ? G.gripForward : rng() * 200, 200 + Math.floor(rng() * 400), 40 + rng() * 140);
        if (rng() < 0.7) io.stopWheel('all');
      } else if (r < 0.52) {
        io.setWheelRpm('left', (rng() * 2 - 1) * 200);
        io.setWheelRpm('right', (rng() * 2 - 1) * 200);
        yield* pause(Math.floor(rng() * 150));
      } else if (r < 0.62) {
        io.startMotion((rng() * 2 - 1) * 1500, (rng() * 2 - 1) * 1500, rng() * 200);
        for (let n = Math.floor(rng() * 300); n > 0 && !io.motionDone(); n--) yield;
      } else if (r < 0.74) {
        io.setServo(G.liftServo, rng() < 0.4 ? G.liftUpAngle : rng() < 0.5 ? G.liftDownAngle : rng() * 180);
        yield* pause(Math.floor(rng() * 80));
      } else if (r < 0.88) {
        io.setServo(G.clawServo, rng() < 0.45 ? G.clawClosedAngle : rng() < 0.6 ? G.clawOpenAngle : rng() * 90);
        yield* pause(Math.floor(rng() * 60));
      } else if (r < 0.93) {
        io.stopWheel(rng() < 0.5 ? 'all' : rng() < 0.5 ? 'left' : 'right');
        yield* pause(Math.floor(rng() * 30));
      } else if (r < 0.96) {
        io.setWheelPower('left', (rng() * 2 - 1) * 120);
        io.setWheelPower('right', (rng() * 2 - 1) * 120);
        yield* pause(Math.floor(rng() * 100));
      } else {
        const nonsense = [NaN, Infinity, -Infinity, 1e12, -1e12][Math.floor(rng() * 5)];
        const which = Math.floor(rng() * 4);
        if (which === 0) io.setWheelRpm('left', nonsense);
        else if (which === 1) io.startMotion(nonsense, 100, 50);
        else if (which === 2) io.setServo(G.liftServo, nonsense);
        else io.setServo(G.clawServo, nonsense);
      }
      yield;
    }
  };
}

test('fuzz: 100 random programs on random combinations - the world stays sane on every single tick', () => {
  const counts = { grabs: 0, releases: 0, putOnTowers: 0, bumps: 0, restarts: 0, falls: 0 };
  for (let run = 1; run <= 100; run++) {
    const rng = makeRng(run * 7919 + 13);
    const holder: { sim?: Simulation<unknown> } = {};
    const sim = createEngineSimulation(
      {
        game: fireRescueGame,
        scenario: scenarioFromIndex(Math.floor(rng() * 9216)),
        robotConfig: CFG,
        program: {},
        seed: run,
      },
      scriptedVM(randomCommands(() => holder.sim as Simulation<unknown>, rng)),
    );
    holder.sim = sim as Simulation<unknown>;
    const watcher = makeWatcher(sim, `run ${run}`);
    sim.start();
    for (let tick = 0; tick < 2000 && sim.status === 'running'; tick++) {
      if (rng() < 0.0005) {
        sim.restart();
        counts.restarts++;
        watcher.afterRestart(tick);
      } else {
        sim.step(1);
        watcher.afterTick(tick);
      }
    }
    sim.declareFinished();
    watcher.atEnd();
    for (const e of sim.drainEvents()) {
      if (e.type === 'grab') counts.grabs++;
      if (e.type === 'release') counts.releases++;
      if (e.type === 'release' && e.onto !== null) counts.putOnTowers++;
      if (e.type === 'bump') counts.bumps++;
    }
    counts.falls += sim.world.bodies.filter((b) => b.kind === 'bucket' && b.restingOn === null && !b.held).length;
  }
  // the test is only worth something if a lot really happened
  assert.ok(counts.bumps >= 400, `bumps: ${counts.bumps}`);
  assert.ok(counts.grabs >= 40, `grabs: ${counts.grabs}`);
  assert.ok(counts.releases >= 20, `releases: ${counts.releases}`);
  assert.ok(counts.putOnTowers >= 10, `things put on towers: ${counts.putOnTowers}`);
  assert.ok(counts.falls >= 30, `buckets no longer on a tower: ${counts.falls}`);
  assert.ok(counts.restarts >= 50, `restarts: ${counts.restarts}`);
});

/** A random walk written with blocks: drive, turn, open, close, raise, lower ... in any order, for ever. */
function randomBlockProgram(rng: () => number) {
  const pick = <T>(choices: readonly T[]): T => choices[Math.floor(rng() * choices.length)];
  const steps: blocks.BlockNode[] = [];
  for (let i = 0; i < 40; i++) {
    const r = rng();
    if (r < 0.3) steps.push(blocks.moveCm(pick(['forward', 'forward', 'backward'] as const), Math.round(2 + rng() * 45)));
    else if (r < 0.5) steps.push(blocks.turn(pick(['left', 'right'] as const), Math.round(5 + rng() * 175)));
    else if (r < 0.58) {
      const seconds = Math.round((0.2 + rng() * 1.5) * 10) / 10;
      steps.push(blocks.moveFor(pick(['forward', 'backward', 'left', 'right'] as const), Math.round(20 + rng() * 180), seconds));
    } else if (r < 0.68) steps.push(blocks.gripper(pick(['open', 'close'] as const)));
    else if (r < 0.78) steps.push(blocks.arm(pick(['raise', 'lower'] as const)));
    else if (r < 0.82) steps.push(blocks.armHeight(Math.round(rng() * 100)));
    else if (r < 0.88) steps.push(blocks.setServo(pick(['S1', 'S2'] as const), Math.round(rng() * 90)));
    else if (r < 0.94) {
      steps.push(blocks.driveRpm(Math.round((rng() * 2 - 1) * 180), Math.round((rng() * 2 - 1) * 180)));
      steps.push(blocks.wait(Math.round((0.1 + rng()) * 10) / 10));
      if (rng() < 0.7) steps.push(blocks.stopMotors());
    } else {
      steps.push(blocks.motorRotate(pick(['EM1', 'EM2', 'all'] as const), Math.round((rng() * 2 - 1) * 720), Math.round(20 + rng() * 150)));
    }
  }
  return blocks.program([blocks.script(blocks.whenStart(), [blocks.forever(steps)])]);
}

test('fuzz: 40 random block programs run by the real interpreter - the world stays sane on every tick', () => {
  let bumps = 0;
  for (let run = 1; run <= 40; run++) {
    const rng = makeRng(run * 2654435761 + 5);
    const sim = createSimulation({
      game: fireRescueGame,
      scenario: scenarioFromIndex(Math.floor(rng() * 9216)),
      robotConfig: CFG,
      program: randomBlockProgram(rng),
      seed: run,
    });
    const watcher = makeWatcher(sim, `block program ${run}`);
    sim.start();
    for (let tick = 0; tick < 1500 && sim.status === 'running'; tick++) {
      if (rng() < 0.0005) {
        sim.restart();
        watcher.afterRestart(tick);
      } else {
        sim.step(1);
        watcher.afterTick(tick);
      }
    }
    sim.declareFinished();
    watcher.atEnd();
    assert.deepEqual(sim.vm.errors(), [], `block program ${run}: the interpreter reported no problem`);
    bumps += sim.drainEvents().filter((e) => e.type === 'bump').length;
  }
  assert.ok(bumps >= 100, `bumps: ${bumps}`);
});

test('fuzz: the same random program gives exactly the same match twice', () => {
  const play = (): string => {
    const rng = makeRng(4242);
    const holder: { sim?: Simulation<unknown> } = {};
    const sim = createEngineSimulation(
      { game: fireRescueGame, scenario: scenarioFromIndex(777), robotConfig: CFG, program: {}, seed: 9 },
      scriptedVM(randomCommands(() => holder.sim as Simulation<unknown>, rng)),
    );
    holder.sim = sim as Simulation<unknown>;
    sim.start();
    sim.step(4000);
    sim.declareFinished();
    return JSON.stringify({ world: sim.world, score: sim.score(), events: sim.drainEvents() });
  };
  assert.equal(play(), play());
});

// =============================================================================================
// Engine + real referee: no points for "almost"
// =============================================================================================

function fireRescueMatch(script: Script) {
  const sim = createEngineSimulation(
    { game: fireRescueGame, scenario: scenarioFromIndex(0), robotConfig: CFG, program: {} },
    scriptedVM(script),
  );
  sim.start();
  sim.step(18000);
  assert.equal(sim.finishReason, 'program-ended');
  const report = sim.score();
  const line = (id: string) => {
    const found = report.lines.find((l) => l.id === id);
    assert.ok(found, `score line ${id}`);
    return found;
  };
  const body = (id: string): Body => {
    const b = sim.world.bodies.find((x) => x.id === id);
    assert.ok(b, `body ${id} exists`);
    return b;
  };
  return { sim, report, line, body };
}

test('referee: a person scores only when it is let go really on top of its rescue tower', () => {
  // Combination 0: the red person waits in A1 (1050, 115.3); its rescue tower RR stands at (680, 1100.2).
  // The robot fetches the person, lifts it and carries it to RR; `short` / `aside` spoil the aim (mm).
  const rescue = (short: number, aside: number, andThen: 'back off' | 'stay' | 'keep hold') =>
    fireRescueMatch(function* (io) {
      yield* turn(io, 90);
      yield* drive(io, 1050 - 625);
      yield* turn(io, -90);
      yield* drive(io, 673.2 - 115.3 - G.gripForward);
      yield* closeClaw(io);
      yield* armUp(io);
      yield* turn(io, 180);
      yield* drive(io, 700 - 257.3);
      yield* turn(io, 90);
      yield* drive(io, 1050 - 680 + aside);
      yield* turn(io, -90);
      yield* drive(io, 1100.2 - G.gripForward - 700 - short);
      if (andThen === 'keep hold') return;
      yield* openClaw(io);
      if (andThen === 'back off') yield* drive(io, -100);
    });

  const good = rescue(0, 0, 'back off');
  assert.equal(good.line('person:red').ok, true, good.line('person:red').detail);
  assert.equal(good.report.total, 20);
  assert.equal(good.body('person:red').restingOn, 'tower:RR');

  // the claw is wide open (12 mm of air on each side): the robot may stay where it is
  const stay = rescue(0, 0, 'stay');
  assert.equal(stay.line('person:red').ok, true, stay.line('person:red').detail);

  const held = rescue(0, 0, 'keep hold');
  assert.equal(held.line('person:red').ok, false);
  assert.match(held.line('person:red').detail, /holding/);

  // 22 mm short: the middle of the person is over the tower, so it stays up there - hanging over the edge
  const hanging = rescue(22, 0, 'back off');
  assert.equal(hanging.body('person:red').restingOn, 'tower:RR');
  assert.equal(hanging.line('person:red').ok, false);
  assert.match(hanging.line('person:red').detail, /hanging over the edge/);

  const sideways = rescue(0, 22, 'back off');
  assert.equal(sideways.line('person:red').ok, false);
  assert.match(sideways.line('person:red').detail, /hanging over the edge/);

  // 40 mm short: its middle is not over the tower, it drops to the mat beside the tower
  const missed = rescue(40, 0, 'back off');
  assert.equal(missed.body('person:red').restingOn, null);
  assert.equal(missed.body('person:red').z, 0);
  assert.equal(missed.line('person:red').ok, false);
  assert.deepEqual([missed.body('tower:RR').x, missed.body('tower:RR').y], [680, 1100.2], 'the tower was not shoved');
  assert.equal(missed.report.total, 0);
  for (const run of [good, stay, held, hanging, sideways, missed]) {
    assert.ok(deepestOverlap(run.sim).depth < 0.1, 'nothing overlaps at the end');
  }
});

test('referee: a bucket scores only when it stands completely inside the right square, on the mat, let go', () => {
  // Combination 0: the red bucket stands on W1 (420.85, 426.5) and belongs in square A2 (1160, 115.3),
  // a 60 mm square with a 4.9 mm line: a 40 mm bucket has 12.45 mm of play to each side.
  const deliver = (aside: number, andThen: 'let go' | 'barely open' | 'keep hold' | 'drop from above' | 'nudge') =>
    fireRescueMatch(function* (io) {
      yield* turn(io, -90);
      yield* drive(io, 625 - 420.85);
      yield* turn(io, 90);
      yield* armUp(io);
      yield* drive(io, 673.2 - (426.5 + G.gripForward));
      yield* closeClaw(io);
      yield* drive(io, -50);
      yield* turn(io, 90);
      yield* drive(io, 1160 - 420.85 + aside);
      yield* turn(io, -90);
      yield* drive(io, 618.5 - (115.3 + G.gripForward));
      if (andThen !== 'drop from above') yield* servo(io, G.liftServo, G.liftDownAngle);
      if (andThen === 'keep hold') return;
      // 'barely open': 40.75 mm between the fingers - too little to let the 40 mm bucket go
      yield* servo(io, G.clawServo, andThen === 'barely open' ? 31.7 : G.clawOpenAngle);
      // 'nudge': roll on until the front of the chassis rests against the bucket
      if (andThen === 'nudge') yield* drive(io, 25);
    });

  const good = deliver(0, 'let go');
  assert.equal(good.line('bucket:red').ok, true, good.line('bucket:red').detail);
  assert.equal(good.report.total, 20);

  const dropped = deliver(0, 'drop from above');
  assert.equal(dropped.body('bucket:red').z, 0, 'the bucket fell to the mat');
  assert.equal(dropped.line('bucket:red').ok, true, dropped.line('bucket:red').detail);

  const edge = deliver(12, 'let go'); // just inside
  assert.equal(edge.line('bucket:red').ok, true, edge.line('bucket:red').detail);

  const over = deliver(13, 'let go'); // 0.55 mm over the line
  assert.equal(over.line('bucket:red').ok, false);
  assert.match(over.line('bucket:red').detail, /partly outside/);

  const held = deliver(0, 'keep hold');
  assert.equal(held.body('bucket:red').z, 0, 'the bucket stands on the mat, in the claw');
  assert.equal(held.line('bucket:red').ok, false);
  assert.match(held.line('bucket:red').detail, /holding/);

  const gripped = deliver(0, 'barely open');
  assert.equal(gripped.sim.world.robot.gripper.holding, 'bucket:red');
  assert.equal(gripped.line('bucket:red').ok, false);
  assert.match(gripped.line('bucket:red').detail, /holding/);

  const touching = deliver(0, 'nudge');
  assert.equal(touching.sim.world.robot.gripper.holding, null);
  assert.ok(touching.body('bucket:red').y < 115.3 - 5, 'the chassis pushed the bucket a little');
  assert.equal(touching.line('bucket:red').ok, false);
  assert.match(touching.line('bucket:red').detail, /touching the robot/);
});
