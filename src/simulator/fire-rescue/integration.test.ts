/**
 * The whole chain in one place:
 *
 *   block program (builder / Blockly)  ->  interpreter  ->  engine  ->  Fire Rescue referee
 *
 * Every sample program of samples.ts is run headless on the real field, and the batch runner
 * (core/batch.ts) is checked on the way. If one of these tests fails, a program a teacher shows
 * in class no longer does what its description says.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { createEditor, type BlocklyApi } from '../blocks/register';
import {
  batchRuns,
  drawScenarios,
  runBatch,
  runBatchAsync,
  runMatch,
  summarize,
  type BatchResult,
} from '../core/batch';
import { makeProbeReading } from '../core/engine-sensors';
import { DEG, obbCorners, wrapAngle } from '../core/geometry';
import { RasterMatSampler } from '../core/mat';
import { DEFAULT_ROBOT_CONFIG } from '../core/robot';
import { createSimulation } from '../core/simulation';
import type { Body, ColorName, MatSampler, Pose, ProgramJson, RobotConfig, SimEvent, Simulation } from '../core/types';
import { forever, program, script, wait, whenStart } from '../vm/builder';
import { supportsBlock } from '../vm';
import { BUCKET_DESTINATION, FIRE_STATION, MAT_SIZE, MAT_VECTOR, type BuildingSlot } from './field';
import { bucketBodyId, buildingSquare, fireRescueGame, footprint, personBodyId, towerBodyId } from './game';
import { FULL_MISSION_SAMPLE, getSampleProgram, SAMPLE_PROGRAMS, type SampleProgram } from './samples';
import {
  COLORS,
  defaultScenario,
  encodeScenario,
  scenarioFromIndex,
  SCENARIO_COUNT,
  withBucket,
  withPersonSlot,
  type FireRescueScenario,
} from './scenario';

type Sim = Simulation<FireRescueScenario>;

// =============================================================================================
// Helpers
// =============================================================================================

function sample(id: string): SampleProgram {
  const found = getSampleProgram(id);
  assert.ok(found, `sample "${id}" exists`);
  return found;
}

function simulate(
  blocks: ProgramJson,
  scenario: FireRescueScenario = defaultScenario(),
  extra: { robotConfig?: RobotConfig; startPose?: Pose; seed?: number; sampler?: MatSampler } = {},
): Sim {
  return createSimulation({
    game: fireRescueGame,
    scenario,
    robotConfig: extra.robotConfig ?? DEFAULT_ROBOT_CONFIG,
    program: blocks,
    startPose: extra.startPose,
    seed: extra.seed,
    sampler: extra.sampler,
  });
}

/** Run a match to its end, 5 ticks at a time; `watch` is called after every slice. Returns all events. */
function runToEnd(sim: Sim, watch?: (sim: Sim) => void): SimEvent[] {
  const events: SimEvent[] = [];
  sim.start();
  while (sim.status === 'running') {
    sim.step(5);
    events.push(...sim.drainEvents());
    watch?.(sim);
  }
  events.push(...sim.drainEvents());
  return events;
}

const bodyOf = (sim: Sim, id: string): Body => {
  const body = sim.world.bodies.find((b) => b.id === id);
  assert.ok(body, `body ${id} exists`);
  return body;
};

const isHome = (b: Body): boolean =>
  Math.hypot(b.x - b.home.x, b.y - b.home.y) < 0.01 && b.z === b.home.z && b.restingOn === b.home.restingOn && !b.held;

/** Ids of the bodies that are not where they started. */
const movedBodies = (sim: Sim): string[] => sim.world.bodies.filter((b) => !isHome(b)).map((b) => b.id);

/**
 * How far (mm) the robot, or what it carries, sticks out over the edge of the mat right now
 * (0 = completely over the mat).
 */
function overhang(sim: Sim): number {
  const shapes = sim.robotShapes();
  const held = sim.world.bodies.find((b) => b.held);
  if (held) shapes.push(footprint(held));
  let worst = 0;
  for (const shape of shapes) {
    for (const c of obbCorners(shape)) worst = Math.max(worst, -c.x, -c.y, c.x - MAT_SIZE, c.y - MAT_SIZE);
  }
  return worst;
}

/**
 * The squares of the buildings are only 60 mm from the edge of the mat. A robot that turns on the
 * spot in front of an outer square swings a rear corner a few millimetres over the edge; more
 * than this would mean the gripper or the load left the mat.
 */
const MAX_OVERHANG = 8;

const lineOf = (result: { lines: BatchResult['lines'] }, id: string) => {
  const line = result.lines.find((l) => l.id === id);
  assert.ok(line, `score line ${id} exists`);
  return line;
};

const problems = (events: SimEvent[]): SimEvent[] => events.filter((e) => e.type === 'log' && e.level !== 'info');

/** Every block type used anywhere in a program. */
function blockTypes(blocks: ProgramJson): string[] {
  const types = new Set<string>();
  const walk = (block: NonNullable<NonNullable<ProgramJson['blocks']>['blocks']>[number] | undefined): void => {
    if (!block) return;
    types.add(block.type);
    for (const slot of Object.values(block.inputs ?? {})) {
      walk(slot.shadow);
      walk(slot.block);
    }
    walk(block.next?.block);
  };
  (blocks.blocks?.blocks ?? []).forEach(walk);
  return [...types];
}

/** The default combination with another bucket on W1 and the destination building's person in `personSlot`. */
function scenarioFor(color: ColorName, personSlot: BuildingSlot): FireRescueScenario {
  return withPersonSlot(withBucket(defaultScenario(), 'W1', color), BUCKET_DESTINATION[color], personSlot);
}

