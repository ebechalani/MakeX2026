import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEG,
  distanceToSegment,
  forwardOf,
  headingOf,
  localRectToOBB,
  localToWorld,
  makeRng,
  obbContainsOBB,
  obbCorners,
  obbOverlap,
  obbTouchesRect,
  pointInOBB,
  rayOBB,
  rectContainsOBB,
  rightOf,
  worldToLocal,
  wrapAngle,
} from './geometry';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('heading convention: 0 = up, +90deg = right, clockwise positive', () => {
  near(forwardOf(0).x, 0);
  near(forwardOf(0).y, -1);
  near(forwardOf(90 * DEG).x, 1);
  near(forwardOf(90 * DEG).y, 0);
  near(forwardOf(180 * DEG).y, 1);
  near(rightOf(0).x, 1);
  near(rightOf(90 * DEG).y, 1);
  near(headingOf({ x: 1, y: 0 }), 90 * DEG);
  near(headingOf({ x: 0, y: 1 }), 180 * DEG);
  near(wrapAngle(270 * DEG), -90 * DEG);
});

test('local <-> world round trip', () => {
  const pose = { x: 100, y: 200, heading: 37 * DEG };
  const p = localToWorld(pose, 50, -20);
  const back = worldToLocal(pose, p);
  near(back.forward, 50);
  near(back.right, -20);
  // facing right: forward 10 -> +x 10, right 5 -> +y 5
  const q = localToWorld({ x: 0, y: 0, heading: 90 * DEG }, 10, 5);
  near(q.x, 10);
  near(q.y, 5);
});

test('obb corners and containment', () => {
  const o = { x: 0, y: 0, w: 40, l: 100, angle: 0 };
  const [fl, fr, rr, rl] = obbCorners(o);
  near(fl.x, -20);
  near(fl.y, -50);
  near(fr.x, 20);
  near(rr.y, 50);
  near(rl.x, -20);
  assert.ok(pointInOBB({ x: 19, y: 49 }, o));
  assert.ok(!pointInOBB({ x: 21, y: 0 }, o));
  assert.ok(rectContainsOBB({ x: -20, y: -50, w: 40, h: 100 }, o));
  assert.ok(!rectContainsOBB({ x: -19, y: -50, w: 40, h: 100 }, o));
  assert.ok(obbContainsOBB({ x: 0, y: 0, w: 70, l: 70, angle: 30 * DEG }, { x: 5, y: 5, w: 40, l: 40, angle: 10 * DEG }));
  assert.ok(!obbContainsOBB({ x: 0, y: 0, w: 70, l: 70, angle: 0 }, { x: 20, y: 0, w: 40, l: 40, angle: 0 }));
});

test('SAT overlap gives the minimum push-out vector from A to B', () => {
  const a = { x: 0, y: 0, w: 100, l: 100, angle: 0 };
  const b = { x: 90, y: 0, w: 100, l: 100, angle: 0 };
  const o = obbOverlap(a, b);
  assert.ok(o);
  near(o!.depth, 10);
  near(o!.normal.x, 1);
  near(o!.normal.y, 0);
  assert.equal(obbOverlap(a, { ...b, x: 100.0001 }), null);
  // rotated square overlapping by its corner
  const r = obbOverlap(a, { x: 110, y: 0, w: 100, l: 100, angle: 45 * DEG });
  assert.ok(r);
  near(r!.depth, 50 + Math.SQRT2 * 50 - 110, 1e-6);
  assert.ok(r!.normal.x > 0.99);
});

test('obbTouchesRect counts touching edges', () => {
  const o = { x: 0, y: 0, w: 70, l: 70, angle: 0 };
  assert.ok(obbTouchesRect(o, { x: 35, y: -10, w: 60, h: 60 }));
  assert.ok(!obbTouchesRect(o, { x: 35.5, y: -10, w: 60, h: 60 }));
  assert.ok(obbTouchesRect(o, { x: 35.5, y: -10, w: 60, h: 60 }, 1));
});

test('localRectToOBB', () => {
  const o = localRectToOBB({ x: 0, y: 0, heading: 90 * DEG }, -50, 130, -65, 65);
  near(o.x, 40);
  near(o.y, 0);
  near(o.l, 180);
  near(o.w, 130);
});

test('distance to segment and ray casting', () => {
  const d = distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 });
  near(d.dist, 5);
  near(d.along, 5);
  const box = { x: 0, y: -100, w: 70, l: 70, angle: 0 };
  near(rayOBB({ x: 0, y: 0 }, forwardOf(0), box)!, 65);
  assert.equal(rayOBB({ x: 0, y: 0 }, forwardOf(90 * DEG), box), null);
  assert.equal(rayOBB({ x: 0, y: 0 }, forwardOf(180 * DEG), box), null);
  near(rayOBB({ x: 0, y: -100 }, forwardOf(0), box)!, 0);
});

test('rng is deterministic and in range', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
