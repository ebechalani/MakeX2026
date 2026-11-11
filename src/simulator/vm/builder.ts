/**
 * Write a block program in code, without Blockly.
 *
 *   import { program, script, whenStart, moveCm, turn, forever, ifElse, probeDetects, driveRpm } from './builder';
 *
 *   const p = program([
 *     script(whenStart(), [
 *       moveCm('forward', 20),
 *       turn('left', 90),
 *       forever([
 *         ifElse(probeDetects('L1', 'line'), [driveRpm(20, -50)], [driveRpm(50, -20)]),
 *       ]),
 *     ]),
 *   ]);
 *
 * The result is the same JSON Blockly.serialization.workspaces.save() produces: unique ids, the
 * white bubbles (shadows) for typed-in values, the list of variables, my-block definitions. The
 * interpreter runs it and Blockly.serialization.workspaces.load() shows it as blocks.
 *
 * Two layers:
 *  - b(type, { fields, inputs, statements }) builds ANY block of the catalog (blocks/catalog.ts)
 *    and checks the names you give against the catalog, so a typo fails loudly;
 *  - short helper functions (moveCm, wait, repeat ...) for the everyday blocks.
 *
 * A value slot accepts a number, a text, true/false or another block:
 *   wait(1)   wait(add(v('pause'), 0.5))
 *
 * note(block, 'text') attaches an explanation to a block: in the editor it shows as a small "?"
 * icon on the block that opens the text when clicked.
 *
 * No DOM, no Blockly: usable in tests, in Node scripts and in the browser.
 */
import {
  fieldArgs,
  fieldDefault,
  getBlockDef,
  LIST_VARIABLE_TYPE,
  statementInputs,
  valueInputs,
} from '../blocks/catalog';
import type { BlockArg, BlockDef, ValueArg } from '../blocks/catalog';
import type { BlockJson, ProgramJson, VariableJson } from '../core/types';

// =============================================================================================
// Nodes (blocks before they get their ids)
// =============================================================================================

/** A reference to a variable / list by NAME inside `fields`; program() swaps it for the variable id. */
export type VariableRef = { variable: string } | { list: string };

export type FieldValue = string | number | VariableRef;

/** What can go into a value slot. */
export type Value = number | string | boolean | BlockNode;

export interface BlockNode {
  readonly kind: 'block';
  type: string;
  /** fixed id (otherwise program() numbers the blocks); handy in tests */
  id?: string;
  fields?: Record<string, FieldValue>;
  inputs?: Record<string, Value>;
  statements?: Record<string, BlockNode[]>;
  extraState?: unknown;
  /** a note for the reader, shown by the small "?" icon on the block (see note()) */
  comment?: string;
}

export interface ScriptNode {
  readonly kind: 'script';
  hat: BlockNode;
  body: BlockNode[];
}

export interface DefinitionNode {
  readonly kind: 'definition';
  name: string;
  params: string[];
  body: BlockNode[];
  /** present for a my-block that gives back a value */
  result?: Value;
  id?: string;
  /** a note for the reader, shown by the "?" icon of the definition (see note()) */
  comment?: string;
}

export interface BlockOptions {
  id?: string;
  fields?: Record<string, FieldValue>;
  inputs?: Record<string, Value>;
  statements?: Record<string, BlockNode[]>;
  extraState?: unknown;
  comment?: string;
}

export interface ProgramOptions {
  /** extra variables to declare even if no block uses them */
  variables?: string[];
  /** extra lists to declare even if no block uses them */
  lists?: string[];
}

function isNode(value: unknown): value is BlockNode {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'block';
}

function names(list: Array<{ name: string }>): string {
  return list.length > 0 ? list.map((a) => a.name).join(', ') : '(none)';
}

/**
 * Build any block. For catalog blocks the field / input / statement names are checked.
 *
 *   b('mbot2_straight_cm', { fields: { DIRECTION: 'backward' }, inputs: { DISTANCE: 15 } })
 *   b('control_repeat', { inputs: { TIMES: 4 }, statements: { SUBSTACK: [ ... ] } })
 *
 * Slots and fields you leave out get the catalog defaults (what the toolbox shows).
 */
export function b(type: string, options: BlockOptions = {}): BlockNode {
  const def = getBlockDef(type);
  if (def) checkAgainstCatalog(def, options);
  const node: BlockNode = { kind: 'block', type };
  if (options.id !== undefined) node.id = options.id;
  if (options.fields) node.fields = { ...options.fields };
  if (options.inputs) node.inputs = { ...options.inputs };
  if (options.statements) node.statements = { ...options.statements };
  if (options.extraState !== undefined) node.extraState = options.extraState;
  if (options.comment !== undefined) node.comment = options.comment;
  return node;
}