// =============================================================================================
// The samples
// =============================================================================================

describe('sample programs', () => {
  test('the list holds the six programs, each with a title, a level and a description', () => {
    assert.deepEqual(
      SAMPLE_PROGRAMS.map((s) => s.id),
      ['hello', 'line-follow', 'gripper-demo', 'one-bucket', 'smart-bucket', 'one-person'],
    );
    for (const s of [...SAMPLE_PROGRAMS, FULL_MISSION_SAMPLE]) {
      assert.ok(s.title.length > 3, s.id);
      assert.ok(s.description.length > 40, s.id);
      assert.ok(['starter', 'intermediate', 'advanced'].includes(s.level), s.id);
      assert.equal(getSampleProgram(s.id), s);
      const types = blockTypes(s.program);
      assert.ok(types.includes('event_cyberpi_start'), `${s.id} starts with "when CyberPi starts up"`);
      for (const type of types) assert.ok(supportsBlock(type), `${s.id}: the interpreter knows "${type}"`);
    }
    assert.equal(getSampleProgram('no-such-sample'), undefined);
    assert.equal(sample('smart-bucket').level, 'advanced');
    // the complete solution is available, but not in the menu
    assert.equal(FULL_MISSION_SAMPLE.id, 'full-mission');
    assert.ok(!SAMPLE_PROGRAMS.includes(FULL_MISSION_SAMPLE));
  });

  test('every sample runs on the default combination without errors or warnings, and ends by itself', () => {
    for (const s of [...SAMPLE_PROGRAMS, FULL_MISSION_SAMPLE]) {
      const sim = simulate(s.program);
      assert.deepEqual(sim.vm.errors(), [], `${s.id}: problems found before the start`);
      const events = runToEnd(sim);
      assert.equal(sim.status, 'finished', s.id);
      assert.deepEqual(sim.vm.errors(), [], `${s.id}: runtime problems`);
      assert.deepEqual(problems(events), [], `${s.id}: warnings or errors in the log`);
      assert.equal(sim.finishReason, 'program-ended', s.id);
      assert.equal(events.filter((e) => e.type === 'bump').length, 0, `${s.id}: it never ran into anything`);
      assert.ok(movedBodies(sim).every((id) => !id.startsWith('tower:')), `${s.id}: no tower was pushed`);
    }
  });

  test('hello: 20 cm out and back, a quarter turn, blue LEDs, two lines on the screen', () => {
    const sim = simulate(sample('hello').program);
    let furthest = Infinity;
    const events = runToEnd(sim, (s) => (furthest = Math.min(furthest, s.world.robot.pose.y)));
    const start = fireRescueGame.defaultStartPose;
    const { pose, leds, screen } = sim.world.robot;
    assert.ok(Math.abs(furthest - (start.y - 200)) < 0.5, `drove 20 cm up the mat (reached y = ${furthest})`);
    assert.ok(Math.abs(pose.x - start.x) < 0.01 && Math.abs(pose.y - start.y) < 0.01, 'back where it started');
    assert.ok(Math.abs(wrapAngle(pose.heading - 90 * DEG)) < 1e-6, 'facing right');
    assert.deepEqual(leds, [0, 1, 2, 3, 4].map(() => ({ r: 0, g: 0, b: 255 })));
    assert.deepEqual(screen.lines, ['Hello MakeX!', 'Ready for the mission']);
    assert.deepEqual(movedBodies(sim), [], 'nothing on the field was touched');
    assert.equal(events.filter((e) => e.type === 'bump').length, 0);
    assert.equal(sim.score().total, 0);
  });

  test('line-follow: from the Fire Station along the black line, stops in front of the rescue towers', () => {
    const sim = simulate(sample('line-follow').program);
    let offLine = 0;
    const events = runToEnd(sim, (s) => (offLine = Math.max(offLine, Math.abs(s.world.robot.pose.x - 625))));
    const { pose, left, right, screen } = sim.world.robot;
    assert.equal(sim.finishReason, 'program-ended', '"stop all" ends the program');
    assert.ok(pose.y > 380 && pose.y < 430, `stops short of the upper rescue towers (y = ${pose.y.toFixed(1)})`);
    assert.ok(pose.y < FIRE_STATION.y - 70, 'the whole robot has left the Fire Station');
    assert.ok(offLine < 0.01, `a perfect robot stays on the centre line (off by ${offLine.toFixed(3)} mm)`);
    assert.equal(left.rpm, 0);
    assert.equal(right.rpm, 0);
    assert.equal(sim.readSensors().lineStatus, 0b0110, 'the two middle probes are on the line');
    assert.ok(sim.readSensors().ultrasonicCm < 12, 'the rescue towers are closer than 12 cm');
    assert.deepEqual(screen.lines, ['Line follower', 'Safe zone reached']);
    assert.deepEqual(movedBodies(sim), []);
    assert.equal(events.filter((e) => e.type === 'bump').length, 0);
  });

  test('line-follow: really follows the line - crooked starts, slipping wheels, noisy sensors', () => {
    const line = sample('line-follow').program;
    const real: RobotConfig = { ...DEFAULT_ROBOT_CONFIG, noise: { wheelSlip: 0.03, sensor: 8, ultrasonicCm: 0.3 } };
    const cases: Array<{ name: string; startPose?: Pose; robotConfig?: RobotConfig; seed?: number; mustSteer?: boolean }> = [
      { name: '13 mm left, turned 4 degrees right', startPose: { x: 612, y: 673.2, heading: 4 * DEG }, mustSteer: true },
      { name: '15 mm right, turned 3 degrees left', startPose: { x: 640, y: 673.2, heading: -3 * DEG } },
      // going straight from these two would leave the line: 20 mm to the side, turned 6 degrees
      { name: '20 mm left, turned 6 degrees right', startPose: { x: 605, y: 673.2, heading: 6 * DEG }, mustSteer: true },
      { name: '20 mm right, turned 6 degrees left', startPose: { x: 645, y: 673.2, heading: -6 * DEG }, mustSteer: true },
      { name: 'imperfect robot, seed 1', robotConfig: real, seed: 1 },
      { name: 'imperfect robot, seed 2', robotConfig: real, seed: 2 },
      { name: 'imperfect robot and a crooked start', robotConfig: real, seed: 3, startPose: { x: 612, y: 673.2, heading: 4 * DEG } },
    ];
    for (const c of cases) {
      const sim = simulate(line, defaultScenario(), c);
      let steered = false;
      runToEnd(sim, (s) => {
        const { left, right } = s.world.robot;
        if (left.mode === 'speed' && left.targetRpm !== right.targetRpm) steered = true;
      });
      const pose = sim.world.robot.pose;
      assert.equal(sim.finishReason, 'program-ended', c.name);
      if (c.mustSteer) assert.ok(steered, `${c.name}: the program had to steer`);
      assert.ok(Math.abs(pose.x - 625) < 10, `${c.name}: ends on the line (x = ${pose.x.toFixed(1)})`);
      assert.ok(Math.abs(wrapAngle(pose.heading)) < 8 * DEG, `${c.name}: ends pointing along the line`);
      assert.ok((sim.readSensors().lineStatus & 0b0110) !== 0, `${c.name}: a middle probe is on the line`);
      assert.ok(pose.y > 380 && pose.y < 440, `${c.name}: stops in front of the towers (y = ${pose.y.toFixed(1)})`);
      assert.deepEqual(movedBodies(sim), [], c.name);
    }
  });

  test('gripper-demo: takes the bucket off W1, puts it on the mat, grips it again and lifts it', () => {
    for (const scenario of [defaultScenario(), scenarioFromIndex(4321)]) {
      const code = encodeScenario(scenario);
      const bucketId = bucketBodyId(scenario.buckets.W1);
      const sim = simulate(sample('gripper-demo').program, scenario);
      let stoodOnMat = false;
      const events = runToEnd(sim, (s) => {
        const b = bodyOf(s, bucketId);
        if (!b.held && b.z === 0 && b.restingOn === null) stoodOnMat = true;
      });
      const gripperEvents = events.filter((e) => e.type === 'grab' || e.type === 'release');
      assert.deepEqual(gripperEvents.map((e) => e.type), ['grab', 'release', 'grab'], code);
      assert.ok(gripperEvents.every((e) => 'bodyId' in e && e.bodyId === bucketId), code);
      assert.ok(stoodOnMat, `${code}: the bucket stood on the mat in between`);
      const bucket = bodyOf(sim, bucketId);
      assert.equal(sim.world.robot.gripper.holding, bucketId, code);
      assert.ok(bucket.held && bucket.z > 60, `${code}: the bucket hangs in the raised claw (z = ${bucket.z})`);
      assert.deepEqual(movedBodies(sim), [bucketId], `${code}: nothing else moved`);
      assert.deepEqual(sim.world.robot.screen.lines, ['Got it!']);
    }
  });

  test('one-bucket: 20 points on the default combination', () => {
    const sim = simulate(sample('one-bucket').program);
    let over = 0;
    const events = runToEnd(sim, (s) => (over = Math.max(over, overhang(s))));
    const report = sim.score();
    assert.equal(lineOf(report, 'bucket:red').ok, true, lineOf(report, 'bucket:red').detail);
    assert.equal(report.total, 20);
    assert.ok(report.total >= 20);
    assert.deepEqual(movedBodies(sim), ['bucket:red'], 'only the red bucket moved');
    assert.ok(over < MAX_OVERHANG, `the robot and the bucket stayed over the mat (${over.toFixed(1)} mm over the edge at most)`);
    assert.equal(events.filter((e) => e.type === 'bump').length, 0, 'it never ran into anything');
    // the bucket stands in the middle of A2, with room to spare
    const bucket = bodyOf(sim, 'bucket:red');
    const a2 = buildingSquare('A', 2);
    assert.ok(Math.abs(bucket.x - (a2.x + a2.w / 2)) < 2 && Math.abs(bucket.y - (a2.y + a2.h / 2)) < 2);
  });

  test('one-bucket: as its description says, it only scores with the red bucket on W1 and the person in A1', () => {
    const blocks = sample('one-bucket').program;
    const play = (scenario: FireRescueScenario) =>
      runMatch({ game: fireRescueGame, scenario, robotConfig: DEFAULT_ROBOT_CONFIG, program: blocks });
    assert.equal(play(scenarioFor('red', 1)).total, 20, 'the default combination');
    assert.equal(play(scenarioFor('blue', 1)).total, 0, 'a blue bucket on W1 does not belong in building A');
    assert.equal(play(scenarioFor('red', 2)).total, 0, 'the person stands in A2, where the bucket should go');
  });

  test('one-person: 20 points on the default combination', () => {
    const sim = simulate(sample('one-person').program);
    let over = 0;
    const events = runToEnd(sim, (s) => (over = Math.max(over, overhang(s))));
    const report = sim.score();
    assert.equal(lineOf(report, 'person:red').ok, true, lineOf(report, 'person:red').detail);
    assert.equal(report.total, 20);
    assert.ok(report.total >= 20);
    const person = bodyOf(sim, 'person:red');
    assert.equal(person.restingOn, towerBodyId('RR'));
    assert.deepEqual(movedBodies(sim), ['person:red'], 'only the red person moved (the tower was not pushed)');
    assert.equal(over, 0, 'the robot and the person stayed over the mat all the way');
    assert.equal(events.filter((e) => e.type === 'bump').length, 0);
    assert.deepEqual(
      events.filter((e) => e.type === 'release').map((e) => (e.type === 'release' ? e.onto : '')),
      [towerBodyId('RR')],
    );
  });
});

