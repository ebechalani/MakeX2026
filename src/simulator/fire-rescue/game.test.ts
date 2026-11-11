import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEG, localRectToOBB, makeRng, obbCorners, pointInRect, rectCenter, type OBB } from '../core/geometry';
import type {
  Body,
  ColorName,
  RobotConfig,
  RobotState,
  ScoreContext,
  ScoreLine,
  ScoreReport,
  WheelState,
  World,
} from '../core/types';
import {
  BUCKET_DESTINATION,
  BUILDINGS,
  BUILDING_IDS,
  DASH_OUTLINE_WIDTH,
  FIRE_STATION,
  MAT_IMAGE_URL,
  MAT_SENSOR_IMAGE_URL,
  MAT_VECTOR,
  RESCUE_SQUARES,
  RESCUE_TOWER_BY_COLOR,
  RESCUE_TOWER_IDS,
  WATER_SQUARES,
  WATER_TOWER_IDS,
} from './field';
import {
  MAX_SCORE,
  TOWER_IDS,
  bucketBodyId,
  buildingSquare,
  deliverySlot,
  fireRescueGame as game,
  personBodyId,
  robotExtents,
  robotFitsStartZone,
  startPoseFor,
  towerBodyId,
  type TowerId,
} from './game';
import {
  COLORS,
  SCENARIO_COUNT,
  decodeScenario,
  defaultScenario,
  encodeScenario,
  randomScenario,
  type FireRescueScenario,
} from './scenario';

// ---------------------------------------------------------------------------------------------
// Test helpers: a hand-made robot, world and referee context
// ---------------------------------------------------------------------------------------------

/** An mBot2-like robot: chassis 105 mm ahead / 75 mm behind the axle, gripper reaching 170 mm ahead. */
const ROBOT: RobotConfig = {
  chassisFront: 105,
  chassisRear: 75,
  chassisWidth: 150,
  chassisHeight: 90,
  wheelDiameter: 64,
  trackWidth: 130,
  maxRpm: 200,
  rpmPerSecond: 600,
  servoSpeed: 300,
  quadRgb: { forward: 60, probeOffsets: [-24, -8, 8, 24], spotRadius: 3, lineThreshold: 50 },
  ultrasonic: { forward: 100, height: 40, minRangeCm: 3, maxRangeCm: 300, halfAngleDeg: 10 },
  frontColorSensor: { enabled: false, rangeMm: 40 },
  gripper: {
    enabled: true,
    liftServo: 'S1',
    clawServo: 'S2',
    liftDownAngle: 0,
    liftUpAngle: 90,
    liftDownHeight: 5,
    liftUpHeight: 70,
    clawOpenAngle: 0,
    clawClosedAngle: 90,
    clawOpenGap: 70,
    clawClosedGap: 30,
    gripForward: 140,
    fingerLength: 60,
    fingerThickness: 10,
    fingerHeight: 20,
  },
  noise: { wheelSlip: 0, sensor: 0, ultrasonicCm: 0 },
};

function robotState(): RobotState {
  const wheel = (): WheelState => ({ mode: 'stop', targetRpm: 0, rpm: 0, power: 0, angleDeg: 0 });
  const servo = () => ({ angle: 0, target: 0 });
  return {
    pose: { ...game.defaultStartPose },
    left: wheel(),
    right: wheel(),
    servos: { S1: servo(), S2: servo(), S3: servo(), S4: servo() },
    gripper: { height: 5, gap: 70, holding: null },
    yawDeg: 0,
    leds: [],
    screen: { lines: [], labels: [] },
    touching: false,
    lastUltrasonicCm: 300,
  };
}

function scenarioFromCode(code: string): FireRescueScenario {
  const s = decodeScenario(code);
  assert.ok(s, `bad combination code ${code}`);
  return s;
}

function makeWorld(s: FireRescueScenario): World {
  return { time: 0, tick: 0, robot: robotState(), bodies: game.createBodies(s) };
}

interface Extra {
  restarts?: number;
  robotShapes?: OBB[];
}

function scoreOf(world: World, s: FireRescueScenario, extra: Extra = {}): ScoreReport {
  const ctx: ScoreContext<FireRescueScenario> = {
    scenario: s,
    world,
    robotConfig: ROBOT,
    restarts: extra.restarts ?? 0,
    robotShapes: extra.robotShapes ?? [],
  };
  return game.score(ctx);
}

