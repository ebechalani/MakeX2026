/**
 * 2-D geometry helpers shared by the physics engine, the referee and the renderer.
 *
 * Conventions (used everywhere in the simulator):
 *  - Units are millimetres. The mat origin is its top-left corner, +x to the right, +y DOWN.
 *  - A heading / angle is in radians, 0 = facing "up" the mat (towards -y), and it grows
 *    CLOCKWISE as seen from above (so +90 degrees = facing right / +x).
 *  - A "local" point is expressed in a body's own frame as (forward, right).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Oriented rectangle: centre, size across (w) and along (l) its heading, and its heading. */
export interface OBB {
  x: number;
  y: number;
  /** size perpendicular to the heading (left-right) */
  w: number;
  /** size along the heading (front-back) */
  l: number;
  angle: number;
}

export const DEG = Math.PI / 180;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec2): Vec2 {
  const n = Math.hypot(a.x, a.y);
  return n > 1e-12 ? { x: a.x / n, y: a.y / n } : { x: 0, y: 0 };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle in radians to (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Unit vector pointing where a body with this heading faces. heading 0 -> (0,-1); +90deg -> (1,0). */
export function forwardOf(heading: number): Vec2 {
  return { x: Math.sin(heading), y: -Math.cos(heading) };
}

/** Unit vector pointing to the body's right-hand side. heading 0 -> (1,0). */
export function rightOf(heading: number): Vec2 {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

/** Heading (radians, simulator convention) of the direction vector d. */
export function headingOf(d: Vec2): number {
  return Math.atan2(d.x, -d.y);
}

/** Transform a local (forward, right) point of a body at pose (x, y, heading) into mat coordinates. */
export function localToWorld(
  pose: { x: number; y: number; heading: number },
  forward: number,
  right: number,
): Vec2 {
  const s = Math.sin(pose.heading);
  const c = Math.cos(pose.heading);
  return {
    x: pose.x + forward * s + right * c,
    y: pose.y - forward * c + right * s,
  };
}

/** Inverse of localToWorld: returns { forward, right } of the mat point p in the body's frame. */
export function worldToLocal(
  pose: { x: number; y: number; heading: number },
  p: Vec2,
): { forward: number; right: number } {
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  const s = Math.sin(pose.heading);
  const c = Math.cos(pose.heading);
  return { forward: dx * s - dy * c, right: dx * c + dy * s };
}

/**
 * Build an OBB from a rectangle given in a body's local frame.
 * @param forwardMin rear edge (mm ahead of the pose origin; may be negative)
 * @param forwardMax front edge
 * @param rightMin   left edge  (negative = left of the centre line)
 * @param rightMax   right edge
 */
export function localRectToOBB(
  pose: { x: number; y: number; heading: number },
  forwardMin: number,
  forwardMax: number,
  rightMin: number,
  rightMax: number,
): OBB {
  const c = localToWorld(pose, (forwardMin + forwardMax) / 2, (rightMin + rightMax) / 2);
  return { x: c.x, y: c.y, w: rightMax - rightMin, l: forwardMax - forwardMin, angle: pose.heading };
}

/** Corners of an OBB in order: front-left, front-right, rear-right, rear-left. */
export function obbCorners(o: OBB): [Vec2, Vec2, Vec2, Vec2] {
  const f = forwardOf(o.angle);
  const r = rightOf(o.angle);
  const hl = o.l / 2;
  const hw = o.w / 2;
  return [
    { x: o.x + f.x * hl - r.x * hw, y: o.y + f.y * hl - r.y * hw },
    { x: o.x + f.x * hl + r.x * hw, y: o.y + f.y * hl + r.y * hw },
    { x: o.x - f.x * hl + r.x * hw, y: o.y - f.y * hl + r.y * hw },
    { x: o.x - f.x * hl - r.x * hw, y: o.y - f.y * hl - r.y * hw },
  ];
}

/** Axis-aligned rect as an OBB. */
export function rectToOBB(r: Rect): OBB {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, l: r.h, angle: 0 };
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Grow (or shrink, with a negative margin) a rect on all four sides. */
export function expandRect(r: Rect, margin: number): Rect {
  return { x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin };
}

export function pointInRect(p: Vec2, r: Rect, eps = 0): boolean {
  return p.x >= r.x - eps && p.x <= r.x + r.w + eps && p.y >= r.y - eps && p.y <= r.y + r.h + eps;
}

export function pointInOBB(p: Vec2, o: OBB, eps = 0): boolean {
  const { forward, right } = worldToLocal({ x: o.x, y: o.y, heading: o.angle }, p);
  return Math.abs(forward) <= o.l / 2 + eps && Math.abs(right) <= o.w / 2 + eps;
}

/** True when every corner of the oriented box lies inside the axis-aligned rect (boundary counts). */
export function rectContainsOBB(r: Rect, o: OBB, eps = 1e-6): boolean {
  return obbCorners(o).every((c) => pointInRect(c, r, eps));
}

/** True when every corner of `inner` lies inside `outer` (boundary counts). */
export function obbContainsOBB(outer: OBB, inner: OBB, eps = 1e-6): boolean {
  return obbCorners(inner).every((c) => pointInOBB(c, outer, eps));
}

export interface Overlap {
  /** penetration depth in mm (> 0 when overlapping) */
  depth: number;
  /** unit vector: move B by normal * depth (or A by -normal * depth) to separate them */
  normal: Vec2;
}

function projectOnto(corners: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const p = c.x * axis.x + c.y * axis.y;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

/**
 * Separating-axis test between two oriented boxes.
 * Returns null when they do not overlap (touching edges do not count as overlap),
 * otherwise the minimum translation that pushes B out of A.
 */
export function obbOverlap(a: OBB, b: OBB): Overlap | null {
  // cheap reject on bounding circles
  const ra = Math.hypot(a.w, a.l) / 2;
  const rb = Math.hypot(b.w, b.l) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx * dx + dy * dy > (ra + rb) * (ra + rb)) return null;

  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [forwardOf(a.angle), rightOf(a.angle), forwardOf(b.angle), rightOf(b.angle)];
  let best = Infinity;
  let bestAxis: Vec2 = { x: 0, y: 0 };
  for (const axis of axes) {
    const [minA, maxA] = projectOnto(ca, axis);
    const [minB, maxB] = projectOnto(cb, axis);
    const o = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (o <= 1e-9) return null;
    if (o < best) {
      best = o;
      bestAxis = axis;
    }
  }
  // orient the normal from A towards B
  if (bestAxis.x * dx + bestAxis.y * dy < 0) bestAxis = { x: -bestAxis.x, y: -bestAxis.y };
  return { depth: best, normal: bestAxis };
}

/** True when two oriented boxes overlap or touch within `eps` mm. */
export function obbTouches(a: OBB, b: OBB, eps = 0.5): boolean {
  return obbOverlap({ ...a, w: a.w + 2 * eps, l: a.l + 2 * eps }, b) !== null;
}

/** True when an oriented box and an axis-aligned rect overlap or touch within `eps` mm. */
export function obbTouchesRect(o: OBB, r: Rect, eps = 0): boolean {
  return obbOverlap(rectToOBB(expandRect(r, eps + 1e-6)), o) !== null;
}

/** Closest point to p on the segment a-b. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return { x: a.x, y: a.y };
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Distance from p to the segment a-b, and how far along the segment (mm from a) the closest point is. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): { dist: number; along: number } {
  const c = closestPointOnSegment(p, a, b);
  return { dist: Math.hypot(p.x - c.x, p.y - c.y), along: Math.hypot(c.x - a.x, c.y - a.y) };
}

/**
 * Ray versus oriented box. Returns the distance along the ray to the first hit, or null.
 * A ray starting inside the box returns 0.
 */
export function rayOBB(origin: Vec2, dir: Vec2, o: OBB): number | null {
  const frame = { x: o.x, y: o.y, heading: o.angle };
  const lo = worldToLocal(frame, origin);
  const tip = worldToLocal(frame, { x: origin.x + dir.x, y: origin.y + dir.y });
  const df = tip.forward - lo.forward;
  const dr = tip.right - lo.right;
  const hl = o.l / 2;
  const hw = o.w / 2;
  let tmin = 0;
  let tmax = Infinity;
  const slabs: Array<[number, number, number]> = [
    [lo.forward, df, hl],
    [lo.right, dr, hw],
  ];
  for (const [p, d, h] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (p < -h || p > h) return null;
    } else {
      let t1 = (-h - p) / d;
      let t2 = (h - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** Deterministic pseudo-random generator (mulberry32). Returns numbers in [0, 1). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