function checkAgainstCatalog(def: BlockDef, options: BlockOptions): void {
  const fields = fieldArgs(def);
  for (const [name, value] of Object.entries(options.fields ?? {})) {
    const arg = fields.find((f) => f.name === name);
    if (!arg) throw new Error(`Block "${def.type}" has no field "${name}". Its fields: ${names(fields)}.`);
    if (arg.type === 'field_dropdown' && !arg.options.some(([, stored]) => stored === String(value))) {
      const allowed = arg.options.map(([, stored]) => `"${stored}"`).join(', ');
      throw new Error(`Block "${def.type}": "${String(value)}" is not a choice of "${name}". Choices: ${allowed}.`);
    }
  }
  const values = valueInputs(def);
  for (const [name, value] of Object.entries(options.inputs ?? {})) {
    const arg = values.find((a) => a.name === name);
    if (!arg) throw new Error(`Block "${def.type}" has no value slot "${name}". Its slots: ${names(values)}.`);
    if (arg.check === 'Boolean' && (typeof value === 'number' || typeof value === 'string')) {
      throw new Error(`Block "${def.type}": the slot "${name}" needs a true/false block, not the value ${JSON.stringify(value)}.`);
    }
    if (isNode(value)) {
      const shape = getBlockDef(value.type)?.shape;
      if (shape === 'hat' || shape === 'statement') {
        throw new Error(`Block "${def.type}": "${value.type}" is a ${shape} block and cannot sit in the value slot "${name}".`);
      }
      if (arg.check === 'Boolean' && shape === 'reporter') {
        throw new Error(`Block "${def.type}": the slot "${name}" needs a true/false block, but "${value.type}" is a round value block.`);
      }
    }
  }
  const mouths = statementInputs(def);
  for (const [name, body] of Object.entries(options.statements ?? {})) {
    if (!mouths.some((a) => a.name === name)) {
      throw new Error(`Block "${def.type}" has no mouth "${name}". Its mouths: ${names(mouths)}.`);
    }
    checkStack(body, `inside "${def.type}"`);
  }
}

/** A stack may only hold statement blocks, and nothing can follow a block like "forever". */
function checkStack(body: BlockNode[], where: string): void {
  body.forEach((node, i) => {
    if (!isNode(node)) throw new Error(`Only blocks can be stacked ${where}; got ${JSON.stringify(node)}.`);
    const def = getBlockDef(node.type);
    if (!def) return;
    if (def.shape !== 'statement') throw new Error(`"${node.type}" is a ${def.shape} block and cannot be stacked ${where}.`);
    if (def.terminal && i < body.length - 1) {
      throw new Error(`Nothing can come after "${node.type}" ${where}: it never ends.`);
    }
  });
}

/** Give a block a fixed id (tests use it to check highlighting and error reports). */
export function withId(node: BlockNode, id: string): BlockNode {
  return { ...node, id };
}

/**
 * Attach a note to a block (or to a my-block definition). In the editor the block gets a small
 * round "?" icon; a click on it opens the note. The interpreter ignores notes.
 *
 *   note(moveCm('forward', 20.4), 'Now the robot is exactly below water tower W1.')
 */
export function note<T extends BlockNode | DefinitionNode>(node: T, text: string): T {
  return { ...node, comment: text };
}

/** A hat block with the blocks hanging below it. */
export function script(hat: BlockNode, body: BlockNode[] = []): ScriptNode {
  const def = getBlockDef(hat.type);
  if (def && def.shape !== 'hat') throw new Error(`A script must start with a hat block; "${hat.type}" is a ${def.shape} block.`);
  checkStack(body, `below "${hat.type}"`);
  return { kind: 'script', hat, body };
}

// =============================================================================================
// program(): nodes -> Blockly JSON
// =============================================================================================

class Emitter {
  private counter = 0;
  private readonly usedIds = new Set<string>();
  private readonly variables = new Map<string, VariableJson>();
  private readonly lists = new Map<string, VariableJson>();
  readonly definitions = new Map<string, DefinitionNode>();

  nextId(explicit?: string): string {
    let id = explicit;
    if (id !== undefined) {
      if (this.usedIds.has(id)) throw new Error(`Two blocks have the same id "${id}".`);
    } else {
      do id = `b${++this.counter}`;
      while (this.usedIds.has(id));
    }
    this.usedIds.add(id);
    return id;
  }

  variableId(name: string): string {
    let entry = this.variables.get(name);
    if (!entry) {
      entry = { name, id: `var${this.variables.size + 1}` };
      this.variables.set(name, entry);
    }
    return entry.id;
  }

  listId(name: string): string {
    let entry = this.lists.get(name);
    if (!entry) {
      entry = { name, id: `list${this.lists.size + 1}`, type: LIST_VARIABLE_TYPE };
      this.lists.set(name, entry);
    }
    return entry.id;
  }

  variableList(): VariableJson[] {
    return [...this.variables.values(), ...this.lists.values()];
  }

  private literal(kind: 'number' | 'text', value: number | string): BlockJson {
    return kind === 'number'
      ? { type: 'math_number', id: this.nextId(), fields: { NUM: Number(value) } }
      : { type: 'text', id: this.nextId(), fields: { TEXT: String(value) } };
  }