// =============================================================================================
// The whole match
// =============================================================================================

describe('full mission', () => {
  test('all eight missions and the bonus: 180 points in well under three minutes', () => {
    const sim = simulate(FULL_MISSION_SAMPLE.program);
    let over = 0;
    const events = runToEnd(sim, (s) => (over = Math.max(over, overhang(s))));
    const report = sim.score();

    assert.equal(sim.finishReason, 'program-ended');
    assert.deepEqual(sim.vm.errors(), []);
    assert.deepEqual(problems(events), []);
    for (const line of report.lines) assert.equal(line.ok, true, `${line.id}: ${line.detail}`);
    assert.equal(report.complete, true);
    assert.equal(lineOf(report, 'bonus').points, 20);
    assert.equal(report.total, 180);
    assert.equal(report.total, report.max);
    assert.ok(sim.world.time < 120, `finished after ${sim.world.time.toFixed(1)} s of the 180 s`);

    // eight things were gripped once and put down once; every person was put on a tower
    assert.equal(events.filter((e) => e.type === 'grab').length, 8);
    const releases = events.filter((e) => e.type === 'release');
    assert.equal(releases.length, 8);
    assert.equal(releases.filter((e) => e.type === 'release' && e.onto !== null).length, 4);
    // a clean run: nothing was bumped, no tower moved, the robot stayed over the mat
    assert.equal(events.filter((e) => e.type === 'bump').length, 0);
    assert.ok(sim.world.bodies.filter((b) => b.id.startsWith('tower:')).every(isHome), 'every tower is where it started');
    assert.ok(over < MAX_OVERHANG, `${over.toFixed(1)} mm over the edge of the mat at most`);
    assert.deepEqual(sim.world.robot.screen.lines, ['Mission complete!']);
  });

  test('it is a solution of the default combination only', () => {
    // another bucket arrangement: the buckets end up at the wrong buildings
    const other = runMatch({
      game: fireRescueGame,
      scenario: withBucket(defaultScenario(), 'W1', 'green'),
      robotConfig: DEFAULT_ROBOT_CONFIG,
      program: FULL_MISSION_SAMPLE.program,
    });
    assert.ok(other.total < 180, `${other.total} points`);
    assert.equal(other.complete, false);
    assert.equal(lineOf(other, 'bonus').ok, false);
  });
});

