/**
 * Drawing the stage: the mat seen from above, the game elements, the robot, and the optional
 * helpers (zones, sensor view, driven path).
 *
 * Everything is drawn in MILLIMETRES: drawStage() first sets a transform that maps mat
 * millimetres to screen pixels, so the numbers below are real sizes (a 70 mm tower is drawn 70
 * units wide). Browser only (it needs a 2-D canvas), but free of React.
 *
 * Reminder of the simulator's conventions (see core/geometry.ts): +x is right, +y is DOWN,
 * heading 0 faces up the mat and grows clockwise - exactly how a canvas rotates, so a body is
 * drawn by translate(x, y) + rotate(heading) and then "forward" is the canvas direction -y.
 */
import { DEG, localRectToOBB, localToWorld, obbCorners, pointInOBB, type OBB, type Vec2 } from '../core/geometry';
import { mmPerWheelDegree, robotShapesAt, widestClawGap } from '../core/robot';
import {
  PROBE_NAMES,
  type Body,
  type MatVector,
  type Pose,
  type RobotConfig,
  type SensorSnapshot,
  type Simulation,
  type ZoneOverlay,
} from '../core/types';
import { inkOn, parseHex, rgbCss, shade } from './format';
import type { Trail } from './trail';

// =============================================================================================
// View: where the mat sits inside the canvas
// =============================================================================================

export interface StageView {
  /** size of the canvas element in CSS pixels */
  cssWidth: number;
  cssHeight: number;
  /** device pixels per CSS pixel (2 on a retina screen) */
  dpr: number;
  /** CSS pixels per millimetre */
  scale: number;
  /** CSS pixel position of the mat's top-left corner */
  originX: number;
  originY: number;
}

/** Strip of table shown around the mat, in mm. */
export const STAGE_MARGIN = 45;

/** Largest view of the mat (plus a margin of table) that fits the canvas; the mat lands on whole device pixels. */
export function fitView(
  cssWidth: number,
  cssHeight: number,
  matWidth: number,
  matHeight: number,
  dpr: number,
  margin: number = STAGE_MARGIN,
): StageView {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const availW = Math.max(1, cssWidth * d);
  const availH = Math.max(1, cssHeight * d);
  const fit = Math.min(availW / (matWidth + 2 * margin), availH / (matHeight + 2 * margin));
  const matPixels = Math.max(1, Math.floor(matWidth * fit));
  const devicePerMm = matPixels / matWidth;
  return {
    cssWidth,
    cssHeight,
    dpr: d,
    scale: devicePerMm / d,
    originX: Math.round((availW - matWidth * devicePerMm) / 2) / d,
    originY: Math.round((availH - matHeight * devicePerMm) / 2) / d,
  };
}

/** Mat position (mm) of a point given in CSS pixels relative to the canvas' top-left corner. */
export function viewToMat(view: StageView, cssX: number, cssY: number): Vec2 {
  return { x: (cssX - view.originX) / view.scale, y: (cssY - view.originY) / view.scale };
}

// =============================================================================================
// The mat picture
// =============================================================================================

