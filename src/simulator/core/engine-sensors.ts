/**
 * How the simulated sensors turn "what is physically there" into the numbers a program reads.
 * The engine decides WHERE a sensor looks, this file decides what it reports.
 * (At the bottom: a faster version of the vector mat sampler, used when no sampler is given.)
 */
import { VectorMatSampler } from './mat';
import type { MatSampler, MatVector, ProbeReading, RGB, SensorColor } from './types';

/** Brightness of a colour as a light sensor sees it: 0 (black) .. 100 (white). */
export function lightOf(rgb: RGB): number {
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 2.55;
}

/**
 * Name the colour like the Quad RGB sensor does: one of eight names, always.
 *
 *  - very dark                      -> black
 *  - pale / greyish (low saturation) -> white (or black when it is also dark)
 *  - otherwise by hue: red, yellow (orange counts as yellow), green, cyan, blue, purple
 *
 * The "blue" printed on the MakeX mats is a light sky blue (0, 174, 239). Its hue (196 degrees)
 * lies between pure cyan (180) and pure blue (240); the border is set at 188 so that it reads as
 * blue, like on the real sensor.
 */
export function classifyColor(rgb: RGB): SensorColor {
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 70) return 'black';
  const delta = max - min;
  if (delta / max < 0.4) return max < 110 ? 'black' : 'white';

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;

  if (hue < 20 || hue >= 330) return 'red';
  if (hue < 70) return 'yellow';
  if (hue < 160) return 'green';
  if (hue < 188) return 'cyan';
  if (hue < 265) return 'blue';
  return 'purple';
}

/** Everything one Quad RGB probe reports for the colour it is looking at. */
export function makeProbeReading(rgb: RGB, lineThreshold: number): ProbeReading {
  const light = lightOf(rgb);
  return {
    rgb,
    light,
    gray: 100 - light,
    onLine: light < lineThreshold,
    color: classifyColor(rgb),
  };
}

/** 4-bit line status: bit 3 = L2, bit 2 = L1, bit 1 = R1, bit 0 = R2 (1 = that probe is on the line). */
export function lineStatusOf(readings: readonly ProbeReading[]): number {
  let status = 0;
  for (let i = 0; i < 4; i++) {
    if (readings[i].onLine) status |= 8 >> i;
  }
  return status;
}

/**
 * The line deviation, with the same sign as on the real mBot2 (the mBlock block "quad rgb sensor
 * deviation (-100~100)", in Python `mbuild.quad_rgb_sensor.get_offset_track(1)`). It tells where
 * the SENSOR is, seen from the line - not where the line is, seen from the sensor:
 *
 *   -100  the sensor (the robot) is far to the LEFT of the line: the line is under the right probes
 *      0  the line is in the middle, or no probe sees a line
 *   +100  the sensor (the robot) is far to the RIGHT of the line: the line is under the left probes
 *
 * That is the sign Makeblock's own line follower is written for, so it works here unchanged:
 *
 *   EM1 (left motor)  power =       base_power - kp * deviation
 *   EM2 (right motor) power = -1 * (base_power + kp * deviation)     (EM2 is mounted mirrored)
 *
 * Robot left of the line -> negative deviation -> the left wheel speeds up, the right wheel slows
 * down -> the robot turns right, back towards the line.
 *
 * The size of the value comes from the average position of the probes that see the line, each
 * weighted by how dark it reads. `probeOffsets` are the positions of L2, L1, R1, R2 across the
 * robot (negative = left of the middle).
 */
export function lineOffsetOf(
  readings: readonly ProbeReading[],
  probeOffsets: readonly number[],
  lineThreshold: number,
): number {
  let reach = 0;
  for (let i = 0; i < 4; i++) reach = Math.max(reach, Math.abs(probeOffsets[i]));
  if (reach <= 0 || lineThreshold <= 0) return 0;

  let weightSum = 0;
  /** where the line is under the sensor: -1 = under the far-left probe .. +1 = under the far-right probe */
  let linePositionSum = 0;
  for (let i = 0; i < 4; i++) {
    // weight 0 at the line threshold, growing to 1 when the probe reads half the threshold or less
    const weight = Math.min(1, Math.max(0, (lineThreshold - readings[i].light) / (lineThreshold / 2)));
    weightSum += weight;
    linePositionSum += weight * (probeOffsets[i] / reach);
  }
  if (weightSum < 1e-9) return 0;
  // A line under the RIGHT probes means the sensor sits to the LEFT of the line: the sign turns round.
  const deviation = (-100 * linePositionSum) / weightSum;
  return deviation === 0 ? 0 : deviation; // (so a centred line reads 0, never "-0")
}

/**
 * Repeatable "random" number in -1 .. 1 for sensor noise. It depends only on the seed, the tick
 * and a channel number, so a sensor reads the same value no matter how often (or by whom) it is
 * read during one tick - looking at the dashboard never changes what the program sees.
 */
export function hashNoise(seed: number, tick: number, channel: number): number {
  let h = (seed ^ Math.imul(tick + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2147483648 - 1;
}

// =============================================================================================
// A fast sampler for the vector mat
// =============================================================================================

/** Size of one remembered square of the mat, mm. */
const CELL = 1;

/**
 * Working out the colour of a point of the vector mat means checking it against every line and
 * square that is printed on it. A line-following robot asks for 20 points on every tick, so this
 * wrapper remembers the answers: the mat is divided into 1 mm squares, and the colour in the
 * middle of a square is looked up only the first time a sensor looks at that square.
 */
class GridCachedSampler implements MatSampler {
  private readonly cols: number;
  private readonly rows: number;
  /** per square: 0 = not looked at yet, otherwise 1 + index into `colors` */
  private readonly cells: Uint16Array;
  private readonly colors: RGB[] = [];
  private readonly colorIndex = new Map<RGB, number>();

  constructor(
    private readonly inner: MatSampler,
    private readonly width: number,
    private readonly height: number,
  ) {
    this.cols = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.cells = new Uint16Array(this.cols * this.rows);
  }

  sample(x: number, y: number): RGB {
    if (!(x >= 0 && y >= 0 && x < this.width && y < this.height)) return this.inner.sample(x, y);
    const col = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    const at = row * this.cols + col;
    const known = this.cells[at];
    if (known !== 0) return this.colors[known - 1];

    const color = this.inner.sample(
      Math.min((col + 0.5) * CELL, this.width),
      Math.min((row + 0.5) * CELL, this.height),
    );
    let index = this.colorIndex.get(color);
    if (index === undefined) {
      if (this.colors.length >= 65535) return color; // (cannot happen with a vector mat: it has a few colours)
      index = this.colors.length;
      this.colors.push(color);
      this.colorIndex.set(color, index);
    }
    this.cells[at] = index + 1;
    return color;
  }
}

const samplerCache = new WeakMap<MatVector, MatSampler>();

/**
 * The default floor sampler of a simulation: the vector description of the mat, with remembered
 * answers. All simulations of the same mat share one sampler (a batch run builds it only once).
 */
export function fastVectorSampler(mat: MatVector): MatSampler {
  let sampler = samplerCache.get(mat);
  if (!sampler) {
    sampler = new GridCachedSampler(new VectorMatSampler(mat), mat.width, mat.height);
    samplerCache.set(mat, sampler);
  }
  return sampler;
}
