/**
 * The path the robot has driven, kept as a list of points for the stage to draw.
 * Plain TypeScript (no DOM), so it can be unit-tested under Node.
 */

/** A new point is stored only after the robot has moved this far (mm). */
const MIN_STEP = 4;
/** Oldest points are dropped beyond this many (a full 3-minute match at top speed stays below it). */
const MAX_POINTS = 30000;

export class Trail {
  /** x0, y0, x1, y1 ... ; a NaN pair marks a gap (the robot was lifted back to the start zone) */
  private data: number[] = [];
  private lastX = NaN;
  private lastY = NaN;
  /** grows whenever the trail changes, so the stage knows it must redraw */
  version = 0;

  /** Number of stored entries (points and gap markers). */
  get length(): number {
    return this.data.length / 2;
  }

  /** Read-only view of the stored coordinates. */
  get points(): readonly number[] {
    return this.data;
  }

  /** Record where the robot is now. Returns true when a point was added. */
  add(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!Number.isNaN(this.lastX)) {
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return false;
    }
    this.data.push(x, y);
    this.lastX = x;
    this.lastY = y;
    if (this.data.length > MAX_POINTS * 2) this.data.splice(0, this.data.length - MAX_POINTS * 2);
    this.version++;
    return true;
  }

  /** The robot was picked up and put somewhere else: do not join the old and the new position. */
  breakLine(): void {
    if (this.data.length === 0 || Number.isNaN(this.lastX)) return;
    this.data.push(NaN, NaN);
    this.lastX = NaN;
    this.lastY = NaN;
    this.version++;
  }

  clear(): void {
    this.data = [];
    this.lastX = NaN;
    this.lastY = NaN;
    this.version++;
  }
}
