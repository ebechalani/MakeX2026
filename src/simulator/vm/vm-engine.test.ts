/**
 * The blocks on the REAL robot engine: does a block do on the mat what a student who knows
 * mBlock 5 and the mBot2 expects?
 *
 * vm.test.ts checks the interpreter against a pretend robot (which commands are sent). These tests
 * go one step further: block program -> interpreter -> physics engine, on an empty practice mat,
 * and then look at where the robot really ended up. They pin down the things that are easy to get
 * backwards: centimetres, degrees, RPM and seconds; left and right; the mirrored right motor
 * (EM2); which blocks wait "until done" and which carry on at once; the order of the four line
 * sensor probes.
 *
 * The practice mat: 3 x 3 m, white, with one black line (26 mm wide, like on the MakeX mats)
 * running up the middle at x = 1500 and one across at y = 1000 on the left half. The robot starts
 * at (1500, 1500) facing "up" the mat (towards smaller y), so on a picture of the mat:
 *   forward = up (y gets smaller), the robot's right-hand side = +x, turning right = clockwise.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEG, wrapAngle } from '../core/geometry';
import { DEFAULT_ROBOT_CONFIG } from '../core/robot';
import { createSimulation } from '../core/simulation';
import type { Body, Game, MatVector, Pose, ProgramJson, Scalar, Simulation } from '../core/types';
import * as B from './builder';

// =============================================================================================
// The practice mat
// =============================================================================================

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 10, g: 10, b: 10 };
const SIZE = 3000;
const START: Pose = { x: 1500, y: 1500, heading: 0 };

const MAT: MatVector = {
  width: SIZE,
  height: SIZE,
  background: WHITE,
  outside: { r: 120, g: 90, b: 60 },
  layers: [
    { kind: 'stroke', points: [{ x: 1500, y: 0 }, { x: 1500, y: SIZE }], width: 26, color: BLACK },
    { kind: 'stroke', points: [{ x: 0, y: 1000 }, { x: 1200, y: 1000 }], width: 26, color: BLACK },
  ],
};

/** A 70 x 70 x 50 mm box (the size of a MakeX tower) centred on (x, y). */
function box(x: number, y: number): Body {
  return {
    id: 'box',
    kind: 'box',
    label: 'box',
    fill: '#888888',
    x,
    y,
    angle: 0,
    w: 70,
    l: 70,
    h: 50,
    z: 0,
    restingOn: null,
    held: false,
    grippable: false,
    platform: false,
    mass: 3,
    home: { x, y, angle: 0, z: 0, restingOn: null },
  };
}

function practiceGame(bodies: Body[]): Game<null> {
  return {
    id: 'practice',
    title: 'Practice mat',
    mat: { width: SIZE, height: SIZE, imageUrl: '', sensorImageUrl: '', vector: MAT },
    matchDuration: 60,
    startZone: { x: 0, y: 0, w: SIZE, h: SIZE },
    defaultStartPose: START,
    restartPenalty: 0,
    defaultScenario: () => null,
    randomScenario: () => null,
    scenarioCount: () => 1,
    encodeScenario: () => '',
    decodeScenario: () => null,
    describeScenario: () => '',
    createBodies: () => bodies.map((b) => ({ ...b, home: { ...b.home } })),
    overlays: () => [],
    score: () => ({ total: 0, max: 0, lines: [], complete: false }),
  };
}

type Sim = Simulation<null>;

interface Setup {
  startPose?: Pose;
  bodies?: Body[];
}

/** Put the robot on the practice mat with this program; the match has not started yet. */
function place(program: ProgramJson, setup: Setup = {}): Sim {
  return createSimulation({
    game: practiceGame(setup.bodies ?? []),
    scenario: null,
    robotConfig: DEFAULT_ROBOT_CONFIG,
    program,
    startPose: setup.startPose ?? START,
  });
}

/** Run a program until it ends by itself (the test fails if it does not within `maxSeconds`). */
function play(body: B.BlockNode[], setup: Setup = {}, extra: Array<B.ScriptNode | B.DefinitionNode> = [], maxSeconds = 30): Sim {
  const sim = place(B.program([B.script(B.whenStart(), body), ...extra]), setup);
  sim.start();
  sim.step(Math.round(maxSeconds / sim.dt));
  assert.deepEqual(sim.vm.errors(), [], 'the program has no errors');
  assert.equal(sim.finishReason, 'program-ended', `the program ended by itself within ${maxSeconds} s`);
  return sim;
}

