/**
 * MakeX Lebanon 2027 - Fire Rescue: the game definition and its referee.
 *
 * This file answers three questions for the rest of the simulator:
 *   1. What is on the field at the start of a match?            -> createBodies()
 *   2. Which areas should be highlighted on the mat?            -> overlays()
 *   3. How many points is the field worth right now, and why?   -> score()
 *
 * The referee follows the official scoring rules:
 *   - 20 points for every bucket standing completely inside the water delivery square of the
 *     building of its colour, directly on the mat and not touching the robot;
 *   - 20 points for every person standing on top of the rescue tower of its colour;
 *   - 20 bonus points when all eight missions are complete and every tower is legally positioned;
 *   - minus 5 for every restart, minus 5 for every tower that is completely outside its area;
 *   - the total is never below 0 and never above 180.
 *
 * Plain TypeScript only (no DOM, no React), so it also runs headless under Node.
 */
import {
  expandRect,
  obbContainsOBB,
  obbTouches,
  obbTouchesRect,
  pointInRect,
  rectCenter,
  rectContainsOBB,
  type OBB,
  type Rect,
} from '../core/geometry';
import type {
  Body,
  ColorName,
  Game,
  Pose,
  RobotConfig,
  ScoreContext,
  ScoreLine,
  ScoreReport,
  ZoneOverlay,
} from '../core/types';
import {
  BUCKET_DESTINATION,
  BUCKET_HEIGHT,
  BUCKET_SIZE,
  BUILDINGS,
  BUILDING_IDS,
  DASH_OUTLINE_WIDTH,
  FIRE_STATION,
  MAT_IMAGE_URL,
  MAT_SENSOR_IMAGE_URL,
  MAT_SIZE,
  MAT_VECTOR,
  PERSON_HEIGHT,
  PERSON_SIZE,
  RESCUE_SQUARES,
  RESCUE_TOWER_BY_COLOR,
  RESCUE_TOWER_IDS,
  TOWER_HEIGHT,
  TOWER_SIZE,
  WATER_SQUARES,
  WATER_TOWER_IDS,
  type BuildingId,
  type BuildingSlot,
  type RescueTowerId,
  type WaterTowerId,
} from './field';
import {
  COLORS,
  SCENARIO_COUNT,
  decodeScenario,
  defaultScenario,
  describeScenario,
  encodeScenario,
  randomScenario,
  type FireRescueScenario,
} from './scenario';

// =============================================================================================
// Points (rules: scoring)
// =============================================================================================

/** Points for one delivered bucket or one rescued person. */
export const MISSION_POINTS = 20;
/** Extra points when all eight missions are complete and every tower is legally positioned. */
export const BONUS_POINTS = 20;
/** Points removed for every restart. */
export const RESTART_PENALTY = 5;
/** Points removed for every tower that ends completely outside its designated area. */
export const TOWER_OUTSIDE_PENALTY = 5;
/** 4 buckets + 4 people + bonus = 180. */
export const MAX_SCORE = 8 * MISSION_POINTS + BONUS_POINTS;
/** Match length in seconds (3 minutes). */
export const MATCH_DURATION = 180;

// =============================================================================================
// Names of the game elements
// =============================================================================================

export type TowerId = WaterTowerId | RescueTowerId;
export const TOWER_IDS: TowerId[] = [...WATER_TOWER_IDS, ...RESCUE_TOWER_IDS];

export const KIND_WATER_TOWER = 'water-tower';
export const KIND_RESCUE_TOWER = 'rescue-tower';
export const KIND_BUCKET = 'bucket';
export const KIND_PERSON = 'person';

/** Body id of a tower, e.g. 'tower:W1' or 'tower:RG'. */
export const towerBodyId = (id: TowerId): string => `tower:${id}`;
/** Body id of a bucket, e.g. 'bucket:red'. */
export const bucketBodyId = (color: ColorName): string => `bucket:${color}`;
/** Body id of a person, e.g. 'person:green'. */
export const personBodyId = (color: ColorName): string => `person:${color}`;

