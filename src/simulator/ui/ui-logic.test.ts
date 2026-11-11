/**
 * Tests for the parts of the simulator screen that are plain logic (no browser needed):
 * texts, the program file, placing the robot, the driven path and the stage geometry.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEG } from '../core/geometry';
import { DEFAULT_ROBOT_CONFIG, robotFitsInRect } from '../core/robot';
import { createSimulation } from '../core/simulation';
import type { ProgramJson, SimEvent } from '../core/types';
import { FIRE_STATION } from '../fire-rescue/field';
import { fireRescueGame, startPoseFor } from '../fire-rescue/game';
import { moveCm, program, script, whenButton, whenStart } from '../vm/builder';
import {
  appendLog,
  bodyName,
  describeEvent,
  finishText,
  formatClock,
  formatNumber,
  formatStamp,
  inkOn,
  luminance,
  parseHex,
  restartNote,
  shade,
  wrapScreenLines,
  type LogLine,
} from './format';
import {
  blankProgram,
  countBlocks,
  hasHatBlock,
  hasRunnableScript,
  isProgramJson,
  parseProgramFile,
  programFileName,
  serializeProgramFile,
} from './program-file';
import { programFitScale } from './program-view';
import { fitView, placeZoneLabels, robotHit, viewToMat } from './render';
import { centredPose, headingDegrees, isPose, poseFits, robotBounds, rotatedPose } from './start-pose';
import { isRecord, storageKey } from './storage';
import { Trail } from './trail';

// =============================================================================================
// Texts
// =============================================================================================

test('the match clock counts down in whole seconds and shows 3:00 until time really runs', () => {
  assert.equal(formatClock(180), '3:00');
  assert.equal(formatClock(179.99), '3:00');
  assert.equal(formatClock(179), '2:59');
  assert.equal(formatClock(59.2), '1:00');
  assert.equal(formatClock(0.01), '0:01');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(-5), '0:00');
});

test('time stamps show tenths of a second and never 60 seconds', () => {
  assert.equal(formatStamp(0), '0:00.0');
  assert.equal(formatStamp(5.26), '0:05.3');
  assert.equal(formatStamp(65.42), '1:05.4');
  assert.equal(formatStamp(59.97), '1:00.0');
  assert.equal(formatStamp(180), '3:00.0');
  assert.equal(formatStamp(Number.NaN), '0:00.0');
});

test('numbers for the dashboard never show "-0"', () => {
  assert.equal(formatNumber(-0.0001), '0');
  assert.equal(formatNumber(-0.04, 1), '0.0');
  assert.equal(formatNumber(12.345, 1), '12.3');
  assert.equal(formatNumber(-179.6), '-180');
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), '-');
});

test('colour helpers', () => {
  assert.deepEqual(parseHex('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.deepEqual(parseHex('#f80'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(parseHex('tomato'), { r: 128, g: 128, b: 128 });
  assert.ok(luminance(parseHex('#ffffff')) > 0.99);
  assert.ok(luminance(parseHex('#000000')) < 0.01);
  assert.equal(inkOn(parseHex('#ffe600')), '#111827', 'dark text on yellow');
  assert.equal(inkOn(parseHex('#a81c22')), '#ffffff', 'white text on dark red');
  assert.deepEqual(shade({ r: 100, g: 100, b: 100 }, -1), { r: 0, g: 0, b: 0 });
  assert.deepEqual(shade({ r: 100, g: 100, b: 100 }, 1), { r: 255, g: 255, b: 255 });
});

test('game elements are named in plain words', () => {
  assert.equal(bodyName('tower:W1'), 'tower W1');
  assert.equal(bodyName('bucket:red'), 'the red bucket');
  assert.equal(bodyName('person:green'), 'the green person');
  assert.equal(bodyName('wall'), 'the table wall');
  assert.equal(bodyName('something'), 'something');
  assert.equal(finishText('time'), 'Time is up');
  assert.equal(finishText(null), 'Match over');
});

test('engine events become console lines; sounds do not', () => {
  const grab: SimEvent = { type: 'grab', bodyId: 'bucket:red', time: 3 };
  assert.deepEqual(describeEvent(grab), { time: 3, level: 'event', text: 'Picked up the red bucket.' });
  const onTower: SimEvent = { type: 'release', bodyId: 'person:blue', onto: 'tower:RB', time: 9 };
  assert.equal(describeEvent(onTower)?.text, 'Put down the blue person on tower RB.');
  const onMat: SimEvent = { type: 'release', bodyId: 'bucket:red', onto: null, time: 9 };
  assert.equal(describeEvent(onMat)?.text, 'Put down the red bucket on the mat.');
  const error: SimEvent = { type: 'log', level: 'error', text: 'oops', blockId: 'b7', time: 1 };
  assert.deepEqual(describeEvent(error), { time: 1, level: 'error', text: 'oops', blockId: 'b7' });
  assert.equal(describeEvent({ type: 'tone', frequency: 440, seconds: 1, time: 0 }), null);
  assert.equal(describeEvent({ type: 'restart', time: 12 })?.level, 'warn');
  assert.match(describeEvent({ type: 'finish', reason: 'time', time: 180 })?.text ?? '', /Time is up/);
});

test('restarts are spelled out, because a restart at 0 points does not change the score', () => {
  assert.equal(restartNote(0, 5), '');
  assert.equal(restartNote(1, 5), '1 restart: -5 points');
  assert.equal(restartNote(3, 5), '3 restarts: -15 points');
  assert.equal(restartNote(2, -5), '2 restarts: -10 points', 'the sign of the penalty does not matter');
  assert.equal(restartNote(1, 1), '1 restart: -1 point');
  assert.equal(restartNote(Number.NaN, 5), '');
  assert.equal(restartNote(-2, 5), '');
});

test('the console merges repeated lines and keeps only the newest ones', () => {
  let lines: LogLine[] = [];
  lines = appendLog(lines, { time: 1, level: 'event', text: 'Bumped into tower W1.' });
  lines = appendLog(lines, { time: 2, level: 'event', text: 'Bumped into tower W1.' });
  lines = appendLog(lines, { time: 3, level: 'error', text: 'oops', blockId: 'a' });
  lines = appendLog(lines, { time: 4, level: 'error', text: 'oops', blockId: 'b' });
  assert.equal(lines.length, 3, 'same text for another block is a new line');
  assert.equal(lines[0].count, 2);
  assert.equal(lines[0].time, 2);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3], 'line numbers are unique and rising');

  let many: LogLine[] = [];
  for (let i = 0; i < 25; i++) many = appendLog(many, { time: i, level: 'info', text: `line ${i}` }, 10);
  assert.equal(many.length, 10);
  assert.equal(many[0].text, 'line 15');
  assert.equal(many[9].n, 25);
});

test('long lines wrap on the narrow CyberPi screen', () => {
  assert.deepEqual(wrapScreenLines(['Hello', ''], 18), ['Hello', '']);
  assert.deepEqual(wrapScreenLines(['Ready for the mission'], 18), ['Ready for the miss', 'ion']);
  assert.deepEqual(wrapScreenLines(['abcdef'], 2), ['ab', 'cd', 'ef']);
  assert.deepEqual(wrapScreenLines(['abc'], 0), ['a', 'b', 'c'], 'never less than one character per row');
  assert.deepEqual(wrapScreenLines([], 18), []);
});

// =============================================================================================
// Program file
// =============================================================================================

const SAMPLE: ProgramJson = program([
  script(whenStart(), [moveCm('forward', 10), moveCm('backward', 10)]),
  script(whenButton('a'), [moveCm('forward', 5)]),
]);

test('a saved program file opens again unchanged', () => {
  const text = serializeProgramFile('fire-rescue', SAMPLE, new Date('2027-03-14T10:00:00Z'));
  const parsed = parseProgramFile(text);
  assert.ok(parsed.ok);
  assert.equal(parsed.game, 'fire-rescue');
  assert.deepEqual(parsed.program, SAMPLE);
  assert.match(text, /"savedAt": "2027-03-14T10:00:00.000Z"/);
});

test('a bare Blockly workspace file is accepted too', () => {
  const parsed = parseProgramFile(JSON.stringify(SAMPLE));
  assert.ok(parsed.ok);
  assert.equal(parsed.game, null);
  assert.deepEqual(parsed.program, SAMPLE);
});

test('files that are not programs are refused with a reason', () => {
  for (const text of ['', 'hello', '[1,2,3]', '{"a":1}', '{"blocks":{"blocks":"nope"}}', '{"blocks":{"blocks":[{"id":"x"}]}}']) {
    const parsed = parseProgramFile(text);
    assert.equal(parsed.ok, false, `should refuse: ${text}`);
    if (!parsed.ok) assert.ok(parsed.error.length > 10);
  }
  const damaged = parseProgramFile(JSON.stringify({ format: 'mbot2-simulator-program', version: 1, game: 'x' }));
  assert.equal(damaged.ok, false);
});

test('what counts as a program', () => {
  assert.ok(isProgramJson({}));
  assert.ok(isProgramJson(SAMPLE));
  assert.ok(isProgramJson(blankProgram()));
  assert.equal(isProgramJson(null), false);
  assert.equal(isProgramJson([]), false);
  assert.equal(isProgramJson({ blocks: 5 }), false);
  assert.equal(isProgramJson({ variables: 'x' }), false);
});

test('blocks are counted without the white bubbles', () => {
  assert.equal(countBlocks(blankProgram()), 1);
  assert.equal(countBlocks(SAMPLE), 5);
  assert.equal(countBlocks({}), 0);
});

test('a program needs a hat block to do anything', () => {
  assert.ok(hasHatBlock(blankProgram()));
  assert.ok(hasHatBlock(SAMPLE));
  assert.equal(hasHatBlock({}), false);
  const loose: ProgramJson = { blocks: { blocks: [{ type: 'mbot2_straight_cm', id: 'x' }] } };
  assert.equal(hasHatBlock(loose), false);
  // "broadcast" is an Events block too, but it does not start a script
  const looseBroadcast: ProgramJson = { blocks: { blocks: [{ type: 'event_broadcast', id: 'y' }] } };
  assert.equal(hasHatBlock(looseBroadcast), false);
  assert.ok(hasHatBlock(program([script(whenButton('b'), [])])), 'a button hat counts');
});

test('a program has something to run once a block is snapped under a hat block', () => {
  assert.equal(hasRunnableScript(blankProgram()), false, 'the yellow block alone does nothing');
  assert.equal(hasRunnableScript({}), false);
  assert.ok(hasRunnableScript(SAMPLE));
  assert.ok(hasRunnableScript(program([script(whenButton('a'), [moveCm('forward', 5)])])), 'a button script counts');
  // blocks that hang under nothing never run
  const loose: ProgramJson = { blocks: { blocks: [{ type: 'mbot2_straight_cm', id: 'x', next: { block: { type: 'mbot2_straight_cm', id: 'y' } } }] } };
  assert.equal(hasRunnableScript(loose), false);
  // one empty hat next to a full one
  assert.ok(hasRunnableScript(program([script(whenStart(), []), script(whenButton('b'), [moveCm('backward', 5)])])));
});

test('the blank program is a valid program that ends at once', () => {
  const sim = createSimulation({
    game: fireRescueGame,
    scenario: fireRescueGame.defaultScenario(),
    robotConfig: DEFAULT_ROBOT_CONFIG,
    program: blankProgram(),
    startPose: startPoseFor(DEFAULT_ROBOT_CONFIG),
  });
  sim.start();
  sim.step(50);
  assert.equal(sim.status, 'finished');
  assert.equal(sim.finishReason, 'program-ended');
  assert.deepEqual(sim.vm.errors(), []);
});

test('download names are safe file names', () => {
  assert.equal(programFileName('fire-rescue', new Date('2027-03-14T10:00:00Z')), 'fire-rescue-program-2027-03-14.json');
  assert.equal(programFileName('a b/c', new Date('2027-01-02T00:00:00Z')), 'a-b-c-program-2027-01-02.json');
});

test('storage keys are separate per game', () => {
  assert.equal(storageKey('fire-rescue', 'workspace'), 'mbot2-sim:fire-rescue:workspace');
  assert.notEqual(storageKey('a', 'workspace'), storageKey('b', 'workspace'));
  assert.ok(isRecord({}));
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
});

// =============================================================================================
// Placing the robot
// =============================================================================================

const ROBOT = DEFAULT_ROBOT_CONFIG;

test('the centred pose fits the Fire Station when the robot faces up, right, down or left', () => {
  for (const degrees of [0, 90, 180, 270]) {
    const pose = centredPose(ROBOT, FIRE_STATION, degrees * DEG);
    assert.ok(poseFits(ROBOT, FIRE_STATION, pose), `heading ${degrees}`);
    const box = robotBounds(ROBOT, pose);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    assert.ok(Math.abs(cx - (FIRE_STATION.x + FIRE_STATION.w / 2)) < 1e-6);
    assert.ok(Math.abs(cy - (FIRE_STATION.y + FIRE_STATION.h / 2)) < 1e-6);
  }
});

test('facing up, the centred pose is the game\'s own start pose', () => {
  const mine = centredPose(ROBOT, FIRE_STATION, 0);
  const theirs = startPoseFor(ROBOT);
  assert.ok(Math.abs(mine.x - theirs.x) < 1e-6);
  assert.ok(Math.abs(mine.y - theirs.y) < 1e-6);
  assert.equal(mine.heading, 0);
});

test('the default robot also fits diagonally in the Fire Station, but not at every angle', () => {
  // The robot is 237 mm long, but its gripper end is only 80 mm wide: turned by 45 degrees its
  // corners are about 242 mm apart in both directions, which is still inside the 250 mm square.
  const diagonal = centredPose(ROBOT, FIRE_STATION, 45 * DEG);
  assert.ok(poseFits(ROBOT, FIRE_STATION, diagonal));
  const box = robotBounds(ROBOT, diagonal);
  assert.ok(box.maxX - box.minX < FIRE_STATION.w && box.maxY - box.minY < FIRE_STATION.h);

  // In between (about 9..39 degrees away from straight) one of its sides is longer than 250 mm.
  // The centred pose is the best possible one, so at these angles the robot fits nowhere.
  for (const degrees of [20, 70, 110, 200, 290, 340]) {
    const pose = centredPose(ROBOT, FIRE_STATION, degrees * DEG);
    assert.equal(poseFits(ROBOT, FIRE_STATION, pose), false, `heading ${degrees}`);
    const b = robotBounds(ROBOT, pose);
    assert.ok(Math.max(b.maxX - b.minX, b.maxY - b.minY) > FIRE_STATION.w, `heading ${degrees}`);
  }
});

test('turning the robot moves it to the middle when it would otherwise stick out', () => {
  // pushed against the left edge, facing up: legal
  const left = { ...centredPose(ROBOT, FIRE_STATION, 0), x: FIRE_STATION.x + ROBOT.chassisWidth / 2 };
  assert.ok(poseFits(ROBOT, FIRE_STATION, left));
  const turned = rotatedPose(ROBOT, FIRE_STATION, left, 90 * DEG);
  assert.ok(turned.legal);
  assert.ok(poseFits(ROBOT, FIRE_STATION, turned.pose));
  assert.ok(Math.abs(turned.pose.heading - 90 * DEG) < 1e-9);

  // a small turn in the middle keeps the position
  const centre = centredPose(ROBOT, FIRE_STATION, 0);
  const small = rotatedPose(ROBOT, FIRE_STATION, centre, 3 * DEG);
  assert.ok(small.legal);
  assert.equal(small.pose.x, centre.x);
  assert.equal(small.pose.y, centre.y);

  // an angle that never fits is reported, with the old position kept
  const bad = rotatedPose(ROBOT, FIRE_STATION, centre, 20 * DEG);
  assert.equal(bad.legal, false);
  assert.equal(bad.pose.x, centre.x);
  assert.equal(bad.pose.y, centre.y);
  assert.ok(Math.abs(bad.pose.heading - 20 * DEG) < 1e-9);

  // from that not-allowed pose, turning on to the diagonal finds a place again (in the middle)
  const diagonal = rotatedPose(ROBOT, FIRE_STATION, bad.pose, 45 * DEG);
  assert.ok(diagonal.legal);
  assert.ok(poseFits(ROBOT, FIRE_STATION, diagonal.pose));
});

test('poseFits agrees with the engine about what is allowed', () => {
  const sim = createSimulation({
    game: fireRescueGame,
    scenario: fireRescueGame.defaultScenario(),
    robotConfig: ROBOT,
    program: {},
    startPose: startPoseFor(ROBOT),
  });
  // A fixed grid of poses around the middle of the Fire Station (no random numbers, so the test
  // cannot pass or fail by luck): small shifts are allowed, large ones are not, and some
  // headings are never allowed.
  const headings = [0, 3, 45, 90, 135, 180, 225, 270, 315, 357, 20, 110];
  const shifts = [-60, -20, -5, 0, 5, 20, 60];
  let allowed = 0;
  let refused = 0;
  for (const degrees of headings) {
    const centre = centredPose(ROBOT, FIRE_STATION, degrees * DEG);
    for (const dx of shifts) {
      for (const dy of shifts) {
        const pose = { x: centre.x + dx, y: centre.y + dy, heading: centre.heading };
        const mine = poseFits(ROBOT, FIRE_STATION, pose);
        const label = `heading ${degrees}, shifted by ${dx}, ${dy}`;
        assert.equal(mine, robotFitsInRect(ROBOT, pose, FIRE_STATION), label);
        assert.equal(sim.setStartPose(pose), mine, label);
        if (mine) allowed++;
        else refused++;
      }
    }
    // the middle is allowed exactly at the headings the robot can stand at
    assert.equal(poseFits(ROBOT, FIRE_STATION, centre), degrees !== 20 && degrees !== 110, `heading ${degrees}, centred`);
  }
  assert.ok(allowed >= 30, `only ${allowed} allowed poses`);
  assert.ok(refused >= 30, `only ${refused} refused poses`);
  assert.equal(poseFits(ROBOT, FIRE_STATION, { x: Number.NaN, y: 0, heading: 0 }), false);
  assert.equal(sim.setStartPose({ x: Number.NaN, y: 0, heading: 0 }), false);
});

test('headings are shown as 0..359 degrees', () => {
  assert.equal(headingDegrees(0), 0);
  assert.equal(headingDegrees(90 * DEG), 90);
  assert.equal(headingDegrees(-90 * DEG), 270);
  assert.equal(headingDegrees(Math.PI), 180);
  assert.equal(headingDegrees(-0.0001), 0);
  assert.equal(headingDegrees(359.6 * DEG), 0);
  assert.equal(headingDegrees(-359.6 * DEG), 0);
  assert.equal(headingDegrees(725 * DEG), 5);
  // never "-0": Object.is tells 0 and -0 apart, which a plain comparison does not
  for (const heading of [-0.0001, -0, -360 * DEG, 359.6 * DEG, -359.6 * DEG]) {
    assert.ok(Object.is(headingDegrees(heading), 0), `heading ${heading}`);
  }
});

test('isPose only accepts three finite numbers', () => {
  assert.ok(isPose({ x: 1, y: 2, heading: 0 }));
  assert.equal(isPose({ x: 1, y: 2 }), false);
  assert.equal(isPose({ x: '1', y: 2, heading: 0 }), false);
  assert.equal(isPose({ x: 1, y: Number.NaN, heading: 0 }), false);
  assert.equal(isPose(null), false);
});

// =============================================================================================
// Driven path
// =============================================================================================

test('the path stores a point only after the robot has moved a little', () => {
  const trail = new Trail();
  assert.equal(trail.add(100, 100), true);
  assert.equal(trail.add(101, 101), false);
  assert.equal(trail.add(103, 103), true);
  assert.equal(trail.add(Number.NaN, 0), false);
  assert.equal(trail.length, 2);
  assert.deepEqual([...trail.points], [100, 100, 103, 103]);
});

test('a restart breaks the path, and clear empties it', () => {
  const trail = new Trail();
  trail.breakLine();
  assert.equal(trail.length, 0, 'nothing to break yet');
  trail.add(0, 0);
  trail.add(10, 0);
  trail.breakLine();
  trail.breakLine();
  assert.equal(trail.length, 3, 'only one gap marker');
  assert.equal(trail.add(10.5, 0), true, 'the first point after a gap is always stored');
  assert.ok(Number.isNaN(trail.points[4]));
  const before = trail.version;
  trail.clear();
  assert.equal(trail.length, 0);
  assert.ok(trail.version > before);
});

test('a very long path forgets its oldest points', () => {
  const trail = new Trail();
  for (let i = 0; i < 40000; i++) trail.add(i * 5, 0);
  assert.equal(trail.length, 30000);
  assert.equal(trail.points[trail.points.length - 2], 39999 * 5);
});

// =============================================================================================
// Stage geometry
// =============================================================================================

test('the mat is fitted into the canvas, centred, on whole device pixels', () => {
  for (const [w, h, dpr] of [[504, 504, 1], [651, 651, 2], [437.5, 600, 1.5], [800, 300, 3]] as const) {
    const view = fitView(w, h, 1250, 1250, dpr);
    const matPixels = 1250 * view.scale * view.dpr;
    assert.ok(Math.abs(matPixels - Math.round(matPixels)) < 1e-6, 'whole number of device pixels');
    assert.ok(Math.abs(view.originX * view.dpr - Math.round(view.originX * view.dpr)) < 1e-6);
    assert.ok(view.originX >= 0 && view.originY >= 0);
    assert.ok(view.originX + 1250 * view.scale <= w + 1e-6);
    assert.ok(view.originY + 1250 * view.scale <= h + 1e-6);
    // the mat is in the middle
    assert.ok(Math.abs(view.originX - (w - 1250 * view.scale) / 2) <= 1 / dpr);
    assert.ok(Math.abs(view.originY - (h - 1250 * view.scale) / 2) <= 1 / dpr);
  }
});

test('a point on the screen maps back to the mat', () => {
  const view = fitView(600, 600, 1250, 1250, 2);
  const corner = viewToMat(view, view.originX, view.originY);
  assert.ok(Math.abs(corner.x) < 1e-9 && Math.abs(corner.y) < 1e-9);
  const centre = viewToMat(view, view.originX + 625 * view.scale, view.originY + 625 * view.scale);
  assert.ok(Math.abs(centre.x - 625) < 1e-9 && Math.abs(centre.y - 625) < 1e-9);
});

test('the pointer grabs the robot anywhere on its body or gripper, not beside it', () => {
  const pose = { x: 625, y: 673, heading: 0 };
  assert.ok(robotHit(ROBOT, pose, { x: 625, y: 673 }));
  assert.ok(robotHit(ROBOT, pose, { x: 625, y: 673 - 160 }), 'between the fingers');
  assert.ok(robotHit(ROBOT, pose, { x: 625 + 60, y: 673 + 65 }), 'rear corner');
  assert.equal(robotHit(ROBOT, pose, { x: 625 + 80, y: 673 }), false);
  assert.ok(robotHit(ROBOT, pose, { x: 625 + 80, y: 673 }, 20), 'with tolerance');
  assert.equal(robotHit(ROBOT, pose, { x: 625, y: 673 + 90 }), false, 'behind the robot');
  // turned to the right, the gripper is to the right
  const right = { x: 625, y: 625, heading: 90 * DEG };
  assert.ok(robotHit(ROBOT, right, { x: 625 + 160, y: 625 }));
  assert.equal(robotHit(ROBOT, right, { x: 625, y: 625 - 160 }), false);
});

test('zone names never run into each other, however small the stage is', () => {
  const zones = fireRescueGame.overlays(fireRescueGame.defaultScenario());
  // from a phone (about 0.25 screen pixels per mm) to a large monitor (about 0.75)
  for (const pixelsPerMm of [0.25, 0.36, 0.46, 0.6, 0.75]) {
    const fontSize = 10 / pixelsPerMm;
    const gap = 5 / pixelsPerMm;
    // bold letters are roughly 0.62 of the font size wide
    const textWidth = (label: string): number => label.length * fontSize * 0.62;
    const places = placeZoneLabels(zones, textWidth, fontSize, gap);
    assert.equal(places.length, zones.length);
    const boxes = places.map((place, i) => {
      const half = textWidth(zones[i].label) / 2;
      const top = place.below ? zones[i].rect.y + zones[i].rect.h + gap : zones[i].rect.y - gap - fontSize;
      return { left: place.x - half, right: place.x + half, top, bottom: top + fontSize };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = a.right + fontSize <= b.left || b.right + fontSize <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        assert.ok(apart, `"${zones[i].label}" and "${zones[j].label}" overlap at ${pixelsPerMm} px/mm`);
      }
    }
    // the two squares of a building are 110 mm apart: on a small stage their names are wider
    // than that, so one goes above its square and the other below; on a large stage both fit above
    for (const building of ['A', 'B', 'C', 'D']) {
      const pickup = zones.findIndex((z) => z.id === `pickup:${building}`);
      const delivery = zones.findIndex((z) => z.id === `delivery:${building}`);
      // (side by side they need a clear space of one letter height between them)
      const sideBySide = (textWidth(zones[pickup].label) + textWidth(zones[delivery].label)) / 2 + fontSize <= 110;
      assert.equal(places[pickup].below !== places[delivery].below, !sideBySide, `building ${building} at ${pixelsPerMm} px/mm`);
    }
  }
});

test('a zone name stays above its area when nothing is in the way', () => {
  const zones = [
    { label: 'W1', rect: { x: 100, y: 100, w: 70, h: 70 } },
    { label: 'W2', rect: { x: 500, y: 100, w: 70, h: 70 } },
  ];
  const places = placeZoneLabels(zones, (label) => label.length * 12, 20, 10);
  assert.deepEqual(places.map((p) => p.below), [false, false]);
  assert.equal(places[0].x, 135);
  assert.equal(places[0].y, 90, 'the text baseline sits `gap` above the area');
});

// =============================================================================================
// How large a freshly loaded program is shown in the block workspace
// =============================================================================================

/** The editor of the tests: normal zoom 0.75, never smaller than 0.6, 48 px kept free each way. */
function fitScale(contentWidth: number, contentHeight: number, viewWidth: number, viewHeight: number): number {
  return programFitScale({ contentWidth, contentHeight, viewWidth, viewHeight, marginX: 48, marginY: 48, defaultScale: 0.75, minScale: 0.6 });
}