  /** What goes into one value slot: { shadow } for a typed-in value, { shadow, block } for a dropped-in block. */
  private slot(arg: ValueArg | undefined, value: Value | undefined): { shadow?: BlockJson; block?: BlockJson } | undefined {
    const spec = arg?.shadow;
    if (value === undefined) return spec ? { shadow: this.literal(spec.kind, spec.value) } : undefined;

    if (typeof value === 'number' || typeof value === 'string') {
      // keep the kind of bubble the slot normally has, when the value fits it
      let kind: 'number' | 'text' = typeof value === 'number' ? 'number' : 'text';
      if (spec?.kind === 'text') kind = 'text';
      else if (spec?.kind === 'number' && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) kind = 'number';
      return { shadow: this.literal(kind, value) };
    }

    const out: { shadow?: BlockJson; block?: BlockJson } = {};
    if (spec) out.shadow = this.literal(spec.kind, spec.value);
    out.block =
      typeof value === 'boolean'
        ? { type: 'logic_boolean', id: this.nextId(), fields: { BOOL: value ? 'TRUE' : 'FALSE' } }
        : this.block(value);
    return out;
  }

  private field(value: FieldValue, asList: boolean): unknown {
    if (typeof value === 'object') return 'list' in value ? { id: this.listId(value.list) } : { id: this.variableId(value.variable) };
    return asList ? { id: this.listId(String(value)) } : value;
  }

  /** A stack of statements: each block is the `next` of the one above. */
  stack(nodes: BlockNode[]): BlockJson | undefined {
    let first: BlockJson | undefined;
    let last: BlockJson | undefined;
    for (const node of nodes) {
      const json = this.block(node);
      if (last) last.next = { block: json };
      else first = json;
      last = json;
    }
    return first;
  }

  block(node: BlockNode): BlockJson {
    const json: BlockJson = { type: node.type, id: this.nextId(node.id) };
    const def = getBlockDef(node.type);
    const fields: Record<string, unknown> = {};
    const inputs: Record<string, { shadow?: BlockJson; block?: BlockJson }> = {};

    if (def) {
      // catalog block: every field and every slot is written, with the catalog default when not given
      for (const arg of fieldArgs(def)) {
        const given = node.fields?.[arg.name];
        if (arg.type === 'field_variable') {
          const isList = arg.defaultType === LIST_VARIABLE_TYPE;
          const name = given === undefined ? arg.variable : typeof given === 'object' ? ('list' in given ? given.list : given.variable) : String(given);
          fields[arg.name] = { id: isList ? this.listId(name) : this.variableId(name) };
        } else {
          fields[arg.name] = given === undefined ? fieldDefault(arg) : typeof given === 'object' ? this.field(given, false) : String(given);
        }
      }
      for (const arg of valueInputs(def)) {
        const slot = this.slot(arg, node.inputs?.[arg.name]);
        if (slot) inputs[arg.name] = slot;
      }
      for (const arg of statementInputs(def)) {
        const first = this.stack(node.statements?.[arg.name] ?? []);
        if (first) inputs[arg.name] = { block: first };
      }
    } else {
      // a Blockly built-in (or anything else): copied as given
      for (const [name, value] of Object.entries(node.fields ?? {})) fields[name] = this.field(value, false);
      for (const [name, value] of Object.entries(node.inputs ?? {})) {
        const slot = this.slot(undefined, value);
        if (slot) inputs[name] = slot;
      }
      for (const [name, body] of Object.entries(node.statements ?? {})) {
        const first = this.stack(body);
        if (first) inputs[name] = { block: first };
      }
    }

    if (node.type === 'procedures_callnoreturn' || node.type === 'procedures_callreturn') {
      const name = (node.extraState as { name: string }).name;
      const definition = this.definitions.get(name);
      if (!definition) throw new Error(`call("${name}"): there is no define("${name}", ...) in this program.`);
      const given = Object.keys(node.inputs ?? {}).length;
      if (given > definition.params.length) {
        throw new Error(`call("${name}") gives ${given} values but the block only has ${definition.params.length} parameter(s).`);
      }
      json.extraState = { name, params: [...definition.params] };
    } else if (node.extraState !== undefined) {
      json.extraState = node.extraState;
    }

    if (node.comment) json.icons = { comment: commentState(node.comment) };
    if (Object.keys(fields).length > 0) json.fields = fields;
    if (Object.keys(inputs).length > 0) json.inputs = inputs;
    return json;
  }

  definition(node: DefinitionNode): BlockJson {
    const returns = node.result !== undefined;
    const json: BlockJson = {
      type: returns ? 'procedures_defreturn' : 'procedures_defnoreturn',
      id: this.nextId(node.id),
    };
    if (node.params.length > 0) {
      json.extraState = { params: node.params.map((name) => ({ name, id: this.variableId(name) })) };
    }
    if (node.comment) json.icons = { comment: commentState(node.comment) };
    json.fields = { NAME: node.name };
    const inputs: Record<string, { shadow?: BlockJson; block?: BlockJson }> = {};
    const first = this.stack(node.body);
    if (first) inputs.STACK = { block: first };
    if (returns) {
      const slot = this.slot(undefined, node.result);
      if (slot) inputs.RETURN = slot;
    }
    if (Object.keys(inputs).length > 0) json.inputs = inputs;
    return json;
  }
}

/**
 * Turn scripts (and my-block definitions) into a complete program.
 * Top-level blocks are laid out side by side so they do not overlap when shown in Blockly:
 * first the scripts, in the order given, then the my-block definitions.
 */
