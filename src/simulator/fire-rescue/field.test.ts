import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VectorMatSampler } from '../core/mat';
import type { RGB } from '../core/types';
import { BUILDINGS, MAT_VECTOR, RESCUE_SQUARES, WATER_SQUARES } from './field';

const mat = new VectorMatSampler(MAT_VECTOR);
const isBlack = (c: RGB) => c.r < 60 && c.g < 60 && c.b < 60;
const isWhite = (c: RGB) => c.r > 240 && c.g > 240 && c.b > 240;
const isYellow = (c: RGB) => c.r > 220 && c.g > 200 && c.b < 80;

// Reference values measured on the real mat picture (mat-sensor.webp, 1 px = 1 mm).
test('vector mat matches the printed mat at known points', () => {
  assert.ok(isBlack(mat.sample(370, 310)), 'loop, top-left horizontal');
  assert.ok(isBlack(mat.sample(625, 300)), 'centre line');
  assert.ok(isBlack(mat.sample(487, 352)), 'diagonal of the loop');
  assert.ok(isBlack(mat.sample(90, 200)), 'spur into the school');
  assert.ok(isBlack(mat.sample(1160, 1050)), 'spur into the clinic');
  assert.ok(isWhite(mat.sample(500, 250)), 'blank mat');
  assert.ok(isWhite(mat.sample(421, 426)), 'inside the W1 square');
  assert.ok(isYellow(mat.sample(623, 395)), 'yellow marker, top junction');
  assert.ok(isYellow(mat.sample(395, 625)), 'yellow marker, left side');
  assert.ok(isBlack(mat.sample(1105, 340)), 'side line, first black dash');
  assert.ok(isYellow(mat.sample(1105, 415)), 'side line, first yellow gap');
  assert.ok(isBlack(mat.sample(1105, 480)), 'side line, second black dash');
  assert.ok(isBlack(mat.sample(144, 340)), 'left side line, first black dash');
  assert.ok(isYellow(mat.sample(144, 410)), 'left side line, first yellow gap');
});

test('lines have the right width and square ends', () => {
  assert.ok(isBlack(mat.sample(625 + 12.5, 300)));
  assert.ok(isWhite(mat.sample(625 + 13.5, 300)));
  // the centre line stops at the Fire Station edge and at y = 150
  assert.ok(isBlack(mat.sample(625, 151)));
  assert.ok(!isBlack(mat.sample(625, 148)));
  assert.ok(!isBlack(mat.sample(625, 520)));
  // rounded outer corner where the school spur turns up at (90, 310)
  assert.ok(isBlack(mat.sample(84, 316)));
  assert.ok(isWhite(mat.sample(79, 321)));
  // the loop corner at (310, 310) is a T-junction with the spur, so it is black all around
  assert.ok(isBlack(mat.sample(299, 299)));
});

test('off the mat reports the table colour', () => {
  assert.deepEqual(mat.sample(-5, 100), MAT_VECTOR.outside);
  assert.deepEqual(mat.sample(100, 1251), MAT_VECTOR.outside);
});

test('zone geometry is consistent', () => {
  for (const sq of Object.values(WATER_SQUARES)) {
    assert.ok(Math.abs(sq.w - 69.65) < 0.2 && Math.abs(sq.h - 69.65) < 0.2);
  }
  for (const b of Object.values(BUILDINGS)) {
    for (const sq of b.squares) {
      assert.equal(sq.w, 60);
      assert.equal(sq.h, 60);
      // each square sits inside its building tile
      assert.ok(sq.x >= b.tile.x && sq.x + sq.w <= b.tile.x + b.tile.w);
      assert.ok(sq.y >= b.tile.y && sq.y + sq.h <= b.tile.y + b.tile.h);
    }
    // left square first
    assert.ok(b.squares[0].x < b.squares[1].x);
  }
  // the centre line (x = 625) runs between the two rescue squares of each safe zone
  assert.ok(RESCUE_SQUARES.RG.rect.x + 60 < 625 && RESCUE_SQUARES.RY.rect.x > 625);
  assert.ok(RESCUE_SQUARES.RB.rect.x + 60 < 625 && RESCUE_SQUARES.RR.rect.x > 625);
});
