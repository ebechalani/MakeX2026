/**
 * The interpreter ("virtual machine") that runs a student's block program.
 *
 *   createVM(program, io)   program = what Blockly.serialization.workspaces.save() returns
 *                           io      = the robot (see core/io.ts)
 *
 * How it works, in plain words:
 *
 *  - Every hat block ("when CyberPi starts up", "when button A pressed", "when I receive ...")
 *    with the blocks hanging below it is a SCRIPT. Several scripts can run at the same time.
 *  - The simulation advances in small time steps ("ticks"). On every tick the engine calls
 *    vm.step() once, and every running script is given a turn: it runs block after block until it
 *    reaches something that takes time - a wait, a move "until done", a tone, "wait until" - or
 *    the end of one pass through a loop. Then it pauses and continues on the next tick. So a
 *    "forever" loop makes exactly one pass per tick, like Scratch.
 *  - A script that runs more than BLOCKS_PER_TICK blocks in one tick without pausing (possible
 *    with a block that calls itself) is paused by force until the next tick, so a mistake in a
 *    program can never freeze the simulator.
 *  - Time only comes from io.time (simulated seconds), never from the computer's clock, so a run
 *    is repeatable and can be computed faster than real time.
 *
 * Nothing here needs a browser: no DOM, no React, no Blockly.
 */
import { BLOCKS, fieldArgs, fieldDefault, valueInputs } from '../blocks/catalog';
import type { RobotIO } from '../core/io';
import type { BlockJson, ButtonName, ProgramJson, Scalar, VM, VMError } from '../core/types';
import { BUTTON_NAMES } from '../core/types';
import { REPORTERS, STATEMENTS } from './handlers';
import type { BlockContext, Wait } from './handlers';
import { compare, toBoolean, toFinite, toNumber, toText } from './values';

/** Most blocks one script may run in a single tick before it is paused until the next tick. */
export const BLOCKS_PER_TICK = 2000;

/** How deep "my blocks" may call each other (a block that calls itself forever is stopped here). */
export const MAX_CALL_DEPTH = 250;

/** Longest list a program may build. */
export const MAX_LIST_LENGTH = 100000;

// =============================================================================================
// Internal types
// =============================================================================================

type Args = Record<string, Scalar>;
type Step = Generator<void, void, void>;
type Eval = Generator<void, Scalar, void>;

/** One value slot of a block and what it counts as when it is left empty. */
interface SlotSpec {
  name: string;
  fallback: Scalar;
}

interface BlockInfo {
  slots: SlotSpec[];
  fieldDefaults: Record<string, string>;
}

/** The inside of one running "my block": the values of its parameters. */
interface Frame {
  locals: Map<string, Scalar>;
  /** id of the block that made the call (highlighted while the definition runs) */
  callSite: string;
}

/** One running script. */
interface Thread {
  script: Script;
  run: Step;
  dead: boolean;
  /** blocks this thread may still run during the current tick */
  budget: number;
  /** id of the statement block being run */
  current: string | null;
  frames: Frame[];
  /** set by "return" / "stop this script" inside a my-block definition: leave the definition */
  returning: boolean;
  returnValue: Scalar | undefined;
}

interface Script {
  hat: BlockJson;
  kind: 'start' | 'button' | 'message';
  button?: ButtonName;
  /** message name, trimmed and in lower case */
  message?: string;
  thread: Thread | null;
}

interface Procedure {
  block: BlockJson;
  name: string;
  /** variable ids of the parameters, in order */
  params: string[];
}

interface VariableMeta {
  name: string;
  isList: boolean;
}

// =============================================================================================
// What the interpreter knows about each block type (slots and field defaults)
// =============================================================================================

const NO_SLOTS: SlotSpec[] = [];
const NO_ARGS: Args = Object.freeze({}) as Args;
/** placeholder until a new thread gets its real generator */
const NOTHING_TO_RUN: Step = (function* (): Step {})();

const INFO = new Map<string, BlockInfo>();
for (const def of BLOCKS) {
  const fieldDefaults: Record<string, string> = {};
  for (const arg of fieldArgs(def)) {
    const value = fieldDefault(arg);
    if (value !== undefined) fieldDefaults[arg.name] = value;
  }
  INFO.set(def.type, {
    slots: valueInputs(def).map((arg) => ({
      name: arg.name,
      // an empty pointed slot counts as false, an empty text slot as '', an empty number slot as 0
      fallback: arg.check === 'Boolean' ? false : arg.shadow?.kind === 'text' ? '' : 0,
    })),
    fieldDefaults,
  });
}
// Blockly's own variable blocks (understood so that programs made with plain Blockly also run)
INFO.set('variables_set', { slots: [{ name: 'VALUE', fallback: 0 }], fieldDefaults: {} });
INFO.set('math_change', { slots: [{ name: 'DELTA', fallback: 0 }], fieldDefaults: {} });