test('a loaded program that fits the editor is shown at the normal size, never larger', () => {
  // "Hello, mBot2" (427 x 413 units) in the editor of a 1366 x 768 laptop (607 x 675 px)
  assert.equal(fitScale(427, 413, 607, 675), 0.75);
  // a single block in a huge editor is not blown up
  assert.equal(fitScale(100, 50, 3000, 2000), 0.75);
  // an empty workspace, or an editor that has no size yet
  assert.equal(fitScale(0, 0, 607, 675), 0.75);
  assert.equal(fitScale(427, 413, 0, 0), 0.75);
  assert.equal(fitScale(427, 413, 40, 675), 0.75);
});

test('a loaded program that is a little too large is made smaller until all of it shows', () => {
  // "Deliver one bucket" (375 x 955 units) is 69 px too tall for that laptop at the normal size
  const scale = fitScale(375, 955, 607, 675);
  assert.ok(scale < 0.75 && scale >= 0.6, `scale ${scale}`);
  assert.ok(955 * scale <= 675 - 48 + 1e-9, 'the whole height shows');
  assert.ok(375 * scale <= 607 - 48 + 1e-9, 'the whole width shows');
  // too wide instead of too tall
  const wide = fitScale(800, 300, 607, 675);
  assert.ok(Math.abs(800 * wide - (607 - 48)) < 1e-9, 'exactly as wide as the room allows');
});

test('a long program keeps a readable size: only its width is fitted, the student scrolls down', () => {
  // 30 blocks under each other: showing all of it would need a zoom of 0.4
  assert.equal(fitScale(375, 1600, 607, 675), 0.75);
  // long and a little too wide: small enough for the full width, not smaller
  const scale = fitScale(800, 3000, 607, 675);
  assert.ok(Math.abs(800 * scale - (607 - 48)) < 1e-9);
  assert.ok(scale >= 0.6 && scale < 0.75);
});

test('a loaded program is never shown smaller than the smallest readable size', () => {
  // "Follow the black line" (1076 x 1064 units) on an iPad (505 x 727 px) would need 0.42
  assert.equal(fitScale(1076, 1064, 505, 727), 0.6);
  assert.equal(fitScale(5000, 5000, 300, 300), 0.6);
  // a "smallest size" above the normal size makes no sense: the normal size wins
  assert.equal(programFitScale({ contentWidth: 5000, contentHeight: 50, viewWidth: 300, viewHeight: 300, marginX: 0, marginY: 0, defaultScale: 0.75, minScale: 0.9 }), 0.75);
});