// =============================================================================================
// smart-bucket: any colour on W1, person in either square
// =============================================================================================

describe('smart-bucket', () => {
  const blocks = sample('smart-bucket').program;

  test('all eight cases: four bucket colours x person in square 1 or 2', () => {
    for (const color of COLORS) {
      for (const personSlot of [1, 2] as const) {
        const scenario = scenarioFor(color, personSlot);
        const code = encodeScenario(scenario);
        const building = BUCKET_DESTINATION[color];
        const waterSlot: BuildingSlot = personSlot === 1 ? 2 : 1;
        const bucketId = bucketBodyId(color);

        const sim = simulate(blocks, scenario);
        let over = 0;
        const events = runToEnd(sim, (s) => (over = Math.max(over, overhang(s))));
        const report = sim.score();

        assert.equal(sim.finishReason, 'program-ended', code);
        assert.deepEqual(sim.vm.errors(), [], code);
        assert.deepEqual(problems(events), [], code);
        assert.equal(lineOf(report, bucketId).ok, true, `${code}: ${lineOf(report, bucketId).detail}`);
        assert.equal(report.total, 20, code);
        assert.equal(sim.vm.variables().colour, color, `${code}: the variable holds the colour that was read`);
        assert.ok(sim.world.robot.screen.lines.includes(`Bucket: ${color}`), code);

        // the bucket stands in the free square of the right building, near its middle
        const square = buildingSquare(building, waterSlot);
        const bucket = bodyOf(sim, bucketId);
        assert.ok(
          Math.abs(bucket.x - (square.x + square.w / 2)) < 2 && Math.abs(bucket.y - (square.y + square.h / 2)) < 2,
          `${code}: bucket at (${bucket.x.toFixed(1)}, ${bucket.y.toFixed(1)}), expected the middle of ${building}${waterSlot}`,
        );
        // ... and nothing else was disturbed: no tower pushed, the person still waiting
        assert.deepEqual(movedBodies(sim), [bucketId], code);
        assert.ok(isHome(bodyOf(sim, personBodyId(scenario.people[building].color))), code);
        assert.equal(events.filter((e) => e.type === 'bump').length, 0, `${code}: it never ran into anything`);
        assert.ok(over < MAX_OVERHANG, `${code}: the robot stayed over the mat (${over.toFixed(1)} mm over the edge at most)`);
        assert.ok(sim.world.time < 30, `${code}: done in ${sim.world.time.toFixed(1)} s`);
      }
    }
  });

  test('scores 20 on 60 combinations drawn at random from all 9216', () => {
    const scenarios = drawScenarios(fireRescueGame, 60, 2027);
    assert.equal(new Set(scenarios.map(encodeScenario)).size, 60, '60 different combinations');
    const results = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, blocks, scenarios);
    assert.equal(results.length, 60);
    scenarios.forEach((scenario, i) => {
      const result = results[i];
      const bucketLine = lineOf(result, bucketBodyId(scenario.buckets.W1));
      assert.equal(result.scenarioCode, encodeScenario(scenario));
      assert.equal(bucketLine.ok, true, `${result.scenarioCode}: ${bucketLine.detail}`);
      assert.ok(result.total >= 20, `${result.scenarioCode}: ${result.total} points`);
      assert.equal(result.errors, undefined, result.scenarioCode);
      assert.equal(result.finishReason, 'program-ended', result.scenarioCode);
    });
    // the draw covers the space: every colour on W1, and both squares for the person
    assert.equal(new Set(scenarios.map((s) => s.buckets.W1)).size, 4);
    assert.equal(new Set(scenarios.map((s) => s.people[BUCKET_DESTINATION[s.buckets.W1]].slot)).size, 2);
  });

  test('scores 20 on every bucket arrangement x every pattern of person squares (384 combinations)', () => {
    // 24 bucket arrangements x 16 square patterns; the colours of the people change from one to the next
    const scenarios: FireRescueScenario[] = [];
    for (let i = 0; i < SCENARIO_COUNT / 24; i++) scenarios.push(scenarioFromIndex(i * 24 + (i % 24)));
    const results = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, blocks, scenarios);
    const failed = results.filter((r) => r.total !== 20 || r.errors !== undefined);
    assert.deepEqual(failed.map((r) => r.scenarioCode), []);
    const summary = summarize(results);
    assert.equal(summary.runs, 384);
    assert.equal(summary.average, 20);
    assert.equal(summary.worst, 20);
    // each colour stands on W1 in a quarter of the arrangements
    for (const color of COLORS) assert.equal(summary.perLine.find((l) => l.id === bucketBodyId(color))?.successRate, 0.25);
  });
});