function body(world: World, id: string): Body {
  const b = world.bodies.find((x) => x.id === id);
  assert.ok(b, `no body ${id}`);
  return b;
}

function line(report: ScoreReport, id: string): ScoreLine {
  const l = report.lines.find((x) => x.id === id);
  assert.ok(l, `no score line ${id}`);
  return l;
}

/** Stand a body directly on the mat. */
function putOnMat(world: World, id: string, x: number, y: number, angle = 0): void {
  const b = body(world, id);
  Object.assign(b, { x, y, angle, z: 0, restingOn: null, held: false });
}

/** Stand a body on top of a tower, optionally off-centre. */
function putOnTower(world: World, id: string, tower: TowerId, dx = 0, dy = 0): void {
  const t = body(world, towerBodyId(tower));
  const b = body(world, id);
  Object.assign(b, { x: t.x + dx, y: t.y + dy, angle: 0, z: t.z + t.h, restingOn: t.id, held: false });
}

/** Slide a tower (and whatever stands on it) across the mat. */
function moveTower(world: World, tower: TowerId, dx: number, dy: number): void {
  const t = body(world, towerBodyId(tower));
  for (const b of world.bodies) {
    if (b === t || b.restingOn === t.id) {
      b.x += dx;
      b.y += dy;
    }
  }
}

/** Centre of the water delivery square of the building that wants this bucket colour. */
function deliveryCentre(s: FireRescueScenario, color: ColorName) {
  const building = BUCKET_DESTINATION[color];
  return rectCenter(buildingSquare(building, deliverySlot(s, building)));
}

function deliverBucket(world: World, s: FireRescueScenario, color: ColorName): void {
  const c = deliveryCentre(s, color);
  putOnMat(world, bucketBodyId(color), c.x, c.y);
}

function rescuePerson(world: World, color: ColorName): void {
  putOnTower(world, personBodyId(color), RESCUE_TOWER_BY_COLOR[color]);
}

/** Do all eight missions by hand. */
function finishEverything(world: World, s: FireRescueScenario): void {
  for (const color of COLORS) {
    deliverBucket(world, s, color);
    rescuePerson(world, color);
  }
}

const missionLines = (report: ScoreReport) =>
  report.lines.filter((l) => l.id.startsWith('bucket:') || l.id.startsWith('person:'));

// ---------------------------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------------------------

test('game describes the Fire Rescue mat, clock and start zone', () => {
  assert.equal(game.id, 'fire-rescue');
  assert.deepEqual(game.mat, {
    width: 1250,
    height: 1250,
    imageUrl: MAT_IMAGE_URL,
    sensorImageUrl: MAT_SENSOR_IMAGE_URL,
    vector: MAT_VECTOR,
  });
  assert.equal(game.matchDuration, 180);
  assert.equal(game.startZone, FIRE_STATION);
  assert.equal(game.restartPenalty, 5);
  assert.equal(MAX_SCORE, 180);
  assert.equal(game.defaultStartPose.heading, 0);
  assert.ok(pointInRect(game.defaultStartPose, FIRE_STATION), 'default start pose is inside the Fire Station');
});

test('the default start pose keeps a 105/75 mm chassis with a 170 mm gripper reach inside the Fire Station', () => {
  const p = game.defaultStartPose;
  const outline = localRectToOBB(p, -75, 170, -75, 75);
  for (const c of obbCorners(outline)) assert.ok(pointInRect(c, FIRE_STATION), `corner ${c.x},${c.y} is outside`);
});

