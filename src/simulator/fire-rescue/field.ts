/**
 * MakeX Lebanon 2027 - Fire Rescue mat (v3), measured from the vectors of the print PDF
 * "Fire Rescue 1250mm v3.pdf". Everything is in millimetres, origin at the top-left corner of
 * the mat (the side with the MakeX Lebanon logo is "top"), +x right, +y down.
 */
import type { Rect, Vec2 } from '../core/geometry';
import type { ColorName, MatVector, RGB } from '../core/types';

export const MAT_SIZE = 1250;

export const MAT_IMAGE_URL = '/simulator/fire-rescue/mat.webp';
export const MAT_SENSOR_IMAGE_URL = '/simulator/fire-rescue/mat-sensor.webp';

/** Width of every black guide line on the mat. */
export const LINE_WIDTH = 26;

// ---------------------------------------------------------------- game element sizes (rules §2)
export const TOWER_SIZE = 70;
export const TOWER_HEIGHT = 50;
export const BUCKET_SIZE = 40;
export const BUCKET_HEIGHT = 40;
export const PERSON_SIZE = 40;
export const PERSON_HEIGHT = 60;
export const ROBOT_MAX_SIZE = 250;

/** Thickness of the dashed outlines printed around the squares ("including its boundary"). */
export const DASH_OUTLINE_WIDTH = 4.9;

// ---------------------------------------------------------------- zones
export const FIRE_STATION: Rect = { x: 500, y: 500.7, w: 250, h: 250 };

export type WaterTowerId = 'W1' | 'W2' | 'W3' | 'W4';
export const WATER_TOWER_IDS: WaterTowerId[] = ['W1', 'W2', 'W3', 'W4'];

/** Orange dashed squares that hold the water towers. */
export const WATER_SQUARES: Record<WaterTowerId, Rect> = {
  W1: { x: 386.0, y: 391.7, w: 69.7, h: 69.6 },
  W2: { x: 790.1, y: 393.3, w: 69.6, h: 69.7 },
  W3: { x: 387.0, y: 790.4, w: 69.6, h: 69.7 },
  W4: { x: 791.0, y: 792.1, w: 69.7, h: 69.6 },
};

export type BuildingId = 'A' | 'B' | 'C' | 'D';
export const BUILDING_IDS: BuildingId[] = ['A', 'B', 'C', 'D'];
export type BuildingSlot = 1 | 2;

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** colour of the bucket that must be delivered here (rules §5) */
  color: ColorName;
  /** illustrated tile on the mat */
  tile: Rect;
  /** the two white dashed 60 x 60 squares: [slot 1 (left), slot 2 (right)] */
  squares: [Rect, Rect];
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  A: {
    id: 'A',
    name: 'Apartment',
    color: 'red',
    tile: { x: 979.1, y: 19.9, w: 249.4, h: 249.4 },
    squares: [
      { x: 1020, y: 85.3, w: 60, h: 60 },
      { x: 1130, y: 85.3, w: 60, h: 60 },
    ],
  },
  B: {
    id: 'B',
    name: 'School',
    color: 'blue',
    tile: { x: 19.4, y: 19.9, w: 249.4, h: 249.4 },
    squares: [
      { x: 60, y: 85.3, w: 60, h: 60 },
      { x: 170, y: 85.3, w: 60, h: 60 },
    ],
  },
  C: {
    id: 'C',
    name: 'Workshop',
    color: 'yellow',
    tile: { x: 20.9, y: 987.1, w: 249.4, h: 249.4 },
    squares: [
      { x: 60.1, y: 1104.8, w: 60, h: 60 },
      { x: 170.1, y: 1104.8, w: 60, h: 60 },
    ],
  },
  D: {
    id: 'D',
    name: 'Clinic',
    color: 'green',
    tile: { x: 980.7, y: 987.1, w: 249.4, h: 249.4 },
    squares: [
      { x: 1020.1, y: 1104.7, w: 60, h: 60 },
      { x: 1130.1, y: 1104.7, w: 60, h: 60 },
    ],
  },
};

/** Which building wants which bucket colour. */
export const BUCKET_DESTINATION: Record<ColorName, BuildingId> = {
  red: 'A',
  blue: 'B',
  yellow: 'C',
  green: 'D',
};