// =============================================================================================
// Rules that only show when everything runs together
// =============================================================================================

describe('whole matches', () => {
  test('same program + same combination + same seed = exactly the same match', () => {
    // a robot with every kind of noise switched on, so that the seed really matters
    const noisy: RobotConfig = { ...DEFAULT_ROBOT_CONFIG, noise: { wheelSlip: 0.03, sensor: 6, ultrasonicCm: 0.4 } };
    const play = (id: string, seed: number) => {
      const sim = simulate(sample(id).program, scenarioFromIndex(777), { robotConfig: noisy, seed });
      const events = runToEnd(sim);
      return JSON.stringify({ world: sim.world, score: sim.score(), reason: sim.finishReason, events, vars: sim.vm.variables() });
    };
    for (const id of ['smart-bucket', 'line-follow']) {
      const first = play(id, 42);
      assert.equal(play(id, 42), first, `${id}: seed 42 twice`);
      assert.notEqual(play(id, 43), first, `${id}: another seed gives another match`);
    }
    // and without noise the seed does not matter at all
    const blocks = sample('one-bucket').program;
    const opts = { game: fireRescueGame, scenario: defaultScenario(), robotConfig: DEFAULT_ROBOT_CONFIG, program: blocks };
    assert.deepEqual(runMatch({ ...opts, seed: 1 }), runMatch({ ...opts, seed: 99 }));
  });

  test('a full 3-minute match of a waiting robot is computed in well under 1.5 seconds', () => {
    const idle = program([script(whenStart(), [forever([wait(1)])])]);
    const opts = { game: fireRescueGame, scenario: defaultScenario(), robotConfig: DEFAULT_ROBOT_CONFIG, program: idle };
    runMatch(opts, 1); // (the first match also pays for loading and warming up the code)
    const started = performance.now();
    const result = runMatch(opts);
    const wallMs = performance.now() - started;
    assert.equal(result.finishReason, 'time');
    assert.equal(result.time, 180);
    assert.equal(result.total, 0);
    assert.ok(wallMs < 1500, `took ${wallMs.toFixed(0)} ms`);
  });

  test('restart while carrying a bucket: -5, the bucket goes back onto its tower, the program starts again', () => {
    const sim = simulate(sample('one-bucket').program);
    sim.start();
    while (sim.world.robot.gripper.holding === null && sim.world.time < 30) sim.step(1);
    assert.equal(sim.world.robot.gripper.holding, 'bucket:red');
    sim.step(150); // carry it away from the tower for a second and a half
    const bucket = bodyOf(sim, 'bucket:red');
    assert.ok(bucket.held && Math.hypot(bucket.x - bucket.home.x, bucket.y - bucket.home.y) > 50, 'the bucket is on its way');
    const timeBefore = sim.world.time;

    sim.restart();

    assert.equal(sim.restarts, 1);
    assert.equal(sim.status, 'running', 'the match goes on');
    assert.equal(sim.world.time, timeBefore, 'the clock keeps running, it is not reset');
    assert.deepEqual(sim.world.robot.pose, fireRescueGame.defaultStartPose, 'the robot is back in the Fire Station');
    assert.equal(sim.world.robot.gripper.holding, null);
    assert.ok(isHome(bucket), 'the bucket stands on water tower W1 again');
    assert.equal(bucket.restingOn, towerBodyId('W1'));
    assert.deepEqual(movedBodies(sim), []);
    const now = sim.score();
    assert.equal(lineOf(now, 'restarts').points, -5);
    assert.equal(now.total, 0, 'the total never goes below 0');
    assert.ok(sim.drainEvents().some((e) => e.type === 'restart'));

    // the program starts again from the top and this time finishes the delivery: 20 - 5 = 15
    sim.step(18000);
    assert.equal(sim.finishReason, 'program-ended');
    const final = sim.score();
    assert.equal(lineOf(final, 'bucket:red').ok, true, lineOf(final, 'bucket:red').detail);
    assert.equal(lineOf(final, 'restarts').points, -5);
    assert.equal(final.total, 15);
  });

  test('restart while carrying a person: the person goes back to its square on the mat', () => {
    const sim = simulate(sample('one-person').program);
    sim.start();
    while (sim.world.robot.gripper.holding === null && sim.world.time < 30) sim.step(1);
    assert.equal(sim.world.robot.gripper.holding, 'person:red');
    sim.step(400); // lifted and on its way to the tower
    const person = bodyOf(sim, 'person:red');
    assert.ok(person.held && person.z > 60);

    sim.restart();
    sim.restart(); // a second restart right away costs another 5 points and changes nothing else

    assert.equal(sim.restarts, 2);
    assert.ok(isHome(person), 'the person waits in A1 again, standing on the mat');
    assert.equal(person.z, 0);
    sim.step(18000);
    const final = sim.score();
    assert.equal(lineOf(final, 'person:red').ok, true);
    assert.equal(final.total, 10, '20 for the person, minus two restarts');
  });
});