test('startPoseFor centres the whole robot (chassis + open gripper) in the Fire Station, facing up', () => {
  const ext = robotExtents(ROBOT);
  assert.deepEqual(ext, { front: 170, rear: 75, halfWidth: 75 });
  assert.ok(robotFitsStartZone(ROBOT));

  const p = startPoseFor(ROBOT);
  assert.equal(p.heading, 0);
  const corners = obbCorners(localRectToOBB(p, -ext.rear, ext.front, -ext.halfWidth, ext.halfWidth));
  for (const c of corners) assert.ok(pointInRect(c, FIRE_STATION), `corner ${c.x},${c.y} is outside`);
  const top = Math.min(...corners.map((c) => c.y)) - FIRE_STATION.y;
  const bottom = FIRE_STATION.y + FIRE_STATION.h - Math.max(...corners.map((c) => c.y));
  const left = Math.min(...corners.map((c) => c.x)) - FIRE_STATION.x;
  const right = FIRE_STATION.x + FIRE_STATION.w - Math.max(...corners.map((c) => c.x));
  assert.ok(Math.abs(top - bottom) < 1e-9, 'same room in front and behind');
  assert.ok(Math.abs(left - right) < 1e-9, 'same room left and right');

  // without a gripper only the chassis counts
  const bare: RobotConfig = { ...ROBOT, gripper: { ...ROBOT.gripper, enabled: false } };
  assert.deepEqual(robotExtents(bare), { front: 105, rear: 75, halfWidth: 75 });
  assert.ok(Math.abs(startPoseFor(bare).y - (rectCenter(FIRE_STATION).y + 15)) < 1e-9);

  // a robot that is too long cannot start legally
  const long: RobotConfig = { ...ROBOT, gripper: { ...ROBOT.gripper, gripForward: 170 } };
  assert.equal(robotFitsStartZone(long), false);
});

test('scenario functions delegate to scenario.ts', () => {
  const s = game.defaultScenario();
  assert.deepEqual(s, defaultScenario());
  assert.equal(game.scenarioCount(), SCENARIO_COUNT);
  assert.equal(game.encodeScenario(s), encodeScenario(s));
  assert.deepEqual(game.decodeScenario('RGBY-A1R-B1B-C1Y-D1G'), s);
  assert.equal(game.decodeScenario('nonsense'), null);
  assert.deepEqual(game.randomScenario(makeRng(3)), randomScenario(makeRng(3)));
  assert.match(game.describeScenario(s), /Buckets: W1 red/);
});

// ---------------------------------------------------------------------------------------------
// Bodies and overlays
// ---------------------------------------------------------------------------------------------