export type RescueTowerId = 'RG' | 'RY' | 'RB' | 'RR';
export const RESCUE_TOWER_IDS: RescueTowerId[] = ['RG', 'RY', 'RB', 'RR'];

export interface RescueSquareDef {
  id: RescueTowerId;
  color: ColorName;
  rect: Rect;
  zone: 'upper' | 'lower';
}

/** Coloured dashed 60 x 60 squares inside the two safe zones; one rescue tower stands on each. */
export const RESCUE_SQUARES: Record<RescueTowerId, RescueSquareDef> = {
  RG: { id: 'RG', color: 'green', rect: { x: 540, y: 113.4, w: 60, h: 60 }, zone: 'upper' },
  RY: { id: 'RY', color: 'yellow', rect: { x: 650, y: 114.1, w: 60, h: 60 }, zone: 'upper' },
  RB: { id: 'RB', color: 'blue', rect: { x: 540, y: 1070.2, w: 60, h: 60 }, zone: 'lower' },
  RR: { id: 'RR', color: 'red', rect: { x: 650, y: 1070.2, w: 60, h: 60 }, zone: 'lower' },
};

export const RESCUE_TOWER_BY_COLOR: Record<ColorName, RescueTowerId> = {
  green: 'RG',
  yellow: 'RY',
  blue: 'RB',
  red: 'RR',
};

export const SAFE_ZONE_TILES: Record<'upper' | 'lower', Rect> = {
  upper: { x: 500, y: 81.7, w: 250, h: 120.1 },
  lower: { x: 499.9, y: 1045.9, w: 250, h: 120 },
};

// ---------------------------------------------------------------- line network
/** Closed loop around the Fire Station. */
export const MAIN_LOOP: Vec2[] = [
  { x: 310, y: 310 },
  { x: 430, y: 310 },
  { x: 545, y: 395 },
  { x: 705, y: 395 },
  { x: 820, y: 310 },
  { x: 940, y: 310 },
  { x: 940, y: 430 },
  { x: 855, y: 545 },
  { x: 855, y: 705 },
  { x: 940, y: 820 },
  { x: 940, y: 940 },
  { x: 820, y: 940 },
  { x: 705, y: 855 },
  { x: 545, y: 855 },
  { x: 430, y: 940 },
  { x: 310, y: 940 },
  { x: 310, y: 820 },
  { x: 395, y: 705 },
  { x: 395, y: 545 },
  { x: 310, y: 430 },
];

/** Open black polylines (all 26 mm wide). Spurs run on into the building tiles as dark bars. */
export const BLACK_POLYLINES: Vec2[][] = [
  // centre line: upper safe zone -> Fire Station, Fire Station -> lower safe zone
  [
    { x: 625, y: 150 },
    { x: 625, y: 500 },
  ],
  [
    { x: 625, y: 750 },
    { x: 625, y: 1100 },
  ],
  // B School (top-left)
  [
    { x: 310, y: 310 },
    { x: 90, y: 310 },
    { x: 90, y: 176.5 },
  ],
  [
    { x: 200, y: 310 },
    { x: 200, y: 176.5 },
  ],
  // A Apartment (top-right)
  [
    { x: 940, y: 310 },
    { x: 1160, y: 310 },
    { x: 1160, y: 176.5 },
  ],
  [
    { x: 1050, y: 310 },
    { x: 1050, y: 176.5 },
  ],
  // C Workshop (bottom-left)
  [
    { x: 310, y: 940 },
    { x: 90, y: 940 },
    { x: 90, y: 1073.5 },
  ],
  [
    { x: 200, y: 940 },
    { x: 200, y: 1073.5 },
  ],
  // D Clinic (bottom-right)
  [
    { x: 940, y: 940 },
    { x: 1160, y: 940 },
    { x: 1160, y: 1073.5 },
  ],
  [
    { x: 1050, y: 940 },
    { x: 1050, y: 1073.5 },
  ],
];

/** Solid yellow markers painted over the black line (26 mm wide). */
export const YELLOW_MARKERS: Array<[Vec2, Vec2]> = [
  [
    { x: 587.8, y: 395.2 },
    { x: 659.2, y: 395.2 },
  ],
  [
    { x: 587.0, y: 855.3 },
    { x: 658.4, y: 855.3 },
  ],
  [
    { x: 394.9, y: 589.3 },
    { x: 394.9, y: 660.7 },
  ],
  [
    { x: 854.6, y: 590.1 },
    { x: 854.6, y: 661.5 },
  ],
];