function isWaterTowerId(id: TowerId): id is WaterTowerId {
  return (WATER_TOWER_IDS as string[]).includes(id);
}

function isTower(body: Body): boolean {
  return body.kind === KIND_WATER_TOWER || body.kind === KIND_RESCUE_TOWER;
}

// =============================================================================================
// Colours used to draw the elements
// =============================================================================================

/** The four game colours as bright CSS colours (buckets, highlighted squares). */
const GAME_COLOR_CSS: Record<ColorName, string> = {
  red: '#ef4044',
  green: '#40ad49',
  blue: '#00aeef',
  yellow: '#ffe600',
};

/** People use a deeper shade of their colour, so a person and a bucket never look the same. */
const PERSON_FILL: Record<ColorName, string> = {
  red: '#a81c22',
  green: '#1f7a2b',
  blue: '#0a6fa8',
  yellow: '#c79a00',
};

/** Rescue towers are lightly tinted with the colour of the person they are waiting for. */
const RESCUE_TOWER_FILL: Record<ColorName, string> = {
  red: '#f9c4c6',
  green: '#bfe8c5',
  blue: '#b5e3f8',
  yellow: '#fdf3a6',
};

/** Water towers: a cool grey that contrasts with all four bucket colours. */
const WATER_TOWER_FILL = '#b9c4d4';

const START_ZONE_CSS = '#dc2626';
const WATER_AREA_CSS = '#faa21a';

/** Letter drawn on buckets and people, so the colour can also be read without seeing colours. */
const COLOR_LETTER: Record<ColorName, string> = { red: 'R', green: 'G', blue: 'B', yellow: 'Y' };

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// =============================================================================================
// Areas of the mat, as the rules mean them
// =============================================================================================

/**
 * Outline thickness of the orange water tower squares (they are drawn thinner than the others;
 * same value as in MAT_VECTOR in field.ts).
 */
const WATER_OUTLINE_WIDTH = 1.8;

/**
 * The rules always say "including its boundary". The rectangles in field.ts run along the MIDDLE
 * of the printed dashed line, so the area that counts reaches half a line width further out.
 */
function includingBoundary(rect: Rect, outlineWidth: number): Rect {
  return expandRect(rect, outlineWidth / 2);
}

/** The square a building's person starts in (1 = left, 2 = right), as printed on the mat. */
export function personSlot(s: FireRescueScenario, building: BuildingId): BuildingSlot {
  return s.people[building].slot;
}

/** The other square of the building: that is where the water must be delivered. */
export function deliverySlot(s: FireRescueScenario, building: BuildingId): BuildingSlot {
  return s.people[building].slot === 1 ? 2 : 1;
}

/** One of the two white dashed squares of a building, as printed on the mat (centre of the line). */
export function buildingSquare(building: BuildingId, slot: BuildingSlot): Rect {
  return BUILDINGS[building].squares[slot - 1];
}

/** The same square as the referee measures it: the dashed line itself is part of the square. */
export function buildingSquareArea(building: BuildingId, slot: BuildingSlot): Rect {
  return includingBoundary(buildingSquare(building, slot), DASH_OUTLINE_WIDTH);
}

/** The designated area of a tower as printed on the mat (centre of the dashed line). */
export function towerSquare(id: TowerId): Rect {
  return isWaterTowerId(id) ? WATER_SQUARES[id] : RESCUE_SQUARES[id].rect;
}

/** The designated area of a tower as the referee measures it (boundary included). */
export function towerArea(id: TowerId): Rect {
  return includingBoundary(towerSquare(id), isWaterTowerId(id) ? WATER_OUTLINE_WIDTH : DASH_OUTLINE_WIDTH);
}