export function program(items: Array<ScriptNode | DefinitionNode>, options: ProgramOptions = {}): ProgramJson {
  const emitter = new Emitter();
  for (const name of options.variables ?? []) emitter.variableId(name);
  for (const name of options.lists ?? []) emitter.listId(name);

  for (const item of items) {
    if (item.kind !== 'definition') continue;
    if (emitter.definitions.has(item.name)) throw new Error(`Two my-blocks are called "${item.name}".`);
    emitter.definitions.set(item.name, item);
  }

  // definitions first: Blockly wants to know a my-block before it meets a call to it
  const ordered = [...items.filter((i) => i.kind === 'definition'), ...items.filter((i) => i.kind === 'script')];
  const tops: BlockJson[] = ordered.map((item) => {
    if (item.kind === 'definition') return emitter.definition(item);
    const top = emitter.block(item.hat);
    const first = emitter.stack(item.body);
    if (first) top.next = { block: first };
    return top;
  });

  // On the workspace the scripts come first (a reader starts at "when CyberPi starts up"), the
  // my-block definitions to their right. Each one gets the room its widest block needs.
  const variables = emitter.variableList();
  const sizer = new Sizer(new Map(variables.map((v) => [v.id, v.name])));
  const x = new Map<BlockJson, number>();
  let nextX = FIRST_X;
  const shown = [...tops.filter((_, i) => ordered[i].kind === 'script'), ...tops.filter((_, i) => ordered[i].kind === 'definition')];
  for (const top of shown) {
    x.set(top, nextX);
    nextX += Math.ceil(sizer.stack(top)) + COLUMN_GAP;
  }

  const blocks: BlockJson[] = tops.map((top) => {
    const { type, id, ...rest } = top;
    return { type, id, x: x.get(top) ?? FIRST_X, y: FIRST_Y, ...rest };
  });

  return { blocks: { languageVersion: 0, blocks }, variables };
}

// =============================================================================================
// Layout: how much room a script needs on the workspace
// =============================================================================================

/** Where the first script is put, and the free space between two scripts (workspace pixels). */
const FIRST_X = 40;
const FIRST_Y = 40;
const COLUMN_GAP = 60;

// The builder has no browser to measure text with, so it counts letters. The numbers below were
// compared with what Blockly really draws (zelos renderer, 100 % zoom) and are a little generous:
// a guess that is too wide only makes the gap between two scripts wider, never an overlap.
/** one letter */
const CHAR_WIDTH = 8.5;
/** left + right edge of a block */
const ROW_PADDING = 24;
/** space between two parts of a row (a word, a dropdown, a bubble ...) */
const PART_GAP = 12;
/** frame and arrow of a dropdown */
const DROPDOWN_EXTRA = 44;
/** frame of a white bubble or a text box, and the narrowest bubble */
const BUBBLE_EXTRA = 30;
const BUBBLE_MIN = 46;
/** an empty pointed or round slot */
const EMPTY_SLOT = 52;
/** the colour swatch of the LED block */
const COLOUR_SWATCH = 44;
/** blocks inside a C-shaped block start this much further to the right */
const INDENT = 20;
/** a C-shaped block is never narrower than this, even when it is empty */
const C_BLOCK_MIN = 170;
/** the rounded or pointed ends of a value block */
const VALUE_ENDS = 10;
/** a stackable block that starts with a dropdown is drawn with some free space before it */
const LEADING_FIELD = 36;
/** the two small icons (gear, "?") at the start of a my-block definition */
const DEFINITION_ICONS = 60;
/** the "?" icon of a block that carries a note */
const NOTE_ICON = 30;

const letters = (text: string): number => text.length * CHAR_WIDTH;

/** A note as Blockly saves it: closed (only the "?" icon shows) until it is clicked. */
function commentState(text: string): { text: string; pinned: boolean; width: number; height: number } {
  const lines = Math.max(2, Math.ceil(text.length / 30));
  return { text, pinned: false, width: 240, height: Math.min(200, 24 + lines * 18) };
}

/**
 * Rough width (workspace pixels at 100 % zoom) of a stack of blocks as Blockly draws it, given its
 * top block. program() uses it to place the scripts; it is exported so that a check against the
 * real editor can make sure the guess is never too small.
 */
export function estimateStackWidth(top: BlockJson, variables: VariableJson[] = []): number {
  return new Sizer(new Map(variables.map((v) => [v.id, v.name]))).stack(top);
}

/** Estimates how wide blocks are drawn (see the constants above). */
class Sizer {
  constructor(private readonly variableNames: Map<string, string>) {}

  /** Width of a stack of blocks: its widest block, the blocks nested inside C-shaped blocks included. */
  stack(first: BlockJson | undefined): number {
    let widest = 0;
    for (let block = first; block; block = block.next?.block) widest = Math.max(widest, this.block(block));
    return widest;
  }

  private block(block: BlockJson): number {
    const def = getBlockDef(block.type);
    if (!def) return this.builtIn(block);
    let widest = this.row(block, def.message, def.args);
    if (block.icons) widest += NOTE_ICON;
    if (def.shape === 'reporter' || def.shape === 'boolean') widest += VALUE_ENDS;
    else if (/^%\d/.test(def.message) && def.args.length > 0 && def.args[0].type !== 'input_value') widest += LEADING_FIELD;
    for (const row of def.rows ?? []) {
      widest = Math.max(widest, this.row(block, row.message, row.args ?? []));
      for (const arg of row.args ?? []) {
        if (arg.type === 'input_statement') widest = Math.max(widest, C_BLOCK_MIN, INDENT + this.stack(block.inputs?.[arg.name]?.block));
      }
    }
    return widest;
  }