/**
 * Outer side lines: a yellow base with black dashes on top.
 * The dash pattern starts at `from` with 82.9 mm of black followed by 57.5 mm of yellow.
 */
export const SIDE_LINES = [
  { x: 143.9, from: 302.0, to: 946.8, yellowFrom: 311.8, yellowTo: 924.0 },
  { x: 1104.9, from: 305.0, to: 949.8, yellowFrom: 318.0, yellowTo: 930.2 },
];
export const SIDE_LINE_WIDTH = 25.4;
export const SIDE_LINE_DASH = { on: 82.94, off: 57.54 };

// ---------------------------------------------------------------- colours as printed
const BLACK: RGB = { r: 8, g: 7, b: 6 };
const DARK: RGB = { r: 35, g: 31, b: 32 };
const YELLOW: RGB = { r: 255, g: 242, b: 0 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const TILE: RGB = { r: 150, g: 160, b: 110 };
const STATION: RGB = { r: 190, g: 150, b: 130 };
const SAFE: RGB = { r: 170, g: 175, b: 130 };

export const PRINT_COLORS: Record<ColorName | 'orange' | 'white', RGB> = {
  red: { r: 239, g: 64, b: 68 },
  green: { r: 64, g: 173, b: 73 },
  blue: { r: 0, g: 174, b: 239 },
  yellow: YELLOW,
  orange: { r: 250, g: 162, b: 26 },
  white: WHITE,
};

function outline(rect: Rect, color: RGB, width: number) {
  return {
    kind: 'stroke' as const,
    points: [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ],
    closed: true,
    width,
    color,
    dash: { on: 12, off: 12 },
  };
}

/**
 * A purely geometric description of the mat. The browser normally samples the real mat picture,
 * this vector model is the fallback (before the picture has loaded) and what the headless tests use.
 * Layers are painted in order (later layers cover earlier ones).
 */
export const MAT_VECTOR: MatVector = {
  width: MAT_SIZE,
  height: MAT_SIZE,
  background: WHITE,
  outside: { r: 120, g: 120, b: 120 },
  layers: [
    // illustrated tiles (flat average colours)
    ...BUILDING_IDS.map((id) => ({ kind: 'rect' as const, rect: BUILDINGS[id].tile, color: TILE })),
    { kind: 'rect' as const, rect: SAFE_ZONE_TILES.upper, color: SAFE },
    { kind: 'rect' as const, rect: SAFE_ZONE_TILES.lower, color: SAFE },
    { kind: 'rect' as const, rect: FIRE_STATION, color: STATION },
    // dashed square outlines
    ...WATER_TOWER_IDS.map((id) => outline(WATER_SQUARES[id], PRINT_COLORS.orange, 1.8)),
    ...BUILDING_IDS.flatMap((id) => BUILDINGS[id].squares.map((sq) => outline(sq, WHITE, DASH_OUTLINE_WIDTH))),
    ...RESCUE_TOWER_IDS.map((id) =>
      outline(RESCUE_SQUARES[id].rect, PRINT_COLORS[RESCUE_SQUARES[id].color], DASH_OUTLINE_WIDTH),
    ),
    // outer side lines: yellow base, black dashes on top
    ...SIDE_LINES.map((s) => ({
      kind: 'stroke' as const,
      points: [
        { x: s.x, y: s.yellowFrom },
        { x: s.x, y: s.yellowTo },
      ],
      width: SIDE_LINE_WIDTH,
      color: YELLOW,
    })),
    ...SIDE_LINES.map((s) => ({
      kind: 'stroke' as const,
      points: [
        { x: s.x, y: s.from },
        { x: s.x, y: s.to },
      ],
      width: SIDE_LINE_WIDTH,
      color: DARK,
      dash: SIDE_LINE_DASH,
    })),
    // black line network
    { kind: 'stroke' as const, points: MAIN_LOOP, closed: true, width: LINE_WIDTH, color: BLACK },
    ...BLACK_POLYLINES.map((points) => ({ kind: 'stroke' as const, points, width: LINE_WIDTH, color: BLACK })),
    // yellow markers on top of the black line
    ...YELLOW_MARKERS.map(([a, b]) => ({
      kind: 'stroke' as const,
      points: [a, b],
      width: LINE_WIDTH,
      color: YELLOW,
    })),
  ],
};