test('createBodies puts every element on its starting position', () => {
  const s = scenarioFromCode('YBRG-A2G-B1R-C2B-D1Y');
  const bodies = game.createBodies(s);
  assert.equal(bodies.length, 16);
  assert.equal(new Set(bodies.map((b) => b.id)).size, 16, 'ids are unique');
  const get = (id: string) => {
    const b = bodies.find((x) => x.id === id);
    assert.ok(b, `no body ${id}`);
    return b;
  };

  for (const id of WATER_TOWER_IDS) {
    const t = get(`tower:${id}`);
    const c = rectCenter(WATER_SQUARES[id]);
    assert.equal(t.kind, 'water-tower');
    assert.equal(t.label, id);
    assert.deepEqual([t.x, t.y, t.z, t.w, t.l, t.h], [c.x, c.y, 0, 70, 70, 50]);
    assert.deepEqual([t.platform, t.grippable, t.held, t.restingOn], [true, false, false, null]);
    assert.ok(t.mass > 1, 'towers are heavier than objects');

    const color = s.buckets[id];
    const b = get(`bucket:${color}`);
    assert.equal(b.kind, 'bucket');
    assert.equal(b.colorName, color);
    assert.deepEqual([b.x, b.y, b.z, b.w, b.l, b.h], [c.x, c.y, 50, 40, 40, 40]);
    assert.deepEqual([b.platform, b.grippable, b.held, b.restingOn], [false, true, false, `tower:${id}`]);
  }
  assert.equal(get('bucket:yellow').restingOn, 'tower:W1');

  for (const id of RESCUE_TOWER_IDS) {
    const t = get(`tower:${id}`);
    const c = rectCenter(RESCUE_SQUARES[id].rect);
    assert.equal(t.kind, 'rescue-tower');
    assert.deepEqual([t.x, t.y, t.z, t.w, t.l, t.h], [c.x, c.y, 0, 70, 70, 50]);
    assert.deepEqual([t.platform, t.grippable, t.restingOn], [true, false, null]);
    // rescue towers start empty
    assert.ok(!bodies.some((b) => b.restingOn === t.id));
  }

  for (const building of BUILDING_IDS) {
    const { slot, color } = s.people[building];
    const p = get(`person:${color}`);
    const c = rectCenter(BUILDINGS[building].squares[slot - 1]);
    assert.equal(p.kind, 'person');
    assert.equal(p.colorName, color);
    assert.deepEqual([p.x, p.y, p.z, p.w, p.l, p.h], [c.x, c.y, 0, 40, 40, 60]);
    assert.deepEqual([p.platform, p.grippable, p.held, p.restingOn], [false, true, false, null]);
  }
  // the green person waits in the RIGHT square of building A in this combination
  assert.deepEqual(rectCenter(BUILDINGS.A.squares[1]), { x: get('person:green').x, y: get('person:green').y });

  for (const b of bodies) {
    assert.deepEqual(b.home, { x: b.x, y: b.y, angle: b.angle, z: b.z, restingOn: b.restingOn }, `${b.id} home`);
    assert.match(b.fill, /^#[0-9a-f]{6}$/);
  }
  // every kind of element of every colour has its own fill
  assert.equal(new Set(bodies.filter((b) => b.kind !== 'water-tower').map((b) => b.fill)).size, 12);
});

test('overlays show the start zone, tower areas and each building\'s person and water squares', () => {
  const s = scenarioFromCode('YBRG-A2G-B1R-C2B-D1Y');
  const ov = game.overlays(s);
  assert.equal(ov.length, 1 + 4 + 8 + 4);
  assert.equal(new Set(ov.map((o) => o.id)).size, ov.length);

  const start = ov.filter((o) => o.kind === 'start');
  assert.equal(start.length, 1);
  assert.deepEqual(start[0].rect, FIRE_STATION);

  const areas = ov.filter((o) => o.kind === 'tower-area');
  assert.deepEqual(areas.map((o) => o.label).sort(), [...TOWER_IDS].sort());
  assert.deepEqual(areas.find((o) => o.label === 'W3')?.rect, WATER_SQUARES.W3);
  assert.deepEqual(areas.find((o) => o.label === 'RB')?.rect, RESCUE_SQUARES.RB.rect);

  const pickups = ov.filter((o) => o.kind === 'pickup');
  const deliveries = ov.filter((o) => o.kind === 'delivery');
  assert.deepEqual(pickups.map((o) => o.label), ['A2 person', 'B1 person', 'C2 person', 'D1 person']);
  assert.deepEqual(deliveries.map((o) => o.label), ['A1 water', 'B2 water', 'C1 water', 'D2 water']);
  assert.deepEqual(pickups[0].rect, BUILDINGS.A.squares[1]);
  assert.deepEqual(deliveries[0].rect, BUILDINGS.A.squares[0]);
});

// ---------------------------------------------------------------------------------------------
// Referee
// ---------------------------------------------------------------------------------------------

test('the starting field scores 0: eight open missions, no penalties', () => {
  const s = defaultScenario();
  const r = scoreOf(makeWorld(s), s);
  assert.equal(r.total, 0);
  assert.equal(r.max, 180);
  assert.equal(r.complete, false);
  assert.deepEqual(
    r.lines.map((l) => l.id),
    [
      'bucket:red',
      'bucket:green',
      'bucket:blue',
      'bucket:yellow',
      'person:red',
      'person:green',
      'person:blue',
      'person:yellow',
      'bonus',
      'restarts',
      'towers-outside',
    ],
  );
  const missions = missionLines(r);
  assert.equal(missions.length, 8);
  for (const l of missions) {
    assert.deepEqual([l.ok, l.points, l.max], [false, 0, 20], l.id);
    assert.ok(l.detail.length > 0);
  }
  assert.deepEqual([line(r, 'bonus').ok, line(r, 'bonus').points, line(r, 'bonus').max], [false, 0, 20]);
  for (const id of ['restarts', 'towers-outside']) {
    const l = line(r, id);
    assert.deepEqual([l.ok, l.points, l.max], [true, 0, 0], id);
  }
  // the details tell the student what is missing
  assert.match(line(r, 'bucket:green').detail, /still on water tower W2/);
  assert.match(line(r, 'bucket:green').detail, /D2/);
  assert.match(line(r, 'person:blue').detail, /building B \(B1\)/);
  assert.match(line(r, 'person:blue').detail, /RB/);
  assert.match(line(r, 'bonus').detail, /0 of 8/);
});

test('every single mission is worth 20 points', () => {
  const s = defaultScenario();
  for (const color of COLORS) {
    const w1 = makeWorld(s);
    deliverBucket(w1, s, color);
    const r1 = scoreOf(w1, s);
    assert.equal(r1.total, 20, `${color} bucket`);
    assert.deepEqual([line(r1, `bucket:${color}`).ok, line(r1, `bucket:${color}`).points], [true, 20]);
    assert.equal(missionLines(r1).filter((l) => l.ok).length, 1);

    const w2 = makeWorld(s);
    rescuePerson(w2, color);
    const r2 = scoreOf(w2, s);
    assert.equal(r2.total, 20, `${color} person`);
    assert.deepEqual([line(r2, `person:${color}`).ok, line(r2, `person:${color}`).points], [true, 20]);
    assert.equal(missionLines(r2).filter((l) => l.ok).length, 1);
  }
});

test('all eight missions plus the bonus make 180', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  finishEverything(world, s);
  const r = scoreOf(world, s);
  assert.equal(r.total, 180);
  assert.equal(r.complete, true);
  assert.ok(r.lines.every((l) => l.ok));
  assert.equal(line(r, 'bonus').points, 20);
  assert.equal(
    r.lines.reduce((sum, l) => sum + l.max, 0),
    180,
  );
});