const HAT_TYPES = ['event_cyberpi_start', 'event_button_pressed', 'event_joystick', 'event_whenbroadcastreceived'];
const DEFINITION_TYPES = ['procedures_defnoreturn', 'procedures_defreturn'];
/** shadow / literal blocks evaluated directly */
const LITERAL_TYPES = ['math_number', 'text'];

function isDisabled(block: BlockJson): boolean {
  return block.enabled === false || (Array.isArray(block.disabledReasons) && block.disabledReasons.length > 0);
}

/** Id stored in a variable field: Blockly writes { id: '...' } (sometimes with name and type). */
function variableIdOf(block: BlockJson, fieldName: string): string {
  const value = block.fields?.[fieldName];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const ref = value as { id?: unknown; name?: unknown };
    if (typeof ref.id === 'string') return ref.id;
    if (typeof ref.name === 'string') return ref.name;
  }
  return '';
}

// =============================================================================================
// The context handed to block handlers
// =============================================================================================

class Context implements BlockContext {
  constructor(
    readonly vm: Interpreter,
    readonly thread: Thread,
    readonly block: BlockJson,
    private readonly args: Args,
  ) {}

  get io(): RobotIO {
    return this.vm.io;
  }
  get blockId(): string {
    return this.block.id;
  }
  value(name: string): Scalar {
    const v = this.args[name];
    return v === undefined ? 0 : v;
  }
  num(name: string): number {
    return toNumber(this.args[name]);
  }
  finite(name: string): number {
    return toFinite(this.args[name]);
  }
  str(name: string): string {
    return toText(this.args[name]);
  }
  bool(name: string): boolean {
    return toBoolean(this.args[name]);
  }
  field(name: string): string {
    return this.vm.fieldText(this.block, name);
  }
  claimDrive(): number {
    return ++this.vm.driveToken;
  }
  ownsDrive(token: number): boolean {
    return this.vm.driveToken === token;
  }
  warn(text: string): void {
    this.vm.warn(this.block, text);
  }
}

// =============================================================================================
// Blocks that need to know about scripts, variables or lists
// =============================================================================================

/** Scratch list positions: 1 = first item; also accepts the word "last". Returns a 0-based index or -1. */
function listIndex(value: Scalar, length: number, allowEnd: boolean): number {
  const max = allowEnd ? length + 1 : length;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'last') return max - 1;
  const n = Math.floor(toNumber(value));
  return n >= 1 && n <= max ? n - 1 : -1;
}

/**
 * What "set variable to" stores. Its bubble is a text box (so that a word can be typed in), which
 * means a typed 12 arrives as the text "12": a text that is simply a number is stored as that
 * number. Anything else ("007", "red") is kept as it was typed.
 */
function asStored(value: Scalar): Scalar {
  if (typeof value !== 'string' || value === '') return value;
  const n = Number(value);
  return Number.isFinite(n) && String(n) === value ? n : value;
}