  /** One row of a catalog block: its words, fields and value slots side by side. */
  private row(block: BlockJson, message: string, args: BlockArg[]): number {
    const parts: number[] = [];
    for (const label of message.split(/%\d+/)) {
      if (label.trim() !== '') parts.push(letters(label.trim()));
    }
    for (const arg of args) {
      switch (arg.type) {
        case 'input_statement':
          break;
        case 'input_value':
          parts.push(this.slot(block, arg.name));
          break;
        case 'field_dropdown': {
          const stored = block.fields?.[arg.name];
          const option = arg.options.find(([, value]) => value === stored) ?? arg.options[0];
          parts.push(letters(option[0]) + DROPDOWN_EXTRA);
          break;
        }
        case 'field_input':
          parts.push(letters(String(block.fields?.[arg.name] ?? arg.text)) + BUBBLE_EXTRA);
          break;
        case 'field_variable': {
          const ref = block.fields?.[arg.name] as { id?: string } | undefined;
          parts.push(letters(this.variableNames.get(ref?.id ?? '') ?? arg.variable) + DROPDOWN_EXTRA);
          break;
        }
        case 'field_colour':
          parts.push(COLOUR_SWATCH);
          break;
      }
    }
    return this.sum(parts);
  }

  private sum(parts: number[]): number {
    return ROW_PADDING + parts.reduce((total, part) => total + part, 0) + PART_GAP * Math.max(0, parts.length - 1);
  }

  /** What sits in a value slot: a dropped-in block, else the white bubble, else nothing. */
  private slot(block: BlockJson, name: string): number {
    const slot = block.inputs?.[name];
    const child = slot?.block ?? slot?.shadow;
    if (!child) return EMPTY_SLOT;
    if (child.type === 'math_number') return Math.max(BUBBLE_MIN, letters(String(child.fields?.NUM ?? '')) + BUBBLE_EXTRA);
    if (child.type === 'text') return Math.max(BUBBLE_MIN, letters(String(child.fields?.TEXT ?? '')) + BUBBLE_EXTRA);
    return this.block(child);
  }

  /** Blockly's own blocks: my-block definitions and calls, plain variable blocks. */
  private builtIn(block: BlockJson): number {
    const state = (block.extraState ?? {}) as { name?: unknown; params?: unknown };
    switch (block.type) {
      case 'procedures_defnoreturn':
      case 'procedures_defreturn': {
        const params = Array.isArray(state.params) ? state.params.map((p) => String((p as { name?: unknown }).name ?? '')) : [];
        const title = `define ${String(block.fields?.NAME ?? '')}${params.length > 0 ? ` with: ${params.join(', ')}` : ''}`;
        let widest = letters(title) + BUBBLE_EXTRA + DEFINITION_ICONS + ROW_PADDING;
        widest = Math.max(widest, INDENT + this.stack(block.inputs?.STACK?.block));
        if (block.type === 'procedures_defreturn') widest = Math.max(widest, this.sum([letters('return'), this.slot(block, 'RETURN')]) + INDENT);
        return widest;
      }
      case 'procedures_callnoreturn':
      case 'procedures_callreturn': {
        const params = Array.isArray(state.params) ? state.params.map(String) : [];
        // the name on the first row, then one row per value: "name" (value)
        let widest = this.sum([letters(`${String(state.name ?? '')}${params.length > 0 ? ' with:' : ''}`)]);
        params.forEach((param, i) => (widest = Math.max(widest, this.sum([letters(param), this.slot(block, `ARG${i}`)]))));
        return widest;
      }
      case 'procedures_ifreturn':
        return this.sum([letters('if'), this.slot(block, 'CONDITION'), letters('return'), this.slot(block, 'VALUE')]);
      case 'logic_boolean':
        return this.sum([letters('false') + DROPDOWN_EXTRA]);
      default: {
        // anything else: its fields and slots side by side
        const parts: number[] = [letters(block.type)];
        for (const name of Object.keys(block.inputs ?? {})) parts.push(this.slot(block, name));
        return this.sum(parts);
      }
    }
  }
}

// =============================================================================================
// Typed helpers for the everyday blocks
// =============================================================================================

export type MoveDirection = 'forward' | 'backward' | 'left' | 'right';
export type StraightDirection = 'forward' | 'backward';
export type TurnDirection = 'left' | 'right';
export type MotorName = 'EM1' | 'EM2';
export type ServoName = 'S1' | 'S2' | 'S3' | 'S4';
export type ProbeId = 'L2' | 'L1' | 'R1' | 'R2';
export type ColourName = 'red' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'white' | 'black';
export type ButtonId = 'a' | 'b';
export type JoystickDirection = 'up' | 'down' | 'left' | 'right' | 'middle';
export type LedIndex = 'all' | 1 | 2 | 3 | 4 | 5;
export type StopOption = 'all' | 'this script' | 'other scripts';
export type MathFunction =
  | 'abs'
  | 'floor'
  | 'ceiling'
  | 'sqrt'
  | 'sin'
  | 'cos'
  | 'tan'
  | 'asin'
  | 'acos'
  | 'atan'
  | 'ln'
  | 'log'
  | 'e ^'
  | '10 ^';