test('random combinations: 0 at the start, 180 when everything is done', () => {
  const rng = makeRng(2027);
  for (let i = 0; i < 60; i++) {
    const s = randomScenario(rng);
    const world = makeWorld(s);
    assert.equal(scoreOf(world, s).total, 0, encodeScenario(s));
    finishEverything(world, s);
    const r = scoreOf(world, s);
    assert.equal(r.total, 180, encodeScenario(s));
    assert.equal(r.complete, true);
  }
});

test('a bucket delivered to the wrong building scores nothing', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  const c = rectCenter(buildingSquare('C', deliverySlot(s, 'C'))); // the red bucket belongs to A
  putOnMat(world, 'bucket:red', c.x, c.y);
  const r = scoreOf(world, s);
  assert.equal(r.total, 0);
  assert.equal(line(r, 'bucket:red').ok, false);
  assert.match(line(r, 'bucket:red').detail, /in C2 - wrong building/);
  assert.match(line(r, 'bucket:red').detail, /A2/);
  // ... and it does not count for the yellow bucket either
  assert.equal(line(r, 'bucket:yellow').ok, false);
});

test('a bucket in the person square of the right building scores nothing', () => {
  const s = defaultScenario(); // person in A1, water goes to A2
  const world = makeWorld(s);
  const c = rectCenter(BUILDINGS.A.squares[0]);
  putOnMat(world, 'bucket:red', c.x, c.y);
  const r = scoreOf(world, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'bucket:red').detail, /in A1 - that is the person square, deliver to A2/);

  // with the person in the other square the same spot is the delivery square
  const s2 = scenarioFromCode('RGBY-A2R-B1B-C1Y-D1G');
  const world2 = makeWorld(s2);
  putOnMat(world2, 'bucket:red', c.x, c.y);
  assert.equal(scoreOf(world2, s2).total, 20);
});

test('a bucket must be completely inside the delivery square (its dashed line included)', () => {
  const s = defaultScenario();
  const c = deliveryCentre(s, 'red');
  // a 40 mm bucket in a 60 mm square whose line is 4.9 mm thick: 10 mm + half the line of room
  const room = 10 + DASH_OUTLINE_WIDTH / 2;

  const inside = makeWorld(s);
  putOnMat(inside, 'bucket:red', c.x + room - 0.05, c.y - room + 0.05);
  assert.equal(scoreOf(inside, s).total, 20);

  const outside = makeWorld(s);
  putOnMat(outside, 'bucket:red', c.x + room + 0.2, c.y);
  const r = scoreOf(outside, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'bucket:red').detail, /partly outside A2/);

  // a turned bucket needs more room: its corners stick out further
  const turned = makeWorld(s);
  putOnMat(turned, 'bucket:red', c.x, c.y, 45 * DEG);
  assert.equal(scoreOf(turned, s).total, 20);
  putOnMat(turned, 'bucket:red', c.x + 6, c.y, 45 * DEG);
  assert.equal(scoreOf(turned, s).total, 0);

  // next to the building but not in a square
  const near = makeWorld(s);
  putOnMat(near, 'bucket:red', c.x, c.y + 90);
  assert.match(line(scoreOf(near, s), 'bucket:red').detail, /at building A but not inside the water square A2/);

  // somewhere on the mat
  const away = makeWorld(s);
  putOnMat(away, 'bucket:red', 625, 300);
  assert.match(line(scoreOf(away, s), 'bucket:red').detail, /not delivered yet - take it to A2/);
});