const CORE_STATEMENTS: Record<string, (ctx: Context) => Wait | void> = {
  // ------------------------------------------------------------------ control
  control_wait(ctx) {
    const io = ctx.io;
    const end = io.time + Math.max(0, ctx.num('DURATION'));
    let polls = 0;
    // always pauses at least one tick, like Scratch
    return () => polls++ > 0 && io.time >= end - 1e-9;
  },

  control_stop(ctx) {
    switch (ctx.field('STOP_OPTION')) {
      case 'this script':
        // inside a my-block definition this ends the definition only (as in Scratch)
        if (ctx.thread.frames.length > 0) ctx.thread.returning = true;
        else ctx.thread.dead = true;
        break;
      case 'other scripts':
        ctx.vm.killOthers(ctx.thread);
        break;
      default:
        ctx.vm.halt();
    }
  },

  // ------------------------------------------------------------------ events
  event_broadcast(ctx) {
    ctx.vm.broadcast(ctx.str('MESSAGE'));
  },

  event_broadcastandwait(ctx) {
    const started = ctx.vm.broadcast(ctx.str('MESSAGE'));
    if (started.length === 0) return;
    return () => started.every((thread) => thread.dead);
  },

  // ------------------------------------------------------------------ variables
  data_setvariableto(ctx) {
    ctx.vm.writeVariable(ctx.thread, variableIdOf(ctx.block, 'VARIABLE'), asStored(ctx.value('VALUE')));
  },
  data_changevariableby(ctx) {
    const id = variableIdOf(ctx.block, 'VARIABLE');
    ctx.vm.writeVariable(ctx.thread, id, toNumber(ctx.vm.readVariable(ctx.thread, id)) + ctx.num('VALUE'));
  },
  variables_set(ctx) {
    ctx.vm.writeVariable(ctx.thread, variableIdOf(ctx.block, 'VAR'), asStored(ctx.value('VALUE')));
  },
  math_change(ctx) {
    const id = variableIdOf(ctx.block, 'VAR');
    ctx.vm.writeVariable(ctx.thread, id, toNumber(ctx.vm.readVariable(ctx.thread, id)) + ctx.num('DELTA'));
  },

  // ------------------------------------------------------------------ lists
  data_addtolist(ctx) {
    const list = ctx.vm.list(variableIdOf(ctx.block, 'LIST'));
    if (list.length < MAX_LIST_LENGTH) list.push(ctx.value('ITEM'));
  },
  data_deleteoflist(ctx) {
    const list = ctx.vm.list(variableIdOf(ctx.block, 'LIST'));
    const where = ctx.value('INDEX');
    if (typeof where === 'string' && where.trim().toLowerCase() === 'all') {
      list.length = 0;
      return;
    }
    const index = listIndex(where, list.length, false);
    if (index >= 0) list.splice(index, 1);
  },
  data_deletealloflist(ctx) {
    ctx.vm.list(variableIdOf(ctx.block, 'LIST')).length = 0;
  },
  data_insertatlist(ctx) {
    const list = ctx.vm.list(variableIdOf(ctx.block, 'LIST'));
    const index = listIndex(ctx.value('INDEX'), list.length, true);
    if (index >= 0 && list.length < MAX_LIST_LENGTH) list.splice(index, 0, ctx.value('ITEM'));
  },
  data_replaceitemoflist(ctx) {
    const list = ctx.vm.list(variableIdOf(ctx.block, 'LIST'));
    const index = listIndex(ctx.value('INDEX'), list.length, false);
    if (index >= 0) list[index] = ctx.value('ITEM');
  },
};

const CORE_REPORTERS: Record<string, (ctx: Context) => Scalar> = {
  data_variable: (ctx) => ctx.vm.readVariable(ctx.thread, variableIdOf(ctx.block, 'VARIABLE')),
  variables_get: (ctx) => ctx.vm.readVariable(ctx.thread, variableIdOf(ctx.block, 'VAR')),
  logic_boolean: (ctx) => ctx.field('BOOL') === 'TRUE',

  data_listcontents: (ctx) => ctx.vm.list(variableIdOf(ctx.block, 'LIST')).map(toText).join(' '),
  data_itemoflist(ctx) {
    const list = ctx.vm.list(variableIdOf(ctx.block, 'LIST'));
    const index = listIndex(ctx.value('INDEX'), list.length, false);
    return index >= 0 ? list[index] : '';
  },
  data_itemnumoflist(ctx) {
    const item = ctx.value('ITEM');
    return ctx.vm.list(variableIdOf(ctx.block, 'LIST')).findIndex((entry) => compare(entry, item) === 0) + 1;
  },
  data_lengthoflist: (ctx) => ctx.vm.list(variableIdOf(ctx.block, 'LIST')).length,
  data_listcontainsitem(ctx) {
    const item = ctx.value('ITEM');
    return ctx.vm.list(variableIdOf(ctx.block, 'LIST')).some((entry) => compare(entry, item) === 0);
  },
};

