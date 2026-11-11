/**
 * The block catalog: the single source of truth for every custom block of the simulator.
 *
 * This file is plain data + small helpers. It does NOT import Blockly and does not touch the DOM,
 * so the interpreter (vm/), the program builder (vm/builder.ts), the toolbox and the tests can all
 * read it, in the browser and in Node.
 *
 *   catalog.ts --> register.ts  (turns every entry into a real Blockly block, browser only)
 *              --> toolbox.ts   (the palette on the left, with the white "type here" bubbles)
 *              --> vm/          (knows which inputs / fields each block has and their defaults)
 *
 * The wording follows mBlock 5 (device CyberPi + extensions mBot2, Quad RGB Sensor, Ultrasonic
 * Sensor 2) closely enough that students recognise the blocks.
 *
 * mBot2 wiring reminder (important for the "encoder motor EM1 ... EM2 ..." blocks):
 *   EM1 = LEFT wheel, EM2 = RIGHT wheel, and the two motors are mounted mirrored. A positive speed
 *   turns a motor clockwise, so driving straight ahead needs EM1 = +50 and EM2 = -50.
 */

// =============================================================================================
// Types
// =============================================================================================

/** hat = starts a script, statement = stackable command, reporter = round value, boolean = pointed true/false value */
export type BlockShape = 'hat' | 'statement' | 'reporter' | 'boolean';

export type CategoryId =
  | 'cyberpi'
  | 'sensing'
  | 'events'
  | 'control'
  | 'operators'
  | 'variables'
  | 'myblocks'
  | 'chassis'
  | 'servo'
  | 'gripper'
  | 'quadrgb'
  | 'ultrasonic'
  | 'colorsensor';

export interface CategoryDef {
  id: CategoryId;
  /** name shown in the toolbox */
  name: string;
  /** colour of the category and of all its blocks */
  colour: string;
  /**
   * Set for categories whose content is produced at run time by a Blockly "toolbox category
   * callback" (variables, my blocks) instead of being listed in the catalog.
   */
  custom?: 'VARIABLE' | 'PROCEDURE';
}

/** The white bubble sitting in a value slot: what you get before you type or drop a reporter in. */
export type ShadowSpec = { kind: 'number'; value: number } | { kind: 'text'; value: string };

export interface ValueArg {
  type: 'input_value';
  name: string;
  /** 'Boolean' = pointed slot that only accepts true/false blocks (never has a shadow) */
  check?: 'Boolean';
  /** our own addition (not a Blockly property): the default shadow of this slot */
  shadow?: ShadowSpec;
}
export interface StatementArg {
  type: 'input_statement';
  name: string;
}
export interface DropdownArg {
  type: 'field_dropdown';
  name: string;
  /** [text shown, value stored in the program] */
  options: [string, string][];
}
export interface TextFieldArg {
  type: 'field_input';
  name: string;
  text: string;
}
export interface VariableFieldArg {
  type: 'field_variable';
  name: string;
  /** name of the variable picked by default */
  variable: string;
  variableTypes?: string[];
  defaultType?: string;
}
export interface ColourFieldArg {
  /** our own small colour picker field, registered by register.ts */
  type: 'field_colour';
  name: string;
  /** '#rrggbb' */
  colour: string;
}

/** One %n placeholder of a block message, written the way Blockly's JSON block format wants it. */
export type BlockArg = ValueArg | StatementArg | DropdownArg | TextFieldArg | VariableFieldArg | ColourFieldArg;

export interface BlockRow {
  message: string;
  args?: BlockArg[];
}

export interface BlockDef {
  /** unique block type id, e.g. 'mbot2_straight_cm' */
  type: string;
  category: CategoryId;
  shape: BlockShape;
  /** text of the first row; %1, %2 ... are replaced by `args` in order */
  message: string;
  args: BlockArg[];
  /** further rows of C-shaped blocks (the "mouth" that holds other blocks, "else" ...) */
  rows?: BlockRow[];
  /** a statement nothing can be attached below (forever) */
  terminal?: boolean;
  /** shown when the mouse rests on the block */
  tooltip: string;
  /** not listed in the static toolbox (a dynamic category adds it itself) */
  hidden?: boolean;
  /** leave a little extra space above this block in the toolbox (start of a new group) */
  gapBefore?: boolean;
}

/** Type name Blockly variables get when they are a list (plain variables have type ''). */
export const LIST_VARIABLE_TYPE = 'list';

// =============================================================================================
// Categories (toolbox order = mBlock order: device blocks, Scratch basics, then the extensions)
// =============================================================================================

export const CATEGORIES: CategoryDef[] = [
  { id: 'cyberpi', name: 'CyberPi', colour: '#9966FF' },
  { id: 'sensing', name: 'Sensing', colour: '#5CB1D6' },
  { id: 'events', name: 'Events', colour: '#FFBF00' },
  { id: 'control', name: 'Control', colour: '#FFAB19' },
  { id: 'operators', name: 'Operators', colour: '#59C059' },
  { id: 'variables', name: 'Variables', colour: '#FF8C1A', custom: 'VARIABLE' },
  { id: 'myblocks', name: 'My Blocks', colour: '#FF6680', custom: 'PROCEDURE' },
  { id: 'chassis', name: 'mBot2 Chassis', colour: '#4C97FF' },
  { id: 'servo', name: 'Servos', colour: '#4A6CD4' },
  { id: 'gripper', name: 'Gripper', colour: '#CF63CF' },
  { id: 'quadrgb', name: 'Quad RGB Sensor', colour: '#0FBD8C' },
  { id: 'ultrasonic', name: 'Ultrasonic Sensor 2', colour: '#0E9E86' },
  { id: 'colorsensor', name: 'Colour Sensor', colour: '#2E9BB5' },
];

