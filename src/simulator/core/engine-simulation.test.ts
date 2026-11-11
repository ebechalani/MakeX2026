/**
 * The whole simulator in one go: a block program (as Blockly would save it) is run by the real
 * interpreter, moves the robot in the engine, and the Fire Rescue referee counts the points.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fireRescueGame } from '../fire-rescue/game';
import { defaultScenario } from '../fire-rescue/scenario';
import { arm, forever, gripper, moveCm, program, script, turn, wait, whenStart } from '../vm/builder';
import { DEFAULT_ROBOT_CONFIG } from './robot';
import { createSimulation } from './simulation';

test('a block program delivers the red bucket and rescues the red person: 40 points', () => {
  // Default combination: red bucket on W1 (420.85, 426.5) -> square A2 (1160, 115.3);
  // red person in A1 (1050, 115.3) -> rescue tower RR (680, 1100.2).
  // The robot starts at (625, 673.2) facing up; the middle of its claw is 14.2 cm ahead of the axle.
  const blocks = program([
    script(whenStart(), [
      // ---- fetch the bucket from water tower W1
      turn('left', 90),
      moveCm('forward', 20.415),
      turn('right', 90),
      arm('raise'),
      moveCm('forward', 10.47),
      gripper('close'),
      // ---- bring it to building A, square 2
      moveCm('backward', 5),
      turn('right', 90),
      moveCm('forward', 73.915),
      turn('left', 90),
      moveCm('forward', 36.12),
      arm('lower'),
      gripper('open'),
      moveCm('backward', 10),
      // ---- pick up the person in square 1
      turn('left', 90),
      moveCm('forward', 11),
      turn('right', 90),
      moveCm('forward', 10),
      gripper('close'),
      arm('raise'),
      // ---- carry it to rescue tower RR
      turn('right', 180),
      moveCm('forward', 44.27),
      turn('right', 90),
      moveCm('forward', 37),
      turn('left', 90),
      moveCm('forward', 25.82),
      arm('lower'),
      gripper('open'),
      moveCm('backward', 10),
    ]),
  ]);

  const sim = createSimulation({
    game: fireRescueGame,
    scenario: defaultScenario(),
    robotConfig: DEFAULT_ROBOT_CONFIG,
    program: blocks,
  });
  assert.deepEqual(sim.vm.errors(), []);
  sim.start();
  sim.step(18000);

  assert.equal(sim.status, 'finished');
  assert.equal(sim.finishReason, 'program-ended');
  assert.deepEqual(sim.vm.errors(), []);
  const report = sim.score();
  const line = (id: string) => report.lines.find((l) => l.id === id);
  assert.equal(line('bucket:red')?.ok, true, line('bucket:red')?.detail);
  assert.equal(line('person:red')?.ok, true, line('person:red')?.detail);
  assert.equal(report.total, 40);
  const events = sim.drainEvents();
  assert.equal(events.filter((e) => e.type === 'grab').length, 2);
  assert.equal(events.filter((e) => e.type === 'log' && e.level !== 'info').length, 0, 'no warnings from the program');
});

test('restart with the real interpreter: the program starts again from the top', () => {
  const blocks = program([
    script(whenStart(), [moveCm('forward', 10), forever([wait(1)])]),
  ]);
  const sim = createSimulation({
    game: fireRescueGame,
    scenario: defaultScenario(),
    robotConfig: DEFAULT_ROBOT_CONFIG,
    program: blocks,
  });
  const startY = fireRescueGame.defaultStartPose.y;
  sim.start();
  sim.step(300);
  assert.ok(Math.abs(sim.world.robot.pose.y - (startY - 100)) < 0.01, 'drove 10 cm');
  sim.restart();
  assert.equal(sim.world.robot.pose.y, startY);
  assert.equal(sim.restarts, 1);
  sim.step(300);
  assert.ok(Math.abs(sim.world.robot.pose.y - (startY - 100)) < 0.01, 'drove 10 cm again');
  assert.equal(sim.status, 'running', 'a forever loop keeps the match going');
  sim.declareFinished();
  assert.equal(sim.finishReason, 'declared');
  assert.equal(sim.score().lines.find((l) => l.id === 'restarts')?.points, -5);
});
