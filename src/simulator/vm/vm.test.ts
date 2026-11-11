/**
 * Tests of the interpreter with a pretend robot (fake-io.ts). Time is simulated: one tick is
 * io.dt seconds and the test decides how many ticks pass.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BlockJson, ProgramJson } from '../core/types';
import * as B from './builder';
import { createFakeIO, runFor, runTicks, runUntilDone } from './fake-io';
import {
  BLOCKS_PER_TICK,
  createVM,
  DEFAULT_MOTION_RPM,
  MAX_CALL_DEPTH,
  wheelDegreesForDistance,
  wheelDegreesForTurn,
} from './index';

/** Start a program on a fresh pretend robot. */
function boot(program: ProgramJson, dt = 0.02) {
  const io = createFakeIO({ dt });
  const vm = createVM(program, io);
  vm.start();
  return { io, vm };
}

const close = (actual: number, expected: number, eps = 1e-6): void => {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);
};

describe('sequencing and waits', () => {
  it('runs blocks in order and waits in simulated time', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.print('a'), B.wait(1), B.print('b'), B.wait(0.5), B.print('c')])]));
    assert.deepEqual(io.lines, [], 'nothing runs before the first step');
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['a']);
    runFor(vm, io, 0.96); // t = 0.98 after this
    assert.deepEqual(io.lines, ['a']);
    runTicks(vm, io, 2); // the step at t = 1.00 prints b
    assert.deepEqual(io.lines, ['a', 'b']);
    runFor(vm, io, 0.44);
    assert.deepEqual(io.lines, ['a', 'b']);
    runFor(vm, io, 0.1);
    assert.deepEqual(io.lines, ['a', 'b', 'c']);
    assert.equal(vm.running, false);
    assert.equal(vm.idle, true);
  });

  it('wait 0 still pauses one tick', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.print('a'), B.wait(0), B.print('b')])]));
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['a']);
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['a', 'b']);
  });

  it('never uses the wall clock: a huge time step works the same', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.wait(100), B.print('late')])]), 10);
    runTicks(vm, io, 10);
    assert.deepEqual(io.lines, []);
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['late']);
  });

  it('play tone sounds and waits for its duration', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.playTone(440, 0.5), B.print('after')])]));
    runFor(vm, io, 0.4);
    assert.deepEqual(io.tones, [{ frequency: 440, seconds: 0.5, time: 0 }]);
    assert.deepEqual(io.lines, []);
    runFor(vm, io, 0.2);
    assert.deepEqual(io.lines, ['after']);
  });
});

describe('loops and conditions', () => {
  it('repeat runs its body the given number of times, one pass per tick', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.repeat(4, [B.changeVar('n', 1)]), B.print('done')])]));
    runTicks(vm, io, 1);
    assert.equal(vm.variables().n, 1);
    runTicks(vm, io, 2);
    assert.equal(vm.variables().n, 3);
    runUntilDone(vm, io);
    assert.equal(vm.variables().n, 4);
    assert.deepEqual(io.lines, ['done']);
  });

  it('forever makes exactly one pass per tick', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.forever([B.changeVar('n', 1)])])]));
    runTicks(vm, io, 50);
    assert.equal(vm.variables().n, 50);
    assert.equal(vm.running, true);
    assert.equal(vm.idle, false);
  });

  it('if / if-else choose the right branch', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [
          B.ifThen(B.gt(3, 2), [B.print('yes1')]),
          B.ifThen(B.gt(2, 3), [B.print('no1')]),
          B.ifElse(B.lt(5, 1), [B.print('no2')], [B.print('else2')]),
          B.ifElse(B.eq('Hello', 'hello'), [B.print('yes3')], [B.print('no3')]),
        ]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['yes1', 'else2', 'yes3']);
  });

  it('wait until polls its condition every tick', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.waitUntil(B.lt(B.ultrasonic(), 10)), B.print('close')])]));
    runFor(vm, io, 1);
    assert.deepEqual(io.lines, []);
    io.sensors.ultrasonicCm = 8;
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['close']);
  });

  it('repeat until stops when the condition becomes true', () => {
    const { io, vm } = boot(
      B.program([B.script(B.whenStart(), [B.repeatUntil(B.eq(B.v('n'), 5), [B.changeVar('n', 1)]), B.print(B.v('n'))])]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['5']);
  });
});