/** Colour of the list blocks inside the Variables category (same as Scratch). */
export const LIST_COLOUR = '#FF661A';

// =============================================================================================
// Small helpers to keep the list below readable
// =============================================================================================

/** number slot with a default value */
const num = (name: string, value: number): ValueArg => ({ type: 'input_value', name, shadow: { kind: 'number', value } });
/** text slot with a default value */
const txt = (name: string, value: string): ValueArg => ({ type: 'input_value', name, shadow: { kind: 'text', value } });
/** pointed true/false slot */
const bool = (name: string): ValueArg => ({ type: 'input_value', name, check: 'Boolean' });
/** the mouth of a C-shaped block */
const stack = (name: string): StatementArg => ({ type: 'input_statement', name });
/** dropdown menu; each option is [text shown, stored value] */
const menu = (name: string, options: [string, string][]): DropdownArg => ({ type: 'field_dropdown', name, options });
/** dropdown whose stored values are the same as the texts shown */
const pick = (name: string, values: string[]): DropdownArg => menu(name, values.map((v) => [v, v]));

const MOVE_4: [string, string][] = [
  ['moves forward', 'forward'],
  ['moves backward', 'backward'],
  ['turns left', 'left'],
  ['turns right', 'right'],
];
const MOVE_2: [string, string][] = [
  ['moves forward', 'forward'],
  ['moves backward', 'backward'],
];
const TURN_2: [string, string][] = [
  ['turns left', 'left'],
  ['turns right', 'right'],
];
const MOTOR = ['EM1', 'EM2'];
const MOTOR_OR_ALL = ['all', 'EM1', 'EM2'];
const PROBES = ['L2', 'L1', 'R1', 'R2'];
const SENSOR_COLOURS = ['red', 'yellow', 'green', 'cyan', 'blue', 'purple', 'white', 'black'];
const LEDS: [string, string][] = [
  ['all', 'all'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5', '5'],
];
const BUTTONS: [string, string][] = [
  ['A', 'a'],
  ['B', 'b'],
];
const JOYSTICK: [string, string][] = [
  ['pulled ↑', 'up'],
  ['pulled ↓', 'down'],
  ['pulled ←', 'left'],
  ['pulled →', 'right'],
  ['pressed', 'middle'],
];

/**
 * The 16 possible line patterns of the four probes. The value is the number the
 * "line status" reporter gives (L2 = 8, L1 = 4, R1 = 2, R2 = 1, added up for every probe on the
 * line); the text draws the probes from left to right, a filled square = on the line.
 */
export const LINE_PATTERNS: [string, string][] = Array.from({ length: 16 }, (_, value): [string, string] => {
  const squares = [8, 4, 2, 1].map((bit) => (value & bit ? '■' : '□')).join('');
  return [`(${value}) ${squares}`, String(value)];
});

const listField = (name = 'LIST'): VariableFieldArg => ({
  type: 'field_variable',
  name,
  variable: 'my list',
  variableTypes: [LIST_VARIABLE_TYPE],
  defaultType: LIST_VARIABLE_TYPE,
});
const variableField = (name = 'VARIABLE'): VariableFieldArg => ({
  type: 'field_variable',
  name,
  variable: 'my variable',
  variableTypes: [''],
  defaultType: '',
});

// =============================================================================================
// The blocks
// =============================================================================================

export const BLOCKS: BlockDef[] = [
  // ------------------------------------------------------------------------------- CyberPi
  {
    type: 'cyberpi_led_color',
    category: 'cyberpi',
    shape: 'statement',
    message: 'LED %1 displays %2',
    args: [menu('INDEX', LEDS), { type: 'field_colour', name: 'COLOR', colour: '#ff0000' }],
    tooltip: 'Lights one of the five CyberPi LEDs (or all of them) in the chosen colour.',
  },
  {
    type: 'cyberpi_led_rgb',
    category: 'cyberpi',
    shape: 'statement',
    message: 'LED %1 displays R %2 G %3 B %4',
    args: [menu('INDEX', LEDS), num('R', 255), num('G', 0), num('B', 0)],
    tooltip: 'Lights the LEDs with a colour mixed from red, green and blue (each 0 to 255).',
  },
  {
    type: 'cyberpi_led_off',
    category: 'cyberpi',
    shape: 'statement',
    message: 'turn off LED %1',
    args: [menu('INDEX', LEDS)],
    tooltip: 'Switches the LEDs off.',
  },
  {
    type: 'cyberpi_print',
    category: 'cyberpi',
    shape: 'statement',
    message: 'print %1 and move to a newline',
    args: [txt('TEXT', 'makeblock')],
    tooltip: 'Writes a line of text on the CyberPi screen.',
    gapBefore: true,
  },
  {
    type: 'cyberpi_show_label',
    category: 'cyberpi',
    shape: 'statement',
    message: 'show label %1 at x: %2 y: %3 size %4',
    args: [txt('TEXT', 'makeblock'), num('X', 0), num('Y', 0), num('SIZE', 16)],
    tooltip: 'Shows a text at a chosen place on the CyberPi screen (x from the left, y from the top, in pixels).',
  },
  {
    type: 'cyberpi_clear_screen',
    category: 'cyberpi',
    shape: 'statement',
    message: 'clear screen',
    args: [],
    tooltip: 'Removes everything from the CyberPi screen.',
  },
  {
    type: 'cyberpi_play_tone',
    category: 'cyberpi',
    shape: 'statement',
    message: 'play tone at frequency of %1 Hz for %2 secs',
    args: [num('FREQUENCY', 700), num('DURATION', 1)],
    tooltip: 'Plays a beep and waits until it is over.',
    gapBefore: true,
  },

  // ------------------------------------------------------------------------------- Sensing (CyberPi)
  {
    type: 'cyberpi_button_pressed',
    category: 'sensing',
    shape: 'boolean',
    message: 'button %1 pressed?',
    args: [menu('BUTTON', BUTTONS)],
    tooltip: 'True while button A (or B) of the CyberPi is held down.',
  },
  {
    type: 'cyberpi_joystick_pulled',
    category: 'sensing',
    shape: 'boolean',
    message: 'joystick %1 ?',
    args: [menu('DIRECTION', JOYSTICK)],
    tooltip: 'True while the CyberPi joystick is pulled in that direction (or pressed in).',
  },
  {
    type: 'cyberpi_timer',
    category: 'sensing',
    shape: 'reporter',
    message: 'timer (s)',
    args: [],
    tooltip: 'Seconds since the program started or since the last "reset timer".',
    gapBefore: true,
  },
  {
    type: 'cyberpi_reset_timer',
    category: 'sensing',
    shape: 'statement',
    message: 'reset timer',
    args: [],
    tooltip: 'Sets the timer back to 0.',
  },
  {
    type: 'cyberpi_rotation_z',
    category: 'sensing',
    shape: 'reporter',
    message: 'rotated angle around z axis (°)',
    args: [],
    tooltip:
      'Gyro: how far the robot has turned since the last reset, in degrees. Turning right counts up, turning left counts down, and it keeps counting past 360.',
    gapBefore: true,
  },
  {
    type: 'cyberpi_yaw',
    category: 'sensing',
    shape: 'reporter',
    message: 'yaw angle (°)',
    args: [],
    tooltip: 'Gyro: the direction the robot faces compared with the last reset, from -180 to 180 degrees (right is positive).',
  },
  {
    type: 'cyberpi_reset_yaw',
    category: 'sensing',
    shape: 'statement',
    message: 'reset yaw angle',
    args: [],
    tooltip: 'Makes the direction the robot faces right now the new 0 of the gyro.',
  },

  // ------------------------------------------------------------------------------- Events
  {
    type: 'event_cyberpi_start',
    category: 'events',
    shape: 'hat',
    message: 'when CyberPi starts up',
    args: [],
    tooltip: 'The blocks below run when the match starts.',
  },
  {
    type: 'event_button_pressed',
    category: 'events',
    shape: 'hat',
    message: 'when button %1 pressed',
    args: [menu('BUTTON', BUTTONS)],
    tooltip: 'The blocks below run each time button A (or B) is pressed.',
  },
  {
    type: 'event_joystick',
    category: 'events',
    shape: 'hat',
    message: 'when joystick %1',
    args: [menu('DIRECTION', JOYSTICK)],
    tooltip: 'The blocks below run each time the joystick is pulled that way (or pressed in).',
  },
  {
    type: 'event_whenbroadcastreceived',
    category: 'events',
    shape: 'hat',
    message: 'when I receive %1',
    args: [{ type: 'field_input', name: 'MESSAGE', text: 'message1' }],
    tooltip: 'The blocks below run each time another script broadcasts this message.',
    gapBefore: true,
  },
  {
    type: 'event_broadcast',
    category: 'events',
    shape: 'statement',
    message: 'broadcast %1',
    args: [txt('MESSAGE', 'message1')],
    tooltip: 'Starts every "when I receive" script with this message and carries on straight away.',
  },
  {
    type: 'event_broadcastandwait',
    category: 'events',
    shape: 'statement',
    message: 'broadcast %1 and wait',
    args: [txt('MESSAGE', 'message1')],
    tooltip: 'Starts every "when I receive" script with this message and waits until they have all finished.',
  },

  // ------------------------------------------------------------------------------- Control
  {
    type: 'control_wait',
    category: 'control',
    shape: 'statement',
    message: 'wait %1 seconds',
    args: [num('DURATION', 1)],
    tooltip: 'Pauses this script. Motors that are running keep running.',
  },
  {
    type: 'control_repeat',
    category: 'control',
    shape: 'statement',
    message: 'repeat %1',
    args: [num('TIMES', 10)],
    rows: [{ message: '%1', args: [stack('SUBSTACK')] }],
    tooltip: 'Runs the blocks inside this many times.',
    gapBefore: true,
  },
  {
    type: 'control_forever',
    category: 'control',
    shape: 'statement',
    message: 'forever',
    args: [],
    rows: [{ message: '%1', args: [stack('SUBSTACK')] }],
    terminal: true,
    tooltip: 'Runs the blocks inside again and again until the match ends.',
  },
  {
    type: 'control_if',
    category: 'control',
    shape: 'statement',
    message: 'if %1 then',
    args: [bool('CONDITION')],
    rows: [{ message: '%1', args: [stack('SUBSTACK')] }],
    tooltip: 'Runs the blocks inside only when the condition is true.',
    gapBefore: true,
  },
  {
    type: 'control_if_else',
    category: 'control',
    shape: 'statement',
    message: 'if %1 then',
    args: [bool('CONDITION')],
    rows: [
      { message: '%1', args: [stack('SUBSTACK')] },
      { message: 'else' },
      { message: '%1', args: [stack('SUBSTACK2')] },
    ],
    tooltip: 'Runs the first group of blocks when the condition is true, otherwise the second group.',
  },
  {
    type: 'control_wait_until',
    category: 'control',
    shape: 'statement',
    message: 'wait until %1',
    args: [bool('CONDITION')],
    tooltip: 'Pauses this script until the condition becomes true.',
  },
  {
    type: 'control_repeat_until',
    category: 'control',
    shape: 'statement',
    message: 'repeat until %1',
    args: [bool('CONDITION')],
    rows: [{ message: '%1', args: [stack('SUBSTACK')] }],
    tooltip: 'Runs the blocks inside again and again until the condition becomes true.',
  },
  {
    type: 'control_stop',
    category: 'control',
    shape: 'statement',
    message: 'stop %1',
    args: [
      menu('STOP_OPTION', [
        ['all', 'all'],
        ['this script', 'this script'],
        ['other scripts', 'other scripts'],
      ]),
    ],
    tooltip: '"all" ends the whole program and stops the motors. "this script" ends only this stack of blocks.',
    gapBefore: true,
  },

  // ------------------------------------------------------------------------------- Operators
  {
    type: 'operator_add',
    category: 'operators',
    shape: 'reporter',
    message: '%1 + %2',
    args: [num('NUM1', 0), num('NUM2', 0)],
    tooltip: 'Adds two numbers.',
  },
  {
    type: 'operator_subtract',
    category: 'operators',
    shape: 'reporter',
    message: '%1 - %2',
    args: [num('NUM1', 0), num('NUM2', 0)],
    tooltip: 'Subtracts the second number from the first.',
  },
  {
    type: 'operator_multiply',
    category: 'operators',
    shape: 'reporter',
    message: '%1 * %2',
    args: [num('NUM1', 0), num('NUM2', 0)],
    tooltip: 'Multiplies two numbers.',
  },
  {
    type: 'operator_divide',
    category: 'operators',
    shape: 'reporter',
    message: '%1 / %2',
    args: [num('NUM1', 0), num('NUM2', 1)],
    tooltip: 'Divides the first number by the second.',
  },
  {
    type: 'operator_random',
    category: 'operators',
    shape: 'reporter',
    message: 'pick random %1 to %2',
    args: [num('FROM', 1), num('TO', 10)],
    tooltip: 'A random number between the two values. Whole numbers in, whole number out.',
    gapBefore: true,
  },
  // The three comparisons take text bubbles, as in Scratch: a number or a word can be typed in
  // (colour = red). Two things that both read as numbers are compared as numbers.
  {
    type: 'operator_gt',
    category: 'operators',
    shape: 'boolean',
    message: '%1 > %2',
    args: [txt('OPERAND1', ''), txt('OPERAND2', '50')],
    tooltip: 'True when the first value is greater than the second.',
    gapBefore: true,
  },
  {
    type: 'operator_lt',
    category: 'operators',
    shape: 'boolean',
    message: '%1 < %2',
    args: [txt('OPERAND1', ''), txt('OPERAND2', '50')],
    tooltip: 'True when the first value is less than the second.',
  },
  {
    type: 'operator_equals',
    category: 'operators',
    shape: 'boolean',
    message: '%1 = %2',
    args: [txt('OPERAND1', ''), txt('OPERAND2', '50')],
    tooltip: 'True when both values are the same. Works for numbers and for words (upper / lower case does not matter).',
  },
  {
    type: 'operator_and',
    category: 'operators',
    shape: 'boolean',
    message: '%1 and %2',
    args: [bool('OPERAND1'), bool('OPERAND2')],
    tooltip: 'True when both conditions are true.',
    gapBefore: true,
  },
  {
    type: 'operator_or',
    category: 'operators',
    shape: 'boolean',
    message: '%1 or %2',
    args: [bool('OPERAND1'), bool('OPERAND2')],
    tooltip: 'True when at least one of the conditions is true.',
  },
  {
    type: 'operator_not',
    category: 'operators',
    shape: 'boolean',
    message: 'not %1',
    args: [bool('OPERAND')],
    tooltip: 'True when the condition is false.',
  },
  {
    type: 'operator_join',
    category: 'operators',
    shape: 'reporter',
    message: 'join %1 %2',
    args: [txt('STRING1', 'apple '), txt('STRING2', 'banana')],
    tooltip: 'Sticks two texts together.',
    gapBefore: true,
  },
  {
    type: 'operator_letter_of',
    category: 'operators',
    shape: 'reporter',
    message: 'letter %1 of %2',
    args: [num('LETTER', 1), txt('STRING', 'apple')],
    tooltip: 'One letter of a text; 1 is the first letter.',
  },
  {
    type: 'operator_length',
    category: 'operators',
    shape: 'reporter',
    message: 'length of %1',
    args: [txt('STRING', 'apple')],
    tooltip: 'How many letters the text has.',
  },
  {
    type: 'operator_contains',
    category: 'operators',
    shape: 'boolean',
    message: '%1 contains %2 ?',
    args: [txt('STRING1', 'apple'), txt('STRING2', 'a')],
    tooltip: 'True when the first text has the second text somewhere inside it.',
  },
  {
    type: 'operator_mod',
    category: 'operators',
    shape: 'reporter',
    message: '%1 mod %2',
    args: [num('NUM1', 0), num('NUM2', 1)],
    tooltip: 'The remainder left after dividing the first number by the second.',
    gapBefore: true,
  },
  {
    type: 'operator_round',
    category: 'operators',
    shape: 'reporter',
    message: 'round %1',
    args: [num('NUM', 0)],
    tooltip: 'The nearest whole number.',
  },
  {
    type: 'operator_mathop',
    category: 'operators',
    shape: 'reporter',
    message: '%1 of %2',
    args: [
      pick('OPERATOR', ['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'e ^', '10 ^']),
      num('NUM', 0),
    ],
    tooltip: 'Maths functions. sin, cos and tan work in degrees.',
  },

  // ------------------------------------------------------------------------------- Variables
  // (shown by the dynamic Variables category, which lists one reporter per existing variable)
  {
    type: 'data_variable',
    category: 'variables',
    shape: 'reporter',
    message: '%1',
    args: [variableField()],
    tooltip: 'The value stored in this variable.',
    hidden: true,
  },
  {
    type: 'data_setvariableto',
    category: 'variables',
    shape: 'statement',
    message: 'set %1 to %2',
    // a text bubble, as in Scratch: a variable can hold a number or a word
    args: [variableField(), txt('VALUE', '0')],
    tooltip: 'Stores a value in the variable: a number or a word.',
    hidden: true,
  },
  {
    type: 'data_changevariableby',
    category: 'variables',
    shape: 'statement',
    message: 'change %1 by %2',
    args: [variableField(), num('VALUE', 1)],
    tooltip: 'Adds a number to the variable (use a negative number to count down).',
    hidden: true,
  },
  {
    type: 'data_listcontents',
    category: 'variables',
    shape: 'reporter',
    message: '%1',
    args: [listField()],
    tooltip: 'All the items of this list, as one text.',
    hidden: true,
  },
  {
    type: 'data_addtolist',
    category: 'variables',
    shape: 'statement',
    message: 'add %1 to %2',
    args: [txt('ITEM', 'thing'), listField()],
    tooltip: 'Puts a new item at the end of the list.',
    hidden: true,
  },
  {
    type: 'data_deleteoflist',
    category: 'variables',
    shape: 'statement',
    message: 'delete %1 of %2',
    args: [num('INDEX', 1), listField()],
    tooltip: 'Removes one item from the list; 1 is the first item.',
    hidden: true,
  },
  {
    type: 'data_deletealloflist',
    category: 'variables',
    shape: 'statement',
    message: 'delete all of %1',
    args: [listField()],
    tooltip: 'Empties the list.',
    hidden: true,
  },
  {
    type: 'data_insertatlist',
    category: 'variables',
    shape: 'statement',
    message: 'insert %1 at %2 of %3',
    args: [txt('ITEM', 'thing'), num('INDEX', 1), listField()],
    tooltip: 'Puts a new item at a chosen place in the list; 1 is the first place.',
    hidden: true,
  },
  {
    type: 'data_replaceitemoflist',
    category: 'variables',
    shape: 'statement',
    message: 'replace item %1 of %2 with %3',
    args: [num('INDEX', 1), listField(), txt('ITEM', 'thing')],
    tooltip: 'Changes one item of the list.',
    hidden: true,
  },
  {
    type: 'data_itemoflist',
    category: 'variables',
    shape: 'reporter',
    message: 'item %1 of %2',
    args: [num('INDEX', 1), listField()],
    tooltip: 'One item of the list; 1 is the first item.',
    hidden: true,
  },
  {
    type: 'data_itemnumoflist',
    category: 'variables',
    shape: 'reporter',
    message: 'item # of %1 in %2',
    args: [txt('ITEM', 'thing'), listField()],
    tooltip: 'The place of this item in the list (0 when it is not in the list).',
    hidden: true,
  },
  {
    type: 'data_lengthoflist',
    category: 'variables',
    shape: 'reporter',
    message: 'length of %1',
    args: [listField()],
    tooltip: 'How many items the list has.',
    hidden: true,
  },
  {
    type: 'data_listcontainsitem',
    category: 'variables',
    shape: 'boolean',
    message: '%1 contains %2 ?',
    args: [listField(), txt('ITEM', 'thing')],
    tooltip: 'True when the item is in the list.',
    hidden: true,
  },

  // ------------------------------------------------------------------------------- mBot2 chassis
  {
    type: 'mbot2_move_direction_with_time',
    category: 'chassis',
    shape: 'statement',
    message: '%1 at %2 RPM for %3 secs',
    args: [menu('DIRECTION', MOVE_4), num('SPEED', 50), num('DURATION', 1)],
    tooltip: 'Drives (or turns on the spot) at this wheel speed for a time, then stops.',
  },
  {
    type: 'mbot2_straight_cm',
    category: 'chassis',
    shape: 'statement',
    message: '%1 %2 cm until done',
    args: [menu('DIRECTION', MOVE_2), num('DISTANCE', 100)],
    tooltip: 'Drives straight for this distance, measured by the wheel encoders, then stops.',
  },
  {
    type: 'mbot2_turn_deg',
    category: 'chassis',
    shape: 'statement',
    message: '%1 %2 ° until done',
    args: [menu('DIRECTION', TURN_2), num('ANGLE', 90)],
    tooltip: 'Turns on the spot by this angle, measured by the wheel encoders, then stops.',
  },
  {
    type: 'mbot2_move_direction',
    category: 'chassis',
    shape: 'statement',
    message: '%1 at %2 RPM',
    args: [menu('DIRECTION', MOVE_4), num('SPEED', 50)],
    tooltip: 'Starts driving (or turning) and carries on with the next block straight away. The robot keeps going until you stop it.',
  },
  {
    type: 'mbot2_drive_speed',
    category: 'chassis',
    shape: 'statement',
    message: 'encoder motor EM1 ↻ rotates at %1 RPM , encoder motor EM2 ↻ rotates at %2 RPM',
    args: [num('EM1', 50), num('EM2', 50)],
    tooltip:
      'Sets the speed of both motors. EM1 is the left wheel, EM2 the right wheel. The motors are mirrored: EM1 = 50 and EM2 = -50 drives straight ahead.',
    gapBefore: true,
  },
  {
    type: 'mbot2_drive_power',
    category: 'chassis',
    shape: 'statement',
    message: 'encoder motor EM1 ↻ rotates at power %1 % , encoder motor EM2 ↻ rotates at power %2 %',
    args: [num('EM1', 50), num('EM2', 50)],
    tooltip:
      'Sets the power of both motors (-100 to 100). EM1 is the left wheel, EM2 the right wheel. The motors are mirrored: EM1 = 50 and EM2 = -50 drives straight ahead.',
  },
  {
    type: 'mbot2_motor_speed',
    category: 'chassis',
    shape: 'statement',
    message: 'encoder motor %1 ↻ rotates at %2 RPM',
    args: [pick('PORT', MOTOR), num('SPEED', 50)],
    tooltip: 'Sets the speed of one motor. A positive speed on EM1 (left) drives forward; on EM2 (right) it drives backward.',
  },
  {
    type: 'mbot2_motor_power',
    category: 'chassis',
    shape: 'statement',
    message: 'encoder motor %1 ↻ rotates at power %2 %',
    args: [pick('PORT', MOTOR), num('POWER', 50)],
    tooltip: 'Sets the power of one motor (-100 to 100).',
  },
  {
    type: 'mbot2_motor_rotate_deg',
    category: 'chassis',
    shape: 'statement',
    message: 'encoder motor %1 ↻ rotates %2 ° at %3 RPM until done',
    args: [pick('PORT', ['EM1', 'EM2', 'all']), num('ANGLE', 360), num('SPEED', 50)],
    tooltip: 'Turns the motor shaft by this many degrees, then stops. 360 is one full turn of the wheel.',
  },
  {
    type: 'mbot2_stop',
    category: 'chassis',
    shape: 'statement',
    message: 'stop encoder motor %1',
    args: [pick('PORT', MOTOR_OR_ALL)],
    tooltip: 'Stops the motors.',
  },
  {
    type: 'mbot2_motor_angle',
    category: 'chassis',
    shape: 'reporter',
    message: 'encoder motor %1 ↻ rotated angle (°)',
    args: [pick('PORT', MOTOR)],
    tooltip: 'How far the motor has turned since the last reset, in degrees. For EM2 driving forward counts down (mirrored motor).',
    gapBefore: true,
  },
  {
    type: 'mbot2_motor_rpm',
    category: 'chassis',
    shape: 'reporter',
    message: 'encoder motor %1 ↻ speed (RPM)',
    args: [pick('PORT', MOTOR)],
    tooltip: 'How fast the motor is turning right now.',
  },
  {
    type: 'mbot2_motor_power_value',
    category: 'chassis',
    shape: 'reporter',
    message: 'encoder motor %1 ↻ power (%)',
    args: [pick('PORT', MOTOR)],
    tooltip: 'The power the motor is running at right now (-100 to 100).',
  },
  {
    type: 'mbot2_motor_reset_angle',
    category: 'chassis',
    shape: 'statement',
    message: 'reset encoder motor %1 ↻ rotated angle',
    args: [pick('PORT', MOTOR_OR_ALL)],
    tooltip: 'Sets the rotated angle of the motor back to 0.',
  },

  // ------------------------------------------------------------------------------- Servos (mBot2 shield)
  {
    type: 'mbot2_servo_set',
    category: 'servo',
    shape: 'statement',
    message: 'set servo %1 angle to %2 °',
    args: [pick('PORT', ['S1', 'S2', 'S3', 'S4', 'all']), num('ANGLE', 90)],
    tooltip: 'Tells a servo to move to an angle (0 to 180). The servo needs a moment to get there: add a "wait" if the next block needs it in place.',
  },
  {
    type: 'mbot2_servo_angle',
    category: 'servo',
    shape: 'reporter',
    message: 'servo %1 angle (°)',
    args: [pick('PORT', ['S1', 'S2', 'S3', 'S4'])],
    tooltip: 'The angle the servo is at right now.',
  },

  // ------------------------------------------------------------------------------- Gripper (helpers on top of the servos)
  {
    type: 'gripper_claw',
    category: 'gripper',
    shape: 'statement',
    message: 'gripper %1 until done',
    args: [menu('ACTION', [['opens', 'open'], ['closes', 'close']])],
    tooltip: 'Opens or closes the claw and waits until it has finished. Closing on a bucket or a person grabs it.',
  },
  {
    type: 'gripper_arm',
    category: 'gripper',
    shape: 'statement',
    message: 'arm %1 until done',
    args: [menu('ACTION', [['raises', 'raise'], ['lowers', 'lower']])],
    tooltip: 'Lifts the arm all the way up or lowers it all the way down, and waits until it has finished.',
  },
  {
    type: 'gripper_arm_height',
    category: 'gripper',
    shape: 'statement',
    message: 'arm moves to height %1 % until done',
    args: [num('HEIGHT', 50)],
    tooltip: 'Moves the arm to a height between 0 % (all the way down) and 100 % (all the way up).',
  },

  // ------------------------------------------------------------------------------- Quad RGB sensor
  {
    type: 'sensing_quadrgb_line_status',
    category: 'quadrgb',
    shape: 'reporter',
    message: 'quad rgb sensor %1 line status',
    args: [
      menu('MODE', [
        ['L2 L1 R1 R2 (0~15)', 'all'],
        ['L1 R1 (0~3)', 'inner'],
      ]),
    ],
    tooltip:
      'Which probes see the line, as one number. With four probes: L2 = 8, L1 = 4, R1 = 2, R2 = 1, added up (6 = the two middle probes are on the line). With two probes: L1 = 2, R1 = 1.',
  },
  {
    type: 'sensing_quadrgb_status_is',
    category: 'quadrgb',
    shape: 'boolean',
    message: 'quad rgb sensor line status is %1 ?',
    args: [menu('STATUS', LINE_PATTERNS)],
    tooltip: 'True when the four probes (L2 L1 R1 R2, left to right) see exactly this pattern. A filled square means "on the line".',
  },
  {
    type: 'sensing_quadrgb_deviation',
    category: 'quadrgb',
    shape: 'reporter',
    message: 'quad rgb sensor deviation (-100~100)',
    args: [],
    tooltip:
      'How far the robot has drifted off the line, as on the real mBot2: -100 = the robot is far to the left of the line (the line is under the right probes), 0 = the line is in the middle, 100 = the robot is far to the right of the line (the line is under the left probes). To follow a line: EM1 power = base - kp x deviation, EM2 power = -1 x (base + kp x deviation).',
  },
  {
    type: 'sensing_quadrgb_probe_detects',
    category: 'quadrgb',
    shape: 'boolean',
    message: 'quad rgb sensor probe %1 detects %2 ?',
    args: [pick('PROBE', PROBES), pick('TARGET', ['line', 'background'])],
    tooltip: 'True when this probe is over the dark line (or over the light background).',
    gapBefore: true,
  },
  {
    type: 'sensing_quadrgb_probe_color_is',
    category: 'quadrgb',
    shape: 'boolean',
    message: 'quad rgb sensor probe %1 detects colour %2 ?',
    args: [pick('PROBE', PROBES), pick('COLOR', SENSOR_COLOURS)],
    tooltip: 'True when this probe is over that colour of the mat.',
  },
  {
    type: 'sensing_quadrgb_probe_color',
    category: 'quadrgb',
    shape: 'reporter',
    message: 'quad rgb sensor probe %1 colour',
    args: [pick('PROBE', PROBES)],
    tooltip: 'The name of the colour under this probe: red, yellow, green, cyan, blue, purple, white or black.',
  },
  {
    type: 'sensing_quadrgb_probe_rgb',
    category: 'quadrgb',
    shape: 'reporter',
    message: 'quad rgb sensor probe %1 %2 value (0~255)',
    args: [pick('PROBE', PROBES), menu('CHANNEL', [['R', 'r'], ['G', 'g'], ['B', 'b']])],
    tooltip: 'How much red, green or blue this probe sees (0 to 255).',
    gapBefore: true,
  },
  {
    type: 'sensing_quadrgb_probe_gray',
    category: 'quadrgb',
    shape: 'reporter',
    message: 'quad rgb sensor probe %1 grayscale (0~100)',
    args: [pick('PROBE', PROBES)],
    tooltip: 'How dark the mat is under this probe: 0 = white, 100 = black.',
  },
  {
    type: 'sensing_quadrgb_probe_light',
    category: 'quadrgb',
    shape: 'reporter',
    message: 'quad rgb sensor probe %1 reflected light (0~100)',
    args: [pick('PROBE', PROBES)],
    tooltip: 'How much light the mat reflects under this probe: 0 = black, 100 = white.',
  },

  // ------------------------------------------------------------------------------- Ultrasonic sensor 2
  {
    type: 'sensing_ultrasonic_distance',
    category: 'ultrasonic',
    shape: 'reporter',
    message: 'ultrasonic sensor 2 distance to an object (cm)',
    args: [],
    tooltip: 'Distance to the nearest thing in front of the robot, in centimetres. Shows the maximum range when nothing is in sight.',
  },

  // ------------------------------------------------------------------------------- Colour sensor at the claw (add-on)
  {
    type: 'sensing_claw_color_is',
    category: 'colorsensor',
    shape: 'boolean',
    message: 'claw colour sensor detects %1 ?',
    args: [pick('COLOR', SENSOR_COLOURS)],
    tooltip: 'True when the object in (or just in front of) the claw has this colour.',
  },
  {
    type: 'sensing_claw_color',
    category: 'colorsensor',
    shape: 'reporter',
    message: 'claw colour sensor colour',
    args: [],
    tooltip: 'The name of the colour of the object at the claw, or "none" when there is nothing.',
  },
  {
    type: 'sensing_claw_object_detected',
    category: 'colorsensor',
    shape: 'boolean',
    message: 'object detected at claw ?',
    args: [],
    tooltip: 'True when there is a bucket or a person in (or just in front of) the claw.',
  },
];

// =============================================================================================
// Blockly built-in blocks we rely on (they are defined by Blockly itself, not by this catalog)
// =============================================================================================

/**
 * math_number / text are the white bubbles (shadows); the procedures_* blocks are "My Blocks";
 * variables_get / variables_set / math_change / logic_boolean are understood by the interpreter
 * in case a program made with plain Blockly blocks is loaded.
 */
export const BUILTIN_BLOCK_TYPES: string[] = [
  'math_number',
  'text',
  'logic_boolean',
  'variables_get',
  'variables_set',
  'math_change',
  'procedures_defnoreturn',
  'procedures_defreturn',
  'procedures_callnoreturn',
  'procedures_callreturn',
  'procedures_ifreturn',
];

// =============================================================================================
// Look-ups
// =============================================================================================

const BY_TYPE = new Map<string, BlockDef>(BLOCKS.map((def) => [def.type, def]));
const CATEGORY_BY_ID = new Map<CategoryId, CategoryDef>(CATEGORIES.map((c) => [c.id, c]));

export function getBlockDef(type: string): BlockDef | undefined {
  return BY_TYPE.get(type);
}

export function getCategory(id: CategoryId): CategoryDef {
  const category = CATEGORY_BY_ID.get(id);
  if (!category) throw new Error(`Unknown block category "${id}"`);
  return category;
}

/** Every %n placeholder of a block: first row, then the extra rows. */
export function allArgs(def: BlockDef): BlockArg[] {
  const out = [...def.args];
  for (const row of def.rows ?? []) out.push(...(row.args ?? []));
  return out;
}

/** The value slots (round or pointed holes) of a block, in order. */
export function valueInputs(def: BlockDef): ValueArg[] {
  return allArgs(def).filter((a): a is ValueArg => a.type === 'input_value');
}

/** The "mouths" of a C-shaped block, in order. */
export function statementInputs(def: BlockDef): StatementArg[] {
  return allArgs(def).filter((a): a is StatementArg => a.type === 'input_statement');
}

/** The dropdowns / text boxes / variable pickers / colour pickers of a block, in order. */
export function fieldArgs(def: BlockDef): Array<DropdownArg | TextFieldArg | VariableFieldArg | ColourFieldArg> {
  return allArgs(def).filter(
    (a): a is DropdownArg | TextFieldArg | VariableFieldArg | ColourFieldArg =>
      a.type !== 'input_value' && a.type !== 'input_statement',
  );
}

/** What a field holds before the student touches it (variable fields have no fixed default). */
export function fieldDefault(arg: BlockArg): string | undefined {
  switch (arg.type) {
    case 'field_dropdown':
      return arg.options[0][1];
    case 'field_input':
      return arg.text;
    case 'field_colour':
      return arg.colour;
    default:
      return undefined;
  }
}

/** Colour of a block: its category colour, except the list blocks which are a darker orange. */
export function blockColour(def: BlockDef): string {
  const isListBlock = allArgs(def).some((a) => a.type === 'field_variable' && a.defaultType === LIST_VARIABLE_TYPE);
  return isListBlock ? LIST_COLOUR : getCategory(def.category).colour;
}

// =============================================================================================
// Blockly JSON definitions (plain data; register.ts hands them to Blockly)
// =============================================================================================

/** Remove our own extra properties so Blockly only sees what it knows. */
function toBlocklyArg(arg: BlockArg): Record<string, unknown> {
  if (arg.type === 'input_value') {
    const out: Record<string, unknown> = { type: arg.type, name: arg.name };
    if (arg.check) out.check = arg.check;
    return out;
  }
  return { ...arg };
}

/**
 * The definition of one block in Blockly's JSON block format
 * (https://developers.google.com/blockly/guides/create-custom-blocks/define/json-and-js).
 */
export function toBlocklyJson(def: BlockDef): Record<string, unknown> {
  const json: Record<string, unknown> = {
    type: def.type,
    message0: def.message,
    args0: def.args.map(toBlocklyArg),
    colour: blockColour(def),
    tooltip: def.tooltip,
    inputsInline: true,
  };
  (def.rows ?? []).forEach((row, i) => {
    json[`message${i + 1}`] = row.message;
    if (row.args && row.args.length > 0) json[`args${i + 1}`] = row.args.map(toBlocklyArg);
  });
  switch (def.shape) {
    case 'hat':
      json.nextStatement = null;
      break;
    case 'statement':
      json.previousStatement = null;
      if (!def.terminal) json.nextStatement = null;
      break;
    case 'boolean':
      // 'Boolean' gives the pointed (hexagonal) shape and lets the block fit into pointed slots
      json.output = 'Boolean';
      break;
    case 'reporter':
      // anything that is not 'Boolean': round shape, fits every round slot but no pointed slot
      json.output = ['Number', 'String'];
      break;
  }
  return json;
}

/** Definitions of all catalog blocks, ready for Blockly.common.defineBlocksWithJsonArray(). */
export function blocklyDefinitions(): Record<string, unknown>[] {
  return BLOCKS.map(toBlocklyJson);
}