// ------------------------------------------------------------------------------- events
export const whenStart = (): BlockNode => b('event_cyberpi_start');
export const whenButton = (button: ButtonId): BlockNode => b('event_button_pressed', { fields: { BUTTON: button } });
export const whenJoystick = (direction: JoystickDirection): BlockNode => b('event_joystick', { fields: { DIRECTION: direction } });
export const whenReceive = (message: string): BlockNode => b('event_whenbroadcastreceived', { fields: { MESSAGE: message } });
export const broadcast = (message: Value): BlockNode => b('event_broadcast', { inputs: { MESSAGE: message } });
export const broadcastAndWait = (message: Value): BlockNode => b('event_broadcastandwait', { inputs: { MESSAGE: message } });

// ------------------------------------------------------------------------------- control
export const wait = (seconds: Value): BlockNode => b('control_wait', { inputs: { DURATION: seconds } });
export const repeat = (times: Value, body: BlockNode[]): BlockNode =>
  b('control_repeat', { inputs: { TIMES: times }, statements: { SUBSTACK: body } });
export const forever = (body: BlockNode[]): BlockNode => b('control_forever', { statements: { SUBSTACK: body } });
export const ifThen = (condition: Value, body: BlockNode[]): BlockNode =>
  b('control_if', { inputs: { CONDITION: condition }, statements: { SUBSTACK: body } });
export const ifElse = (condition: Value, thenBody: BlockNode[], elseBody: BlockNode[]): BlockNode =>
  b('control_if_else', { inputs: { CONDITION: condition }, statements: { SUBSTACK: thenBody, SUBSTACK2: elseBody } });
export const waitUntil = (condition: Value): BlockNode => b('control_wait_until', { inputs: { CONDITION: condition } });
export const repeatUntil = (condition: Value, body: BlockNode[]): BlockNode =>
  b('control_repeat_until', { inputs: { CONDITION: condition }, statements: { SUBSTACK: body } });
export const stop = (option: StopOption = 'all'): BlockNode => b('control_stop', { fields: { STOP_OPTION: option } });

// ------------------------------------------------------------------------------- operators
export const add = (a: Value, c: Value): BlockNode => b('operator_add', { inputs: { NUM1: a, NUM2: c } });
export const sub = (a: Value, c: Value): BlockNode => b('operator_subtract', { inputs: { NUM1: a, NUM2: c } });
export const mul = (a: Value, c: Value): BlockNode => b('operator_multiply', { inputs: { NUM1: a, NUM2: c } });
export const div = (a: Value, c: Value): BlockNode => b('operator_divide', { inputs: { NUM1: a, NUM2: c } });
export const random = (from: Value, to: Value): BlockNode => b('operator_random', { inputs: { FROM: from, TO: to } });
export const gt = (a: Value, c: Value): BlockNode => b('operator_gt', { inputs: { OPERAND1: a, OPERAND2: c } });
export const lt = (a: Value, c: Value): BlockNode => b('operator_lt', { inputs: { OPERAND1: a, OPERAND2: c } });
export const eq = (a: Value, c: Value): BlockNode => b('operator_equals', { inputs: { OPERAND1: a, OPERAND2: c } });
export const and = (a: Value, c: Value): BlockNode => b('operator_and', { inputs: { OPERAND1: a, OPERAND2: c } });
export const or = (a: Value, c: Value): BlockNode => b('operator_or', { inputs: { OPERAND1: a, OPERAND2: c } });
export const not = (a: Value): BlockNode => b('operator_not', { inputs: { OPERAND: a } });
export const join = (a: Value, c: Value): BlockNode => b('operator_join', { inputs: { STRING1: a, STRING2: c } });
export const letterOf = (index: Value, text: Value): BlockNode => b('operator_letter_of', { inputs: { LETTER: index, STRING: text } });
export const lengthOf = (text: Value): BlockNode => b('operator_length', { inputs: { STRING: text } });
export const contains = (text: Value, part: Value): BlockNode => b('operator_contains', { inputs: { STRING1: text, STRING2: part } });
export const mod = (a: Value, c: Value): BlockNode => b('operator_mod', { inputs: { NUM1: a, NUM2: c } });
export const round = (a: Value): BlockNode => b('operator_round', { inputs: { NUM: a } });
export const mathOp = (fn: MathFunction, a: Value): BlockNode => b('operator_mathop', { fields: { OPERATOR: fn }, inputs: { NUM: a } });

// ------------------------------------------------------------------------------- variables and lists
/** the value of a variable (also used for the parameters of a my-block) */
export const v = (name: string): BlockNode => b('data_variable', { fields: { VARIABLE: name } });
export const setVar = (name: string, value: Value): BlockNode =>
  b('data_setvariableto', { fields: { VARIABLE: name }, inputs: { VALUE: value } });
export const changeVar = (name: string, by: Value): BlockNode =>
  b('data_changevariableby', { fields: { VARIABLE: name }, inputs: { VALUE: by } });

