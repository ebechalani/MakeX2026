/**
 * Consistency checks between the three places that must agree on the block language:
 * the catalog (blocks/catalog.ts), the interpreter (vm/index.ts) and the toolbox (blocks/toolbox.ts).
 * None of them needs Blockly or a browser.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allArgs,
  BLOCKS,
  blocklyDefinitions,
  BUILTIN_BLOCK_TYPES,
  CATEGORIES,
  fieldArgs,
  getBlockDef,
  LINE_PATTERNS,
  valueInputs,
} from '../blocks/catalog';
import { MBOT2_THEME, RENDERER } from '../blocks/theme';
import { buildToolbox, TOOLBOX, toolboxBlockTypes } from '../blocks/toolbox';
import * as B from './builder';
import { blockRole, SUPPORTED_BLOCK_TYPES, supportsBlock } from './index';

describe('block catalog', () => {
  it('has unique, prefixed type ids and a known category for every block', () => {
    const seen = new Set<string>();
    const categories = new Set(CATEGORIES.map((c) => c.id));
    for (const def of BLOCKS) {
      assert.ok(!seen.has(def.type), `duplicate block type ${def.type}`);
      seen.add(def.type);
      assert.match(def.type, /^(mbot2|cyberpi|event|control|operator|sensing|data|gripper)_[a-z0-9_]+$/, def.type);
      assert.ok(categories.has(def.category), `${def.type}: unknown category ${def.category}`);
      assert.ok(def.tooltip.length > 0, `${def.type}: no tooltip`);
    }
  });

  it('every message placeholder has exactly one argument', () => {
    for (const def of BLOCKS) {
      const rows = [{ message: def.message, args: def.args }, ...(def.rows ?? [])];
      for (const row of rows) {
        const placeholders = [...row.message.matchAll(/%(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
        const expected = (row.args ?? []).map((_, i) => i + 1);
        assert.deepEqual(placeholders, expected, `${def.type}: "${row.message}"`);
      }
      const names = allArgs(def).map((a) => a.name);
      assert.equal(new Set(names).size, names.length, `${def.type}: duplicate argument name`);
    }
  });

  it('number / text slots have a shadow, pointed slots do not; dropdowns are not empty', () => {
    for (const def of BLOCKS) {
      for (const arg of valueInputs(def)) {
        if (arg.check === 'Boolean') assert.equal(arg.shadow, undefined, `${def.type}.${arg.name}`);
        else assert.ok(arg.shadow, `${def.type}.${arg.name} has no shadow`);
      }
      for (const arg of fieldArgs(def)) {
        if (arg.type !== 'field_dropdown') continue;
        assert.ok(arg.options.length > 0, `${def.type}.${arg.name}`);
        const values = arg.options.map(([, value]) => value);
        assert.equal(new Set(values).size, values.length, `${def.type}.${arg.name}: duplicate option`);
      }
    }
  });

  it('offers the 16 line patterns of the quad RGB sensor', () => {
    assert.equal(LINE_PATTERNS.length, 16);
    assert.deepEqual(LINE_PATTERNS[6], ['(6) □■■□', '6']);
    assert.deepEqual(LINE_PATTERNS[8], ['(8) ■□□□', '8']);
  });

  it('produces one Blockly definition per block with the right connections', () => {
    const definitions = blocklyDefinitions();
    assert.equal(definitions.length, BLOCKS.length);
    for (const json of definitions) {
      const def = getBlockDef(String(json.type))!;
      assert.equal(typeof json.message0, 'string');
      assert.match(String(json.colour), /^#[0-9A-F]{6}$/i);
      switch (def.shape) {
        case 'hat':
          assert.ok(!('previousStatement' in json) && 'nextStatement' in json && !('output' in json), def.type);
          break;
        case 'statement':
          assert.ok('previousStatement' in json && !('output' in json), def.type);
          assert.equal('nextStatement' in json, !def.terminal, def.type);
          break;
        case 'boolean':
          assert.equal(json.output, 'Boolean', def.type);
          break;
        case 'reporter':
          assert.ok(Array.isArray(json.output) && !json.output.includes('Boolean'), def.type);
          break;
      }
      // our own "shadow" hint must not leak into what Blockly receives
      for (const arg of json.args0 as Array<Record<string, unknown>>) assert.ok(!('shadow' in arg), def.type);
    }
  });
});

describe('interpreter covers the catalog', () => {
  it('every catalog block is handled, with the matching role', () => {
    const missing = BLOCKS.filter((def) => !supportsBlock(def.type)).map((def) => def.type);
    assert.deepEqual(missing, [], 'catalog blocks the interpreter does not know');
    for (const def of BLOCKS) {
      const expected = def.shape === 'boolean' ? 'reporter' : def.shape;
      assert.equal(blockRole(def.type), expected, def.type);
    }
  });

  it('every Blockly built-in we rely on is handled', () => {
    const missing = BUILTIN_BLOCK_TYPES.filter((type) => !supportsBlock(type));
    assert.deepEqual(missing, []);
  });

  it('the interpreter has no handler for a block that does not exist', () => {
    const known = new Set([...BLOCKS.map((def) => def.type), ...BUILTIN_BLOCK_TYPES]);
    const unknown = SUPPORTED_BLOCK_TYPES.filter((type) => !known.has(type));
    assert.deepEqual(unknown, []);
    assert.equal(new Set(SUPPORTED_BLOCK_TYPES).size, SUPPORTED_BLOCK_TYPES.length, 'a block type is handled twice');
    assert.equal(supportsBlock('no_such_block'), false);
  });
});

describe('toolbox', () => {
  it('only references block types that exist', () => {
    const known = new Set([...BLOCKS.map((def) => def.type), ...BUILTIN_BLOCK_TYPES]);
    const types = toolboxBlockTypes();
    assert.ok(types.length > 60, 'the toolbox should list the catalog');
    const unknown = types.filter((type) => !known.has(type));
    assert.deepEqual(unknown, []);
  });

  it('lists every visible catalog block exactly once, in its own category', () => {
    const listed = new Map<string, string>();
    for (const category of TOOLBOX.contents) {
      for (const item of category.contents ?? []) {
        if (item.kind !== 'block') continue;
        assert.ok(!listed.has(item.type), `${item.type} is listed twice`);
        listed.set(item.type, category.toolboxitemid);
      }
    }
    for (const def of BLOCKS) {
      if (def.hidden) assert.ok(!listed.has(def.type), `${def.type} is hidden but listed`);
      else assert.equal(listed.get(def.type), def.category, def.type);
    }
  });

  it('is plain JSON in mBlock order, with dynamic Variables and My Blocks categories', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(TOOLBOX)), TOOLBOX);
    assert.equal(TOOLBOX.kind, 'categoryToolbox');
    assert.deepEqual(
      TOOLBOX.contents.map((c) => c.name),
      CATEGORIES.map((c) => c.name),
    );
    const names = TOOLBOX.contents.map((c) => c.toolboxitemid);
    assert.ok(names.indexOf('events') < names.indexOf('control'));
    assert.ok(names.indexOf('control') < names.indexOf('operators'));
    assert.ok(names.indexOf('operators') < names.indexOf('variables'));
    assert.ok(names.indexOf('variables') < names.indexOf('myblocks'));
    assert.ok(names.indexOf('myblocks') < names.indexOf('chassis'));
    assert.equal(TOOLBOX.contents.find((c) => c.toolboxitemid === 'variables')!.custom, 'VARIABLE');
    assert.equal(TOOLBOX.contents.find((c) => c.toolboxitemid === 'myblocks')!.custom, 'PROCEDURE');
    for (const category of TOOLBOX.contents) assert.match(category.colour, /^#[0-9A-F]{6}$/i);
  });

  it('gives every number / text slot its shadow with the catalog default', () => {
    const chassis = TOOLBOX.contents.find((c) => c.toolboxitemid === 'chassis')!;
    const move = chassis.contents!.find((item) => item.kind === 'block' && item.type === 'mbot2_straight_cm');
    assert.deepEqual(move, {
      kind: 'block',
      type: 'mbot2_straight_cm',
      fields: { DIRECTION: 'forward' },
      inputs: { DISTANCE: { shadow: { type: 'math_number', fields: { NUM: 100 } } } },
    });
    for (const category of TOOLBOX.contents) {
      for (const item of category.contents ?? []) {
        if (item.kind !== 'block') continue;
        const def = getBlockDef(item.type)!;
        for (const arg of valueInputs(def)) {
          assert.equal(Boolean(item.inputs?.[arg.name]), arg.check !== 'Boolean', `${item.type}.${arg.name}`);
        }
      }
    }
  });

  it('can be limited to some categories, in the order asked for', () => {
    const small = buildToolbox(['chassis', 'events', 'chassis']);
    assert.deepEqual(
      small.contents.map((c) => c.toolboxitemid),
      ['chassis', 'events'],
    );
    assert.ok(small.contents[0].contents!.length > 5);
  });

  it('theme is plain data for the zelos renderer', () => {
    assert.equal(RENDERER, 'zelos');
    assert.deepEqual(JSON.parse(JSON.stringify(MBOT2_THEME)), MBOT2_THEME);
    assert.equal(MBOT2_THEME.startHats, true);
  });
});

describe('program builder', () => {
  it('writes Blockly serialisation JSON: ids, shadows, variables', () => {
    const p = B.program([
      B.script(B.whenStart(), [B.setVar('speed', 40), B.moveCm('forward', B.add(B.v('speed'), 2)), B.forever([B.wait(1)])]),
    ]);
    assert.equal(p.blocks!.languageVersion, 0);
    assert.deepEqual(p.variables, [{ name: 'speed', id: 'var1' }]);
    const hat = p.blocks!.blocks![0];
    assert.equal(hat.type, 'event_cyberpi_start');
    assert.equal(typeof hat.x, 'number');
    const set = hat.next!.block!;
    assert.deepEqual(set.fields, { VARIABLE: { id: 'var1' } });
    assert.equal(set.inputs!.VALUE.shadow!.type, 'math_number');
    assert.equal(set.inputs!.VALUE.shadow!.fields!.NUM, 40);
    const move = set.next!.block!;
    assert.deepEqual(move.fields, { DIRECTION: 'forward' });
    // a dropped-in reporter sits on top of the default shadow, like in the editor
    assert.equal(move.inputs!.DISTANCE.shadow!.fields!.NUM, 100);
    assert.equal(move.inputs!.DISTANCE.block!.type, 'operator_add');
    const loop = move.next!.block!;
    assert.equal(loop.type, 'control_forever');
    assert.equal(loop.inputs!.SUBSTACK.block!.type, 'control_wait');
    assert.equal(loop.next, undefined);

    const ids: string[] = [];
    const walk = (block: (typeof hat) | undefined): void => {
      if (!block) return;
      ids.push(block.id);
      for (const slot of Object.values(block.inputs ?? {})) {
        walk(slot.shadow);
        walk(slot.block);
      }
      walk(block.next?.block);
    };
    p.blocks!.blocks!.forEach(walk);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  });

  it('fills defaults for everything left out', () => {
    const p = B.program([B.script(B.whenStart(), [B.b('mbot2_move_direction_with_time')])]);
    const block = p.blocks!.blocks![0].next!.block!;
    assert.deepEqual(block.fields, { DIRECTION: 'forward' });
    assert.equal(block.inputs!.SPEED.shadow!.fields!.NUM, 50);
    assert.equal(block.inputs!.DURATION.shadow!.fields!.NUM, 1);
  });

  it('refuses typos and impossible stacks', () => {
    assert.throws(() => B.b('mbot2_straight_cm', { inputs: { DISTANSE: 5 } }), /no value slot "DISTANSE"/);
    assert.throws(() => B.b('mbot2_straight_cm', { fields: { DIRECTION: 'sideways' } }), /not a choice/);
    assert.throws(() => B.b('control_if', { inputs: { CONDITION: 1 } }), /true\/false block/);
    assert.throws(() => B.ifThen(B.add(1, 2), []), /round value block/);
    assert.throws(() => B.script(B.whenStart(), [B.forever([]), B.wait(1)]), /Nothing can come after/);
    assert.throws(() => B.script(B.wait(1), []), /must start with a hat/);
    assert.throws(() => B.script(B.whenStart(), [B.add(1, 2)]), /cannot be stacked/);
    assert.throws(() => B.program([B.script(B.whenStart(), [B.call('nothing')])]), /no define/);
  });

  it('builds my-block definitions and calls in Blockly\'s own format', () => {
    const p = B.program([B.script(B.whenStart(), [B.call('go', 5)]), B.define('go', ['dist'], [B.moveCm('forward', B.v('dist'))])]);
    const [def, hat] = p.blocks!.blocks!;
    assert.equal(def.type, 'procedures_defnoreturn', 'definitions come first');
    assert.deepEqual(def.extraState, { params: [{ name: 'dist', id: 'var1' }] });
    assert.deepEqual(def.fields, { NAME: 'go' });
    const callBlock = hat.next!.block!;
    assert.deepEqual(callBlock.extraState, { name: 'go', params: ['dist'] });
    assert.equal(callBlock.inputs!.ARG0.shadow!.fields!.NUM, 5);
    assert.deepEqual(p.variables, [{ name: 'dist', id: 'var1' }]);
  });
});