test('a bucket must stand on the mat, not on a tower or in the air', () => {
  const s = defaultScenario();
  const c = deliveryCentre(s, 'red');

  const lifted = makeWorld(s);
  putOnMat(lifted, 'bucket:red', c.x, c.y);
  body(lifted, 'bucket:red').z = 12;
  assert.equal(scoreOf(lifted, s).total, 0);

  const onRescueTower = makeWorld(s);
  putOnTower(onRescueTower, 'bucket:red', 'RR');
  const r = scoreOf(onRescueTower, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'bucket:red').detail, /on rescue tower RR/);

  const onOtherWaterTower = makeWorld(s);
  putOnMat(onOtherWaterTower, 'bucket:green', 625, 300);
  putOnTower(onOtherWaterTower, 'bucket:red', 'W2');
  assert.match(line(scoreOf(onOtherWaterTower, s), 'bucket:red').detail, /^on water tower W2/);
});

test('a bucket that still touches the robot scores nothing', () => {
  const s = defaultScenario();
  const c = deliveryCentre(s, 'red');
  const world = makeWorld(s);
  putOnMat(world, 'bucket:red', c.x, c.y);
  const finger = (gap: number): OBB => ({ x: c.x - 20 - gap - 5, y: c.y, w: 10, l: 60, angle: 0 });

  // a finger overlapping the bucket, and one just 0.3 mm away, both count as touching
  for (const shape of [finger(-3), finger(0.3)]) {
    const r = scoreOf(world, s, { robotShapes: [shape] });
    assert.equal(r.total, 0);
    assert.match(line(r, 'bucket:red').detail, /inside A2 but still touching the robot/);
  }
  // once the robot has moved away it counts
  assert.equal(scoreOf(world, s, { robotShapes: [finger(1), finger(40)] }).total, 20);

  // gripped: no points, whatever the shapes say
  body(world, 'bucket:red').held = true;
  const held = scoreOf(world, s);
  assert.equal(held.total, 0);
  assert.match(line(held, 'bucket:red').detail, /still holding/);
  body(world, 'bucket:red').held = false;
  world.robot.gripper.holding = 'bucket:red';
  assert.equal(scoreOf(world, s).total, 0);
});

test('a person on the wrong tower scores nothing', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  putOnTower(world, 'person:green', 'RB');
  const r = scoreOf(world, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'person:green').detail, /on the wrong tower \(RB\)/);
  assert.match(line(r, 'person:green').detail, /RG/);
  // the blue person is not rescued by somebody else standing on its tower
  assert.equal(line(r, 'person:blue').ok, false);

  const onWater = makeWorld(s);
  putOnMat(onWater, 'bucket:red', 625, 300);
  putOnTower(onWater, 'person:green', 'W1');
  assert.match(line(scoreOf(onWater, s), 'person:green').detail, /on water tower W1/);
});

test('a person on the mat scores nothing, even right next to its tower', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  const t = body(world, 'tower:RG');
  putOnMat(world, 'person:green', t.x, t.y + 60);
  const r = scoreOf(world, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'person:green').detail, /on the mat - it must stand on top of rescue tower RG/);
});

test('only one person per tower', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  putOnTower(world, 'person:green', 'RG', -15, 0);
  putOnTower(world, 'person:red', 'RG', 15, 0);
  const r = scoreOf(world, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'person:green').detail, /more than one person/);
  assert.match(line(r, 'person:red').detail, /wrong tower \(RG\)/);
});

test("the person's whole base must be on the tower top", () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  putOnTower(world, 'person:green', 'RG', 15, -15); // flush with two edges of the 70 mm top
  assert.equal(scoreOf(world, s).total, 20);
  putOnTower(world, 'person:green', 'RG', 18, 0); // 3 mm over the edge
  const r = scoreOf(world, s);
  assert.equal(r.total, 0);
  assert.match(line(r, 'person:green').detail, /hanging over the edge of tower RG/);
});