/** The building where the person of this colour starts in this combination. */
export function buildingOfPerson(s: FireRescueScenario, color: ColorName): BuildingId | null {
  return BUILDING_IDS.find((b) => s.people[b].color === color) ?? null;
}

/** Footprint of a body on the mat, seen from above. */
export function footprint(body: Body): OBB {
  return { x: body.x, y: body.y, w: body.w, l: body.l, angle: body.angle };
}

/**
 * A tower is legally positioned when any part of its base touches its designated area
 * (boundary included). The simulator has no tipping over, so towers are always upright.
 */
export function isTowerLegal(id: TowerId, tower: Body): boolean {
  return obbTouchesRect(footprint(tower), towerArea(id));
}

// =============================================================================================
// Where the robot starts
// =============================================================================================

/**
 * How far the whole robot reaches from its origin (the midpoint of the drive axle):
 * chassis plus, when a gripper is fitted, its fingers opened as wide as they go.
 */
export function robotExtents(config: RobotConfig): { front: number; rear: number; halfWidth: number } {
  let front = config.chassisFront;
  let halfWidth = Math.max(config.chassisWidth, config.trackWidth) / 2;
  const g = config.gripper;
  if (g.enabled) {
    // the fingers are centred on the gripping point, one on each side of the gap
    front = Math.max(front, g.gripForward + g.fingerLength / 2);
    halfWidth = Math.max(halfWidth, Math.max(g.clawOpenGap, g.clawClosedGap) / 2 + g.fingerThickness);
  }
  return { front, rear: config.chassisRear, halfWidth };
}

/** Pose facing up the mat that puts a robot reaching `front` mm ahead and `rear` mm behind in the middle of the Fire Station. */
function centredStartPose(front: number, rear: number): Pose {
  const c = rectCenter(FIRE_STATION);
  // Facing up, "ahead" is towards the top of the mat (smaller y). A robot that reaches further
  // ahead than behind must therefore stand a little below the centre to be in the middle.
  return { x: c.x, y: c.y + (front - rear) / 2, heading: 0 };
}

/**
 * Start pose for a given robot: facing up, with its whole bounding box (chassis + open gripper
 * fingers) centred in the Fire Station. If the robot is longer than the station (more than
 * 250 mm) it cannot start legally; it is still centred, sticking out equally at both ends.
 */
export function startPoseFor(config: RobotConfig): Pose {
  const { front, rear } = robotExtents(config);
  return centredStartPose(front, rear);
}

/** True when the robot placed by startPoseFor() is completely inside the Fire Station. */
export function robotFitsStartZone(config: RobotConfig): boolean {
  const { front, rear, halfWidth } = robotExtents(config);
  return front + rear <= FIRE_STATION.h + 1e-6 && 2 * halfWidth <= FIRE_STATION.w + 1e-6;
}

/**
 * Start pose used when nobody asks for a specific robot. It suits an mBot2 whose gripper reaches
 * about 170 mm ahead of the drive axle and whose chassis ends about 75 mm behind it: that robot
 * is 245 mm long and stands in the middle of the 250 mm Fire Station. Use startPoseFor() to get
 * the exact pose for a particular robot.
 */
const DEFAULT_START_POSE: Pose = centredStartPose(170, 75);

// =============================================================================================
// The field at the start of a match
// =============================================================================================

function makeBody(
  base: Pick<Body, 'id' | 'kind' | 'label' | 'fill' | 'w' | 'l' | 'h' | 'grippable' | 'platform' | 'mass'> & {
    colorName?: ColorName;
  },
  x: number,
  y: number,
  z: number,
  restingOn: string | null,
): Body {
  return {
    ...base,
    x,
    y,
    angle: 0,
    z,
    restingOn,
    held: false,
    home: { x, y, angle: 0, z, restingOn },
  };
}