/** Blocks that hold other blocks or decide what runs next. They pause with `yield` (= "see you next tick"). */
const CONTROL: Record<string, (vm: Interpreter, thread: Thread, block: BlockJson) => Step> = {
  control_repeat: (vm, thread, block) => vm.repeat(thread, block),
  control_forever: (vm, thread, block) => vm.forever(thread, block),
  control_if: (vm, thread, block) => vm.ifThen(thread, block),
  control_if_else: (vm, thread, block) => vm.ifThen(thread, block),
  control_wait_until: (vm, thread, block) => vm.waitUntil(thread, block),
  control_repeat_until: (vm, thread, block) => vm.repeatUntil(thread, block),
  procedures_callnoreturn: (vm, thread, block) => vm.callStatement(thread, block),
  procedures_ifreturn: (vm, thread, block) => vm.ifReturn(thread, block),
};

/** Value blocks that may need several ticks (a my-block that returns a value can contain waits). */
const ASYNC_REPORTER_TYPES = ['procedures_callreturn'];

// =============================================================================================
// Public look-ups (used by tests and tools to make sure no block is silently missing)
// =============================================================================================

export type BlockRole = 'hat' | 'statement' | 'reporter' | 'definition';

/** How the interpreter treats a block type, or undefined when it does not know the type. */
export function blockRole(type: string): BlockRole | undefined {
  if (HAT_TYPES.includes(type)) return 'hat';
  if (DEFINITION_TYPES.includes(type)) return 'definition';
  if (type in CONTROL || type in CORE_STATEMENTS || type in STATEMENTS) return 'statement';
  if (type in REPORTERS || type in CORE_REPORTERS || LITERAL_TYPES.includes(type) || ASYNC_REPORTER_TYPES.includes(type)) {
    return 'reporter';
  }
  return undefined;
}

export function supportsBlock(type: string): boolean {
  return blockRole(type) !== undefined;
}

/** Every block type the interpreter can run. */
export const SUPPORTED_BLOCK_TYPES: string[] = [
  ...HAT_TYPES,
  ...DEFINITION_TYPES,
  ...Object.keys(CONTROL),
  ...Object.keys(CORE_STATEMENTS),
  ...Object.keys(STATEMENTS),
  ...Object.keys(REPORTERS),
  ...Object.keys(CORE_REPORTERS),
  ...LITERAL_TYPES,
  ...ASYNC_REPORTER_TYPES,
];

// =============================================================================================
// The interpreter
// =============================================================================================

class Interpreter implements VM {
  /** bumped every time a block takes control of the drive motors (see BlockContext.claimDrive) */
  driveToken = 0;

  private readonly scripts: Script[] = [];
  private readonly procedures = new Map<string, Procedure>();
  private readonly variableMeta = new Map<string, VariableMeta>();
  /** ids of variables that are parameters of a my-block (they live inside a call, not globally) */
  private readonly parameterIds = new Set<string>();
  /** value blocks that contain a call to a my-block with a return value somewhere inside */
  private readonly asyncBlocks = new Set<BlockJson>();
  private readonly watchedButtons: ButtonName[] = [];

  private globals = new Map<string, Scalar>();
  private lists = new Map<string, Scalar[]>();
  private threads: Thread[] = [];
  private wasDown: Partial<Record<ButtonName, boolean>> = {};
  private started = false;
  private halted = false;

  private readonly errorList: VMError[] = [];
  private readonly reportedErrors = new Set<string>();
  private readonly reportedWarnings = new Set<string>();

  constructor(
    program: ProgramJson,
    readonly io: RobotIO,
  ) {
    for (const variable of program.variables ?? []) {
      if (!variable || typeof variable.id !== 'string') continue;
      this.variableMeta.set(variable.id, { name: String(variable.name ?? variable.id), isList: variable.type === 'list' });
    }

    const topBlocks = Array.isArray(program.blocks?.blocks) ? program.blocks.blocks : [];
    for (const block of topBlocks) {
      if (!block || typeof block.type !== 'string') continue;
      this.findAsyncBlocks(block);
      if (isDisabled(block)) continue;
      if (DEFINITION_TYPES.includes(block.type)) this.addProcedure(block);
      else if (HAT_TYPES.includes(block.type)) this.addScript(block);
      // anything else lying loose on the workspace is not attached to a hat: it never runs
    }
    this.resetData();
  }

  // ------------------------------------------------------------------ VM interface

  start(): void {
    this.killAll();
    this.resetData();
    this.halted = false;
    this.started = true;
    this.wasDown = {};
    this.driveToken++;
    this.io.resetTimer();
    for (const script of this.scripts) {
      if (script.kind === 'start') this.startScript(script, true);
    }
  }