describe('variables, operators and loose typing', () => {
  /** Evaluate one reporter by printing it. */
  function show(value: B.Value, prepare?: (io: ReturnType<typeof createFakeIO>) => void): string {
    const io = createFakeIO();
    prepare?.(io);
    const vm = createVM(B.program([B.script(B.whenStart(), [B.print(value)])]), io);
    vm.start();
    runTicks(vm, io, 1);
    assert.deepEqual(vm.errors(), []);
    return io.lines[0];
  }

  it('does arithmetic', () => {
    assert.equal(show(B.add(2, 3)), '5');
    assert.equal(show(B.sub(2, 3)), '-1');
    assert.equal(show(B.mul(4, 2.5)), '10');
    assert.equal(show(B.div(7, 2)), '3.5');
    assert.equal(show(B.add(0.1, 0.2)), '0.3');
    assert.equal(show(B.mod(7, 3)), '1');
    assert.equal(show(B.mod(-1, 5)), '4');
    assert.equal(show(B.round(2.5)), '3');
    assert.equal(show(B.mathOp('abs', -4)), '4');
    assert.equal(show(B.mathOp('sqrt', 16)), '4');
    assert.equal(show(B.mathOp('floor', 2.7)), '2');
    assert.equal(show(B.mathOp('ceiling', 2.1)), '3');
    assert.equal(show(B.mathOp('sin', 90)), '1');
    assert.equal(show(B.mathOp('cos', 180)), '-1');
    assert.equal(show(B.mathOp('sin', 180)), '0');
    assert.equal(show(B.mathOp('10 ^', 3)), '1000');
    assert.equal(show(B.div(1, 0)), 'Infinity');
  });

  it('treats text that looks like a number as a number', () => {
    assert.equal(show(B.add('2', ' 3 ')), '5');
    assert.equal(show(B.add('abc', 3)), '3');
    assert.equal(show(B.gt('10', '9')), 'true', 'compared as numbers, not as texts');
    assert.equal(show(B.eq('1.0', 1)), 'true');
    assert.equal(show(B.eq('apple', 'APPLE')), 'true', 'texts compare without upper/lower case');
    assert.equal(show(B.lt('apple', 'banana')), 'true');
    assert.equal(show(B.eq(B.add(0.1, 0.2), 0.3)), 'true');
    assert.equal(show(B.eq(B.div(1, 0), B.div(2, 0))), 'true', 'infinity equals infinity');
    assert.equal(show(B.gt(B.div(1, 0), 1000000)), 'true');
    assert.equal(show(B.mul(123456789, 1000000)), '123456789000000', 'big whole numbers keep all their digits');
    assert.equal(show(B.add(true, true)), '2', 'true counts as 1');
    assert.equal(show(B.join(B.gt(2, 1), '!')), 'true!');
  });

  it('handles texts', () => {
    assert.equal(show(B.join('speed: ', 50)), 'speed: 50');
    assert.equal(show(B.letterOf(2, 'robot')), 'o');
    assert.equal(show(B.letterOf(9, 'robot')), '');
    assert.equal(show(B.lengthOf('robot')), '5');
    assert.equal(show(B.contains('Fire Rescue', 'rescue')), 'true');
    assert.equal(show(B.contains('Fire Rescue', 'water')), 'false');
  });

  it('combines conditions', () => {
    assert.equal(show(B.and(B.gt(2, 1), B.lt(2, 1))), 'false');
    assert.equal(show(B.or(B.gt(2, 1), B.lt(2, 1))), 'true');
    assert.equal(show(B.not(B.gt(2, 1))), 'false');
    assert.equal(show(B.and(true, B.not(false))), 'true');
  });

  it('pick random gives whole numbers for whole limits, using io.random()', () => {
    assert.equal(show(B.random(1, 10), (io) => io.randomQueue.push(0)), '1');
    assert.equal(show(B.random(1, 10), (io) => io.randomQueue.push(0.999)), '10');
    assert.equal(show(B.random(10, 1), (io) => io.randomQueue.push(0.5)), '6');
    assert.equal(show(B.random(1, 2.5), (io) => io.randomQueue.push(0.5)), '1.75');
  });

  it('set / change variables; variables() reports them by name', () => {
    const { io, vm } = boot(
      B.program(
        [
          B.script(B.whenStart(), [
            B.setVar('speed', 40),
            B.changeVar('speed', 15),
            B.setVar('name', B.join('mBot', 2)),
            B.setVar('fast', B.gt(B.v('speed'), 50)),
            B.changeVar('count', '2'),
          ]),
        ],
        { variables: ['unused'] },
      ),
    );
    assert.deepEqual(vm.variables(), { speed: 0, name: 0, fast: 0, count: 0, unused: 0 }, 'variables start at 0');
    runUntilDone(vm, io);
    assert.deepEqual(vm.variables(), { speed: 55, name: 'mBot2', fast: true, count: 2, unused: 0 });
  });

  it("understands Blockly's own variable blocks too (variables_set, variables_get, math_change)", () => {
    const x = { variable: 'x' };
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [
          B.b('variables_set', { fields: { VAR: x }, inputs: { VALUE: 5 } }),
          B.b('math_change', { fields: { VAR: x }, inputs: { DELTA: 2 } }),
          B.print(B.b('variables_get', { fields: { VAR: x } })),
        ]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['7']);
    assert.deepEqual(vm.variables(), { x: 7 });
    assert.deepEqual(vm.errors(), []);
  });

  it('start() again resets the variables', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.changeVar('n', 7)])]));
    runUntilDone(vm, io);
    assert.equal(vm.variables().n, 7);
    vm.start();
    assert.equal(vm.variables().n, 0);
    runUntilDone(vm, io);
    assert.equal(vm.variables().n, 7);
  });

  it('lists', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [
          B.addToList('route', 'A'),
          B.addToList('route', 'C'),
          B.insertAtList('route', 2, 'B'),
          B.addToList('route', 'D'),
          B.deleteOfList('route', 1),
          B.replaceItemOfList('route', 'last', 'Z'),
          B.print(B.listContents('route')),
          B.print(B.itemOfList('route', 1)),
          B.print(B.itemOfList('route', 9)),
          B.print(B.lengthOfList('route')),
          B.print(B.itemNumOfList('route', 'c')),
          B.print(B.listContains('route', 'Z')),
        ]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['B C Z', 'B', '', '3', '2', 'true']);
    assert.deepEqual(vm.variables().route, ['B', 'C', 'Z']);
  });
});