function makeTower(id: TowerId): Body {
  const c = rectCenter(towerSquare(id));
  return makeBody(
    {
      id: towerBodyId(id),
      kind: isWaterTowerId(id) ? KIND_WATER_TOWER : KIND_RESCUE_TOWER,
      label: id,
      fill: isWaterTowerId(id) ? WATER_TOWER_FILL : RESCUE_TOWER_FILL[RESCUE_SQUARES[id].color],
      w: TOWER_SIZE,
      l: TOWER_SIZE,
      h: TOWER_HEIGHT,
      grippable: false,
      platform: true,
      // towers are heavier than buckets and people, but the robot can still push them
      mass: 3,
    },
    c.x,
    c.y,
    0,
    null,
  );
}

function createBodies(s: FireRescueScenario): Body[] {
  // Towers come first so that a simple "draw in order" renderer paints them underneath
  // whatever stands on them.
  const bodies: Body[] = TOWER_IDS.map(makeTower);

  // one bucket on top of each water tower
  for (const towerId of WATER_TOWER_IDS) {
    const color = s.buckets[towerId];
    const c = rectCenter(WATER_SQUARES[towerId]);
    bodies.push(
      makeBody(
        {
          id: bucketBodyId(color),
          kind: KIND_BUCKET,
          label: COLOR_LETTER[color],
          fill: GAME_COLOR_CSS[color],
          colorName: color,
          w: BUCKET_SIZE,
          l: BUCKET_SIZE,
          h: BUCKET_HEIGHT,
          grippable: true,
          platform: false,
          mass: 1,
        },
        c.x,
        c.y,
        TOWER_HEIGHT,
        towerBodyId(towerId),
      ),
    );
  }

  // one person on the mat at each building, in the square chosen by the combination
  for (const building of BUILDING_IDS) {
    const { slot, color } = s.people[building];
    const c = rectCenter(buildingSquare(building, slot));
    bodies.push(
      makeBody(
        {
          id: personBodyId(color),
          kind: KIND_PERSON,
          label: COLOR_LETTER[color],
          fill: PERSON_FILL[color],
          colorName: color,
          w: PERSON_SIZE,
          l: PERSON_SIZE,
          h: PERSON_HEIGHT,
          grippable: true,
          platform: false,
          mass: 1,
        },
        c.x,
        c.y,
        0,
        null,
      ),
    );
  }

  return bodies;
}

// =============================================================================================
// Areas the renderer can highlight
// =============================================================================================

function overlays(s: FireRescueScenario): ZoneOverlay[] {
  const out: ZoneOverlay[] = [
    { id: 'start', label: 'Fire Station (start)', rect: FIRE_STATION, color: START_ZONE_CSS, kind: 'start' },
  ];
  for (const id of WATER_TOWER_IDS) {
    out.push({ id: `water:${id}`, label: id, rect: WATER_SQUARES[id], color: WATER_AREA_CSS, kind: 'tower-area' });
  }
  for (const building of BUILDING_IDS) {
    const person = s.people[building];
    const waterSlot = deliverySlot(s, building);
    out.push({
      id: `pickup:${building}`,
      label: `${building}${person.slot} person`,
      rect: buildingSquare(building, person.slot),
      // colour of the person waiting here
      color: GAME_COLOR_CSS[person.color],
      kind: 'pickup',
    });
    out.push({
      id: `delivery:${building}`,
      label: `${building}${waterSlot} water`,
      rect: buildingSquare(building, waterSlot),
      // colour of the bucket this building needs
      color: GAME_COLOR_CSS[BUILDINGS[building].color],
      kind: 'delivery',
    });
  }
  for (const id of RESCUE_TOWER_IDS) {
    const sq = RESCUE_SQUARES[id];
    out.push({ id: `rescue:${id}`, label: id, rect: sq.rect, color: GAME_COLOR_CSS[sq.color], kind: 'tower-area' });
  }
  return out;
}

// =============================================================================================
// Referee
// =============================================================================================

