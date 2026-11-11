/**
 * Small collision helpers for the physics engine.
 *
 * They do the same maths as obbOverlap() / rayOBB() in geometry.ts, but work on plain numbers and
 * never create objects, because the engine calls them thousands of times per simulated second.
 *
 * A "box" here is a rotated rectangle seen from above, given by
 *   - its centre (x, y),
 *   - its half sizes: hw across (left-right) and hl along its heading (front-back),
 *   - the sine and cosine of its heading (simulator convention: 0 = up the mat, clockwise positive),
 * so its "forward" direction is (sin, -cos) and its "right" direction is (cos, sin).
 */

/** Result of an overlap test. One object is reused for every test. */
export interface Contact {
  /** how deep the two boxes overlap, mm */
  depth: number;
  /** unit vector: moving box B by (nx, ny) * depth separates the boxes */
  nx: number;
  ny: number;
}

export function makeContact(): Contact {
  return { depth: 0, nx: 0, ny: 0 };
}

/** Overlaps thinner than this (mm) are treated as "just touching". */
const MIN_OVERLAP = 1e-4;

/**
 * Separating-axis test between two rotated rectangles A and B.
 * Returns false when they are apart or only touching. Otherwise returns true and fills `out`
 * with the smallest push that moves B out of A.
 */
export function boxesOverlap(
  ax: number,
  ay: number,
  ahw: number,
  ahl: number,
  asin: number,
  acos: number,
  bx: number,
  by: number,
  bhw: number,
  bhl: number,
  bsin: number,
  bcos: number,
  out: Contact,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  // |cos| and |sin| of the angle between the two boxes
  const c = Math.abs(asin * bsin + acos * bcos);
  const s = Math.abs(asin * bcos - acos * bsin);

  // axis 1: A's forward direction (asin, -acos)
  let d = dx * asin - dy * acos;
  let overlap = ahl + bhl * c + bhw * s - Math.abs(d);
  if (overlap <= MIN_OVERLAP) return false;
  let best = overlap;
  let nx = d < 0 ? -asin : asin;
  let ny = d < 0 ? acos : -acos;

  // axis 2: A's right direction (acos, asin)
  d = dx * acos + dy * asin;
  overlap = ahw + bhl * s + bhw * c - Math.abs(d);
  if (overlap <= MIN_OVERLAP) return false;
  if (overlap < best) {
    best = overlap;
    nx = d < 0 ? -acos : acos;
    ny = d < 0 ? -asin : asin;
  }

  // axis 3: B's forward direction (bsin, -bcos)
  d = dx * bsin - dy * bcos;
  overlap = ahl * c + ahw * s + bhl - Math.abs(d);
  if (overlap <= MIN_OVERLAP) return false;
  if (overlap < best) {
    best = overlap;
    nx = d < 0 ? -bsin : bsin;
    ny = d < 0 ? bcos : -bcos;
  }

  // axis 4: B's right direction (bcos, bsin)
  d = dx * bcos + dy * bsin;
  overlap = ahl * s + ahw * c + bhw - Math.abs(d);
  if (overlap <= MIN_OVERLAP) return false;
  if (overlap < best) {
    best = overlap;
    nx = d < 0 ? -bcos : bcos;
    ny = d < 0 ? -bsin : bsin;
  }

  out.depth = best;
  out.nx = nx;
  out.ny = ny;
  return true;
}

/** True when the point (px, py) is inside the box (its edge counts as inside). */
export function pointInBox(
  px: number,
  py: number,
  bx: number,
  by: number,
  bhw: number,
  bhl: number,
  bsin: number,
  bcos: number,
): boolean {
  const dx = px - bx;
  const dy = py - by;
  const forward = dx * bsin - dy * bcos;
  const right = dx * bcos + dy * bsin;
  return Math.abs(forward) <= bhl && Math.abs(right) <= bhw;
}

/**
 * Ray against a box. The ray starts at (ox, oy) and runs along the unit vector (dirx, diry).
 * Returns the distance to the first hit, 0 when the ray starts inside the box, or -1 for a miss.
 */
export function rayBoxDistance(
  ox: number,
  oy: number,
  dirx: number,
  diry: number,
  bx: number,
  by: number,
  bhw: number,
  bhl: number,
  bsin: number,
  bcos: number,
): number {
  // express the ray in the box's own frame (forward, right)
  const px = ox - bx;
  const py = oy - by;
  const pf = px * bsin - py * bcos;
  const pr = px * bcos + py * bsin;
  const df = dirx * bsin - diry * bcos;
  const dr = dirx * bcos + diry * bsin;
  let tmin = 0;
  let tmax = Infinity;

  // slab along the box's forward axis
  if (Math.abs(df) < 1e-12) {
    if (pf < -bhl || pf > bhl) return -1;
  } else {
    let t1 = (-bhl - pf) / df;
    let t2 = (bhl - pf) / df;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // slab along the box's right axis
  if (Math.abs(dr) < 1e-12) {
    if (pr < -bhw || pr > bhw) return -1;
  } else {
    let t1 = (-bhw - pr) / dr;
    let t2 = (bhw - pr) / dr;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