test('a rescued person may touch nothing but its tower', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  putOnTower(world, 'person:green', 'RG', 15, 0);
  const t = body(world, 'tower:RG');

  // a bucket on the mat pushed against the tower is lower than the tower top: no contact
  putOnMat(world, 'bucket:red', t.x + 35 + 20, t.y);
  assert.equal(line(scoreOf(world, s), 'person:green').ok, true);

  // the same bucket standing on the tower top next to the person touches it
  putOnTower(world, 'bucket:red', 'RG', -25, 0);
  const r = scoreOf(world, s);
  assert.equal(line(r, 'person:green').ok, false);
  assert.match(line(r, 'person:green').detail, /touching the red bucket/);

  // the robot
  putOnTower(world, 'bucket:red', 'W1');
  const p = body(world, 'person:green');
  const touching = scoreOf(world, s, { robotShapes: [{ x: p.x, y: p.y + 30, w: 10, l: 30, angle: 0 }] });
  assert.equal(touching.total, 0);
  assert.match(line(touching, 'person:green').detail, /on tower RG but still touching the robot/);
  const movedAway = scoreOf(world, s, { robotShapes: [{ x: p.x, y: p.y + 60, w: 10, l: 30, angle: 0 }] });
  assert.equal(movedAway.total, 20);
  p.held = true;
  assert.equal(scoreOf(world, s).total, 0);
});

test('a tower completely outside its area costs 5, its person does not score and there is no bonus', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  finishEverything(world, s);
  moveTower(world, 'RG', 0, 150);
  const r = scoreOf(world, s);
  assert.equal(line(r, 'person:green').ok, false);
  assert.match(line(r, 'person:green').detail, /tower RG is completely outside its area/);
  assert.deepEqual([line(r, 'towers-outside').ok, line(r, 'towers-outside').points], [false, -5]);
  assert.match(line(r, 'towers-outside').detail, /tower RG is completely outside its area/);
  assert.equal(line(r, 'bonus').ok, false);
  assert.equal(r.complete, false);
  assert.equal(r.total, 7 * 20 - 5);
});

test('a water tower pushed completely outside costs 5 and the bonus, even with all missions done', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  finishEverything(world, s);
  moveTower(world, 'W2', 100, 0);
  moveTower(world, 'W3', -100, 0);
  const r = scoreOf(world, s);
  assert.equal(r.complete, true);
  assert.equal(line(r, 'bonus').ok, false);
  assert.match(line(r, 'bonus').detail, /towers W2, W3 are completely outside their areas/);
  assert.equal(line(r, 'towers-outside').points, -10);
  assert.equal(r.total, 160 - 10);
});

test('a tower that still touches its area is legal', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  finishEverything(world, s);
  moveTower(world, 'RG', 0, 60); // 10 mm of the base is still over the green square
  moveTower(world, 'W1', -65, 20);
  const r = scoreOf(world, s);
  assert.equal(r.total, 180);
  assert.equal(line(r, 'towers-outside').points, 0);

  // exactly on the outer edge of the dashed line still counts, one more millimetre does not
  const edge = RESCUE_SQUARES.RG.rect.y + RESCUE_SQUARES.RG.rect.h + DASH_OUTLINE_WIDTH / 2;
  const tower = body(world, 'tower:RG');
  moveTower(world, 'RG', 0, edge + 35 - tower.y);
  assert.equal(scoreOf(world, s).total, 180);
  moveTower(world, 'RG', 0, 1);
  assert.equal(scoreOf(world, s).total, 135);
});

test('every restart costs 5 points', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  finishEverything(world, s);
  const r = scoreOf(world, s, { restarts: 2 });
  assert.equal(r.total, 170);
  assert.equal(r.complete, true);
  assert.equal(line(r, 'bonus').ok, true, 'restarts do not cancel the bonus');
  assert.deepEqual([line(r, 'restarts').ok, line(r, 'restarts').points, line(r, 'restarts').max], [false, -10, 0]);
  assert.match(line(r, 'restarts').detail, /2 restarts/);
  assert.equal(line(scoreOf(world, s, { restarts: 1 }), 'restarts').points, -5);
});

test('the total is never below 0', () => {
  const s = defaultScenario();
  const world = makeWorld(s);
  const r = scoreOf(world, s, { restarts: 3 });
  assert.equal(line(r, 'restarts').points, -15);
  assert.equal(r.total, 0);

  // one bucket delivered, but every tower pushed away and two restarts: 20 - 40 - 10
  deliverBucket(world, s, 'red');
  for (const id of WATER_TOWER_IDS) body(world, towerBodyId(id)).x = 625;
  for (const id of RESCUE_TOWER_IDS) body(world, towerBodyId(id)).y = 625;
  const worst = scoreOf(world, s, { restarts: 2 });
  assert.equal(line(worst, 'bucket:red').points, 20);
  assert.equal(line(worst, 'towers-outside').points, -40);
  assert.equal(worst.total, 0);
});