/** Two things closer than this (mm) count as touching. */
const TOUCH_EPS = 0.5;
/** A base at most this high above the mat (mm) counts as standing on the mat. */
const ON_MAT_EPS = 0.5;

interface Verdict {
  ok: boolean;
  detail: string;
}
const pass = (detail: string): Verdict => ({ ok: true, detail });
const fail = (detail: string): Verdict => ({ ok: false, detail });

/** The building square (if any) that this footprint touches. */
function squareUnder(fp: OBB): { building: BuildingId; slot: BuildingSlot } | null {
  for (const building of BUILDING_IDS) {
    for (const slot of [1, 2] as const) {
      if (obbTouchesRect(fp, buildingSquareArea(building, slot))) return { building, slot };
    }
  }
  return null;
}

/** The building whose illustrated tile contains the centre of this footprint, if any. */
function tileUnder(fp: OBB): BuildingId | null {
  return BUILDING_IDS.find((b) => pointInRect(fp, BUILDINGS[b].tile)) ?? null;
}

/** Two bodies touch when their footprints touch AND their height ranges meet. */
function bodiesTouch(a: Body, b: Body): boolean {
  const heightsMeet = a.z <= b.z + b.h + TOUCH_EPS && b.z <= a.z + a.h + TOUCH_EPS;
  return heightsMeet && obbTouches(footprint(a), footprint(b), TOUCH_EPS);
}

/** "the red bucket", "the blue person", "W2" ... */
function nameOf(body: Body): string {
  return body.colorName ? `the ${body.colorName} ${body.kind}` : body.label;
}

/** "tower W2 is completely outside its area" / "towers W2, RG are completely outside their areas" */
function outsideText(ids: TowerId[]): string {
  return ids.length === 1
    ? `tower ${ids[0]} is completely outside its area`
    : `towers ${ids.join(', ')} are completely outside their areas`;
}