describe('driving', () => {
  it('"moves forward cm until done" turns the wheels by the right angle and waits', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.moveCm('forward', 20), B.print('arrived')])]));
    runTicks(vm, io, 1);
    const expected = (200 / (Math.PI * io.config.wheelDiameter)) * 360;
    assert.equal(io.motions.length, 1);
    close(io.motions[0].leftDeg, expected);
    close(io.motions[0].rightDeg, expected);
    assert.equal(io.motions[0].rpm, DEFAULT_MOTION_RPM);
    close(wheelDegreesForDistance(io, 200), expected);
    assert.deepEqual(io.lines, [], 'the next block waits for the move');

    const seconds = expected / (DEFAULT_MOTION_RPM * 6);
    runFor(vm, io, seconds - 0.1);
    assert.deepEqual(io.lines, []);
    assert.equal(io.motionDone(), false);
    runFor(vm, io, 0.2);
    assert.deepEqual(io.lines, ['arrived']);
    close(io.wheels.left.angle, expected, 1e-6);
  });

  it('"moves backward" and "turns" use the right wheel directions', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.moveCm('backward', 10), B.turn('left', 90), B.turn('right', 45)])]));
    runUntilDone(vm, io);
    const back = wheelDegreesForDistance(io, 100);
    const quarter = (90 * io.config.trackWidth) / io.config.wheelDiameter;
    close(wheelDegreesForTurn(io, 90), quarter);
    assert.equal(io.motions.length, 3);
    close(io.motions[0].leftDeg, -back);
    close(io.motions[0].rightDeg, -back);
    close(io.motions[1].leftDeg, -quarter); // turning left: left wheel backward, right wheel forward
    close(io.motions[1].rightDeg, quarter);
    close(io.motions[2].leftDeg, quarter / 2);
    close(io.motions[2].rightDeg, -quarter / 2);
  });

  it('a move of 0 cm does nothing and does not block', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.moveCm('forward', 0), B.print('next')])]));
    runTicks(vm, io, 1);
    assert.equal(io.motions.length, 0);
    assert.deepEqual(io.lines, ['next']);
  });

  it('"moves ... at RPM for secs" sets the speed, waits, then stops', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.moveFor('forward', 60, 1), B.moveFor('left', 30, 0.5), B.print('end')])]));
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, ['setWheelRpm left 60', 'setWheelRpm right 60']);
    runFor(vm, io, 0.9);
    assert.equal(io.wheels.left.rpm, 60);
    runFor(vm, io, 0.2);
    assert.deepEqual(io.calls.slice(2, 5), ['stopWheel all', 'setWheelRpm left -30', 'setWheelRpm right 30']);
    runUntilDone(vm, io);
    assert.equal(io.calls[5], 'stopWheel all');
    assert.deepEqual(io.lines, ['end']);
    assert.equal(io.wheels.left.rpm, 0);
  });

  it('"moves ... at RPM" (no time) starts the motors and carries on', () => {
    const { io, vm } = boot(
      B.program([B.script(B.whenStart(), [B.move('backward', 40), B.print('1'), B.move('right', 25), B.print('2'), B.stopMotors()])]),
    );
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, [
      'setWheelRpm left -40',
      'setWheelRpm right -40',
      'print 1',
      'setWheelRpm left 25',
      'setWheelRpm right -25',
      'print 2',
      'stopWheel all',
    ]);
  });

  it('raw EM1 / EM2 blocks: the right motor is mirrored (EM1 50, EM2 -50 drives forward)', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.driveRpm(50, -50)])]));
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, ['setWheelRpm left 50', 'setWheelRpm right 50']);

    const spin = boot(B.program([B.script(B.whenStart(), [B.driveRpm(50, 50)])]));
    runTicks(spin.vm, spin.io, 1);
    assert.deepEqual(spin.io.calls, ['setWheelRpm left 50', 'setWheelRpm right -50'], 'EM1 50, EM2 50 spins on the spot');

    const power = boot(B.program([B.script(B.whenStart(), [B.drivePower(80, -80), B.motorRpm('EM2', -30), B.motorPower('EM1', 150)])]));
    runTicks(power.vm, power.io, 1);
    assert.deepEqual(power.io.calls, ['setWheelPower left 80', 'setWheelPower right 80', 'setWheelRpm right 30', 'setWheelPower left 100']);
  });

  it('encoder reporters are mirrored the same way', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [
          B.driveRpm(50, -50),
          B.wait(1),
          B.print(B.motorAngle('EM1')),
          B.print(B.motorAngle('EM2')),
          B.print(B.motorSpeed('EM2')),
          B.print(B.motorPowerValue('EM1')),
          B.resetMotorAngle('EM1'),
          B.print(B.motorAngle('EM1')),
        ]),
      ]),
    );
    runUntilDone(vm, io);
    // 50 RPM for 1 s = 300 degrees; the loop pauses one extra tick before printing
    assert.deepEqual(io.lines, ['300', '-300', '-50', '25', '0']);
  });

  it('"encoder motor rotates deg until done" for EM1, EM2 and all', () => {
    const { io, vm } = boot(
      B.program([B.script(B.whenStart(), [B.motorRotate('EM1', 360, 60), B.motorRotate('EM2', 360, 60), B.motorRotate('all', 180, -60)])]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.motions, [
      { leftDeg: 360, rightDeg: 0, rpm: 60 },
      { leftDeg: 0, rightDeg: -360, rpm: 60 },
      { leftDeg: -180, rightDeg: 180, rpm: 60 },
    ]);
  });

  it('a new drive block in another script takes over; the waiting script moves on', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.moveCm('forward', 100), B.print('first done')]),
        B.script(B.whenStart(), [B.wait(0.5), B.moveCm('backward', 5), B.print('second done')]),
      ]),
    );
    runFor(vm, io, 0.4);
    assert.deepEqual(io.lines, []);
    runFor(vm, io, 0.2);
    assert.equal(io.motions.length, 2, 'the second move replaced the first');
    assert.deepEqual(io.lines, ['first done'], 'the first script no longer waits for its cancelled move');
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['first done', 'second done']);
  });

  it('a timed move that was taken over does not stop the other script\'s motors', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.moveFor('forward', 50, 1)]),
        B.script(B.whenStart(), [B.wait(0.5), B.move('backward', 20)]),
      ]),
    );
    runFor(vm, io, 2);
    assert.equal(io.wheels.left.rpm, -20);
    assert.ok(!io.calls.includes('stopWheel all'));
  });
});

