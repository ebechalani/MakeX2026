/**
 * A Fire Rescue "combination": the randomised starting arrangement of one match (rules §3).
 *
 *  - which coloured bucket stands on each water tower W1..W4      (4! = 24 arrangements)
 *  - in which square (1 = left, 2 = right) each building's person stands; the other square of
 *    that building is its water delivery target                    (2^4 = 16 arrangements)
 *  - which colour of person stands at which building               (4! = 24 arrangements)
 *
 * 24 x 16 x 24 = 9216 combinations in total.
 */
import type { ColorName } from '../core/types';
import { BUILDING_IDS, WATER_TOWER_IDS, type BuildingId, type BuildingSlot, type WaterTowerId } from './field';

export const COLORS: ColorName[] = ['red', 'green', 'blue', 'yellow'];

export interface FireRescueScenario {
  /** colour of the bucket standing on each water tower */
  buckets: Record<WaterTowerId, ColorName>;
  /** per building: the square the person starts in and the person's colour */
  people: Record<BuildingId, { slot: BuildingSlot; color: ColorName }>;
}

const LETTER: Record<ColorName, string> = { red: 'R', green: 'G', blue: 'B', yellow: 'Y' };
const FROM_LETTER: Record<string, ColorName> = { R: 'red', G: 'green', B: 'blue', Y: 'yellow' };

/** All 24 orderings of the four colours, in a fixed (lexicographic by COLORS index) order. */
export const COLOR_PERMUTATIONS: ColorName[][] = (() => {
  const out: ColorName[][] = [];
  const walk = (rest: ColorName[], acc: ColorName[]) => {
    if (rest.length === 0) {
      out.push(acc);
      return;
    }
    rest.forEach((c, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, c]));
  };
  walk(COLORS, []);
  return out;
})();

export const SCENARIO_COUNT = 24 * 16 * 24;

/** The arrangement drawn in the rule book: R G B Y on W1..W4, everybody in square 1, people matching their building. */
export function defaultScenario(): FireRescueScenario {
  return {
    buckets: { W1: 'red', W2: 'green', W3: 'blue', W4: 'yellow' },
    people: {
      A: { slot: 1, color: 'red' },
      B: { slot: 1, color: 'blue' },
      C: { slot: 1, color: 'yellow' },
      D: { slot: 1, color: 'green' },
    },
  };
}

export function isValidScenario(s: FireRescueScenario): boolean {
  const bucketColors = WATER_TOWER_IDS.map((w) => s.buckets[w]);
  const peopleColors = BUILDING_IDS.map((b) => s.people[b]?.color);
  const isPermutation = (list: Array<ColorName | undefined>) =>
    list.length === 4 && COLORS.every((c) => list.includes(c));
  return (
    isPermutation(bucketColors) &&
    isPermutation(peopleColors) &&
    BUILDING_IDS.every((b) => s.people[b].slot === 1 || s.people[b].slot === 2)
  );
}

function permutationIndex(colors: ColorName[]): number {
  return COLOR_PERMUTATIONS.findIndex((p) => p.every((c, i) => c === colors[i]));
}

/** Number 0 .. 9215 identifying the combination. */
export function scenarioIndex(s: FireRescueScenario): number {
  const b = permutationIndex(WATER_TOWER_IDS.map((w) => s.buckets[w]));
  const p = permutationIndex(BUILDING_IDS.map((id) => s.people[id].color));
  let slots = 0;
  BUILDING_IDS.forEach((id, i) => {
    if (s.people[id].slot === 2) slots |= 1 << i;
  });
  return (b * 16 + slots) * 24 + p;
}

export function scenarioFromIndex(index: number): FireRescueScenario {
  const n = ((Math.floor(index) % SCENARIO_COUNT) + SCENARIO_COUNT) % SCENARIO_COUNT;
  const p = n % 24;
  const slots = Math.floor(n / 24) % 16;
  const b = Math.floor(n / (24 * 16));
  const bucketColors = COLOR_PERMUTATIONS[b];
  const peopleColors = COLOR_PERMUTATIONS[p];
  const s = defaultScenario();
  WATER_TOWER_IDS.forEach((w, i) => {
    s.buckets[w] = bucketColors[i];
  });
  BUILDING_IDS.forEach((id, i) => {
    s.people[id] = { slot: (slots >> i) & 1 ? 2 : 1, color: peopleColors[i] };
  });
  return s;
}

export function randomScenario(rng: () => number): FireRescueScenario {
  return scenarioFromIndex(Math.floor(rng() * SCENARIO_COUNT));
}

/**
 * Short code a teacher can write on the board, e.g. "RGBY-A1R-B2B-C1Y-D2G":
 * bucket colours on W1 W2 W3 W4, then for each building the person's square and colour.
 */
export function encodeScenario(s: FireRescueScenario): string {
  const buckets = WATER_TOWER_IDS.map((w) => LETTER[s.buckets[w]]).join('');
  const people = BUILDING_IDS.map((id) => `${id}${s.people[id].slot}${LETTER[s.people[id].color]}`);
  return [buckets, ...people].join('-');
}

/** Accepts the code in any letter case, with any separators, or a plain number 0..9215. */
export function decodeScenario(code: string): FireRescueScenario | null {
  const trimmed = code.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 0 && n < SCENARIO_COUNT ? scenarioFromIndex(n) : null;
  }
  const compact = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^([RGBY]{4})A([12])([RGBY])B([12])([RGBY])C([12])([RGBY])D([12])([RGBY])$/.exec(compact);
  if (!m) return null;
  const s = defaultScenario();
  WATER_TOWER_IDS.forEach((w, i) => {
    s.buckets[w] = FROM_LETTER[m[1][i]];
  });
  BUILDING_IDS.forEach((id, i) => {
    s.people[id] = { slot: m[2 + i * 2] === '2' ? 2 : 1, color: FROM_LETTER[m[3 + i * 2]] };
  });
  return isValidScenario(s) ? s : null;
}

export function describeScenario(s: FireRescueScenario): string {
  const buckets = WATER_TOWER_IDS.map((w) => `${w} ${s.buckets[w]}`).join(', ');
  const people = BUILDING_IDS.map((id) => `${id}${s.people[id].slot} ${s.people[id].color}`).join(', ');
  return `Buckets: ${buckets}. People: ${people}.`;
}

/** Swap two entries so that the arrangement stays a valid permutation when one colour is edited. */
export function withBucket(s: FireRescueScenario, tower: WaterTowerId, color: ColorName): FireRescueScenario {
  const next: FireRescueScenario = { buckets: { ...s.buckets }, people: { ...s.people } };
  const other = WATER_TOWER_IDS.find((w) => next.buckets[w] === color);
  if (other && other !== tower) next.buckets[other] = next.buckets[tower];
  next.buckets[tower] = color;
  return next;
}

export function withPersonColor(s: FireRescueScenario, building: BuildingId, color: ColorName): FireRescueScenario {
  const next: FireRescueScenario = { buckets: { ...s.buckets }, people: { ...s.people } };
  const other = BUILDING_IDS.find((b) => next.people[b].color === color);
  if (other && other !== building) next.people[other] = { ...next.people[other], color: next.people[building].color };
  next.people[building] = { ...next.people[building], color };
  return next;
}

export function withPersonSlot(s: FireRescueScenario, building: BuildingId, slot: BuildingSlot): FireRescueScenario {
  return { buckets: { ...s.buckets }, people: { ...s.people, [building]: { ...s.people[building], slot } } };
}