// =============================================================================================
// The batch runner
// =============================================================================================

describe('batch runner', () => {
  const smart = sample('smart-bucket').program;
  const base = { game: fireRescueGame, robotConfig: DEFAULT_ROBOT_CONFIG, program: smart };

  test('runMatch reports the score sheet of one match', () => {
    const result = runMatch({ ...base, scenario: defaultScenario() });
    assert.equal(result.scenarioCode, 'RGBY-A1R-B1B-C1Y-D1G');
    assert.equal(result.total, 20);
    assert.equal(result.max, 180);
    assert.equal(result.complete, false);
    assert.equal(result.restarts, 0);
    assert.equal(result.finishReason, 'program-ended');
    assert.ok(result.time > 5 && result.time < 30, `match time ${result.time}`);
    assert.equal(result.lines.length, 11);
    assert.equal(result.errors, undefined);
  });

  test('runMatch with maxSeconds cuts the match short: "Finished" is declared and the field is scored as it is', () => {
    const result = runMatch({ ...base, scenario: defaultScenario() }, 5);
    assert.equal(result.finishReason, 'declared');
    assert.equal(result.time, 5);
    assert.equal(result.total, 0, 'the bucket is still in the claw after 5 seconds');
  });

  test('runMatch reports the problems the interpreter found', () => {
    const broken: ProgramJson = {
      blocks: { blocks: [{ type: 'event_cyberpi_start', id: 'hat', next: { block: { type: 'no_such_block', id: 'x' } } }] },
    };
    const result = runMatch({ ...base, program: broken, scenario: defaultScenario() });
    assert.equal(result.total, 0);
    assert.equal(result.errors?.length, 1);
    assert.equal(result.errors?.[0].blockId, 'x');
  });

  test('runBatch plays the list in order, reports progress and can be stopped early', () => {
    const scenarios = [3, 1500, 4000, 9000].map(scenarioFromIndex);
    const seen: string[] = [];
    const results = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, smart, scenarios, (done, total, result) => {
      seen.push(`${done}/${total} ${result.scenarioCode}`);
    });
    assert.deepEqual(results.map((r) => r.scenarioCode), scenarios.map(encodeScenario));
    assert.deepEqual(seen, scenarios.map((s, i) => `${i + 1}/4 ${encodeScenario(s)}`));
    const firstTwo = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, smart, scenarios, (done) => done < 2);
    assert.deepEqual(firstTwo, results.slice(0, 2));
    // the generator gives the same matches one by one
    assert.deepEqual([...batchRuns({ ...base, scenarios })], results);
    // settings shared by all matches: here every match is cut short after 5 seconds
    const short = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, smart, scenarios, undefined, { maxSeconds: 5 });
    assert.deepEqual(short.map((r) => `${r.finishReason} ${r.time} ${r.total}`), scenarios.map(() => 'declared 5 0'));
  });

  test('runBatchAsync gives the same results, takes breaks and can be cancelled', async () => {
    const scenarios = [3, 1500, 4000, 9000, 77, 5555].map(scenarioFromIndex);
    const expected = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, smart, scenarios);

    // a pretend clock that jumps 10 ms per look: with yieldEvery 15 there is a break after every second match
    let clock = 0;
    let pauses = 0;
    const progress: number[] = [];
    const results = await runBatchAsync(
      { ...base, scenarios },
      {
        yieldEvery: 15,
        now: () => (clock += 10),
        pause: async () => {
          pauses++;
        },
        onResult: (_result, done, total) => progress.push(done / total),
      },
    );
    assert.deepEqual(results, expected);
    assert.deepEqual(progress, [1, 2, 3, 4, 5, 6].map((n) => n / 6));
    assert.ok(pauses >= 2 && pauses <= 5, `${pauses} breaks`);

    // cancel after the second match
    const signal = { aborted: false };
    const partial = await runBatchAsync(
      { ...base, scenarios },
      { yieldEvery: 0, signal, onResult: (_r, done) => (signal.aborted = done >= 2) },
    );
    assert.deepEqual(partial, expected.slice(0, 2));

    // with the default timer-based break (and a real AbortController, as a web page would use)
    const controller = new AbortController();
    const all = await runBatchAsync({ ...base, scenarios: scenarios.slice(0, 3) }, { yieldEvery: 0, signal: controller.signal });
    assert.deepEqual(all, expected.slice(0, 3));
  });

  test('summarize: average, best, worst, complete matches and success per score line', () => {
    assert.deepEqual(summarize([]), { runs: 0, average: 0, best: 0, worst: 0, completeCount: 0, perLine: [] });

    // one-bucket only works for the default combination: one hit, one miss
    const oneBucket = sample('one-bucket').program;
    const results = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, oneBucket, [defaultScenario(), scenarioFor('green', 1)]);
    const summary = summarize(results);
    assert.equal(summary.runs, 2);
    assert.equal(summary.best, 20);
    assert.equal(summary.worst, 0);
    assert.equal(summary.average, 10);
    assert.equal(summary.completeCount, 0);
    assert.deepEqual(summary.perLine.map((l) => l.id), results[0].lines.map((l) => l.id));
    const rate = (id: string) => summary.perLine.find((l) => l.id === id)?.successRate;
    assert.equal(rate('bucket:red'), 0.5);
    assert.equal(rate('bucket:green'), 0);
    assert.equal(rate('restarts'), 1, 'no restart in either match');
    assert.equal(summary.perLine[0].label, results[0].lines[0].label);
  });

  test('drawScenarios: different combinations, repeatable, never more than exist', () => {
    const a = drawScenarios(fireRescueGame, 25, 5).map(encodeScenario);
    const b = drawScenarios(fireRescueGame, 25, 5).map(encodeScenario);
    const c = drawScenarios(fireRescueGame, 25, 6).map(encodeScenario);
    assert.equal(new Set(a).size, 25);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.equal(drawScenarios(fireRescueGame, 0).length, 0);
    assert.equal(drawScenarios(fireRescueGame, -3).length, 0);
  });

  test('batch speed: 100 smart-bucket matches in well under 5 seconds', () => {
    const scenarios = drawScenarios(fireRescueGame, 100, 11);
    const started = performance.now();
    const results = runBatch(fireRescueGame, DEFAULT_ROBOT_CONFIG, smart, scenarios);
    const wallMs = performance.now() - started;
    assert.equal(summarize(results).average, 20);
    assert.ok(wallMs < 5000, `took ${wallMs.toFixed(0)} ms`);
  });
});