export const listContents = (list: string): BlockNode => b('data_listcontents', { fields: { LIST: list } });
export const addToList = (list: string, item: Value): BlockNode => b('data_addtolist', { fields: { LIST: list }, inputs: { ITEM: item } });
export const deleteOfList = (list: string, index: Value): BlockNode =>
  b('data_deleteoflist', { fields: { LIST: list }, inputs: { INDEX: index } });
export const deleteAllOfList = (list: string): BlockNode => b('data_deletealloflist', { fields: { LIST: list } });
export const insertAtList = (list: string, index: Value, item: Value): BlockNode =>
  b('data_insertatlist', { fields: { LIST: list }, inputs: { INDEX: index, ITEM: item } });
export const replaceItemOfList = (list: string, index: Value, item: Value): BlockNode =>
  b('data_replaceitemoflist', { fields: { LIST: list }, inputs: { INDEX: index, ITEM: item } });
export const itemOfList = (list: string, index: Value): BlockNode => b('data_itemoflist', { fields: { LIST: list }, inputs: { INDEX: index } });
export const itemNumOfList = (list: string, item: Value): BlockNode =>
  b('data_itemnumoflist', { fields: { LIST: list }, inputs: { ITEM: item } });
export const lengthOfList = (list: string): BlockNode => b('data_lengthoflist', { fields: { LIST: list } });
export const listContains = (list: string, item: Value): BlockNode =>
  b('data_listcontainsitem', { fields: { LIST: list }, inputs: { ITEM: item } });

// ------------------------------------------------------------------------------- my blocks
function argInputs(args: Value[]): Record<string, Value> {
  const inputs: Record<string, Value> = {};
  args.forEach((value, i) => (inputs[`ARG${i}`] = value));
  return inputs;
}

/** Define a my-block. Inside `body`, read a parameter with v('name'). Put it in program([...]) next to the scripts. */
export function define(name: string, params: string[], body: BlockNode[]): DefinitionNode {
  checkStack(body, `inside the definition of "${name}"`);
  return { kind: 'definition', name, params: [...params], body };
}

/** Define a my-block that gives back a value (used with callReturn). */
export function defineReturn(name: string, params: string[], body: BlockNode[], result: Value): DefinitionNode {
  checkStack(body, `inside the definition of "${name}"`);
  return { kind: 'definition', name, params: [...params], body, result };
}

/** Run a my-block, giving one value per parameter. */
export const call = (name: string, ...args: Value[]): BlockNode =>
  b('procedures_callnoreturn', { inputs: argInputs(args), extraState: { name } });

/** Run a my-block defined with defineReturn and use the value it gives back. */
export const callReturn = (name: string, ...args: Value[]): BlockNode =>
  b('procedures_callreturn', { inputs: argInputs(args), extraState: { name } });

/** Inside a my-block definition: leave it early when the condition is true (optionally giving back a value). */
export function ifReturn(condition: Value, value?: Value): BlockNode {
  const inputs: Record<string, Value> = { CONDITION: condition };
  if (value !== undefined) inputs.VALUE = value;
  return b('procedures_ifreturn', { inputs, extraState: `<mutation value="${value !== undefined ? 1 : 0}"></mutation>` });
}

// ------------------------------------------------------------------------------- mBot2 chassis
export const moveFor = (direction: MoveDirection, rpm: Value, seconds: Value): BlockNode =>
  b('mbot2_move_direction_with_time', { fields: { DIRECTION: direction }, inputs: { SPEED: rpm, DURATION: seconds } });
export const moveCm = (direction: StraightDirection, cm: Value): BlockNode =>
  b('mbot2_straight_cm', { fields: { DIRECTION: direction }, inputs: { DISTANCE: cm } });
export const turn = (direction: TurnDirection, degrees: Value): BlockNode =>
  b('mbot2_turn_deg', { fields: { DIRECTION: direction }, inputs: { ANGLE: degrees } });
export const move = (direction: MoveDirection, rpm: Value): BlockNode =>
  b('mbot2_move_direction', { fields: { DIRECTION: direction }, inputs: { SPEED: rpm } });
/** raw motor speeds; remember EM2 is mirrored: driveRpm(50, -50) goes straight ahead */
export const driveRpm = (em1: Value, em2: Value): BlockNode => b('mbot2_drive_speed', { inputs: { EM1: em1, EM2: em2 } });
/** raw motor powers (-100..100); EM2 is mirrored like in driveRpm */
export const drivePower = (em1: Value, em2: Value): BlockNode => b('mbot2_drive_power', { inputs: { EM1: em1, EM2: em2 } });
export const motorRpm = (port: MotorName, rpm: Value): BlockNode => b('mbot2_motor_speed', { fields: { PORT: port }, inputs: { SPEED: rpm } });
export const motorPower = (port: MotorName, power: Value): BlockNode =>
  b('mbot2_motor_power', { fields: { PORT: port }, inputs: { POWER: power } });
export const motorRotate = (port: MotorName | 'all', degrees: Value, rpm: Value = 50): BlockNode =>
  b('mbot2_motor_rotate_deg', { fields: { PORT: port }, inputs: { ANGLE: degrees, SPEED: rpm } });
