import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../core/geometry';
import {
  SCENARIO_COUNT,
  decodeScenario,
  defaultScenario,
  encodeScenario,
  isValidScenario,
  randomScenario,
  scenarioFromIndex,
  scenarioIndex,
  withBucket,
  withPersonColor,
  withPersonSlot,
} from './scenario';

test('there are 9216 distinct, valid combinations and index <-> scenario round-trips', () => {
  assert.equal(SCENARIO_COUNT, 9216);
  const codes = new Set<string>();
  for (let i = 0; i < SCENARIO_COUNT; i++) {
    const s = scenarioFromIndex(i);
    assert.ok(isValidScenario(s), `scenario ${i} invalid`);
    assert.equal(scenarioIndex(s), i);
    codes.add(encodeScenario(s));
  }
  assert.equal(codes.size, SCENARIO_COUNT);
});

test('codes round-trip and are forgiving about formatting', () => {
  const s = defaultScenario();
  assert.equal(encodeScenario(s), 'RGBY-A1R-B1B-C1Y-D1G');
  assert.deepEqual(decodeScenario('RGBY-A1R-B1B-C1Y-D1G'), s);
  assert.deepEqual(decodeScenario(' rgby a1r b1b c1y d1g '), s);
  assert.deepEqual(decodeScenario(String(scenarioIndex(s))), s);
  assert.equal(decodeScenario('RRBY-A1R-B1B-C1Y-D1G'), null);
  assert.equal(decodeScenario('RGBY-A1R-B1R-C1Y-D1G'), null);
  assert.equal(decodeScenario('hello'), null);
  assert.equal(decodeScenario('99999'), null);
  const rng = makeRng(7);
  for (let i = 0; i < 200; i++) {
    const r = randomScenario(rng);
    assert.deepEqual(decodeScenario(encodeScenario(r)), r);
  }
});

test('editing one item keeps the combination valid', () => {
  let s = defaultScenario();
  s = withBucket(s, 'W1', 'yellow');
  assert.equal(s.buckets.W1, 'yellow');
  assert.equal(s.buckets.W4, 'red');
  assert.ok(isValidScenario(s));
  s = withPersonColor(s, 'A', 'green');
  assert.equal(s.people.A.color, 'green');
  assert.equal(s.people.D.color, 'red');
  assert.ok(isValidScenario(s));
  s = withPersonSlot(s, 'C', 2);
  assert.equal(s.people.C.slot, 2);
  assert.ok(isValidScenario(s));
});
