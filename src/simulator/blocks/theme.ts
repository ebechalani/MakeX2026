/**
 * Look of the block editor: the "zelos" renderer (rounded Scratch-style blocks) and a theme with
 * Scratch / mBlock colours.
 *
 * Pure data, no Blockly import: Blockly.inject() accepts the theme as a plain object.
 *
 *   Blockly.inject(div, { renderer: RENDERER, theme: MBOT2_THEME, toolbox: TOOLBOX })
 *
 * Our own blocks carry their colour themselves (see catalog.ts). The block styles below colour the
 * Blockly built-in blocks we use: the white number / text bubbles and the "My Blocks" blocks.
 */
import { CATEGORIES, getCategory, LIST_COLOUR } from './catalog';

/** The Blockly renderer that draws Scratch-like blocks. */
export const RENDERER = 'zelos';

/** Shape of the object Blockly.inject({ theme }) accepts (same as Blockly's ITheme). */
export interface ThemeData {
  name: string;
  base?: string;
  blockStyles?: Record<string, { colourPrimary: string; colourSecondary?: string; colourTertiary?: string; hat?: string }>;
  categoryStyles?: Record<string, { colour: string }>;
  componentStyles?: {
    workspaceBackgroundColour?: string;
    toolboxBackgroundColour?: string;
    toolboxForegroundColour?: string;
    flyoutBackgroundColour?: string;
    flyoutForegroundColour?: string;
    flyoutOpacity?: number;
    scrollbarColour?: string;
    scrollbarOpacity?: number;
    insertionMarkerColour?: string;
    insertionMarkerOpacity?: number;
    cursorColour?: string;
  };
  fontStyle?: { family?: string; weight?: string; size?: number };
  startHats?: boolean;
}

/** Darken a '#rrggbb' colour (amount 0..1) - used for block borders. */
export function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number): string => {
    const value = Math.round(((n >> shift) & 255) * (1 - amount));
    return value.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

function style(colour: string): { colourPrimary: string; colourSecondary: string; colourTertiary: string } {
  return { colourPrimary: colour, colourSecondary: darken(colour, 0.12), colourTertiary: darken(colour, 0.25) };
}

const operators = getCategory('operators').colour;
const variables = getCategory('variables').colour;
const myBlocks = getCategory('myblocks').colour;
const control = getCategory('control').colour;

export const MBOT2_THEME: ThemeData = {
  name: 'mbot2',
  base: 'zelos',
  // every block that starts a stack gets the rounded "hat" top (events, my-block definitions)
  startHats: true,
  blockStyles: {
    // Blockly built-ins
    math_blocks: style(operators),
    text_blocks: style(operators),
    logic_blocks: style(operators),
    loop_blocks: style(control),
    variable_blocks: style(variables),
    variable_dynamic_blocks: style(variables),
    list_blocks: style(LIST_COLOUR),
    procedure_blocks: style(myBlocks),
  },
  categoryStyles: Object.fromEntries(CATEGORIES.map((c) => [`${c.id}_category`, { colour: c.colour }])),
  componentStyles: {
    workspaceBackgroundColour: '#F9F9F9',
    toolboxBackgroundColour: '#FFFFFF',
    toolboxForegroundColour: '#575E75',
    flyoutBackgroundColour: '#F9F9F9',
    flyoutForegroundColour: '#575E75',
    flyoutOpacity: 1,
    scrollbarColour: '#CECDCE',
    scrollbarOpacity: 0.8,
    insertionMarkerColour: '#000000',
    insertionMarkerOpacity: 0.2,
    cursorColour: '#000000',
  },
  fontStyle: {
    family: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    weight: '500',
    size: 12,
  },
};

/**
 * `plugins` option for Blockly.inject() when the always-open, scrolling Scratch-style palette of
 * '@blockly/continuous-toolbox' is wanted. Call that package's registerContinuousToolbox() first.
 */
export const CONTINUOUS_TOOLBOX_PLUGINS = {
  flyoutsVerticalToolbox: 'ContinuousFlyout',
  metricsManager: 'ContinuousMetrics',
  toolbox: 'ContinuousToolbox',
} as const;

/** Options to spread into Blockly.inject() for the Scratch / mBlock feel. */
export const EDITOR_LOOK = {
  renderer: RENDERER,
  theme: MBOT2_THEME,
  grid: { spacing: 40, length: 2, colour: '#DDDDDD', snap: false },
  zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 1.5, minScale: 0.35, scaleSpeed: 1.1, pinch: true },
  move: { scrollbars: true, drag: true, wheel: true },
  trashcan: true,
} as const;