  step(): void {
    if (!this.started || this.halted) return;
    this.pollButtons();

    // Scripts started during this tick (by a broadcast) get their first turn on the next tick.
    const count = this.threads.length;
    for (let i = 0; i < count; i++) {
      const thread = this.threads[i];
      if (!thread || thread.dead) continue;
      thread.budget = BLOCKS_PER_TICK;
      try {
        if (thread.run.next().done) thread.dead = true;
      } catch (err) {
        thread.dead = true;
        const reason = err instanceof Error ? err.message : String(err);
        this.error(thread.current ?? thread.script.hat.id, `The simulator hit a problem while running this block (${reason}). This script was stopped.`);
      }
      if (this.halted) break;
    }
    this.threads = this.threads.filter((thread) => !thread.dead);
  }

  stopAll(): void {
    this.halt();
  }

  get running(): boolean {
    return this.threads.some((thread) => !thread.dead);
  }

  get idle(): boolean {
    if (this.running) return false;
    // After "stop all" nothing can start any more. Otherwise a button / joystick hat could still
    // start a script; "when I receive" hats cannot fire by themselves.
    return this.halted || this.watchedButtons.length === 0;
  }

  activeBlockIds(): string[] {
    const ids: string[] = [];
    for (const thread of this.threads) {
      if (thread.dead) continue;
      for (const frame of thread.frames) if (!ids.includes(frame.callSite)) ids.push(frame.callSite);
      if (thread.current && !ids.includes(thread.current)) ids.push(thread.current);
    }
    return ids;
  }

  variables(): Record<string, Scalar | Scalar[]> {
    const out: Record<string, Scalar | Scalar[]> = {};
    for (const [id, meta] of this.variableMeta) {
      if (meta.isList) continue;
      const value = this.globals.get(id);
      if (value !== undefined) out[meta.name] = value;
    }
    for (const [id, meta] of this.variableMeta) {
      if (!meta.isList) continue;
      // a list may have the same name as a variable: keep both visible
      const key = meta.name in out ? `${meta.name} (list)` : meta.name;
      out[key] = [...(this.lists.get(id) ?? [])];
    }
    return out;
  }

  errors(): VMError[] {
    return this.errorList.map((e) => ({ ...e }));
  }

  // ------------------------------------------------------------------ set-up

  private addScript(hat: BlockJson): void {
    switch (hat.type) {
      case 'event_cyberpi_start':
        this.scripts.push({ hat, kind: 'start', thread: null });
        break;
      case 'event_button_pressed':
      case 'event_joystick': {
        const raw = this.fieldText(hat, hat.type === 'event_joystick' ? 'DIRECTION' : 'BUTTON').toLowerCase();
        const button = BUTTON_NAMES.find((name) => name === raw);
        if (!button) {
          this.error(hat, `This hat block listens to an unknown button "${raw}".`);
          break;
        }
        this.scripts.push({ hat, kind: 'button', button, thread: null });
        if (!this.watchedButtons.includes(button)) this.watchedButtons.push(button);
        break;
      }
      case 'event_whenbroadcastreceived':
        this.scripts.push({ hat, kind: 'message', message: this.fieldText(hat, 'MESSAGE').trim().toLowerCase(), thread: null });
        break;
    }
  }

  private addProcedure(block: BlockJson): void {
    const name = this.fieldText(block, 'NAME');
    const state = block.extraState as { params?: Array<{ id?: unknown }> } | undefined;
    const params: string[] = [];
    if (state && typeof state === 'object' && Array.isArray(state.params)) {
      for (const p of state.params) params.push(typeof p?.id === 'string' ? p.id : '');
    }
    for (const id of params) if (id) this.parameterIds.add(id);
    this.procedures.set(name.trim().toLowerCase(), { block, name, params });
  }

  /** Remember which value blocks contain a call that may take several ticks. */
  private findAsyncBlocks(first: BlockJson): void {
    for (let block: BlockJson | undefined = first; block; block = block.next?.block) this.markAsync(block);
  }

  private markAsync(block: BlockJson): boolean {
    let found = ASYNC_REPORTER_TYPES.includes(block.type);
    for (const slot of Object.values(block.inputs ?? {})) {
      for (const child of [slot?.block, slot?.shadow]) {
        if (!child) continue;
        // a chain of statements inside a C-block: look at each of them
        for (let b: BlockJson | undefined = child; b; b = b.next?.block) {
          if (this.markAsync(b) && b === child) found = true;
        }
      }
    }
    if (found) this.asyncBlocks.add(block);
    return found;
  }