/** Paint the geometric description of a mat (used until the real picture has loaded). */
export function paintMatVector(ctx: CanvasRenderingContext2D, mat: MatVector): void {
  ctx.save();
  ctx.fillStyle = rgbCss(mat.background);
  ctx.fillRect(0, 0, mat.width, mat.height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  for (const layer of mat.layers) {
    if (layer.kind === 'rect') {
      ctx.fillStyle = rgbCss(layer.color);
      ctx.fillRect(layer.rect.x, layer.rect.y, layer.rect.w, layer.rect.h);
      continue;
    }
    if (layer.points.length < 2) continue;
    ctx.beginPath();
    layer.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (layer.closed) ctx.closePath();
    ctx.strokeStyle = rgbCss(layer.color);
    ctx.lineWidth = layer.width;
    ctx.setLineDash(layer.dash ? [layer.dash.on, layer.dash.off] : []);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Keeps a copy of the mat at exactly the size it is shown, so that every frame only has to copy
 * pixels instead of shrinking a large picture again.
 */
export class MatPainter {
  private image: HTMLImageElement | null = null;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';

  constructor(private readonly vector: MatVector) {}

  /** Use the real mat picture from now on (null = back to the drawn version). */
  setImage(image: HTMLImageElement | null): void {
    this.image = image;
    this.cacheKey = '';
  }

  get hasImage(): boolean {
    return this.image !== null;
  }

  /** Draw the mat with its top-left corner at (0, 0); `ctx` must already be in millimetres. */
  paint(ctx: CanvasRenderingContext2D, view: StageView): void {
    const m = this.vector;
    const w = Math.max(1, Math.round(m.width * view.scale * view.dpr));
    const h = Math.max(1, Math.round(m.height * view.scale * view.dpr));
    const key = `${w}x${h}:${this.image ? 'picture' : 'drawing'}`;
    if (!this.cache || key !== this.cacheKey) {
      const cache = this.cache ?? document.createElement('canvas');
      cache.width = w;
      cache.height = h;
      const g = cache.getContext('2d');
      if (g) {
        if (this.image) {
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(this.image, 0, 0, w, h);
        } else {
          g.setTransform(w / m.width, 0, 0, h / m.height, 0, 0);
          paintMatVector(g, m);
        }
      }
      this.cache = cache;
      this.cacheKey = key;
    }
    ctx.drawImage(this.cache, 0, 0, m.width, m.height);
  }
}

// =============================================================================================
// Small drawing helpers
// =============================================================================================

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function polygon(ctx: CanvasRenderingContext2D, points: Vec2[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * Height cue: the higher something is above the mat, the further away and the softer its shadow.
 * (Canvas shadows are measured in device pixels, hence `devicePerMm`.)
 */
function castShadow(ctx: CanvasRenderingContext2D, heightMm: number, devicePerMm: number): void {
  const h = Math.max(0, heightMm);
  ctx.shadowColor = 'rgba(15, 23, 42, 0.45)';
  ctx.shadowBlur = (2 + h * 0.1) * devicePerMm;
  ctx.shadowOffsetX = h * 0.07 * devicePerMm;
  ctx.shadowOffsetY = h * 0.11 * devicePerMm;
}

function noShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** Text with a thin outline so it stays readable on any part of the mat. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ink: string, halo: string, haloWidth: number): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = haloWidth;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y);
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

// =============================================================================================
// Game elements
// =============================================================================================

/** Draw one tower, bucket or person where it stands (or where the claw holds it). */
export function drawBody(ctx: CanvasRenderingContext2D, body: Body, devicePerMm: number): void {
  const fill = parseHex(body.fill);
  const edge = rgbCss(shade(fill, -0.45));
  const { w, l } = body;
  const size = Math.min(w, l);

  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);

  // base shape = the exact footprint the referee measures
  castShadow(ctx, body.z + body.h, devicePerMm);
  roundRect(ctx, -w / 2, -l / 2, w, l, body.platform ? 5 : 6);
  ctx.fillStyle = body.fill;
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = edge;
  ctx.stroke();

  let ink = inkOn(fill);
  if (body.platform) {
    // tower: a lighter top plate inside a darker rim
    const inset = Math.min(8, size * 0.12);
    roundRect(ctx, -w / 2 + inset, -l / 2 + inset, w - 2 * inset, l - 2 * inset, 3);
    ctx.fillStyle = rgbCss(shade(fill, 0.35));
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgbCss(shade(fill, -0.2));
    ctx.stroke();
    ink = inkOn(shade(fill, 0.35));
  } else if (body.kind === 'person') {
    // person: shoulders and a round white head
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.42, size * 0.27, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss(shade(fill, -0.25));
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.29, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = edge;
    ctx.stroke();
    ink = rgbCss(shade(fill, -0.2));
  } else if (body.grippable) {
    // bucket: an open container, darker inside
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.37, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss(shade(fill, -0.3));
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgbCss(shade(fill, 0.45));
    ctx.stroke();
    ink = '#ffffff';
  }

  // label, always upright so it can be read whichever way the element is turned
  if (body.label) {
    ctx.rotate(-body.angle);
    const fontSize = body.platform ? size * 0.34 : size * 0.44;
    ctx.font = `700 ${fontSize}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(body.label, 0, fontSize * 0.06);
  }
  ctx.restore();
}

// =============================================================================================
// Robot
// =============================================================================================

type StageSim = Pick<Simulation<unknown>, 'world' | 'robotConfig' | 'game' | 'status' | 'readSensors'>;

/** Oriented box around the whole robot (chassis and gripper), used to tell whether the pointer is on it. */
export function robotHull(config: RobotConfig, pose: Pose): OBB {
  const g = config.gripper;
  const front = g.enabled ? Math.max(config.chassisFront, g.gripForward + g.fingerLength / 2) : config.chassisFront;
  const half = config.chassisWidth / 2;
  return localRectToOBB(pose, -config.chassisRear, front, -half, half);
}

export function robotHit(config: RobotConfig, pose: Pose, point: Vec2, tolerance = 0): boolean {
  return pointInOBB(point, robotHull(config, pose), tolerance);
}

/** 0 = arm fully down, 1 = fully up. */
function liftFraction(config: RobotConfig, height: number): number {
  const g = config.gripper;
  const span = g.liftUpHeight - g.liftDownHeight;
  if (Math.abs(span) < 1e-9) return 0;
  return Math.max(0, Math.min(1, (height - g.liftDownHeight) / span));
}

function drawRobot(ctx: CanvasRenderingContext2D, sim: StageSim, devicePerMm: number): void {
  const robot = sim.world.robot;
  const c = sim.robotConfig;
  const g = c.gripper;
  const { pose } = robot;
  const half = c.chassisWidth / 2;
  const front = c.chassisFront;
  const rear = c.chassisRear;

  // ------------------------------------------------------------------ chassis, wheels, CyberPi
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.heading);
  // from here on: x = to the robot's right, y = towards its REAR (so the front is at negative y)

  // base plate = the exact box the engine uses for collisions
  castShadow(ctx, c.chassisHeight * 0.6, devicePerMm);
  roundRect(ctx, -half, -front, 2 * half, front + rear, 13);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = '#075985';
  ctx.stroke();

  // wheels, with a tread that rolls with the encoder
  const wheelW = Math.min(22, half * 0.36);
  const wheelL = c.wheelDiameter;
  const wheelX = Math.min(c.trackWidth / 2, half - wheelW / 2 - 1);
  const mmPerDeg = mmPerWheelDegree(c);
  const treadGap = 9;
  for (const side of [-1, 1] as const) {
    const wheel = side < 0 ? robot.left : robot.right;
    const x = side * wheelX - wheelW / 2;
    roundRect(ctx, x, -wheelL / 2, wheelW, wheelL, 5);
    ctx.fillStyle = '#1f2937';
    ctx.fill();
    ctx.save();
    ctx.clip();
    const rolled = (((wheel.angleDeg * mmPerDeg) % treadGap) + treadGap) % treadGap;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // seen from above the top of the wheel moves forward when the robot drives forward
    for (let y = wheelL / 2 + treadGap - rolled; y > -wheelL / 2 - treadGap; y -= treadGap) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + wheelW, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // the mBot2 shield (dark board) between the wheels
  const innerHalf = Math.max(12, wheelX - wheelW / 2 - 3);
  roundRect(ctx, -innerHalf, -front + 24, 2 * innerHalf, front + rear - 32, 6);
  ctx.fillStyle = '#0c4a6e';
  ctx.fill();

  // CyberPi: screen, joystick, buttons and the strip of five LEDs
  const piHalf = Math.max(10, innerHalf - 2);
  const piTop = -30;
  const piLength = 46;
  roundRect(ctx, -piHalf, piTop, 2 * piHalf, piLength, 8);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#4b5563';
  ctx.stroke();

  const screenOn = robot.screen.lines.length > 0 || robot.screen.labels.length > 0;
  roundRect(ctx, -piHalf * 0.4, piTop + 6, piHalf * 0.8, 21, 2);
  ctx.fillStyle = screenOn ? '#bae6fd' : '#020617';
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.stroke();

  ctx.fillStyle = '#9ca3af';
  ctx.beginPath();
  ctx.arc(-piHalf * 0.68, piTop + 16, 4, 0, Math.PI * 2); // joystick
  ctx.arc(piHalf * 0.68, piTop + 11, 3, 0, Math.PI * 2); // button A
  ctx.fill();
  ctx.beginPath();
  ctx.arc(piHalf * 0.68, piTop + 21, 3, 0, Math.PI * 2); // button B
  ctx.fill();

  const ledPitch = Math.min(12, (2 * piHalf - 10) / 5);
  for (let i = 0; i < 5; i++) {
    const led = robot.leds[i] ?? { r: 0, g: 0, b: 0 };
    const lit = led.r + led.g + led.b > 24;
    const x = (i - 2) * ledPitch;
    if (lit) {
      ctx.shadowColor = rgbCss(led);
      ctx.shadowBlur = 7 * devicePerMm;
    }
    roundRect(ctx, x - ledPitch * 0.36, piTop + piLength - 13, ledPitch * 0.72, 7, 2);
    ctx.fillStyle = lit ? rgbCss(led) : '#374151';
    ctx.fill();
    noShadow(ctx);
  }

  // ultrasonic sensor: the two "eyes" at the front
  const eyeY = -front + 9.5;
  roundRect(ctx, -32, -front + 1.5, 64, 16, 8);
  ctx.fillStyle = '#0369a1';
  ctx.fill();
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(side * 17, eyeY, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#e0f2fe';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(side * 17, eyeY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0c4a6e';
    ctx.fill();
  }

  // gripper arm: neck and palm (the fingers come later, on top of whatever they hold)
  const lift = liftFraction(c, robot.gripper.height);
  const armColor = rgbCss(shade({ r: 51, g: 65, b: 85 }, lift * 0.45));
  const fingerRear = g.gripForward - g.fingerLength / 2;
  const fingerFront = g.gripForward + g.fingerLength / 2;
  if (g.enabled) {
    const palmHalf = widestClawGap(c) / 2 + g.fingerThickness;
    castShadow(ctx, robot.gripper.height, devicePerMm);
    ctx.fillStyle = armColor;
    roundRect(ctx, -8, -fingerRear, 16, Math.max(6, fingerRear - front + 6), 3);
    ctx.fill();
    roundRect(ctx, -palmHalf, -fingerRear, 2 * palmHalf, Math.min(9, Math.max(4, fingerRear - front)), 3);
    ctx.fill();
    noShadow(ctx);
  }
  ctx.restore();

  // ------------------------------------------------------------------ what the claw holds
  const holding = robot.gripper.holding;
  if (holding) {
    const held = sim.world.bodies.find((b) => b.id === holding);
    if (held) drawBody(ctx, held, devicePerMm);
  }

  // ------------------------------------------------------------------ fingers
  if (g.enabled) {
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.heading);
    const gap = robot.gripper.gap;
    castShadow(ctx, robot.gripper.height + g.fingerHeight, devicePerMm);
    for (const side of [-1, 1] as const) {
      const x = side < 0 ? -gap / 2 - g.fingerThickness : gap / 2;
      roundRect(ctx, x, -fingerFront, g.fingerThickness, fingerFront - fingerRear, Math.min(3.5, g.fingerThickness / 2));
      ctx.fillStyle = armColor;
      ctx.fill();
    }
    noShadow(ctx);
    ctx.lineWidth = 1;
    ctx.strokeStyle = lift > 0.5 ? '#0f172a' : '#e2e8f0';
    for (const side of [-1, 1] as const) {
      const x = side < 0 ? -gap / 2 - g.fingerThickness : gap / 2;
      roundRect(ctx, x, -fingerFront, g.fingerThickness, fingerFront - fingerRear, Math.min(3.5, g.fingerThickness / 2));
      ctx.stroke();
    }
    ctx.restore();
  }
}

// =============================================================================================
// Sensor view
// =============================================================================================

/** How far the "nothing seen" beam is drawn (mm). */
const EMPTY_BEAM_LENGTH = 420;

interface Beam {
  origin: Vec2;
  /** true when the sensor sees something within its range */
  sees: boolean;
  /** length of the drawn beam, mm */
  range: number;
  /** half opening angle, radians */
  half: number;
  /** direction of the beam as a canvas angle (0 = +x, clockwise) */
  centre: number;
}

function beamOf(sim: StageSim, sensors: SensorSnapshot): Beam {
  const u = sim.robotConfig.ultrasonic;
  const pose = sim.world.robot.pose;
  const sees = sensors.ultrasonicCm < u.maxRangeCm - 1e-6;
  return {
    origin: localToWorld(pose, u.forward, 0),
    sees,
    range: sees ? sensors.ultrasonicCm * 10 : EMPTY_BEAM_LENGTH,
    half: u.halfAngleDeg * DEG,
    // canvas angles start at +x; our heading 0 points up, a quarter turn earlier
    centre: pose.heading - Math.PI / 2,
  };
}

/** The light-blue cone of the ultrasonic sensor, drawn under the game elements. */
function drawUltrasonicBeam(ctx: CanvasRenderingContext2D, beam: Beam, view: StageView): void {
  const { origin, range, half, centre } = beam;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.arc(origin.x, origin.y, range, centre - half, centre + half);
  ctx.closePath();
  if (beam.sees) {
    ctx.fillStyle = 'rgba(14, 165, 233, 0.26)';
  } else {
    const fade = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, range);
    fade.addColorStop(0, 'rgba(14, 165, 233, 0.22)');
    fade.addColorStop(1, 'rgba(14, 165, 233, 0)');
    ctx.fillStyle = fade;
  }
  ctx.fill();
  if (beam.sees) {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, range, centre - half, centre + half);
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3 / view.scale;
    ctx.stroke();
  }
  ctx.restore();
}

/** The measured distance, written beside the end of the beam, on top of everything else. */
function drawUltrasonicLabel(ctx: CanvasRenderingContext2D, sim: StageSim, sensors: SensorSnapshot, beam: Beam, view: StageView): void {
  if (!beam.sees) return;
  const u = sim.robotConfig.ultrasonic;
  const pose = sim.world.robot.pose;
  // to the right of where the beam ends, so that it covers neither the beam nor what it hit
  const aside = beam.range * Math.tan(beam.half) + 24 / view.scale;
  const at = localToWorld(pose, u.forward + beam.range, aside);
  const fontSize = 11 / view.scale;
  ctx.save();
  ctx.font = `700 ${fontSize}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  haloText(ctx, `${Math.round(sensors.ultrasonicCm)} cm`, at.x, at.y, '#075985', 'rgba(255, 255, 255, 0.95)', 3.5 / view.scale);
  ctx.restore();
}

function drawProbes(ctx: CanvasRenderingContext2D, sim: StageSim, sensors: SensorSnapshot): void {
  const q = sim.robotConfig.quadRgb;
  const pose = sim.world.robot.pose;
  ctx.save();
  PROBE_NAMES.forEach((name, i) => {
    const p = localToWorld(pose, q.forward, q.probeOffsets[i]);
    const reading = sensors.probes[name];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6.6, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5.6, 0, Math.PI * 2);
    // orange ring = this probe is on the line, white ring = background
    ctx.fillStyle = reading.onLine ? '#f97316' : '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.9, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss(reading.rgb);
    ctx.fill();
  });
  ctx.restore();
}

// =============================================================================================
// Zones, path, placing the robot
// =============================================================================================

/** Where the name of one zone is written: centre x and text baseline y, in mat millimetres. */
export interface ZoneLabelPlace {
  x: number;
  y: number;
  /** true when the name had to go below its area */
  below: boolean;
}

/**
 * Decide where the name of every zone is written.
 *
 * A name normally sits just above its area, so that whatever stands in the area does not hide
 * it. Names are often wider than their areas, though: the two squares of a building are 110 mm
 * apart and "A1 person" / "A2 water" would run into each other. A name that would touch one
 * already placed is therefore written below its area instead.
 *
 * `textWidth` measures a name, `fontSize` is the height of the letters and `gap` the distance
 * between an area and its name - all in the same unit as the zone rectangles (mm).
 */
export function placeZoneLabels(
  zones: ReadonlyArray<Pick<ZoneOverlay, 'label' | 'rect'>>,
  textWidth: (label: string) => number,
  fontSize: number,
  gap: number,
): ZoneLabelPlace[] {
  interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }
  const taken: Box[] = [];
  // two names side by side need a clear space between them (one letter height), or they read as one
  const air = fontSize;
  const free = (box: Box): boolean =>
    taken.every((t) => box.right + air <= t.left || t.right + air <= box.left || box.bottom <= t.top || t.bottom <= box.top);

  return zones.map((zone) => {
    const { x, y, w, h } = zone.rect;
    const centre = x + w / 2;
    const half = textWidth(zone.label) / 2;
    const above: Box = { left: centre - half, right: centre + half, top: y - gap - fontSize, bottom: y - gap };
    const under: Box = { left: centre - half, right: centre + half, top: y + h + gap, bottom: y + h + gap + fontSize };
    const below = !free(above) && free(under);
    const box = below ? under : above;
    taken.push(box);
    // the letters stand on the baseline; capital letters are about 0.72 of the font size tall
    return { x: centre, y: below ? box.top + fontSize * 0.72 : box.bottom, below };
  });
}

function drawOverlays(ctx: CanvasRenderingContext2D, overlays: ZoneOverlay[], view: StageView): void {
  const fontSize = 10 / view.scale;
  ctx.save();
  ctx.font = `700 ${fontSize}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const zone of overlays) {
    const { x, y, w, h } = zone.rect;
    ctx.globalAlpha = zone.kind === 'start' ? 0.1 : 0.3;
    ctx.fillStyle = zone.color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2 / view.scale;
    ctx.strokeStyle = zone.color;
    ctx.setLineDash(zone.kind === 'delivery' ? [6 / view.scale, 4 / view.scale] : []);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  // the names go on top of all the areas, each where it does not run into another name
  const places = placeZoneLabels(overlays, (label) => ctx.measureText(label).width, fontSize, 5 / view.scale);
  overlays.forEach((zone, i) => {
    haloText(ctx, zone.label, places[i].x, places[i].y, '#0f172a', 'rgba(255, 255, 255, 0.92)', 3 / view.scale);
  });
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, trail: Trail, view: StageView): void {
  const pts = trail.points;
  if (pts.length < 4) return;
  ctx.save();
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (Number.isNaN(x)) {
      penDown = false;
    } else if (!penDown) {
      ctx.moveTo(x, y);
      penDown = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4.5 / view.scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.stroke();
  ctx.lineWidth = 2.5 / view.scale;
  ctx.strokeStyle = '#c026d3';
  ctx.stroke();
  ctx.restore();
}

/** Outline of the start zone while the robot can still be placed; red when the wanted place is not allowed. */
function drawStartZone(ctx: CanvasRenderingContext2D, sim: StageSim, view: StageView, illegal: boolean): void {
  const z = sim.game.startZone;
  ctx.save();
  ctx.lineWidth = 2.5 / view.scale;
  ctx.setLineDash([9 / view.scale, 6 / view.scale]);
  ctx.strokeStyle = illegal ? '#dc2626' : 'rgba(255, 255, 255, 0.95)';
  ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.lineDashOffset = 9 / view.scale;
  ctx.strokeStyle = illegal ? '#fecaca' : 'rgba(15, 23, 42, 0.75)';
  ctx.strokeRect(z.x, z.y, z.w, z.h);
  ctx.restore();
}

/** Red outline of the robot at a place where it is not allowed to start. */
function drawGhost(ctx: CanvasRenderingContext2D, config: RobotConfig, pose: Pose, view: StageView): void {
  ctx.save();
  ctx.lineWidth = 2.5 / view.scale;
  ctx.strokeStyle = '#dc2626';
  ctx.fillStyle = 'rgba(220, 38, 38, 0.22)';
  ctx.setLineDash([7 / view.scale, 4 / view.scale]);
  for (const shape of robotShapesAt(config, pose)) {
    polygon(ctx, obbCorners(shape));
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// =============================================================================================
// The whole picture
// =============================================================================================

export interface StageOptions {
  /** coloured zones of the game (start, pick-up, delivery, tower areas) */
  overlays: boolean;
  /** what the sensors see: line sensor dots and the ultrasonic beam */
  sensors: boolean;
  /** the path the robot has driven */
  trail: boolean;
}

export interface StageScene {
  sim: StageSim;
  view: StageView;
  options: StageOptions;
  mat: MatPainter;
  trail: Trail;
  overlays: ZoneOverlay[];
  /** the robot may still be placed: show the start zone */
  placing: boolean;
  /** where the student is trying to put the robot although it does not fit there */
  ghost: Pose | null;
}

export const TABLE_COLOR = '#475569';

export function drawStage(ctx: CanvasRenderingContext2D, scene: StageScene): void {
  const { sim, view, options } = scene;
  const devicePerMm = view.scale * view.dpr;
  const mat = sim.game.mat;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TABLE_COLOR;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // from here on everything is in millimetres on the mat
  ctx.setTransform(devicePerMm, 0, 0, devicePerMm, view.originX * view.dpr, view.originY * view.dpr);

  // the mat, lying on the table
  ctx.save();
  castShadow(ctx, 30, devicePerMm);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, mat.width, mat.height);
  ctx.restore();
  scene.mat.paint(ctx, view);

  if (options.overlays) drawOverlays(ctx, scene.overlays, view);
  if (scene.placing) drawStartZone(ctx, sim, view, scene.ghost !== null);
  if (options.trail) drawTrail(ctx, scene.trail, view);

  // game elements, lowest first, so that what stands on a tower is drawn over the tower
  const holding = sim.world.robot.gripper.holding;
  const standing = sim.world.bodies.filter((b) => b.id !== holding && !b.held);
  standing.sort((a, b) => a.z - b.z);

  const sensors = options.sensors ? sim.readSensors() : null;
  const beam = sensors ? beamOf(sim, sensors) : null;
  if (beam) drawUltrasonicBeam(ctx, beam, view);

  for (const body of standing) drawBody(ctx, body, devicePerMm);
  drawRobot(ctx, sim, devicePerMm);
  if (sensors) drawProbes(ctx, sim, sensors);
  if (sensors && beam) drawUltrasonicLabel(ctx, sim, sensors, beam, view);
  if (scene.ghost) drawGhost(ctx, sim.robotConfig, scene.ghost, view);
}