describe('servos and gripper', () => {
  it('set servo angle is immediate; the reporter shows the servo moving', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.setServo('S3', 150), B.print('sent'), B.wait(0.1), B.print(B.servoAngle('S3'))])]));
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, ['setServo S3 150', 'print sent']);
    runUntilDone(vm, io);
    // the servo turns 300 deg/s: 0.1 s after leaving 90 it is at 120
    assert.equal(io.lines[1], '120');
  });

  it('servo "all" and out-of-range angles', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.setServo('all', 270)])]));
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, ['setServo S1 180', 'setServo S2 180', 'setServo S3 180', 'setServo S4 180']);
  });

  it('gripper helpers use the ports and angles of io.config.gripper and wait until done', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.gripper('open'), B.arm('lower'), B.gripper('close'), B.print('gripped'), B.arm('raise'), B.armHeight(50), B.print('end')]),
      ]),
    );
    const g = io.config.gripper;
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, [`setServo ${g.clawServo} ${g.clawOpenAngle}`]);
    runUntilDone(vm, io);
    assert.deepEqual(
      io.calls.filter((c) => c.startsWith('setServo') || c.startsWith('print')),
      [
        `setServo ${g.clawServo} ${g.clawOpenAngle}`,
        `setServo ${g.liftServo} ${g.liftDownAngle}`,
        `setServo ${g.clawServo} ${g.clawClosedAngle}`,
        'print gripped',
        `setServo ${g.liftServo} ${g.liftUpAngle}`,
        `setServo ${g.liftServo} ${(g.liftDownAngle + g.liftUpAngle) / 2}`,
        'print end',
      ],
    );
    close(io.servos[g.liftServo].angle, (g.liftDownAngle + g.liftUpAngle) / 2);
    close(io.servos[g.clawServo].angle, g.clawClosedAngle);
    // closing the claw takes (130 - 40) / 300 = 0.3 s: "gripped" cannot be printed before that
    assert.ok(io.time > 0.3);
  });

  it('gripper blocks on a robot without gripper warn and carry on', () => {
    const io = createFakeIO({ config: { gripper: { ...createFakeIO().config.gripper, enabled: false } } });
    const vm = createVM(B.program([B.script(B.whenStart(), [B.gripper('close'), B.print('next')])]), io);
    vm.start();
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['next']);
    assert.equal(io.logs.length, 1);
    assert.equal(io.logs[0].level, 'warn');
  });
});