  private resetData(): void {
    this.globals = new Map();
    this.lists = new Map();
    for (const [id, meta] of this.variableMeta) {
      if (meta.isList) this.lists.set(id, []);
      else if (!this.parameterIds.has(id)) this.globals.set(id, 0);
    }
  }

  // ------------------------------------------------------------------ scripts

  private startScript(script: Script, restartIfRunning: boolean): Thread | null {
    const existing = script.thread;
    if (existing && !existing.dead) {
      if (!restartIfRunning) return null;
      existing.dead = true;
    }
    const thread: Thread = {
      script,
      run: NOTHING_TO_RUN,
      dead: false,
      budget: BLOCKS_PER_TICK,
      current: null,
      frames: [],
      returning: false,
      returnValue: undefined,
    };
    thread.run = this.runStack(thread, script.hat.next?.block);
    script.thread = thread;
    this.threads.push(thread);
    return thread;
  }

  /** "when button pressed" hats fire at the moment a button goes from released to pressed. */
  private pollButtons(): void {
    for (const name of this.watchedButtons) {
      const down = this.io.buttonDown(name);
      if (down && !this.wasDown[name]) {
        for (const script of this.scripts) {
          // like "when key pressed" in Scratch: ignored while that script is still running
          if (script.kind === 'button' && script.button === name) this.startScript(script, false);
        }
      }
      this.wasDown[name] = down;
    }
  }

  /** Start (or restart) every "when I receive" script with this message; returns the new threads. */
  broadcast(message: string): Thread[] {
    const wanted = message.trim().toLowerCase();
    const started: Thread[] = [];
    for (const script of this.scripts) {
      if (script.kind !== 'message' || script.message !== wanted) continue;
      const thread = this.startScript(script, true);
      if (thread) started.push(thread);
    }
    return started;
  }

  killOthers(keep: Thread): void {
    for (const thread of this.threads) if (thread !== keep) thread.dead = true;
  }

  private killAll(): void {
    for (const thread of this.threads) thread.dead = true;
    this.threads = [];
    for (const script of this.scripts) script.thread = null;
  }

  /** "stop all": end every script, stop the wheels, and let nothing start again until start(). */
  halt(): void {
    this.killAll();
    this.halted = true;
    this.driveToken++;
    this.io.stopWheel('all');
  }

  // ------------------------------------------------------------------ problems

  error(block: BlockJson | string, message: string): void {
    const blockId = typeof block === 'string' ? block : block.id;
    if (this.reportedErrors.has(blockId)) return;
    this.reportedErrors.add(blockId);
    this.errorList.push({ message, blockId });
    this.io.log('error', message, blockId);
  }

  warn(block: BlockJson, message: string): void {
    if (this.reportedWarnings.has(block.id)) return;
    this.reportedWarnings.add(block.id);
    this.io.log('warn', message, block.id);
  }

  // ------------------------------------------------------------------ variables and lists

  readVariable(thread: Thread, id: string): Scalar {
    const frame = thread.frames[thread.frames.length - 1];
    const local = frame?.locals.get(id);
    if (local !== undefined) return local;
    return this.globals.get(id) ?? 0;
  }

  writeVariable(thread: Thread, id: string, value: Scalar): void {
    const frame = thread.frames[thread.frames.length - 1];
    if (frame?.locals.has(id)) frame.locals.set(id, value);
    else this.globals.set(id, value);
  }

  list(id: string): Scalar[] {
    let list = this.lists.get(id);
    if (!list) {
      list = [];
      this.lists.set(id, list);
    }
    return list;
  }

  // ------------------------------------------------------------------ reading a block

  /** Text stored in a dropdown / text field; the catalog default when the program has none. */
  fieldText(block: BlockJson, name: string): string {
    const value = block.fields?.[name];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return INFO.get(block.type)?.fieldDefaults[name] ?? '';
  }

  /** The block sitting in a value slot: the dropped-in reporter, else the white bubble (shadow). */
  private childOf(block: BlockJson, name: string): BlockJson | undefined {
    const slot = block.inputs?.[name];
    if (!slot) return undefined;
    if (slot.block && !isDisabled(slot.block)) return slot.block;
    return slot.shadow;
  }

  private emptySlot(block: BlockJson, slot: SlotSpec): void {
    const counts = typeof slot.fallback === 'boolean' ? 'false' : slot.fallback === '' ? 'empty text' : String(slot.fallback);
    this.error(block, `This block has an empty slot (${slot.name}). It counts as ${counts} - drop a block into it.`);
  }