function score(ctx: ScoreContext<FireRescueScenario>): ScoreReport {
  const { scenario, world, robotShapes } = ctx;
  const bodies = new Map<string, Body>();
  for (const b of world.bodies) bodies.set(b.id, b);

  const isHeld = (b: Body): boolean => b.held || world.robot.gripper.holding === b.id;

  // The robot's shapes are footprints seen from above (chassis, fingers). An element counts as
  // touching the robot when it is gripped or when one of those footprints reaches its own.
  const touchesRobot = (b: Body): boolean =>
    isHeld(b) || robotShapes.some((shape) => obbTouches(footprint(b), shape, TOUCH_EPS));

  // ------------------------------------------------------------------ towers
  // legal = some part of the base touches the tower's own square (boundary included)
  const legalTowers = new Set<TowerId>();
  const outsideTowers: TowerId[] = [];
  for (const id of TOWER_IDS) {
    const tower = bodies.get(towerBodyId(id));
    if (!tower) continue; // not on the field at all: nothing to judge
    if (isTowerLegal(id, tower)) legalTowers.add(id);
    else outsideTowers.push(id);
  }
  const allTowersLegal = legalTowers.size === TOWER_IDS.length;

  // ------------------------------------------------------------------ mission 1: buckets
  const judgeBucket = (color: ColorName): Verdict => {
    const building = BUCKET_DESTINATION[color];
    const slot = deliverySlot(scenario, building);
    const target = `${building}${slot}`;
    const bucket = bodies.get(bucketBodyId(color));
    if (!bucket) return fail('this bucket is not on the field');
    if (isHeld(bucket)) return fail(`the robot is still holding it - put it down inside ${target}`);

    if (bucket.restingOn !== null) {
      const under = bodies.get(bucket.restingOn);
      if (under && under.kind === KIND_WATER_TOWER) {
        const still = bucket.restingOn === bucket.home.restingOn ? 'still on' : 'on';
        return fail(`${still} water tower ${under.label} - take it to ${target}`);
      }
      if (under && under.kind === KIND_RESCUE_TOWER) {
        return fail(`on rescue tower ${under.label} - a bucket must stand on the mat, inside ${target}`);
      }
      return fail(`standing on ${under ? nameOf(under) : 'something'} - it must stand on the mat, inside ${target}`);
    }
    if (bucket.z > ON_MAT_EPS) return fail(`not standing on the mat yet - put it down inside ${target}`);

    const fp = footprint(bucket);
    if (rectContainsOBB(buildingSquareArea(building, slot), fp)) {
      if (touchesRobot(bucket)) return fail(`inside ${target} but still touching the robot - let go and move away`);
      return pass(`delivered: completely inside ${target}`);
    }

    if (obbTouchesRect(fp, buildingSquareArea(building, slot))) {
      return fail(`partly outside ${target} - the whole bucket must be inside the white dashed square`);
    }
    const at = squareUnder(fp);
    if (at) {
      const name = `${at.building}${at.slot}`;
      if (at.building === building) return fail(`in ${name} - that is the person square, deliver to ${target}`);
      return fail(`in ${name} - wrong building, the ${color} bucket belongs in ${target}`);
    }
    const tile = tileUnder(fp);
    if (tile === building) return fail(`at building ${building} but not inside the water square ${target}`);
    if (tile) return fail(`at building ${tile} - wrong building, the ${color} bucket belongs in ${target}`);
    return fail(`on the mat, not delivered yet - take it to ${target}`);
  };

  // ------------------------------------------------------------------ mission 2: people
  const judgePerson = (color: ColorName): Verdict => {
    const towerId = RESCUE_TOWER_BY_COLOR[color];
    const person = bodies.get(personBodyId(color));
    if (!person) return fail('this person is not on the field');
    if (isHeld(person)) return fail(`the robot is still holding it - put it on top of rescue tower ${towerId}`);

    if (person.restingOn === null) {
      if (person.z > ON_MAT_EPS) return fail(`not standing on anything yet - put it on top of rescue tower ${towerId}`);
      const at = squareUnder(footprint(person));
      if (at && at.building === buildingOfPerson(scenario, color)) {
        return fail(`still waiting at building ${at.building} (${at.building}${at.slot}) - carry it to rescue tower ${towerId}`);
      }
      return fail(`on the mat - it must stand on top of rescue tower ${towerId}`);
    }

    const under = bodies.get(person.restingOn);
    if (!under) return fail(`not on rescue tower ${towerId}`);
    if (under.id !== towerBodyId(towerId)) {
      if (under.kind === KIND_RESCUE_TOWER) {
        return fail(`on the wrong tower (${under.label}) - the ${color} person goes on ${towerId}`);
      }
      if (under.kind === KIND_WATER_TOWER) {
        return fail(`on water tower ${under.label} - the ${color} person goes on rescue tower ${towerId}`);
      }
      return fail(`standing on ${nameOf(under)} - it must stand on top of rescue tower ${towerId}`);
    }

    // From here on the person stands on the tower of its own colour.
    if (!obbContainsOBB(footprint(under), footprint(person), TOUCH_EPS)) {
      return fail(`hanging over the edge of tower ${towerId} - its whole base must be on the tower top`);
    }
    const sharing = world.bodies.some((o) => o !== person && o.kind === KIND_PERSON && o.restingOn === under.id);
    if (sharing) return fail(`tower ${towerId} has more than one person on it - only one person per tower`);
    const toucher = world.bodies.find((o) => o !== person && !isTower(o) && bodiesTouch(person, o));
    if (toucher) return fail(`on tower ${towerId} but touching ${nameOf(toucher)} - it may only touch its tower`);
    if (touchesRobot(person)) return fail(`on tower ${towerId} but still touching the robot - let go and move away`);
    if (!legalTowers.has(towerId)) return fail(`${outsideText([towerId])} - the person on it does not count`);
    return pass(`rescued: standing on tower ${towerId}`);
  };

  // ------------------------------------------------------------------ score lines
  const lines: ScoreLine[] = [];
  let missionsDone = 0;
  const addMission = (id: string, label: string, verdict: Verdict) => {
    if (verdict.ok) missionsDone++;
    lines.push({
      id,
      label,
      points: verdict.ok ? MISSION_POINTS : 0,
      max: MISSION_POINTS,
      ok: verdict.ok,
      detail: verdict.detail,
    });
  };

  for (const color of COLORS) {
    const building = BUCKET_DESTINATION[color];
    addMission(
      bucketBodyId(color),
      `${capitalize(color)} bucket to building ${building} (${BUILDINGS[building].name})`,
      judgeBucket(color),
    );
  }
  for (const color of COLORS) {
    addMission(
      personBodyId(color),
      `${capitalize(color)} person onto rescue tower ${RESCUE_TOWER_BY_COLOR[color]}`,
      judgePerson(color),
    );
  }
  const complete = missionsDone === 8;

  // bonus: everything done AND every tower still (partly) on its own square
  const bonus = complete && allTowersLegal;
  let bonusDetail: string;
  if (bonus) bonusDetail = 'all eight missions complete and every tower is on its area';
  else if (complete) {
    bonusDetail =
      outsideTowers.length > 0
        ? `all eight missions complete, but ${outsideText(outsideTowers)}`
        : 'all eight missions complete, but a tower is missing from the field';
  } else bonusDetail = `${missionsDone} of 8 missions complete - finish all eight to earn the bonus`;
  lines.push({
    id: 'bonus',
    label: 'Bonus: all eight missions complete',
    points: bonus ? BONUS_POINTS : 0,
    max: BONUS_POINTS,
    ok: bonus,
    detail: bonusDetail,
  });

  // penalties ("0 - x" so that no penalty shows as a clean 0, never as -0)
  const restarts = Number.isFinite(ctx.restarts) ? Math.max(0, Math.floor(ctx.restarts)) : 0;
  lines.push({
    id: 'restarts',
    label: 'Restarts',
    points: 0 - RESTART_PENALTY * restarts,
    max: 0,
    ok: restarts === 0,
    detail:
      restarts === 0
        ? 'no restarts'
        : `${restarts} restart${restarts === 1 ? '' : 's'}, -${RESTART_PENALTY} points each`,
  });
  lines.push({
    id: 'towers-outside',
    label: 'Towers completely outside their area',
    points: 0 - TOWER_OUTSIDE_PENALTY * outsideTowers.length,
    max: 0,
    ok: outsideTowers.length === 0,
    detail:
      outsideTowers.length === 0
        ? 'every tower touches its own square'
        : `${outsideText(outsideTowers)}, -${TOWER_OUTSIDE_PENALTY} points each`,
  });

  const sum = lines.reduce((total, line) => total + line.points, 0);
  return { total: Math.max(0, sum), max: MAX_SCORE, lines, complete };
}

// =============================================================================================
// The game
// =============================================================================================

export const fireRescueGame: Game<FireRescueScenario> = {
  id: 'fire-rescue',
  title: 'MakeX Lebanon 2027 - Fire Rescue',
  mat: {
    width: MAT_SIZE,
    height: MAT_SIZE,
    imageUrl: MAT_IMAGE_URL,
    sensorImageUrl: MAT_SENSOR_IMAGE_URL,
    vector: MAT_VECTOR,
  },
  matchDuration: MATCH_DURATION,
  startZone: FIRE_STATION,
  defaultStartPose: DEFAULT_START_POSE,
  restartPenalty: RESTART_PENALTY,
  defaultScenario,
  randomScenario,
  scenarioCount: () => SCENARIO_COUNT,
  encodeScenario,
  decodeScenario,
  describeScenario,
  createBodies,
  overlays,
  score,
};
