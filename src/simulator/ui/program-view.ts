/**
 * How large to show a program in the block workspace right after it was loaded
 * (an example, a file, the saved blocks after a reload).
 *
 * The rule, in plain words:
 *   1. A program that fits the editor at the normal size is shown at the normal size.
 *   2. A program that is too large is made smaller until all of it can be seen - but never
 *      smaller than "still easy to read".
 *   3. A program that is too large even then (a long one) is made just small enough that its
 *      full WIDTH can be seen, so that reading it only needs scrolling down, like a page of text.
 *      If that is not possible either, it is shown at the smallest readable size.
 * It is never shown larger than the normal size.
 *
 * Plain TypeScript (no DOM, no Blockly), so it can be unit-tested under Node.
 */

export interface ProgramViewInput {
  /** size of the whole program at zoom 1 (Blockly "workspace units") */
  contentWidth: number;
  contentHeight: number;
  /** size of the visible part of the workspace, in pixels (the block palette's column not counted) */
  viewWidth: number;
  viewHeight: number;
  /** pixels kept free around the program: left + right, and top + bottom */
  marginX: number;
  marginY: number;
  /** the normal zoom of the editor */
  defaultScale: number;
  /** the smallest zoom that is still easy to read */
  minScale: number;
}

/** The zoom at which a freshly loaded program is shown (see the rule at the top of this file). */
export function programFitScale(input: ProgramViewInput): number {
  const { contentWidth, contentHeight, defaultScale } = input;
  const minScale = Math.min(input.minScale, defaultScale);
  const roomX = input.viewWidth - input.marginX;
  const roomY = input.viewHeight - input.marginY;
  // nothing to show, or the editor has no size yet (hidden, still being laid out)
  if (!(contentWidth > 0) || !(contentHeight > 0) || !(roomX > 0) || !(roomY > 0)) return defaultScale;

  const fitWidth = roomX / contentWidth;
  const fitAll = Math.min(fitWidth, roomY / contentHeight);
  if (fitAll >= defaultScale) return defaultScale;
  if (fitAll >= minScale) return fitAll;
  return Math.max(minScale, Math.min(defaultScale, fitWidth));
}
