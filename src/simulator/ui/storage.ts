/**
 * Remembering things in the browser (localStorage), without ever throwing: private windows,
 * blocked storage and a full disk must not break the simulator.
 */

/** Every key of the simulator starts with this, followed by the game id. */
export function storageKey(gameId: string, name: string): string {
  return `mbot2-sim:${gameId}:${name}`;
}

export function loadJson<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const text = localStorage.getItem(key);
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    // nothing to do: storage is not available
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
