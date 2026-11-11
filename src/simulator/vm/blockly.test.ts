/**
 * Checks against the real Blockly library (loaded in Node with a pretend browser, jsdom, which
 * Blockly brings along):
 *  - Blockly accepts every block definition of the catalog and every toolbox entry;
 *  - programs written with the builder load into a Blockly workspace, and what Blockly saves
 *    again runs in the interpreter with the same result.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';

import { BLOCKS, getBlockDef } from '../blocks/catalog';
import { createEditor, registerBlocks, variablesFlyout } from '../blocks/register';
import type { BlocklyApi } from '../blocks/register';
import { TOOLBOX, toolboxBlock } from '../blocks/toolbox';
import type { ProgramJson } from '../core/types';
import * as B from './builder';
import { createFakeIO, runUntilDone } from './fake-io';
import { createVM, supportsBlock } from './index';

type AnyWorkspace = InstanceType<BlocklyApi['WorkspaceSvg']>;

let Blockly: BlocklyApi;
let workspace: AnyWorkspace;

/** Give Node the few browser globals Blockly needs to draw blocks, then load Blockly. */
async function loadBlocklyWithDom(): Promise<BlocklyApi> {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options?: object) => { window: Record<string, unknown> } };
  const dom = new JSDOM('<!DOCTYPE html><div id="editor" style="width: 900px; height: 600px"></div>', { pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'DOMParser', 'XMLSerializer',
    'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']; // prettier-ignore
  // jsdom has no canvas; Blockly only uses it to measure how wide a text is
  const canvas = dom.window.HTMLCanvasElement as { prototype: { getContext: unknown } };
  canvas.prototype.getContext = () => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) });
  for (const name of names) {
    const value = name === 'window' ? dom.window : dom.window[name];
    if (value !== undefined) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return (await import('blockly')) as unknown as BlocklyApi;
}

/** A program that touches most kinds of blocks. */
function sampleProgram(): ProgramJson {
  return B.program([
    B.script(B.whenStart(), [
      B.setVar('speed', 40),
      B.ledColor('all', '#00ff00'),
      B.call('side', 10),
      B.repeat(2, [B.changeVar('speed', B.add(B.v('speed'), 1)), B.addToList('log', B.v('speed'))]),
      B.ifElse(B.and(B.gt(B.v('speed'), 100), B.not(B.probeDetects('L1', 'line'))), [B.print('fast')], [B.print(B.join('speed ', B.v('speed')))]),
      B.print(B.callReturn('twice', 4)),
      B.broadcastAndWait('lift'),
      B.driveRpm(B.v('speed'), B.sub(0, B.v('speed'))),
      B.waitUntil(B.gt(B.timer(), 1)),
      B.stop('all'),
    ]),
    B.script(B.whenReceive('lift'), [B.gripper('close'), B.arm('raise'), B.print(B.lengthOfList('log'))]),
    B.script(B.whenButton('b'), [B.forever([B.playTone(440, 0.2)])]),
    B.define('side', ['length'], [B.moveCm('forward', B.v('length')), B.turn('left', 90)]),
    B.defineReturn('twice', ['x'], [B.ifReturn(B.lt(B.v('x'), 0), 0)], B.mul(B.v('x'), 2)),
  ]);
}

function run(program: ProgramJson): { lines: string[]; calls: string[]; variables: unknown; errors: unknown } {
  const io = createFakeIO();
  const vm = createVM(program, io);
  vm.start();
  runUntilDone(vm, io, 30);
  return { lines: io.lines, calls: io.calls, variables: vm.variables(), errors: vm.errors() };
}