/** Start a program and let `seconds` of match time pass. */
function playFor(seconds: number, body: B.BlockNode[], setup: Setup = {}, extra: Array<B.ScriptNode | B.DefinitionNode> = []): Sim {
  const sim = place(B.program([B.script(B.whenStart(), body), ...extra]), setup);
  sim.start();
  sim.step(Math.round(seconds / sim.dt));
  return sim;
}

const near = (actual: number, expected: number, eps: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual.toFixed(3)} is not within ${eps} of ${expected}`);

/** Heading in degrees, -180..180, clockwise positive (0 = facing up the mat). */
const headingDeg = (sim: Sim): number => wrapAngle(sim.world.robot.pose.heading) / DEG;

/** Where the robot is, relative to its start: right = +x on the picture, up = towards the top of the mat. */
const moved = (sim: Sim, from: Pose = START): { right: number; up: number } => ({
  right: sim.world.robot.pose.x - from.x,
  up: from.y - sim.world.robot.pose.y,
});

const variable = (sim: Sim, name: string): Scalar => {
  const value = sim.vm.variables()[name];
  assert.ok(value !== undefined && !Array.isArray(value), `variable "${name}" exists`);
  return value;
};

/** mm the robot rolls in one second when both wheels turn at `rpm`. */
const mmPerSecond = (rpm: number): number => (rpm / 60) * Math.PI * DEFAULT_ROBOT_CONFIG.wheelDiameter;

// =============================================================================================
// Distances, angles, directions
// =============================================================================================

describe('blocks on the real robot: units and directions', () => {
  it('"moves forward 10 cm until done" drives 100 mm ahead, "backward" 100 mm back', () => {
    const forward = play([B.moveCm('forward', 10)]);
    near(moved(forward).up, 100, 0.2, 'forward: mm up the mat');
    near(moved(forward).right, 0, 0.01, 'forward: no sideways drift');
    near(headingDeg(forward), 0, 0.01, 'forward: heading');

    const backward = play([B.moveCm('backward', 10)]);
    near(moved(backward).up, -100, 0.2, 'backward: mm up the mat');

    // a negative distance drives the other way, as on the real robot
    near(moved(play([B.moveCm('forward', -10)])).up, -100, 0.2, 'forward -10 cm');
    near(moved(play([B.moveCm('forward', 0)])).up, 0, 1e-9, 'forward 0 cm');
  });

  it('"turns right 90 degrees" turns clockwise seen from above, "turns left" anticlockwise, on the spot', () => {
    const right = play([B.turn('right', 90)]);
    near(headingDeg(right), 90, 0.1, 'right: heading');
    near(Math.hypot(moved(right).right, moved(right).up), 0, 0.01, 'right: turns on the spot');

    const left = play([B.turn('left', 90)]);
    near(headingDeg(left), -90, 0.1, 'left: heading');

    // facing up, a right turn points the robot to the right-hand side of the picture
    const thenForward = play([B.turn('right', 90), B.moveCm('forward', 10)]);
    near(moved(thenForward).right, 100, 0.3, 'after a right turn, forward goes right');
    near(moved(thenForward).up, 0, 0.3, 'after a right turn, forward does not go up');

    near(headingDeg(play([B.turn('left', 45), B.turn('left', 45), B.turn('right', 180)])), 90, 0.2, 'turns add up');
  });

  it('a square driven with a my-block and "repeat 4" ends where it started', () => {
    const sim = place(
      B.program([
        B.define('side', ['length'], [B.moveCm('forward', B.v('length')), B.turn('right', 90)]),
        B.script(B.whenStart(), [B.repeat(4, [B.call('side', 20)])]),
      ]),
    );
    sim.start();
    let farRight = 0;
    let farUp = 0;
    let farLeft = 0;
    let farDown = 0;
    while (sim.status === 'running') {
      sim.step(5);
      const at = moved(sim);
      farRight = Math.max(farRight, at.right);
      farLeft = Math.min(farLeft, at.right);
      farUp = Math.max(farUp, at.up);
      farDown = Math.min(farDown, at.up);
    }
    assert.equal(sim.finishReason, 'program-ended');
    near(moved(sim).right, 0, 0.6, 'back at the start (x)');
    near(moved(sim).up, 0, 0.6, 'back at the start (y)');
    // right turns: the square lies up and to the RIGHT of the start
    near(farUp, 200, 0.6, 'square reaches 20 cm up');
    near(farRight, 200, 0.6, 'square reaches 20 cm to the right');
    near(farLeft, 0, 0.6, 'never left of the start');
    near(farDown, 0, 0.6, 'never below the start');
  });

  it('"moves forward at 60 RPM for 1 secs" drives about one second at that wheel speed, then stops', () => {
    const sim = play([B.moveFor('forward', 60, 1)]);
    // 60 RPM with 64 mm wheels = 201 mm/s; a little less because the wheels need time to speed up
    const expected = mmPerSecond(60);
    assert.ok(moved(sim).up > expected * 0.93 && moved(sim).up <= expected * 1.01, `drove ${moved(sim).up.toFixed(1)} mm, expected about ${expected.toFixed(0)}`);
    assert.ok(sim.world.time >= 1 && sim.world.time < 1.2, `took ${sim.world.time.toFixed(2)} s`);
    assert.equal(sim.world.robot.left.rpm, 0);
    assert.equal(sim.world.robot.right.rpm, 0);

    near(moved(play([B.moveFor('backward', 60, 1)])).up, -moved(sim).up, 0.01, 'backward is the mirror image');
    const right = play([B.moveFor('right', 30, 1)]);
    assert.ok(headingDeg(right) > 90 && headingDeg(right) < 106, `turns right (clockwise): ${headingDeg(right).toFixed(1)} degrees`);
    near(headingDeg(play([B.moveFor('left', 30, 1)])), -headingDeg(right), 0.01, 'left is the mirror image');
  });

  it('twice the RPM is twice the distance; the motors top out at their maximum speed', () => {
    const slow = moved(play([B.move('forward', 40), B.wait(2), B.stopMotors('all')])).up;
    const fast = moved(play([B.move('forward', 80), B.wait(2), B.stopMotors('all')])).up;
    near(fast / slow, 2, 0.05, 'distance ratio');
    const tooFast = play([B.move('forward', 1000), B.wait(1), B.setVar('rpm', B.motorSpeed('EM1')), B.stopMotors('all')]);
    assert.equal(variable(tooFast, 'rpm'), DEFAULT_ROBOT_CONFIG.maxRpm);
  });
});

// =============================================================================================
// "until done" or not
// =============================================================================================

describe('blocks on the real robot: waiting and not waiting', () => {
  it('"... until done" blocks hold the script, "moves forward at RPM" carries on at once', () => {
    // the timer is read right after each block
    const sim = play([
      B.moveCm('forward', 10),
      B.setVar('after cm', B.timer()),
      B.resetTimer(),
      B.turn('left', 90),
      B.setVar('after turn', B.timer()),
      B.resetTimer(),
      B.move('forward', 50),
      B.setVar('after start', B.timer()),
      B.stopMotors('all'),
    ]);
    assert.ok(Number(variable(sim, 'after cm')) > 0.5, 'the 10 cm move took its time');
    assert.ok(Number(variable(sim, 'after turn')) > 0.4, 'the turn took its time');
    assert.equal(variable(sim, 'after start'), 0, '"moves forward at RPM" does not wait');
  });

  it('a robot left driving keeps driving while the script waits, until a stop block', () => {
    const sim = play([B.move('forward', 60), B.wait(1), B.setVar('rpm', B.motorSpeed('EM1')), B.stopMotors('all')]);
    assert.equal(variable(sim, 'rpm'), 60);
    near(moved(sim).up, mmPerSecond(60), 12, 'about one second of driving');
  });

  it('a script that ends with the motors running leaves them running (the match goes on)', () => {
    const sim = playFor(3, [B.move('forward', 20)]);
    assert.equal(sim.status, 'running');
    assert.equal(sim.vm.running, false, 'the script is over');
    assert.ok(moved(sim).up > mmPerSecond(20) * 2.8, 'the robot is still driving');
  });

  it('"wait 1 seconds" takes one second of match time; "forever" makes one pass per tick', () => {
    const waited = play([B.wait(1), B.setVar('t', B.timer())]);
    near(Number(variable(waited, 't')), 1, 0.011, 'timer after wait 1');

    const looping = playFor(1, [B.forever([B.changeVar('passes', 1)])]);
    near(Number(variable(looping, 'passes')), 1 / looping.dt, 1, 'passes in one second');
  });

  it('"wait until" a sensor: the robot stops when its line sensor reaches the black line', () => {
    // 700 mm left of the middle line; the line across the mat is at y = 1000
    const start: Pose = { x: 800, y: 1500, heading: 0 };
    const sim = play([B.move('forward', 30), B.waitUntil(B.probeDetects('L1', 'line')), B.stopMotors('all')], { startPose: start });
    // the sensor sits 85 mm ahead of the axle and the line's lower edge is at y = 1013
    const sensorY = sim.world.robot.pose.y - DEFAULT_ROBOT_CONFIG.quadRgb.forward;
    assert.ok(sensorY < 1013 + 1 && sensorY > 1013 - 12, `the sensor stopped on the edge of the line (y = ${sensorY.toFixed(1)})`);
  });

  it('gripper blocks wait until the claw / arm has finished; "set servo" does not', () => {
    const g = DEFAULT_ROBOT_CONFIG.gripper;
    const sim = play([
      B.gripper('close'),
      B.setVar('close time', B.timer()),
      B.setVar('claw', B.servoAngle('S2')),
      B.resetTimer(),
      B.arm('raise'),
      B.setVar('raise time', B.timer()),
      B.setVar('lift', B.servoAngle('S1')),
      B.resetTimer(),
      B.setServo('S1', 0),
      B.setVar('set time', B.timer()),
      B.wait(0.25),
      B.setVar('half way', B.servoAngle('S1')),
      B.armHeight(50),
      B.setVar('half height', B.servoAngle('S1')),
    ]);
    assert.equal(variable(sim, 'claw'), g.clawClosedAngle);
    assert.equal(variable(sim, 'lift'), g.liftUpAngle);
    // the servos turn 180 degrees per second
    near(Number(variable(sim, 'close time')), Math.abs(g.clawClosedAngle - g.clawOpenAngle) / DEFAULT_ROBOT_CONFIG.servoSpeed, 0.03, 'time to close');
    near(Number(variable(sim, 'raise time')), Math.abs(g.liftUpAngle - g.liftDownAngle) / DEFAULT_ROBOT_CONFIG.servoSpeed, 0.03, 'time to raise');
    assert.equal(variable(sim, 'set time'), 0, '"set servo" carries on at once');
    near(Number(variable(sim, 'half way')), 90 - 0.25 * DEFAULT_ROBOT_CONFIG.servoSpeed, 2, 'the servo is on its way');
    near(Number(variable(sim, 'half height')), (g.liftDownAngle + g.liftUpAngle) / 2, 0.01, 'arm at 50 %');
    near(sim.world.robot.gripper.height, (g.liftDownHeight + g.liftUpHeight) / 2, 0.01, 'claw height at 50 %');
  });
});

// =============================================================================================
// The raw motor blocks: EM1 = left wheel, EM2 = right wheel, mounted mirrored
// =============================================================================================

describe('blocks on the real robot: encoder motors EM1 / EM2', () => {
  it('EM1 50 and EM2 -50 drives straight ahead; 50 and 50 spins to the right on the spot', () => {
    const straight = play([B.driveRpm(50, -50), B.wait(1), B.stopMotors('all')]);
    near(headingDeg(straight), 0, 0.01, 'straight: heading');
    near(moved(straight).up, mmPerSecond(50), 10, 'straight: distance');

    const spin = play([B.driveRpm(50, 50), B.wait(1), B.stopMotors('all')]);
    near(Math.hypot(moved(spin).right, moved(spin).up), 0, 0.01, 'spin: stays on the spot');
    assert.ok(headingDeg(spin) > 150 && headingDeg(spin) < 180, `spin: clockwise (${headingDeg(spin).toFixed(1)} degrees)`);

    const back = play([B.driveRpm(-50, 50), B.wait(1), B.stopMotors('all')]);
    near(moved(back).up, -moved(straight).up, 0.01, 'both reversed: straight back');
  });

  it('power blocks: 50 % is half of the top speed', () => {
    const sim = play([B.drivePower(50, -50), B.wait(1), B.setVar('rpm', B.motorSpeed('EM1')), B.setVar('power', B.motorPowerValue('EM1')), B.stopMotors('all')]);
    assert.equal(variable(sim, 'rpm'), DEFAULT_ROBOT_CONFIG.maxRpm / 2);
    assert.equal(variable(sim, 'power'), 50);
    near(headingDeg(sim), 0, 0.01, 'heading');
    assert.ok(moved(sim).up > mmPerSecond(90) * 0.85, 'drove about one second at 90 RPM');
  });

  it('one motor alone: EM1 forward swings the robot to the right, EM2 with a positive speed runs backward', () => {
    const em1 = play([B.motorRpm('EM1', 50), B.wait(1), B.stopMotors('all')]);
    assert.ok(headingDeg(em1) > 60, `EM1 +50: the left wheel pushes forward, the robot turns right (${headingDeg(em1).toFixed(1)})`);
    assert.ok(moved(em1).up > 0, 'EM1 +50: and moves forward');
    assert.equal(em1.world.robot.right.angleDeg, 0, 'EM1 +50: the right wheel did not turn');

    const em2 = play([B.motorRpm('EM2', 50), B.wait(1), B.stopMotors('all')]);
    assert.ok(em2.world.robot.right.angleDeg < -250, 'EM2 +50: the right wheel turned backward');
    assert.ok(headingDeg(em2) > 60, `EM2 +50: the robot turns right (${headingDeg(em2).toFixed(1)})`);
    assert.ok(moved(em2).up < 0, 'EM2 +50: and moves backward');

    const em2Forward = play([B.motorRpm('EM2', -50), B.wait(1), B.stopMotors('all')]);
    assert.ok(headingDeg(em2Forward) < -60, 'EM2 -50: the right wheel pushes forward, the robot turns left');
  });

  it('"stop encoder motor EM1" stops only that wheel', () => {
    const sim = playFor(2, [B.driveRpm(50, -50), B.wait(0.5), B.stopMotors('EM1')]);
    assert.equal(sim.world.robot.left.rpm, 0);
    assert.equal(sim.world.robot.right.rpm, 50);
  });

  it('the rotated-angle, speed and power reporters are mirrored for EM2', () => {
    const sim = play([
      B.moveCm('forward', 10),
      B.setVar('em1', B.motorAngle('EM1')),
      B.setVar('em2', B.motorAngle('EM2')),
      B.resetMotorAngle('EM1'),
      B.setVar('em1 reset', B.motorAngle('EM1')),
      B.setVar('em2 kept', B.motorAngle('EM2')),
      B.move('forward', 60),
      B.wait(0.5),
      B.setVar('speed1', B.motorSpeed('EM1')),
      B.setVar('speed2', B.motorSpeed('EM2')),
      B.stopMotors('all'),
    ]);
    // 100 mm with 64 mm wheels = 179 degrees of wheel rotation
    near(Number(variable(sim, 'em1')), (100 / (Math.PI * 64)) * 360, 0.1, 'EM1 angle');
    near(Number(variable(sim, 'em2')), -(100 / (Math.PI * 64)) * 360, 0.1, 'EM2 angle (counts down when driving forward)');
    assert.equal(variable(sim, 'em1 reset'), 0);
    assert.equal(variable(sim, 'em2 kept'), variable(sim, 'em2'));
    assert.equal(variable(sim, 'speed1'), 60);
    assert.equal(variable(sim, 'speed2'), -60);
  });

  it('"encoder motor ... rotates 360 degrees until done": one full turn of the wheel(s)', () => {
    const all = play([B.motorRotate('all', 360, 50)]);
    assert.equal(Math.round(all.world.robot.left.angleDeg), 360);
    assert.equal(Math.round(all.world.robot.right.angleDeg), -360);
    // both motors the same way round = the robot spins: 360 * wheel diameter / track width degrees
    const spin = (360 * DEFAULT_ROBOT_CONFIG.wheelDiameter) / DEFAULT_ROBOT_CONFIG.trackWidth;
    near(all.world.robot.yawDeg, spin, 0.2, 'spin angle');

    const em1 = play([B.motorRotate('EM1', 360, 50)]);
    assert.equal(Math.round(em1.world.robot.left.angleDeg), 360);
    assert.equal(em1.world.robot.right.angleDeg, 0);
    near(em1.world.robot.yawDeg, spin / 2, 0.2, 'one wheel: half the angle');

    // a negative speed turns the motor the other way
    assert.equal(Math.round(play([B.motorRotate('EM1', 360, -50)]).world.robot.left.angleDeg), -360);
    // one wheel turn rolls the robot one wheel circumference: 20.1 cm
    const rolled = play([B.motorRotate('EM1', 360, 50), B.motorRotate('EM2', -360, 50)]);
    assert.equal(Math.round(rolled.world.robot.right.angleDeg), 360);
  });
});

// =============================================================================================
// Sensors
// =============================================================================================

describe('blocks on the real robot: sensors', () => {
  /** Read everything the Quad RGB blocks report, with the robot shifted sideways by `shift` mm. */
  function readLine(shift: number): Sim {
    return play(
      [
        B.setVar('status', B.lineStatus('all')),
        B.setVar('inner', B.lineStatus('inner')),
        B.setVar('deviation', B.lineDeviation()),
        B.setVar('L2', B.probeDetects('L2', 'line')),
        B.setVar('L1', B.probeDetects('L1', 'line')),
        B.setVar('R1', B.probeDetects('R1', 'line')),
        B.setVar('R2', B.probeDetects('R2', 'line')),
        B.setVar('is 6', B.lineStatusIs(6)),
        B.setVar('is 12', B.lineStatusIs(12)),
        B.setVar('L1 colour', B.probeColor('L1')),
        B.setVar('R2 background', B.probeDetects('R2', 'background')),
        B.setVar('L1 gray', B.probeGray('L1')),
        B.setVar('R2 light', B.probeLight('R2')),
      ],
      { startPose: { x: 1500 + shift, y: 1500, heading: 0 } },
    );
  }

  it('line status: L2 = 8, L1 = 4, R1 = 2, R2 = 1 - the probes are named from the robot\'s left to its right', () => {
    // centred on the 26 mm line: the two middle probes (7.5 mm either side) see it
    const centred = readLine(0);
    assert.equal(variable(centred, 'status'), 6);
    assert.equal(variable(centred, 'inner'), 3);
    assert.equal(variable(centred, 'deviation'), 0);
    assert.deepEqual(['L2', 'L1', 'R1', 'R2'].map((p) => variable(centred, p)), [false, true, true, false]);
    assert.equal(variable(centred, 'is 6'), true);
    assert.equal(variable(centred, 'L1 colour'), 'black');
    assert.equal(variable(centred, 'R2 background'), true);
    assert.ok(Number(variable(centred, 'L1 gray')) > 90, 'black reads as a high grey value');
    assert.ok(Number(variable(centred, 'R2 light')) > 90, 'white reflects a lot of light');

    // robot 15 mm too far to the RIGHT: the line is under its two LEFT probes
    const lineOnLeft = readLine(15);
    assert.equal(variable(lineOnLeft, 'status'), 12, 'L2 + L1 = 8 + 4');
    assert.equal(variable(lineOnLeft, 'inner'), 2, 'inner pair: only L1');
    assert.deepEqual(['L2', 'L1', 'R1', 'R2'].map((p) => variable(lineOnLeft, p)), [true, true, false, false]);
    assert.equal(variable(lineOnLeft, 'is 12'), true);
    // the deviation says where the ROBOT is, seen from the line - as on the real mBot2
    assert.ok(Number(variable(lineOnLeft, 'deviation')) > 50, 'robot to the right of the line = positive deviation');

    // robot 15 mm too far to the LEFT: the line is under its two RIGHT probes
    const lineOnRight = readLine(-15);
    assert.equal(variable(lineOnRight, 'status'), 3, 'R1 + R2 = 2 + 1');
    assert.equal(variable(lineOnRight, 'inner'), 1, 'inner pair: only R1');
    assert.deepEqual(['L2', 'L1', 'R1', 'R2'].map((p) => variable(lineOnRight, p)), [false, false, true, true]);
    assert.ok(Number(variable(lineOnRight, 'deviation')) < -50, 'robot to the left of the line = negative deviation');

    // far off the line: nothing
    assert.equal(variable(readLine(200), 'status'), 0);
  });

  it("line deviation: Makeblock's proportional line follower steers towards the line, as on the real robot", () => {
    // The line follower from Makeblock's mBot2 examples, block for block:
    //   forever
    //     set left_power  to  base_power - kp * (quad rgb sensor deviation)
    //     set right_power to  -1 * (base_power + kp * (quad rgb sensor deviation))
    //     encoder motor EM1 rotates at power left_power %, EM2 rotates at power right_power %
    // EM2 (the right wheel) is mounted mirrored, so its negative power drives it forward.
    // On the real robot the deviation is NEGATIVE when the robot is to the LEFT of the line: then
    // EM1 gets more power, the right wheel less, and the robot turns right, back to the line.
    const officialFollower: B.BlockNode[] = [
      B.setVar('base_power', 30),
      B.setVar('kp', 0.4),
      B.forever([
        B.setVar('left_power', B.sub(B.v('base_power'), B.mul(B.v('kp'), B.lineDeviation()))),
        B.setVar('right_power', B.mul(-1, B.add(B.v('base_power'), B.mul(B.v('kp'), B.lineDeviation())))),
        B.drivePower(B.v('left_power'), B.v('right_power')),
      ]),
    ];
    // the black line of the practice mat runs up the middle, at x = 1500
    const offLine = (sim: Sim): number => sim.world.robot.pose.x - 1500;

    for (const shift of [-15, 15]) {
      const side = shift < 0 ? 'left' : 'right';
      const setup: Setup = { startPose: { x: 1500 + shift, y: 1500, heading: 0 } };

      // 0.4 s: the robot has turned towards the line (left of the line = turn right = clockwise)
      const early = playFor(0.4, officialFollower, setup);
      assert.deepEqual(early.vm.errors(), []);
      assert.equal(
        Math.sign(headingDeg(early)),
        -Math.sign(shift),
        `robot ${side} of the line: it turns towards the line (heading ${headingDeg(early).toFixed(1)} deg)`,
      );
      assert.ok(Math.abs(offLine(early)) < Math.abs(shift), `robot ${side} of the line: it is already closer to it`);

      // 4 s: it has driven well over half a metre and is still following the line
      const late = playFor(4, officialFollower, setup);
      assert.ok(moved(late).up > 500, `robot ${side} of the line: drove on along the line (${moved(late).up.toFixed(0)} mm)`);
      near(offLine(late), 0, 6, `robot ${side} of the line: mm off the line after 4 s`);
      near(headingDeg(late), 0, 10, `robot ${side} of the line: heading after 4 s`);
    }

    // The same program with the sign of the correction turned round (what a student would have
    // to write if the deviation had the opposite sign) runs away from the line.
    const wrongWay: B.BlockNode[] = [
      B.forever([
        B.drivePower(B.add(30, B.mul(0.4, B.lineDeviation())), B.mul(-1, B.sub(30, B.mul(0.4, B.lineDeviation())))),
      ]),
    ];
    const lost = playFor(4, wrongWay, { startPose: { x: 1485, y: 1500, heading: 0 } });
    assert.ok(Math.abs(offLine(lost)) > 60, `the reversed formula leaves the line (${offLine(lost).toFixed(0)} mm off)`);
  });

  it('ultrasonic sensor: centimetres from the front of the robot to the object', () => {
    // the sensor face is 105 mm ahead of the axle; the near face of the box is 200 mm further
    const boxY = START.y - DEFAULT_ROBOT_CONFIG.ultrasonic.forward - 200 - 35;
    const sim = play([B.setVar('cm', B.ultrasonic()), B.moveCm('forward', 5), B.setVar('closer', B.ultrasonic())], { bodies: [box(START.x, boxY)] });
    near(Number(variable(sim, 'cm')), 20, 0.2, 'distance');
    near(Number(variable(sim, 'closer')), 15, 0.2, 'distance after driving 5 cm towards it');

    const nothing = play([B.setVar('cm', B.ultrasonic())]);
    assert.equal(variable(nothing, 'cm'), DEFAULT_ROBOT_CONFIG.ultrasonic.maxRangeCm, 'nothing in sight: the maximum range');
  });

  it('gyro: turning right counts up, turning left counts down; "yaw" stays within -180..180', () => {
    const sim = play([
      B.turn('right', 90),
      B.setVar('z right', B.rotationZ()),
      B.turn('right', 180),
      B.setVar('z more', B.rotationZ()),
      B.setVar('yaw', B.yaw()),
      B.resetYaw(),
      B.setVar('z reset', B.rotationZ()),
      B.turn('left', 45),
      B.setVar('z left', B.rotationZ()),
    ]);
    near(Number(variable(sim, 'z right')), 90, 0.2, 'after 90 right');
    near(Number(variable(sim, 'z more')), 270, 0.3, 'keeps counting past 180');
    near(Number(variable(sim, 'yaw')), -90, 0.3, 'yaw folds 270 into -90');
    assert.equal(variable(sim, 'z reset'), 0);
    near(Number(variable(sim, 'z left')), -45, 0.2, 'left counts down');
  });
});

// =============================================================================================
// Scripts, events, stopping
// =============================================================================================

describe('blocks on the real robot: scripts and events', () => {
  it('"when button A pressed" runs on a press of the CyberPi button, every time it is pressed', () => {
    const sim = place(B.program([B.script(B.whenButton('a'), [B.changeVar('presses', 1), B.moveCm('forward', 5)])]));
    sim.start();
    sim.step(50);
    assert.equal(variable(sim, 'presses'), 0, 'nothing happens before the press');
    assert.equal(sim.status, 'running', 'a program that waits for a button does not end by itself');
    for (let press = 0; press < 2; press++) {
      sim.setButton('a', true);
      sim.step(10);
      sim.setButton('a', false);
      sim.step(200);
    }
    assert.equal(variable(sim, 'presses'), 2);
    near(moved(sim).up, 100, 0.3, 'two presses, twice 5 cm');
  });

  it('"button A pressed?" and the joystick can be read while a script runs', () => {
    const sim = place(
      B.program([
        B.script(B.whenStart(), [B.waitUntil(B.buttonPressed('b')), B.setVar('b', 1), B.waitUntil(B.joystickPulled('up')), B.setVar('up', 1)]),
      ]),
    );
    sim.start();
    sim.step(20);
    assert.equal(variable(sim, 'b'), 0);
    sim.setButton('b', true);
    sim.step(5);
    sim.setButton('b', false);
    assert.equal(variable(sim, 'b'), 1);
    assert.equal(variable(sim, 'up'), 0);
    sim.setButton('up', true);
    sim.step(5);
    assert.equal(variable(sim, 'up'), 1);
    assert.equal(sim.finishReason, 'program-ended');
  });

  it('broadcast: two scripts work together, "broadcast and wait" waits for the receiver', () => {
    const sim = play(
      [
        B.broadcastAndWait('lift'),
        B.setVar('arm when back', B.servoAngle('S1')),
        B.broadcast('drive'),
        B.setVar('moved when back', B.motorAngle('EM1')),
      ],
      {},
      [B.script(B.whenReceive('lift'), [B.arm('raise')]), B.script(B.whenReceive('drive'), [B.moveCm('forward', 10)])],
    );
    assert.equal(variable(sim, 'arm when back'), DEFAULT_ROBOT_CONFIG.gripper.liftUpAngle, '"and wait": the arm was up when the script went on');
    assert.equal(variable(sim, 'moved when back'), 0, 'plain broadcast: the script went on before the robot moved');
    near(moved(sim).up, 100, 0.2, 'the receiver still drove its 10 cm');
  });

  it('"stop all" stops the motors and ends the program; "stop this script" leaves the motors alone', () => {
    const all = play([B.move('forward', 40), B.wait(1), B.stop('all'), B.setVar('after', 1)]);
    assert.equal(variable(all, 'after'), 0, 'nothing runs after "stop all"');
    assert.equal(all.world.robot.left.rpm, 0);
    assert.ok(all.world.time < 1.2, 'the match ended right away');

    const thisScript = playFor(3, [B.move('forward', 40), B.wait(1), B.stop('this script'), B.setVar('after', 1)]);
    assert.equal(variable(thisScript, 'after'), 0);
    assert.equal(thisScript.world.robot.left.rpm, 40, 'the motors keep running');
    assert.equal(thisScript.status, 'running');
  });

  it('"stop other scripts" ends a forever loop in another script', () => {
    const sim = play([B.wait(1), B.stop('other scripts'), B.stopMotors('all'), B.setVar('n at stop', B.v('n')), B.wait(0.5)], {}, [
      B.script(B.whenStart(), [B.forever([B.changeVar('n', 1), B.driveRpm(20, 20)])]),
    ]);
    assert.ok(Number(variable(sim, 'n at stop')) > 90, 'the other script was running');
    assert.equal(variable(sim, 'n'), variable(sim, 'n at stop'), 'and stopped counting');
    assert.equal(sim.world.robot.left.rpm, 0);
  });
});

// =============================================================================================
// Words and numbers (what a student types into the white bubbles)
// =============================================================================================

describe('blocks on the real robot: words in variables and comparisons', () => {
  it('a variable can hold a word, and "=" compares words (the idea of the smart bucket sample)', () => {
    const sim = play([
      B.setVar('side', 'left'),
      B.ifElse(B.eq(B.v('side'), 'LEFT'), [B.turn('left', 90)], [B.turn('right', 90)]),
      B.setVar('count', '12'),
      B.changeVar('count', 1),
      B.setVar('code', '007'),
      B.setVar('bigger', B.gt(B.v('count'), '9')),
    ]);
    near(headingDeg(sim), -90, 0.1, 'the word decided the turn');
    assert.equal(variable(sim, 'side'), 'left');
    assert.equal(variable(sim, 'count'), 13, 'a typed number is a number');
    assert.equal(variable(sim, 'code'), '007', 'a text that is not a plain number stays as typed');
    assert.equal(variable(sim, 'bigger'), true, '13 > 9 as numbers, not as texts');
  });
});