  // ------------------------------------------------------------------ values

  /** Value of a reporter block that can be computed straight away (the normal case). */
  private evalSync(thread: Thread, block: BlockJson): Scalar {
    thread.budget--;
    const type = block.type;
    if (type === 'math_number') return toNumber(block.fields?.NUM);
    if (type === 'text') return toText(block.fields?.TEXT);
    const slots = INFO.get(type)?.slots ?? NO_SLOTS;
    return this.report(thread, block, slots.length > 0 ? this.argsSync(thread, block, slots) : NO_ARGS);
  }

  /** Same, for a block with a "my block with return value" somewhere inside (may take several ticks). */
  private *evalAsync(thread: Thread, block: BlockJson): Eval {
    thread.budget--;
    if (block.type === 'procedures_callreturn') return yield* this.call(thread, block);
    const slots = INFO.get(block.type)?.slots ?? NO_SLOTS;
    return this.report(thread, block, yield* this.argsAsync(thread, block, slots));
  }

  private argsSync(thread: Thread, block: BlockJson, slots: SlotSpec[]): Args {
    const args: Args = {};
    for (const slot of slots) {
      const child = this.childOf(block, slot.name);
      if (child) args[slot.name] = this.evalSync(thread, child);
      else {
        this.emptySlot(block, slot);
        args[slot.name] = slot.fallback;
      }
    }
    return args;
  }

  private *argsAsync(thread: Thread, block: BlockJson, slots: SlotSpec[]): Generator<void, Args, void> {
    const args: Args = {};
    for (const slot of slots) args[slot.name] = yield* this.slot(thread, block, slot);
    return args;
  }

  /** Value of one slot of a block. */
  private *slot(thread: Thread, block: BlockJson, slot: SlotSpec): Eval {
    const child = this.childOf(block, slot.name);
    if (!child) {
      this.emptySlot(block, slot);
      return slot.fallback;
    }
    if (this.asyncBlocks.has(child)) return yield* this.evalAsync(thread, child);
    return this.evalSync(thread, child);
  }

  /** Run a reporter whose slots have been computed. */
  private report(thread: Thread, block: BlockJson, args: Args): Scalar {
    const handler = REPORTERS[block.type] ?? CORE_REPORTERS[block.type];
    if (!handler) {
      this.error(block, `The simulator does not know the block "${block.type}". It counts as 0.`);
      return 0;
    }
    return handler(new Context(this, thread, block, args));
  }

  // ------------------------------------------------------------------ statements

  /** Run a stack of blocks from top to bottom. */
  private *runStack(thread: Thread, first: BlockJson | undefined): Step {
    for (let block = first; block; block = block.next?.block) {
      if (isDisabled(block)) continue;
      yield* this.runStatement(thread, block);
      if (thread.returning) return;
    }
  }

  private *runStatement(thread: Thread, block: BlockJson): Step {
    // Safety net: too many blocks in one tick -> carry on next tick.
    if (thread.budget <= 0) yield;
    thread.budget--;
    thread.current = block.id;

    const control = CONTROL[block.type];
    if (control) {
      yield* control(this, thread, block);
      return;
    }

    const handler = STATEMENTS[block.type] ?? CORE_STATEMENTS[block.type];
    if (!handler) {
      this.error(block, `The simulator does not know the block "${block.type}". It was skipped.`);
      return;
    }
    const slots = INFO.get(block.type)?.slots ?? NO_SLOTS;
    let args: Args = NO_ARGS;
    if (slots.length > 0) {
      if (this.asyncBlocks.has(block)) {
        args = yield* this.argsAsync(thread, block, slots);
        thread.current = block.id;
      } else {
        args = this.argsSync(thread, block, slots);
      }
    }

    const wait = handler(new Context(this, thread, block, args));
    // A script that was just stopped (stop this script / stop all / restarted by its own
    // broadcast) pauses here and is never woken up again.
    if (thread.dead) yield;
    if (wait) {
      while (!wait()) yield;
    }
  }

  // ------------------------------------------------------------------ control blocks

  private body(block: BlockJson, name: string): BlockJson | undefined {
    return block.inputs?.[name]?.block;
  }