describe('Blockly integration', () => {
  before(async () => {
    Blockly = await loadBlocklyWithDom();
    registerBlocks(Blockly);
    registerBlocks(Blockly); // twice on purpose: must be harmless
    workspace = createEditor(Blockly, 'editor', { sounds: false });
  });

  it('defines every catalog block with the shape the catalog promises', () => {
    for (const def of BLOCKS) {
      assert.ok(def.type in Blockly.Blocks, `${def.type} is not defined in Blockly`);
      const block = workspace.newBlock(def.type);
      block.initSvg();
      block.render();
      const hasOutput = block.outputConnection !== null;
      const hasPrevious = block.previousConnection !== null;
      const hasNext = block.nextConnection !== null;
      switch (def.shape) {
        case 'hat':
          assert.deepEqual([hasOutput, hasPrevious, hasNext], [false, false, true], def.type);
          break;
        case 'statement':
          assert.deepEqual([hasOutput, hasPrevious, hasNext], [false, true, !def.terminal], def.type);
          break;
        default:
          assert.deepEqual([hasOutput, hasPrevious, hasNext], [true, false, false], def.type);
          assert.equal(block.outputConnection!.getCheck()!.includes('Boolean'), def.shape === 'boolean', def.type);
      }
      assert.ok(block.getHeightWidth().width > 0, `${def.type} was not drawn`);
      block.dispose(false);
    }
    workspace.clear();
  });

  it('accepts every toolbox entry (blocks with their shadows)', () => {
    let count = 0;
    for (const category of TOOLBOX.contents) {
      for (const item of category.contents ?? []) {
        if (item.kind !== 'block') continue;
        const { kind: _kind, ...state } = item;
        const block = Blockly.serialization.blocks.append(state as never, workspace);
        assert.equal(block.type, item.type);
        for (const name of Object.keys(item.inputs ?? {})) {
          const shadow = block.getInput(name)?.connection?.targetBlock();
          assert.ok(shadow?.isShadow(), `${item.type}.${name} has no shadow`);
        }
        count++;
      }
    }
    assert.ok(count > 60);
    workspace.clear();
  });

  it('the toolbox was built: one category per catalog category, flyout filled', () => {
    const toolbox = workspace.getToolbox();
    assert.ok(toolbox);
    assert.equal(toolbox.getToolboxItems().length, TOOLBOX.contents.length);
  });

  it('the Variables palette lists the variables and lists of the workspace', () => {
    workspace.clear();
    assert.deepEqual(
      variablesFlyout(workspace).map((item) => item.kind),
      ['button', 'button'],
      'empty workspace: only the two "Make a ..." buttons',
    );
    const variable = workspace.getVariableMap().createVariable('speed', '');
    workspace.getVariableMap().createVariable('route', 'list');
    const items = variablesFlyout(workspace);
    const types = items.flatMap((item) => (item.kind === 'block' ? [item.type] : []));
    assert.deepEqual(types.slice(0, 3), ['data_variable', 'data_setvariableto', 'data_changevariableby']);
    assert.ok(types.includes('data_listcontents') && types.includes('data_addtolist') && types.includes('data_listcontainsitem'));
    for (const item of items) {
      if (item.kind !== 'block') continue;
      assert.ok(supportsBlock(item.type), item.type);
      const { kind: _kind, ...state } = item;
      const block = Blockly.serialization.blocks.append(state as never, workspace);
      if (item.type === 'data_variable') assert.equal(block.getFieldValue('VARIABLE'), variable.getId());
    }
    assert.equal(workspace.getVariableMap().getAllVariables().length, 2, 'showing the palette does not create variables');
    workspace.clear();
  });

  it('loads a builder program and saves it back unchanged in meaning', () => {
    const program = sampleProgram();
    workspace.clear();
    Blockly.serialization.workspaces.load(program as never, workspace);
    const saved = Blockly.serialization.workspaces.save(workspace) as ProgramJson;

    const collect = (p: ProgramJson): string[] => {
      const out: string[] = [];
      const walk = (block: NonNullable<NonNullable<ProgramJson['blocks']>['blocks']>[number] | undefined): void => {
        if (!block) return;
        out.push(`${block.id}:${block.type}`);
        for (const slot of Object.values(block.inputs ?? {})) {
          walk(slot.shadow);
          walk(slot.block);
        }
        walk(block.next?.block);
      };
      (p.blocks?.blocks ?? []).forEach(walk);
      return out.sort();
    };
    assert.deepEqual(collect(saved), collect(program), 'same blocks, same ids');
    assert.deepEqual(
      [...(saved.variables ?? [])].map((v) => `${v.id}:${v.name}:${v.type ?? ''}`).sort(),
      [...(program.variables ?? [])].map((v) => `${v.id}:${v.name}:${v.type ?? ''}`).sort(),
    );

    // every block Blockly drew is one the interpreter can run
    for (const block of workspace.getAllBlocks(false)) assert.ok(supportsBlock(block.type), block.type);

    const fromBuilder = run(program);
    const fromBlockly = run(saved);
    assert.deepEqual(fromBlockly, fromBuilder);
    assert.deepEqual(fromBuilder.errors, []);
    assert.ok(fromBuilder.lines.includes('8'), 'the my-block with a return value ran');
    assert.ok(fromBuilder.calls.includes('setLed all 0,255,0'));
  });

  it('Blockly keeps field defaults in step with the catalog (a freshly dragged block runs)', () => {
    workspace.clear();
    // what a student gets by dragging blocks out of the toolbox without touching anything
    const hat = Blockly.serialization.blocks.append({ type: 'event_cyberpi_start' } as never, workspace);
    let previous = hat;
    for (const category of TOOLBOX.contents) {
      for (const item of category.contents ?? []) {
        if (item.kind !== 'block') continue;
        const def = getBlockDef(item.type)!;
        // left out: blocks that end the script, and loops / waits that never end with an empty condition
        const skip = ['control_stop', 'control_wait_until', 'control_repeat_until'];
        if (def.shape !== 'statement' || def.terminal || skip.includes(def.type)) continue;
        const { kind: _kind, ...state } = item;
        const block = Blockly.serialization.blocks.append(state as never, workspace);
        previous.nextConnection!.connect(block.previousConnection!);
        previous = block;
      }
    }
    const saved = Blockly.serialization.workspaces.save(workspace) as ProgramJson;
    const result = run(saved);
    // the only complaints allowed are about the empty condition slots of the two "if" blocks
    for (const error of result.errors as Array<{ message: string }>) assert.match(error.message, /empty slot \(CONDITION\)/);
    assert.ok(result.calls.includes('print makeblock'));
    assert.ok(result.calls.some((c) => c.startsWith('startMotion')));
  });

  it('a word can be typed into the bubbles of "=" and "set variable"; move bubbles take numbers only', () => {
    workspace.clear();
    const fresh = (type: string) => {
      const { kind: _kind, ...state } = toolboxBlock(type);
      return Blockly.serialization.blocks.append(state as never, workspace);
    };
    for (const [type, slot] of [['operator_equals', 'OPERAND2'], ['operator_gt', 'OPERAND1'], ['data_setvariableto', 'VALUE']]) {
      const bubble = fresh(type).getInput(slot)!.connection!.targetBlock()!;
      assert.ok(bubble.isShadow(), type);
      bubble.setFieldValue('red', 'TEXT');
      assert.equal(bubble.getFieldValue('TEXT'), 'red', `${type}: the bubble keeps the word`);
    }
    const distance = fresh('mbot2_straight_cm').getInput('DISTANCE')!.connection!.targetBlock()!;
    distance.setFieldValue('red', 'NUM');
    assert.equal(distance.getFieldValue('NUM'), 100, 'a distance cannot be a word: the bubble keeps its number');
    workspace.clear();
  });

  it('the slots of a my-block call (and of "return") get a white bubble to type into', async () => {
    workspace.clear();
    Blockly.serialization.workspaces.load(
      B.program([B.script(B.whenStart(), []), B.define('go', ['dist'], [B.print(B.join('go ', B.v('dist')))])]) as never,
      workspace,
    );
    // what dragging blocks out of the My Blocks palette creates: holes without a bubble
    const call = Blockly.serialization.blocks.append({ type: 'procedures_callnoreturn', extraState: { name: 'go', params: ['dist'] } } as never, workspace);
    const withReturn = Blockly.serialization.blocks.append({ type: 'procedures_defreturn', fields: { NAME: 'my value' } } as never, workspace);
    const hole = call.getInput('ARG0')!.connection!;
    // Blockly tells its listeners about new blocks a moment later
    await new Promise((resolve) => setTimeout(resolve, 50));
    const bubble = hole.targetBlock();
    assert.ok(bubble && bubble.isShadow(), 'the call slot has a bubble');
    assert.equal(bubble.type, 'text');
    assert.ok(withReturn.getInput('RETURN')!.connection!.targetBlock()?.isShadow(), 'the return slot has a bubble');

    // type 25 into it, hang the call under the hat, run the program Blockly saves
    bubble.setFieldValue('25', 'TEXT');
    const hat = workspace.getTopBlocks(false).find((block) => block.type === 'event_cyberpi_start')!;
    hat.nextConnection!.connect(call.previousConnection!);
    withReturn.dispose(false);
    const result = run(Blockly.serialization.workspaces.save(workspace) as ProgramJson);
    assert.deepEqual(result.lines, ['go 25']);
    assert.deepEqual(result.errors, []);

    // a block dropped on the bubble hides it; taking the block away brings the bubble back with its text
    const timer = Blockly.serialization.blocks.append({ type: 'cyberpi_timer' } as never, workspace);
    hole.connect(timer.outputConnection!);
    assert.equal(hole.targetBlock()!.type, 'cyberpi_timer');
    timer.dispose(false);
    assert.equal(hole.targetBlock()!.getFieldValue('TEXT'), '25');
    workspace.clear();
  });

  it('notes written with the builder show up as block comments and are saved again', () => {
    workspace.clear();
    const program = B.program([B.script(B.whenStart(), [B.note(B.moveCm('forward', 20.4), 'Now below water tower W1.')])]);
    Blockly.serialization.workspaces.load(program as never, workspace);
    const move = workspace.getAllBlocks(false).find((block) => block.type === 'mbot2_straight_cm')!;
    assert.equal(move.getCommentText(), 'Now below water tower W1.');
    const saved = Blockly.serialization.workspaces.save(workspace) as ProgramJson;
    const icons = saved.blocks!.blocks![0].next!.block!.icons as { comment: { text: string; pinned: boolean } };
    assert.equal(icons.comment.text, 'Now below water tower W1.');
    assert.equal(icons.comment.pinned, false);
    assert.deepEqual(run(saved), run(program), 'a note changes nothing in what the program does');
    workspace.clear();
  });
});