describe('sensors and CyberPi', () => {
  it('reads the quad RGB sensor', () => {
    const io = createFakeIO();
    io.sensors.lineStatus = 0b0110;
    io.sensors.lineOffset = -37.26;
    io.sensors.probes.L1 = { rgb: { r: 10, g: 20, b: 30 }, light: 8, gray: 92, onLine: true, color: 'black' };
    io.sensors.probes.R2 = { rgb: { r: 250, g: 40, b: 35 }, light: 60, gray: 40, onLine: false, color: 'red' };
    const vm = createVM(
      B.program([
        B.script(B.whenStart(), [
          B.print(B.lineStatus()),
          B.print(B.lineStatus('inner')),
          B.print(B.lineStatusIs(6)),
          B.print(B.lineStatusIs(15)),
          B.print(B.lineDeviation()),
          B.print(B.probeDetects('L1', 'line')),
          B.print(B.probeDetects('L1', 'background')),
          B.print(B.probeDetects('L2')),
          B.print(B.probeColorIs('R2', 'red')),
          B.print(B.probeColorIs('R2', 'blue')),
          B.print(B.probeColor('L1')),
          B.print(B.probeRgb('R2', 'r')),
          B.print(B.probeRgb('L1', 'b')),
          B.print(B.probeGray('L1')),
          B.print(B.probeLight('R2')),
        ]),
      ]),
      io,
    );
    vm.start();
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['6', '3', 'true', 'false', '-37.3', 'true', 'false', 'false', 'true', 'false', 'black', '250', '30', '92', '60']);
    assert.deepEqual(vm.errors(), []);
  });

  it('reads the ultrasonic sensor, the claw colour sensor, the gyro and the timer', () => {
    const io = createFakeIO();
    io.sensors.ultrasonicCm = 12.34;
    io.sensors.frontColor = 'green';
    io.sensors.yawDeg = 450;
    const vm = createVM(
      B.program([
        B.script(B.whenStart(), [
          B.print(B.ultrasonic()),
          B.print(B.clawColorIs('green')),
          B.print(B.clawColorIs('red')),
          B.print(B.clawColor()),
          B.print(B.clawObjectDetected()),
          B.print(B.rotationZ()),
          B.print(B.yaw()),
          B.wait(1),
          B.print(B.timer()),
          B.resetTimer(),
          B.resetYaw(),
          B.print(B.timer()),
          B.print(B.yaw()),
        ]),
      ]),
      io,
    );
    io.tick = 100; // the program starts 2 s into the match: the timer still counts from the start of the program
    vm.start();
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['12.3', 'true', 'false', 'green', 'true', '450', '90', '1', '0', '0']);
  });

  it('drives the LEDs and the screen', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [
          B.ledColor('all', '#00ff80'),
          B.ledRgb(2, 300, -5, 12.4),
          B.ledOff(5),
          B.showLabel('Fire!', 10, 20, 24),
          B.print(B.buttonPressed('a')),
          B.print(B.joystickPulled('up')),
          B.clearScreen(),
        ]),
      ]),
    );
    io.buttons.up = true;
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, [
      'setLed all 0,255,128',
      'setLed 1 255,0,12',
      'setLed 4 0,0,0',
      'showLabel Fire! 10 20 24',
      'print false',
      'print true',
      'clearScreen',
    ]);
  });
});