export const stopMotors = (port: MotorName | 'all' = 'all'): BlockNode => b('mbot2_stop', { fields: { PORT: port } });
export const motorAngle = (port: MotorName): BlockNode => b('mbot2_motor_angle', { fields: { PORT: port } });
export const motorSpeed = (port: MotorName): BlockNode => b('mbot2_motor_rpm', { fields: { PORT: port } });
export const motorPowerValue = (port: MotorName): BlockNode => b('mbot2_motor_power_value', { fields: { PORT: port } });
export const resetMotorAngle = (port: MotorName | 'all' = 'all'): BlockNode => b('mbot2_motor_reset_angle', { fields: { PORT: port } });

// ------------------------------------------------------------------------------- servos and gripper
export const setServo = (port: ServoName | 'all', angle: Value): BlockNode =>
  b('mbot2_servo_set', { fields: { PORT: port }, inputs: { ANGLE: angle } });
export const servoAngle = (port: ServoName): BlockNode => b('mbot2_servo_angle', { fields: { PORT: port } });
export const gripper = (action: 'open' | 'close'): BlockNode => b('gripper_claw', { fields: { ACTION: action } });
export const arm = (action: 'raise' | 'lower'): BlockNode => b('gripper_arm', { fields: { ACTION: action } });
/** 0 = arm all the way down, 100 = all the way up */
export const armHeight = (percent: Value): BlockNode => b('gripper_arm_height', { inputs: { HEIGHT: percent } });

// ------------------------------------------------------------------------------- sensors
/** 0..15 for the four probes (L2 = 8, L1 = 4, R1 = 2, R2 = 1), or 0..3 for the two inner probes */
export const lineStatus = (mode: 'all' | 'inner' = 'all'): BlockNode => b('sensing_quadrgb_line_status', { fields: { MODE: mode } });
export const lineStatusIs = (status: number): BlockNode => b('sensing_quadrgb_status_is', { fields: { STATUS: String(status) } });
export const lineDeviation = (): BlockNode => b('sensing_quadrgb_deviation');
export const probeDetects = (probe: ProbeId, target: 'line' | 'background' = 'line'): BlockNode =>
  b('sensing_quadrgb_probe_detects', { fields: { PROBE: probe, TARGET: target } });
export const probeColorIs = (probe: ProbeId, colour: ColourName): BlockNode =>
  b('sensing_quadrgb_probe_color_is', { fields: { PROBE: probe, COLOR: colour } });
export const probeColor = (probe: ProbeId): BlockNode => b('sensing_quadrgb_probe_color', { fields: { PROBE: probe } });
export const probeRgb = (probe: ProbeId, channel: 'r' | 'g' | 'b'): BlockNode =>
  b('sensing_quadrgb_probe_rgb', { fields: { PROBE: probe, CHANNEL: channel } });
export const probeGray = (probe: ProbeId): BlockNode => b('sensing_quadrgb_probe_gray', { fields: { PROBE: probe } });
export const probeLight = (probe: ProbeId): BlockNode => b('sensing_quadrgb_probe_light', { fields: { PROBE: probe } });
export const ultrasonic = (): BlockNode => b('sensing_ultrasonic_distance');
export const clawColorIs = (colour: ColourName): BlockNode => b('sensing_claw_color_is', { fields: { COLOR: colour } });
export const clawColor = (): BlockNode => b('sensing_claw_color');
export const clawObjectDetected = (): BlockNode => b('sensing_claw_object_detected');

// ------------------------------------------------------------------------------- CyberPi
/** colour as '#rrggbb' */
export const ledColor = (index: LedIndex, colour: string): BlockNode =>
  b('cyberpi_led_color', { fields: { INDEX: String(index), COLOR: colour } });
export const ledRgb = (index: LedIndex, r: Value, g: Value, blue: Value): BlockNode =>
  b('cyberpi_led_rgb', { fields: { INDEX: String(index) }, inputs: { R: r, G: g, B: blue } });
export const ledOff = (index: LedIndex = 'all'): BlockNode => b('cyberpi_led_off', { fields: { INDEX: String(index) } });
export const print = (text: Value): BlockNode => b('cyberpi_print', { inputs: { TEXT: text } });
export const showLabel = (text: Value, x: Value, y: Value, size: Value = 16): BlockNode =>
  b('cyberpi_show_label', { inputs: { TEXT: text, X: x, Y: y, SIZE: size } });
export const clearScreen = (): BlockNode => b('cyberpi_clear_screen');
export const playTone = (hz: Value, seconds: Value): BlockNode => b('cyberpi_play_tone', { inputs: { FREQUENCY: hz, DURATION: seconds } });
export const buttonPressed = (button: ButtonId): BlockNode => b('cyberpi_button_pressed', { fields: { BUTTON: button } });
export const joystickPulled = (direction: JoystickDirection): BlockNode => b('cyberpi_joystick_pulled', { fields: { DIRECTION: direction } });
export const timer = (): BlockNode => b('cyberpi_timer');
export const resetTimer = (): BlockNode => b('cyberpi_reset_timer');
/** gyro, keeps counting past 360 (clockwise positive) */
export const rotationZ = (): BlockNode => b('cyberpi_rotation_z');
/** gyro, folded into -180..180 */
export const yaw = (): BlockNode => b('cyberpi_yaw');
export const resetYaw = (): BlockNode => b('cyberpi_reset_yaw');