// =============================================================================================
// Through the real block editor
// =============================================================================================

/** Give Node the few browser globals Blockly needs (jsdom comes along with Blockly), then load Blockly. */
async function loadBlocklyWithDom(): Promise<BlocklyApi | null> {
  let JSDOM: new (html: string, options?: object) => { window: Record<string, unknown> };
  try {
    ({ JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: typeof JSDOM });
  } catch {
    return null; // no jsdom on this machine: the test is skipped
  }
  const dom = new JSDOM('<!DOCTYPE html><div id="editor" style="width: 900px; height: 600px"></div>', { pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'DOMParser', 'XMLSerializer',
    'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']; // prettier-ignore
  // jsdom has no canvas; Blockly only uses it to measure how wide a text is
  const canvas = dom.window.HTMLCanvasElement as { prototype: { getContext: unknown } };
  canvas.prototype.getContext = () => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) });
  for (const name of names) {
    const value = name === 'window' ? dom.window : dom.window[name];
    if (value !== undefined) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return (await import('blockly')) as unknown as BlocklyApi;
}

describe('samples in the block editor', () => {
  test('every sample loads into Blockly, and what Blockly saves plays the same match', async (t) => {
    const Blockly = await loadBlocklyWithDom();
    if (!Blockly) {
      t.skip('jsdom is not installed');
      return;
    }
    const workspace = createEditor(Blockly, 'editor', { sounds: false });
    for (const s of [...SAMPLE_PROGRAMS, FULL_MISSION_SAMPLE]) {
      workspace.clear();
      Blockly.serialization.workspaces.load(s.program as never, workspace);
      const drawn = workspace.getAllBlocks(false);
      assert.ok(drawn.length >= 5, `${s.id}: ${drawn.length} blocks drawn`);
      for (const block of drawn) assert.ok(supportsBlock(block.type), `${s.id}: ${block.type}`);

      // tidy on the workspace: the start script is the leftmost stack, and no stack lies on top of another
      const stacks = workspace.getTopBlocks(false).map((block) => ({ type: block.type, box: block.getBoundingRectangle() }));
      const leftmost = stacks.reduce((a, b) => (b.box.left < a.box.left ? b : a));
      assert.equal(leftmost.type, 'event_cyberpi_start', `${s.id}: "when CyberPi starts up" comes first`);
      for (let i = 0; i < stacks.length; i++) {
        for (let j = i + 1; j < stacks.length; j++) {
          const a = stacks[i].box;
          const b = stacks[j].box;
          const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          assert.ok(apart, `${s.id}: ${stacks[i].type} and ${stacks[j].type} overlap`);
        }
      }
      // the explanations ("?" icons) arrive in the editor
      const notes = drawn.map((block) => block.getCommentText() ?? '').filter((text) => text !== '');
      assert.ok(notes.length >= 1, `${s.id}: has at least one note`);
      for (const text of notes) assert.ok(text.length <= 220, `${s.id}: a note is short ("${text}")`);

      const saved = Blockly.serialization.workspaces.save(workspace) as ProgramJson;

      // the full mission on its own combination; the others on one where the smart program has to
      // read a colour and step over to the other square
      const scenario = s === FULL_MISSION_SAMPLE ? defaultScenario() : scenarioFor('yellow', 2);
      const opts = { game: fireRescueGame, scenario, robotConfig: DEFAULT_ROBOT_CONFIG };
      const fromBuilder = runMatch({ ...opts, program: s.program });
      const fromEditor = runMatch({ ...opts, program: saved });
      assert.deepEqual(fromEditor, fromBuilder, s.id);
      assert.equal(fromEditor.errors, undefined, s.id);
      if (s.id === 'smart-bucket') assert.equal(fromEditor.total, 20);
      if (s === FULL_MISSION_SAMPLE) assert.equal(fromEditor.total, 180);
    }
    workspace.dispose();
  });
});