describe('several scripts', () => {
  it('two scripts run in parallel', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.repeat(3, [B.print('A'), B.wait(1)])]),
        B.script(B.whenStart(), [B.wait(0.5), B.repeat(3, [B.print('B'), B.wait(1)])]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['A', 'B', 'A', 'B', 'A', 'B']);
  });

  it('broadcast starts the receivers; broadcast and wait waits for them', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.broadcast('Go'), B.print('sent'), B.broadcastAndWait('work'), B.print('work finished')]),
        B.script(B.whenReceive('go'), [B.print('go received')]),
        B.script(B.whenReceive('work'), [B.wait(1), B.print('working 1')]),
        B.script(B.whenReceive('work'), [B.wait(2), B.print('working 2')]),
        B.script(B.whenReceive('other'), [B.print('never')]),
      ]),
    );
    runTicks(vm, io, 2);
    assert.deepEqual(io.lines, ['sent', 'go received']);
    runFor(vm, io, 1.5);
    assert.deepEqual(io.lines, ['sent', 'go received', 'working 1']);
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['sent', 'go received', 'working 1', 'working 2', 'work finished']);
  });

  it('a broadcast restarts a receiver that is still running', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.broadcast('m'), B.wait(0.5), B.broadcast('m')]),
        B.script(B.whenReceive('m'), [B.print('start'), B.wait(1), B.print('end')]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['start', 'start', 'end']);
  });

  it('a script that broadcasts its own message restarts itself without freezing the tick', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.broadcast('loop')]),
        B.script(B.whenReceive('loop'), [B.changeVar('n', 1), B.broadcast('loop'), B.print('never reached')]),
      ]),
    );
    runTicks(vm, io, 20);
    assert.deepEqual(io.lines, []);
    assert.equal(vm.variables().n, 19, 'one restart per tick');
  });

  it('button hats fire on the press, not while held, and not before the press', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenButton('a'), [B.print('A!')]),
        B.script(B.whenJoystick('middle'), [B.print('click'), B.wait(1), B.print('click done')]),
      ]),
    );
    runTicks(vm, io, 5);
    assert.deepEqual(io.lines, []);
    assert.equal(vm.running, false);
    assert.equal(vm.idle, false, 'a button could still start a script');

    io.buttons.a = true;
    runTicks(vm, io, 5);
    assert.deepEqual(io.lines, ['A!'], 'holding the button does not fire again');
    io.buttons.a = false;
    runTicks(vm, io, 1);
    io.buttons.a = true;
    runTicks(vm, io, 1);
    assert.deepEqual(io.lines, ['A!', 'A!']);

    io.buttons.middle = true;
    runTicks(vm, io, 1);
    io.buttons.middle = false;
    runTicks(vm, io, 1);
    io.buttons.middle = true; // pressed again while its script is still running: ignored
    runTicks(vm, io, 1);
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['A!', 'A!', 'click', 'click done']);
  });

  it('a program with only message hats is idle (nothing can ever start)', () => {
    const { vm } = boot(B.program([B.script(B.whenReceive('x'), [B.print('x')])]));
    assert.equal(vm.running, false);
    assert.equal(vm.idle, true);
  });

  it('an empty program is idle', () => {
    const { io, vm } = boot({});
    runTicks(vm, io, 3);
    assert.equal(vm.idle, true);
    assert.deepEqual(vm.errors(), []);
    assert.deepEqual(vm.variables(), {});
  });
});

describe('stopping', () => {
  it('"stop all" ends every script and stops the motors', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.move('forward', 50), B.wait(1), B.stop('all'), B.print('never')]),
        B.script(B.whenStart(), [B.forever([B.changeVar('n', 1)])]),
        B.script(B.whenButton('a'), [B.print('never either')]),
      ]),
    );
    runFor(vm, io, 3);
    assert.equal(vm.running, false);
    assert.equal(vm.idle, true, 'after "stop all" nothing can start any more, even with a button hat');
    assert.equal(io.wheels.left.rpm, 0);
    assert.equal(io.calls[io.calls.length - 1], 'stopWheel all');
    const n = vm.variables().n;
    io.buttons.a = true;
    runFor(vm, io, 1);
    assert.equal(vm.variables().n, n);
    assert.deepEqual(io.lines, []);
  });

  it('"stop this script" ends only its own script', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.print('one'), B.stop('this script'), B.print('never')]),
        B.script(B.whenStart(), [B.wait(0.5), B.print('two')]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['one', 'two']);
  });

  it('"stop other scripts" keeps its own script going', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.forever([B.changeVar('n', 1)])]),
        B.script(B.whenStart(), [B.wait(0.5), B.stop('other scripts'), B.setVar('seen', B.v('n')), B.wait(0.5), B.print('still here')]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['still here']);
    assert.equal(vm.variables().n, vm.variables().seen);
  });

  it('vm.stopAll() stops everything; start() runs the program again from the top', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.print('hello'), B.forever([B.move('forward', 30)])])]));
    runFor(vm, io, 1);
    assert.equal(vm.running, true);
    vm.stopAll();
    assert.equal(vm.running, false);
    assert.equal(vm.idle, true);
    assert.equal(io.wheels.left.rpm, 0);
    assert.deepEqual(vm.activeBlockIds(), []);
    runFor(vm, io, 1);
    assert.deepEqual(io.lines, ['hello']);
    vm.start();
    runFor(vm, io, 1);
    assert.deepEqual(io.lines, ['hello', 'hello']);
    assert.equal(io.wheels.left.rpm, 30);
  });
});

