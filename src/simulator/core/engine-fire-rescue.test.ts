/**
 * The engine together with the real Fire Rescue game: the default robot on the real field,
 * judged by the real referee. The "program" is a script that drives by wheel encoders only
 * (dead reckoning), so it also checks that the robot goes exactly where the maths says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireRescueGame } from '../fire-rescue/game';
import { defaultScenario, scenarioFromIndex, type FireRescueScenario } from '../fire-rescue/scenario';
import { createEngineSimulation, type VMFactory } from './engine';
import { makeRng, obbOverlap, pointInOBB, wrapAngle, type OBB } from './geometry';
import type { RobotIO } from './io';
import { DEFAULT_ROBOT_CONFIG, robotFitsInRect, wheelDegreesForDistance, wheelDegreesForTurn } from './robot';
import type { Body, ServoPort, Simulation, VM } from './types';

const CFG = DEFAULT_ROBOT_CONFIG;
const G = CFG.gripper;

type Script = (io: RobotIO) => Generator<void, void, void>;

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

function* drive(io: RobotIO, mm: number, rpm = 90): Generator<void, void, void> {
  const deg = wheelDegreesForDistance(io.config, mm);
  io.startMotion(deg, deg, rpm);
  yield* waitUntil(() => io.motionDone());
}

/** Turn on the spot, clockwise positive. */
function* turn(io: RobotIO, degrees: number, rpm = 50): Generator<void, void, void> {
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

function makeSim(script: Script, scenario: FireRescueScenario = defaultScenario()): Simulation<FireRescueScenario> {
  return createEngineSimulation(
    { game: fireRescueGame, scenario, robotConfig: CFG, program: {} },
    scriptedVM(script),
  );
}

const bodyOf = (sim: Simulation<FireRescueScenario>, id: string): Body => {
  const b = sim.world.bodies.find((x) => x.id === id);
  assert.ok(b, `body ${id} exists`);
  return b;
};

test('the default robot starts completely inside the Fire Station', () => {
  const game = fireRescueGame;
  assert.ok(robotFitsInRect(CFG, game.defaultStartPose, game.startZone));
  const sim = makeSim(function* () {
    yield;
  });
  assert.deepEqual(sim.drainEvents(), [], 'no warning about the start position');
  assert.equal(sim.setStartPose(game.defaultStartPose), true);
  assert.equal(sim.world.bodies.length, 16, '8 towers, 4 buckets, 4 people');
  assert.equal(sim.score().total, 0);
});

test('an untouched field stays exactly as it was set up, for every kind of combination', () => {
  for (const index of [0, 1234, 5000, 9215]) {
    const sim = makeSim(function* () {
      for (let i = 0; i < 300; i++) yield;
    }, scenarioFromIndex(index));
    const before = JSON.stringify(sim.world.bodies);
    sim.start();
    sim.step(1000);
    assert.equal(sim.status, 'finished');
    assert.equal(sim.finishReason, 'program-ended');
    assert.equal(JSON.stringify(sim.world.bodies), before, `combination ${index}`);
    assert.equal(sim.score().total, 0);
  }
});

test('a full mission by dead reckoning: deliver the red bucket, rescue the red person (40 points)', () => {
  // Default combination: the red bucket stands on W1 (420.85, 426.5) and belongs in A2 (1160, 115.3);
  // the red person waits in A1 (1050, 115.3) and belongs on rescue tower RR (680, 1100.2).
  // The robot starts at (625, 673.2) facing up. The claw centre is 142 mm ahead of the axle.
  const sim = makeSim(function* (io) {
    // ---- to water tower W1, from below
    yield* turn(io, -90);
    yield* drive(io, 625 - 420.85);
    yield* turn(io, 90);
    yield* armUp(io);
    yield* drive(io, 673.2 - (426.5 + 142));
    yield* closeClaw(io); // the bucket
    // ---- to building A, square 2
    yield* drive(io, -50);
    yield* turn(io, 90);
    yield* drive(io, 1160 - 420.85);
    yield* turn(io, -90);
    yield* drive(io, 618.5 - (115.3 + 142));
    yield* armDown(io); // stops when the bucket stands on the mat
    yield* openClaw(io);
    yield* drive(io, -100);
    // ---- to the person in square 1 of building A
    yield* turn(io, -90);
    yield* drive(io, 1160 - 1050);
    yield* turn(io, 90);
    yield* drive(io, 100);
    yield* closeClaw(io); // the person
    yield* armUp(io);
    // ---- to rescue tower RR, from above
    yield* turn(io, 180);
    yield* drive(io, 700 - 257.3);
    yield* turn(io, 90);
    yield* drive(io, 1050 - 680);
    yield* turn(io, -90);
    yield* drive(io, 1100.2 - 142 - 700);
    yield* armDown(io); // stops when the person stands on the tower
    yield* openClaw(io);
    yield* drive(io, -100);
  });

  sim.start();
  sim.step(18000);
  assert.equal(sim.status, 'finished');
  assert.equal(sim.finishReason, 'program-ended');
  assert.ok(sim.world.time < 60, `the mission took ${sim.world.time.toFixed(1)} s`);

  const bucket = bodyOf(sim, 'bucket:red');
  assert.ok(Math.abs(bucket.x - 1160) < 1 && Math.abs(bucket.y - 115.3) < 1, `bucket at ${bucket.x}, ${bucket.y}`);
  assert.equal(bucket.z, 0);
  assert.equal(bucket.restingOn, null);

  const person = bodyOf(sim, 'person:red');
  assert.equal(person.restingOn, 'tower:RR');
  assert.equal(person.z, 50);
  assert.ok(Math.abs(person.x - 680) < 1 && Math.abs(person.y - 1100.2) < 1, `person at ${person.x}, ${person.y}`);

  // nothing else was disturbed
  for (const b of sim.world.bodies) {
    if (b === bucket || b === person) continue;
    assert.ok(Math.hypot(b.x - b.home.x, b.y - b.home.y) < 1e-6, `${b.id} did not move`);
  }

  const report = sim.score();
  const line = (id: string) => report.lines.find((l) => l.id === id);
  assert.equal(line('bucket:red')?.ok, true, line('bucket:red')?.detail);
  assert.equal(line('person:red')?.ok, true, line('person:red')?.detail);
  assert.equal(report.total, 40);

  // the claw touched nothing but the two objects it carried: no bumps
  const story: string[] = [];
  for (const e of sim.drainEvents()) {
    if (e.type === 'grab' || e.type === 'bump') story.push(`${e.type} ${e.bodyId}`);
    if (e.type === 'release') story.push(`release ${e.bodyId} onto ${e.onto}`);
  }
  assert.deepEqual(story, [
    'grab bucket:red',
    'release bucket:red onto null',
    'grab person:red',
    'release person:red onto tower:RR',
  ]);
});

test('a restart on the real field: the carried bucket goes back onto its water tower, minus 5 points', () => {
  const sim = makeSim(function* (io) {
    yield* turn(io, -90);
    yield* drive(io, 625 - 420.85);
    yield* turn(io, 90);
    yield* armUp(io);
    yield* drive(io, 673.2 - (426.5 + 142));
    yield* closeClaw(io);
    yield* drive(io, -50);
    for (;;) yield;
  });
  sim.start();
  sim.step(1200);
  assert.equal(sim.world.robot.gripper.holding, 'bucket:red');
  sim.restart();
  const bucket = bodyOf(sim, 'bucket:red');
  assert.equal(bucket.restingOn, 'tower:W1');
  assert.deepEqual({ x: bucket.x, y: bucket.y, z: bucket.z }, { x: bucket.home.x, y: bucket.home.y, z: 50 });
  assert.deepEqual(sim.world.robot.pose, fireRescueGame.defaultStartPose);
  const report = sim.score();
  assert.equal(report.lines.find((l) => l.id === 'restarts')?.points, -5);
  assert.equal(report.total, 0, 'never below zero');
});

// =============================================================================================
// Stress test
// =============================================================================================

/**
 * A clumsy but busy "program": again and again it picks a random bucket or person, drives to it,
 * grabs it, carries it to a random tower and lets go - sometimes with the arm at the wrong
 * height, sometimes stopping short, shoving everything in its way. It steers by looking at the
 * world directly (a real program cannot do that; the test only wants a lot of contact).
 */
function clumsyProgram(sim: () => Simulation<FireRescueScenario>, rng: () => number): Script {
  function* goTo(io: RobotIO, target: () => { x: number; y: number }, stopAt: number, maxTicks: number) {
    for (let n = 0; n < maxTicks; n++) {
      const pose = sim().world.robot.pose;
      const t = target();
      const dx = t.x - pose.x;
      const dy = t.y - pose.y;
      const remaining = Math.hypot(dx, dy) - stopAt;
      const error = wrapAngle(Math.atan2(dx, -dy) - pose.heading);
      if (Math.abs(remaining) < 1.5 && Math.abs(error) < 0.03) break;
      const forward = Math.abs(error) < 0.15 ? Math.max(-80, Math.min(120, remaining * 1.5)) : 0;
      const turnRpm = Math.max(-60, Math.min(60, error * 150));
      io.setWheelRpm('left', forward + turnRpm);
      io.setWheelRpm('right', forward - turnRpm);
      yield;
    }
    io.stopWheel('all');
    for (let n = 0; n < 100 && (io.wheelRpm('left') !== 0 || io.wheelRpm('right') !== 0); n++) yield;
  }
  function* servoWithin(io: RobotIO, port: ServoPort, angle: number, maxTicks = 200) {
    io.setServo(port, angle);
    for (let n = 0; n < maxTicks && !io.servoDone(port); n++) yield;
  }
  function* backOff(io: RobotIO, deg: number) {
    io.startMotion(-deg, -deg, 90);
    for (let n = 0; n < 300 && !io.motionDone(); n++) yield;
  }
  return function* (io) {
    for (;;) {
      const bodies = sim().world.bodies;
      const things = bodies.filter((b) => b.grippable && !b.held);
      const towers = bodies.filter((b) => b.platform);
      const thing = things[Math.floor(rng() * things.length)];
      yield* servoWithin(io, G.clawServo, G.clawOpenAngle);
      const armUpFirst = thing.z >= 50 ? rng() < 0.9 : rng() < 0.1;
      yield* servoWithin(io, G.liftServo, armUpFirst ? G.liftUpAngle : rng() < 0.2 ? rng() * 90 : G.liftDownAngle);
      // first to a point beside the thing, then straight at it
      const side = rng() * Math.PI * 2;
      const beside = { x: thing.x + 260 * Math.sin(side), y: thing.y - 260 * Math.cos(side) };
      yield* goTo(io, () => beside, 0, 900);
      yield* goTo(io, () => thing, G.gripForward + (rng() < 0.2 ? (rng() - 0.5) * 60 : 0), 600);
      yield* servoWithin(io, G.clawServo, G.clawClosedAngle);
      if (sim().world.robot.gripper.holding === null) {
        yield* backOff(io, 150 + rng() * 300);
        continue;
      }
      yield* servoWithin(io, G.liftServo, rng() < 0.85 ? G.liftUpAngle : rng() * 90);
      const tower = towers[Math.floor(rng() * towers.length)];
      const side2 = rng() * Math.PI * 2;
      const before = { x: tower.x + 300 * Math.sin(side2), y: tower.y - 300 * Math.cos(side2) };
      yield* goTo(io, () => before, 0, 1200);
      yield* goTo(io, () => tower, G.gripForward, 700);
      if (rng() < 0.7) yield* servoWithin(io, G.liftServo, G.liftDownAngle);
      yield* servoWithin(io, G.clawServo, G.clawOpenAngle);
      yield* backOff(io, 200);
    }
  };
}

const footprintOf = (b: Body): OBB => ({ x: b.x, y: b.y, w: b.w, l: b.l, angle: b.angle });

/** Things that must be true at every moment of every match. */
function checkWorld(sim: Simulation<FireRescueScenario>, where: string): void {
  const { robot, bodies } = sim.world;
  assert.ok([robot.pose.x, robot.pose.y, robot.pose.heading].every(Number.isFinite), `${where}: robot pose`);
  let held = 0;
  for (const b of bodies) {
    assert.ok([b.x, b.y, b.z, b.angle].every(Number.isFinite), `${where}: ${b.id} position`);
    // on the table (the wall is 100 mm outside the 1250 mm mat)
    assert.ok(b.x > -101 && b.x < 1351 && b.y > -101 && b.y < 1351, `${where}: ${b.id} on the table`);
    if (b.held) {
      held++;
      assert.equal(robot.gripper.holding, b.id, `${where}: the claw holds ${b.id}`);
      assert.equal(b.restingOn, null, `${where}: ${b.id} is carried`);
      assert.ok(b.z >= -1e-9, `${where}: ${b.id} above the mat`);
    } else if (b.restingOn !== null) {
      const under = bodies.find((x) => x.id === b.restingOn);
      assert.ok(under && under.platform, `${where}: ${b.id} stands on a platform`);
      assert.ok(Math.abs(b.z - (under.z + under.h)) < 1e-9, `${where}: ${b.id} stands on top of ${under.id}`);
      assert.ok(pointInOBB(b, footprintOf(under), 1e-6), `${where}: centre of ${b.id} over ${under.id}`);
    } else {
      assert.equal(b.z, 0, `${where}: ${b.id} stands on the mat`);
    }
  }
  assert.equal(held, robot.gripper.holding === null ? 0 : 1, `${where}: one thing in the claw at most`);
}

/** At the end of a match nothing may be inside anything else. */
function checkNothingOverlaps(sim: Simulation<FireRescueScenario>, where: string): void {
  const { robot, bodies } = sim.world;
  const heightsMeet = (aLow: number, aHigh: number, b: Body) => aLow < b.z + b.h - 0.5 && b.z < aHigh - 0.5;
  const fingers: [number, number] = [robot.gripper.height, robot.gripper.height + G.fingerHeight];
  const shapes = sim.robotShapes();
  const shapeHeights: Array<[number, number]> = [[0, CFG.chassisHeight], fingers, fingers];
  for (const b of bodies) {
    if (b.held) continue;
    shapes.forEach((shape, k) => {
      if (!heightsMeet(shapeHeights[k][0], shapeHeights[k][1], b)) return;
      const o = obbOverlap(shape, footprintOf(b));
      assert.ok(!o || o.depth < 0.1, `${where}: robot part ${k} is ${o?.depth.toFixed(2)} mm inside ${b.id}`);
    });
    for (const c of bodies) {
      if (c === b || c.id < b.id || !heightsMeet(c.z, c.z + c.h, b)) continue;
      const o = obbOverlap(footprintOf(b), footprintOf(c));
      assert.ok(!o || o.depth < 0.1, `${where}: ${b.id} is ${o?.depth.toFixed(2)} mm inside ${c.id}`);
    }
  }
}

test('stress: a clumsy robot shoves, grabs, drops and restarts - the world always stays sane', () => {
  let grabs = 0;
  let placedOnTowers = 0;
  let bumps = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rng = makeRng(seed * 104729);
    const holder: { sim?: Simulation<FireRescueScenario> } = {};
    const sim = createEngineSimulation(
      { game: fireRescueGame, scenario: scenarioFromIndex(Math.floor(rng() * 9216)), robotConfig: CFG, program: {}, seed },
      scriptedVM(clumsyProgram(() => holder.sim as Simulation<FireRescueScenario>, rng)),
    );
    holder.sim = sim;
    sim.start();
    for (let i = 0; i < 8000 && sim.status === 'running'; i++) {
      sim.step(1);
      if (i % 40 === 0) checkWorld(sim, `seed ${seed}, tick ${i}`);
      if (rng() < 0.0002) {
        sim.restart();
        checkWorld(sim, `seed ${seed}, restart at tick ${i}`);
      }
    }
    sim.declareFinished();
    checkWorld(sim, `seed ${seed}, end`);
    checkNothingOverlaps(sim, `seed ${seed}, end`);
    const report = sim.score();
    assert.ok(report.total >= 0 && report.total <= 180);
    for (const e of sim.drainEvents()) {
      if (e.type === 'grab') grabs++;
      if (e.type === 'bump') bumps++;
      if (e.type === 'release' && e.onto !== null) placedOnTowers++;
    }
  }
  // the test is only worth something if a lot really happened
  assert.ok(grabs >= 20, `grabs: ${grabs}`);
  assert.ok(placedOnTowers >= 8, `placed on towers: ${placedOnTowers}`);
  assert.ok(bumps >= 50, `bumps: ${bumps}`);
});