  *repeat(thread: Thread, block: BlockJson): Step {
    const times = Math.round(toNumber(yield* this.slot(thread, block, { name: 'TIMES', fallback: 0 })));
    const body = this.body(block, 'SUBSTACK');
    for (let i = 0; i < times; i++) {
      yield* this.runStack(thread, body);
      if (thread.returning) return;
      yield; // a loop pauses once per pass
    }
  }

  *forever(thread: Thread, block: BlockJson): Step {
    const body = this.body(block, 'SUBSTACK');
    for (;;) {
      yield* this.runStack(thread, body);
      if (thread.returning) return;
      yield;
    }
  }

  *ifThen(thread: Thread, block: BlockJson): Step {
    const condition = toBoolean(yield* this.slot(thread, block, { name: 'CONDITION', fallback: false }));
    if (condition) yield* this.runStack(thread, this.body(block, 'SUBSTACK'));
    else if (block.type === 'control_if_else') yield* this.runStack(thread, this.body(block, 'SUBSTACK2'));
  }

  *waitUntil(thread: Thread, block: BlockJson): Step {
    while (!toBoolean(yield* this.slot(thread, block, { name: 'CONDITION', fallback: false }))) yield;
  }

  *repeatUntil(thread: Thread, block: BlockJson): Step {
    const body = this.body(block, 'SUBSTACK');
    while (!toBoolean(yield* this.slot(thread, block, { name: 'CONDITION', fallback: false }))) {
      yield* this.runStack(thread, body);
      if (thread.returning) return;
      yield;
    }
  }

  // ------------------------------------------------------------------ my blocks (Blockly procedures)

  *callStatement(thread: Thread, block: BlockJson): Step {
    yield* this.call(thread, block);
  }

  /** Run the definition of a my-block with the values given at the call; gives back its return value. */
  private *call(thread: Thread, block: BlockJson): Eval {
    const state = block.extraState as { name?: unknown } | undefined;
    const name = state && typeof state === 'object' && typeof state.name === 'string' ? state.name : '';
    const procedure = this.procedures.get(name.trim().toLowerCase());
    if (!procedure) {
      this.error(block, `There is no definition for the block "${name}". It was skipped.`);
      return 0;
    }

    const locals = new Map<string, Scalar>();
    for (let i = 0; i < procedure.params.length; i++) {
      locals.set(procedure.params[i], yield* this.slot(thread, block, { name: `ARG${i}`, fallback: 0 }));
    }

    if (thread.frames.length >= MAX_CALL_DEPTH) {
      this.error(block, `The block "${procedure.name}" keeps calling itself (more than ${MAX_CALL_DEPTH} levels deep). This script was stopped.`);
      thread.dead = true;
      yield; // never woken up again
      return 0;
    }

    thread.frames.push({ locals, callSite: block.id });
    yield* this.runStack(thread, procedure.block.inputs?.STACK?.block);

    let result: Scalar = 0;
    if (thread.returning) {
      result = thread.returnValue ?? 0;
    } else if (procedure.block.type === 'procedures_defreturn') {
      result = yield* this.slot(thread, procedure.block, { name: 'RETURN', fallback: 0 });
    }
    thread.returning = false;
    thread.returnValue = undefined;
    thread.frames.pop();
    thread.current = block.id;
    return result;
  }

  /** Blockly's "if <condition> return [value]" block: leave the my-block definition early. */
  *ifReturn(thread: Thread, block: BlockJson): Step {
    const condition = toBoolean(yield* this.slot(thread, block, { name: 'CONDITION', fallback: false }));
    if (!condition) return;
    if (thread.frames.length === 0) {
      this.error(block, 'A "return" block only works inside the definition of a my-block.');
      return;
    }
    if (this.childOf(block, 'VALUE')) {
      thread.returnValue = yield* this.slot(thread, block, { name: 'VALUE', fallback: 0 });
    }
    thread.returning = true;
  }
}

// =============================================================================================
// Entry point
// =============================================================================================

/**
 * Create an interpreter for a program.
 * @param program exactly what Blockly.serialization.workspaces.save(workspace) returns
 * @param io the robot the program drives
 */
export function createVM(program: ProgramJson, io: RobotIO): VM {
  return new Interpreter(program ?? {}, io);
}

export { DEFAULT_MOTION_RPM, SERVO_TIMEOUT_SECONDS, wheelDegreesForDistance, wheelDegreesForTurn } from './handlers';
export type { BlockContext, ReporterHandler, StatementHandler, Wait } from './handlers';