describe('my blocks (procedures)', () => {
  it('calls a definition with arguments', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.call('square', 10, 3), B.print('back')]),
        B.define('square', ['side', 'times'], [B.repeat(B.v('times'), [B.moveCm('forward', B.v('side')), B.turn('right', 90)])]),
      ]),
    );
    runUntilDone(vm, io);
    assert.equal(io.motions.length, 6);
    close(io.motions[0].leftDeg, wheelDegreesForDistance(io, 100));
    assert.deepEqual(io.lines, ['back']);
    assert.deepEqual(vm.errors(), []);
    assert.deepEqual(vm.variables(), {}, 'parameters are not global variables');
  });

  it('returns values, also from a recursive definition', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.print(B.callReturn('double', 21)), B.print(B.callReturn('factorial', 5)), B.print(B.add(B.callReturn('double', 1), B.callReturn('double', 2)))]),
        B.defineReturn('double', ['x'], [], B.mul(B.v('x'), 2)),
        B.defineReturn('factorial', ['k'], [B.ifReturn(B.lt(B.v('k'), 2), 1)], B.mul(B.v('k'), B.callReturn('factorial', B.sub(B.v('k'), 1)))),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['42', '120', '6']);
    assert.deepEqual(vm.errors(), []);
  });

  it('a definition may take time, even when used as a value', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.print(B.join('result ', B.callReturn('slow')))]),
        B.defineReturn('slow', [], [B.wait(1)], 7),
      ]),
    );
    runFor(vm, io, 0.9);
    assert.deepEqual(io.lines, []);
    runFor(vm, io, 0.2);
    assert.deepEqual(io.lines, ['result 7']);
  });

  it('"stop this script" inside a definition only leaves the definition', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.call('early'), B.print('after call')]),
        B.define('early', [], [B.print('in'), B.stop('this script'), B.print('never')]),
      ]),
    );
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['in', 'after call']);
  });

  it('a call without definition is reported, not fatal', () => {
    const p = B.program([B.script(B.whenStart(), [B.call('ghost'), B.print('still running')]), B.define('ghost', [], [])]);
    // remove the definition after building
    p.blocks!.blocks = p.blocks!.blocks!.filter((blk) => blk.type !== 'procedures_defnoreturn');
    const { io, vm } = boot(p);
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['still running']);
    assert.equal(vm.errors().length, 1);
    assert.match(vm.errors()[0].message, /ghost/);
  });
});

