/**
 * Small text and colour helpers shared by the simulator screens.
 * Plain TypeScript (no DOM, no React), so it can be unit-tested under Node.
 */
import type { FinishReason, RGB, SimEvent } from '../core/types';

/** 125.4 -> "2:05" (whole seconds, rounded up so the clock shows 3:00 until time really starts to run). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds - 1e-6));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 65.42 -> "1:05.4" (used for time stamps in the console and the results table). */
export function formatStamp(seconds: number): string {
  // work in whole tenths of a second, so that 59.97 becomes "1:00.0" and never "0:60.0"
  const tenths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** A number for the dashboard: at most `digits` decimals, no "-0". */
export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '-';
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

export function rgbCss(c: RGB): string {
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)})`;
}

/** Parse '#rgb' or '#rrggbb'. Anything else gives mid grey. */
export function parseHex(hex: string): RGB {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m3) return { r: parseInt(m3[1] + m3[1], 16), g: parseInt(m3[2] + m3[2], 16), b: parseInt(m3[3] + m3[3], 16) };
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m6) return { r: parseInt(m6[1], 16), g: parseInt(m6[2], 16), b: parseInt(m6[3], 16) };
  return { r: 128, g: 128, b: 128 };
}

/** Perceived brightness 0 (black) .. 1 (white). */
export function luminance(c: RGB): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/** Mix a colour with black (amount < 0) or white (amount > 0); amount is -1 .. 1. */
export function shade(c: RGB, amount: number): RGB {
  const target = amount < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amount));
  return {
    r: c.r + (target - c.r) * k,
    g: c.g + (target - c.g) * k,
    b: c.b + (target - c.b) * k,
  };
}

/** Black or white, whichever is easier to read on top of this colour. */
export function inkOn(c: RGB): string {
  return luminance(c) > 0.6 ? '#111827' : '#ffffff';
}

/** "tower:W1" -> "tower W1", "bucket:red" -> "the red bucket", "wall" -> "the table wall". */
export function bodyName(bodyId: string): string {
  if (bodyId === 'wall') return 'the table wall';
  const [kind, name] = bodyId.split(':');
  if (!name) return bodyId;
  if (kind === 'tower') return `tower ${name}`;
  return `the ${name} ${kind}`;
}

export function finishText(reason: FinishReason | null): string {
  switch (reason) {
    case 'time':
      return 'Time is up';
    case 'declared':
      return 'You declared "Finished"';
    case 'program-ended':
      return 'The program ended';
    default:
      return 'Match over';
  }
}

/**
 * What the restarts of this match have cost so far: "1 restart: -5 points", "3 restarts: -15 points".
 * Empty when there was no restart. (The total score can never go below 0, so with few points on
 * the board a restart does not change the score - this note is then the only sign of the penalty.)
 */
export function restartNote(restarts: number, penaltyEach: number): string {
  const count = Number.isFinite(restarts) ? Math.max(0, Math.floor(restarts)) : 0;
  if (count === 0) return '';
  const lost = count * Math.abs(penaltyEach);
  return `${count} restart${count === 1 ? '' : 's'}: -${lost} point${lost === 1 ? '' : 's'}`;
}

/**
 * The CyberPi screen is narrow: a printed line that is longer than `columns` characters
 * continues on the next row, like on the real screen. Returns the rows to draw.
 */
export function wrapScreenLines(lines: readonly string[], columns: number): string[] {
  const width = Math.max(1, Math.floor(columns));
  const rows: string[] = [];
  for (const line of lines) {
    if (line.length <= width) {
      rows.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += width) rows.push(line.slice(i, i + width));
  }
  return rows;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'event';

export interface LogLine {
  /** running number, used as the React key */
  n: number;
  time: number;
  level: LogLevel;
  text: string;
  /** the block that caused it, when known: clicking the line selects that block */
  blockId?: string;
  /** how many times in a row the same line was produced */
  count: number;
}

/**
 * Turn an engine event into a line for the console, in words a student understands.
 * Returns null for events that are not worth a line (sounds).
 */
export function describeEvent(event: SimEvent): Omit<LogLine, 'n' | 'count'> | null {
  switch (event.type) {
    case 'log':
      return { time: event.time, level: event.level, text: event.text, blockId: event.blockId };
    case 'grab':
      return { time: event.time, level: 'event', text: `Picked up ${bodyName(event.bodyId)}.` };
    case 'release':
      return {
        time: event.time,
        level: 'event',
        text: `Put down ${bodyName(event.bodyId)} ${event.onto ? `on ${bodyName(event.onto)}` : 'on the mat'}.`,
      };
    case 'bump':
      return { time: event.time, level: 'event', text: `Bumped into ${bodyName(event.bodyId)}.` };
    case 'restart':
      return { time: event.time, level: 'warn', text: 'Restart: the robot is back in the start zone (-5 points).' };
    case 'finish':
      return { time: event.time, level: 'info', text: `${finishText(event.reason)} - the match is over.` };
    case 'tone':
      return null;
  }
}

/** Append a line, merging it with the previous one when it says the same thing; keeps the last `max` lines. */
export function appendLog(lines: LogLine[], entry: Omit<LogLine, 'n' | 'count'>, max = 300): LogLine[] {
  const last = lines[lines.length - 1];
  if (last && last.text === entry.text && last.level === entry.level && last.blockId === entry.blockId) {
    return [...lines.slice(0, -1), { ...last, count: last.count + 1, time: entry.time }];
  }
  const next = [...lines, { ...entry, n: (last?.n ?? 0) + 1, count: 1 }];
  return next.length > max ? next.slice(next.length - max) : next;
}
