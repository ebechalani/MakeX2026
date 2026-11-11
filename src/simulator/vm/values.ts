/**
 * Loose typing, the Scratch way.
 *
 * A value in a student program is a number, a text or true/false. Blocks never complain about
 * the "wrong" kind: they convert what they get (the text "12" works as the number 12, an empty
 * slot counts as 0, and so on). These helpers do the converting.
 */
import type { Scalar } from '../core/types';

/** Anything -> number. Text that is not a number, NaN and empty values count as 0. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return 0;
    const n = Number(text);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Like toNumber, but also turns infinity into 0 (for values sent to motors and servos). */
export function toFinite(value: unknown): number {
  const n = toNumber(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Number -> text without the noise of binary arithmetic: 0.1 + 0.2 prints as 0.3,
 * not 0.30000000000000004.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : n > 0 ? 'Infinity' : '-Infinity';
  // whole numbers are exact already; only numbers with decimals need tidying
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

/** Anything -> text. */
export function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

/** Anything -> true/false. Empty text, "0" and "false" are false; the number 0 is false. */
export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text !== '' && text !== '0' && text !== 'false';
  }
  return false;
}

/** True when the value is a number or a text that reads as a number ("3", " 2.5 ", "-1e3"). */
export function looksNumeric(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    const text = value.trim();
    return text !== '' && !Number.isNaN(Number(text));
  }
  return false;
}

/**
 * Compare two values: as numbers when both look like numbers, otherwise as texts ignoring
 * upper / lower case. Returns a negative number, 0 or a positive number (a < b, a = b, a > b).
 */
export function compare(a: Scalar, b: Scalar): number {
  if (looksNumeric(a) && looksNumeric(b)) {
    const x = toNumber(a);
    const y = toNumber(b);
    if (x === y) return 0;
    // tiny tolerance so that 0.1 + 0.2 = 0.3 is true (not for infinity, which has no "nearly")
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return 0;
    return x < y ? -1 : 1;
  }
  const s = toText(a).toLowerCase();
  const t = toText(b).toLowerCase();
  return s < t ? -1 : s > t ? 1 : 0;
}

/** Whole number check used by "pick random". */
export function isWholeNumber(value: unknown): boolean {
  if (typeof value === 'number') return Number.isInteger(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return !value.includes('.') && Number.isInteger(toNumber(value));
  return false;
}

/** Limit a number to a range. */
export function clampNumber(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** '#rrggbb' (or '#rgb') -> { r, g, b }. Anything unreadable gives black. */
export function parseColour(value: unknown): { r: number; g: number; b: number } {
  const text = typeof value === 'string' ? value.trim().replace(/^#/, '') : '';
  const full = text.length === 3 ? text.replace(/(.)/g, '$1$1') : text;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}