describe('robustness', () => {
  it('an unknown block is reported once and skipped; the script keeps running', () => {
    const p = B.program([
      B.script(B.whenStart(), [
        B.repeat(3, [B.b('mystery_block', { id: 'mystery' }), B.print(B.add(B.b('mystery_value', { id: 'mystery2' }), 1))]),
      ]),
    ]);
    const { io, vm } = boot(p);
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['1', '1', '1']);
    const errors = vm.errors();
    assert.equal(errors.length, 2, 'once per block, not once per pass');
    assert.deepEqual(errors.map((e) => e.blockId).sort(), ['mystery', 'mystery2']);
    assert.match(errors[0].message, /mystery_block/);
    const logged = io.logs.filter((l) => l.level === 'error');
    assert.equal(logged.length, 2);
    assert.equal(logged[0].blockId, 'mystery');
  });

  it('an empty slot is reported once and counts as false / 0', () => {
    const p = B.program([B.script(B.whenStart(), [B.repeat(2, [B.b('control_if', { id: 'empty-if', statements: { SUBSTACK: [B.print('never')] } })]), B.print('end')])]);
    const { io, vm } = boot(p);
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['end']);
    assert.equal(vm.errors().length, 1);
    assert.equal(vm.errors()[0].blockId, 'empty-if');
    assert.match(vm.errors()[0].message, /empty slot/);
  });

  it('a program without the fields Blockly normally writes falls back to the catalog defaults', () => {
    const program: ProgramJson = {
      blocks: {
        blocks: [
          {
            type: 'event_cyberpi_start',
            id: 'h',
            next: { block: { type: 'mbot2_move_direction', id: 'm', inputs: { SPEED: { shadow: { type: 'math_number', id: 's', fields: { NUM: 30 } } } } } },
          },
        ],
      },
    };
    const { io, vm } = boot(program);
    runTicks(vm, io, 1);
    assert.deepEqual(io.calls, ['setWheelRpm left 30', 'setWheelRpm right 30']);
  });

  it('survives a forever loop without waits (one pass per tick, the step returns)', () => {
    const { io, vm } = boot(B.program([B.script(B.whenStart(), [B.forever([B.changeVar('n', 1), B.driveRpm(B.v('n'), 0)])])]));
    runTicks(vm, io, 1000);
    assert.equal(vm.variables().n, 1000);
  });

  it('pauses a script that runs too many blocks in one tick (a my-block calling itself, no loop, no wait)', () => {
    const work = Array.from({ length: 40 }, () => B.changeVar('n', 1));
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.call('busy', 1), B.print('done')]),
        // 100 calls x 40 blocks = 4000 blocks with nothing that pauses
        B.define('busy', ['level'], [...work, B.ifThen(B.lt(B.v('level'), 100), [B.call('busy', B.add(B.v('level'), 1))])]),
      ]),
    );
    runTicks(vm, io, 1);
    const afterOne = Number(vm.variables().n);
    assert.ok(afterOne > 0 && afterOne <= BLOCKS_PER_TICK, `ran ${afterOne} blocks in the first tick`);
    assert.equal(vm.running, true);
    runUntilDone(vm, io);
    assert.equal(vm.variables().n, 4000);
    assert.deepEqual(io.lines, ['done']);
    assert.deepEqual(vm.errors(), []);
  });

  it('the block budget pauses a long straight stack until the next tick', () => {
    const body = Array.from({ length: 3 * BLOCKS_PER_TICK }, () => B.changeVar('n', 1));
    const { io, vm } = boot(B.program([B.script(B.whenStart(), body)]));
    runTicks(vm, io, 1);
    const afterOne = Number(vm.variables().n);
    assert.ok(afterOne > 0 && afterOne <= BLOCKS_PER_TICK, `ran ${afterOne} blocks in the first tick`);
    assert.equal(vm.running, true);
    runUntilDone(vm, io);
    assert.equal(vm.variables().n, 3 * BLOCKS_PER_TICK);
  });

  it('a my-block that calls itself forever is stopped with an error', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.call('again'), B.print('never')]),
        B.script(B.whenStart(), [B.wait(1), B.print('other script fine')]),
        B.define('again', [], [B.changeVar('depth', 1), B.call('again')]),
      ]),
    );
    runUntilDone(vm, io, 5);
    assert.equal(vm.variables().depth, MAX_CALL_DEPTH);
    assert.deepEqual(io.lines, ['other script fine']);
    assert.equal(vm.errors().length, 1);
    assert.match(vm.errors()[0].message, /keeps calling itself/);
  });

  it('skips disabled blocks and ignores stacks without a hat', () => {
    const p = B.program([
      B.script(B.whenStart(), [B.print('1'), B.b('cyberpi_print', { id: 'off', inputs: { TEXT: '2' } }), B.repeat(2, [B.print('x')]), B.print('3')]),
      B.script(B.whenStart(), [B.print('disabled script')]),
    ]);
    const blocks = p.blocks!.blocks!;
    const find = (block: BlockJson | undefined, id: string): BlockJson | undefined =>
      !block ? undefined : block.id === id ? block : find(block.next?.block, id);
    find(blocks[0], 'off')!.enabled = false;
    // Blockly 11+ writes disabledReasons instead of enabled: false
    find(blocks[0], 'off')!.next!.block!.disabledReasons = ['MANUALLY_DISABLED'];
    blocks[1].disabledReasons = ['MANUALLY_DISABLED'];
    // a loose stack of blocks that is not attached to any hat
    blocks.push({ type: 'cyberpi_print', id: 'loose', x: 0, y: 0, inputs: { TEXT: { shadow: { type: 'text', id: 'loose-text', fields: { TEXT: 'orphan' } } } } });
    blocks.push({ type: 'operator_add', id: 'loose-value', x: 0, y: 100 });

    const { io, vm } = boot(p);
    runUntilDone(vm, io);
    assert.deepEqual(io.lines, ['1', '3']);
    assert.deepEqual(vm.errors(), []);
  });

  it('a crash inside one block stops that script only and is reported', () => {
    const io = createFakeIO();
    io.print = () => {
      throw new Error('screen exploded');
    };
    const vm = createVM(
      B.program([
        B.script(B.whenStart(), [B.b('cyberpi_print', { id: 'boom', inputs: { TEXT: 'x' } })]),
        B.script(B.whenStart(), [B.wait(0.1), B.changeVar('ok', 1)]),
      ]),
      io,
    );
    vm.start();
    runUntilDone(vm, io);
    assert.equal(vm.variables().ok, 1);
    assert.equal(vm.errors().length, 1);
    assert.equal(vm.errors()[0].blockId, 'boom');
  });
});

describe('highlighting', () => {
  it('activeBlockIds() names the block each running script is on', () => {
    const { io, vm } = boot(
      B.program([
        B.script(B.whenStart(), [B.b('control_wait', { id: 'w1', inputs: { DURATION: 1 } }), B.b('mbot2_straight_cm', { id: 'm1', inputs: { DISTANCE: 50 } })]),
        B.script(B.whenStart(), [B.b('control_wait', { id: 'w2', inputs: { DURATION: 5 } })]),
        B.script(B.whenStart(), [B.withId(B.call('nap'), 'call1')]),
        B.define('nap', [], [B.b('control_wait', { id: 'w3', inputs: { DURATION: 5 } })]),
      ]),
    );
    assert.deepEqual(vm.activeBlockIds(), [], 'nothing has run yet');
    runTicks(vm, io, 1);
    assert.deepEqual(vm.activeBlockIds().sort(), ['call1', 'w1', 'w2', 'w3']);
    runFor(vm, io, 1.5);
    assert.deepEqual(vm.activeBlockIds().sort(), ['call1', 'm1', 'w2', 'w3']);
    vm.stopAll();
    assert.deepEqual(vm.activeBlockIds(), []);
  });
});