// =============================================================================================
// On the real mat picture
// =============================================================================================

/**
 * In the browser the floor sensors look at the real picture of the mat (mat-sensor.webp), not at
 * the simple drawing the other tests use. The picture is decoded here with "sharp", which comes
 * along with Next.js; without it these tests are skipped.
 */
async function loadMatPicture(): Promise<MatSampler | null> {
  interface Decoded {
    data: Uint8Array;
    info: { width: number; height: number };
  }
  type Sharp = (file: string) => {
    ensureAlpha(): { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<Decoded> } };
  };
  try {
    const sharp = createRequire(import.meta.url)('sharp') as Sharp;
    const file = fileURLToPath(new URL(`../../../public${fireRescueGame.mat.sensorImageUrl}`, import.meta.url));
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return new RasterMatSampler({ data, width: info.width, height: info.height }, MAT_SIZE, MAT_SIZE, MAT_VECTOR.outside);
  } catch {
    return null;
  }
}

describe('on the real mat picture', () => {
  const picture = loadMatPicture();

  test('the picture has dark spots inside the Fire Station that the Quad RGB sensor takes for a line', async (t) => {
    const mat = await picture;
    if (!mat) return t.skip('the mat picture could not be decoded (sharp is not installed)');
    const threshold = DEFAULT_ROBOT_CONFIG.quadRgb.lineThreshold;
    const reading = (x: number, y: number) => makeProbeReading(mat.sample(x, y), threshold);
    // the centre line is as black in the picture as in the drawing
    assert.ok(reading(625, 300).onLine && reading(625, 300).light < 10);
    assert.ok(!reading(580, 300).onLine, 'white mat next to the line');
    assert.ok(!reading(625, 395).onLine, 'the yellow marker is not a line');
    // ... but the Fire Station is a picture, not a flat colour: a good part of it reads as "line".
    // That is why the line follower sample first drives out of the station without looking down.
    let dark = 0;
    let points = 0;
    for (let y = FIRE_STATION.y + 5; y < FIRE_STATION.y + FIRE_STATION.h - 5; y += 5) {
      for (let x = FIRE_STATION.x + 5; x < FIRE_STATION.x + FIRE_STATION.w - 5; x += 5) {
        points++;
        if (reading(x, y).onLine) dark++;
      }
    }
    assert.ok(dark / points > 0.05, `${((100 * dark) / points).toFixed(0)} % of the Fire Station reads as line`);
  });

  test('every sample plays the same match on the picture as on the drawing', async (t) => {
    const mat = await picture;
    if (!mat) return t.skip('the mat picture could not be decoded (sharp is not installed)');
    for (const s of [...SAMPLE_PROGRAMS, FULL_MISSION_SAMPLE]) {
      const onDrawing = simulate(s.program);
      const onPicture = simulate(s.program, defaultScenario(), { sampler: mat });
      runToEnd(onDrawing);
      const events = runToEnd(onPicture);
      assert.deepEqual(problems(events), [], s.id);
      assert.equal(onPicture.finishReason, 'program-ended', s.id);
      assert.deepEqual(onPicture.score(), onDrawing.score(), s.id);
      assert.deepEqual(movedBodies(onPicture), movedBodies(onDrawing), s.id);
      const a = onPicture.world.robot.pose;
      const b = onDrawing.world.robot.pose;
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 2, `${s.id}: the robot ends in the same place`);
    }
  });

  test('line-follow follows the printed line from crooked starts and with an imperfect robot', async (t) => {
    const mat = await picture;
    if (!mat) return t.skip('the mat picture could not be decoded (sharp is not installed)');
    const real: RobotConfig = { ...DEFAULT_ROBOT_CONFIG, noise: { wheelSlip: 0.03, sensor: 8, ultrasonicCm: 0.3 } };
    const starts: Array<Pose | undefined> = [
      undefined,
      { x: 612, y: 673.2, heading: 4 * DEG },
      { x: 605, y: 673.2, heading: 6 * DEG },
      { x: 645, y: 673.2, heading: -6 * DEG },
    ];
    for (const robotConfig of [DEFAULT_ROBOT_CONFIG, real]) {
      for (const [i, startPose] of starts.entries()) {
        const name = `${robotConfig === real ? 'imperfect' : 'perfect'} robot, start ${i}`;
        const sim = simulate(sample('line-follow').program, defaultScenario(), { sampler: mat, startPose, robotConfig, seed: 5 + i });
        runToEnd(sim);
        const pose = sim.world.robot.pose;
        assert.equal(sim.finishReason, 'program-ended', name);
        assert.ok(Math.abs(pose.x - 625) < 10, `${name}: ends on the line (x = ${pose.x.toFixed(1)})`);
        assert.ok(pose.y > 380 && pose.y < 440, `${name}: stops in front of the towers (y = ${pose.y.toFixed(1)})`);
        assert.deepEqual(movedBodies(sim), [], name);
      }
    }
  });
});
