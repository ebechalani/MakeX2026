'use client';

/**
 * The stage: a canvas that shows the mat, the game elements and the robot.
 *
 * It redraws on the animation frames of the run loop (useSimulation) and reads the simulation
 * directly, so it never waits for React. It is sharp on high-resolution screens
 * (devicePixelRatio) and follows the size of its container.
 *
 * Before the start signal the robot can be placed with the pointer: drag = move, mouse wheel on
 * the robot = turn (hold Shift for 1 degree steps). With the keyboard: arrow keys move, Q / E turn.
 * On a touch screen a finger on the robot drags it; a finger anywhere else on the stage scrolls
 * the page as usual.
 */
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { Vec2 } from '../core/geometry';
import type { Pose, Simulation, ZoneOverlay } from '../core/types';
import { drawStage, fitView, MatPainter, robotHit, viewToMat, type StageOptions, type StageView } from './render';
import type { Trail } from './trail';

export interface StageCanvasProps {
  simRef: RefObject<Simulation<unknown>>;
  trail: Trail;
  subscribeFrame: (listener: (changed: boolean) => void) => () => void;
  options: StageOptions;
  overlays: ZoneOverlay[];
  /** the robot may be placed (before the start signal) */
  placing: boolean;
  /** a wanted start pose that is not allowed (drawn as a red outline), or null */
  ghost: Pose | null;
  /** the student moved the robot to `pose`; `phase` is 'end' when the pointer was released */
  onPlace: (pose: Pose, phase: 'move' | 'end') => void;
  /** the student turned the robot by this many degrees (clockwise positive) */
  onRotate: (degrees: number) => void;
}

/** How far outside the robot (mm) a click still grabs it - fingers are thicker than a mouse pointer. */
const GRAB_TOLERANCE = 14;
/** Wheel movement (pixels) that counts as one turning step: less than one notch of any mouse wheel. */
const WHEEL_STEP = 30;
/** Shortest time between two turning steps (ms), so that a trackpad swipe does not spin the robot. */
const WHEEL_PAUSE = 90;
/** A half-finished wheel movement is forgotten after this long (ms). */
const WHEEL_FORGET = 300;

function StageCanvasImpl(props: StageCanvasProps) {
  const { simRef, trail, subscribeFrame } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<StageView | null>(null);
  /** true when the picture must be redrawn although the simulation did not change */
  const dirtyRef = useRef(true);
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number; heading: number } | null>(null);
  const wheelRef = useRef({ travelled: 0, lastEvent: 0, lastStep: 0 });

  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
    dirtyRef.current = true;
  });

  const [painter] = useState(() => new MatPainter(simRef.current.game.mat.vector));

  // ---- the mat picture (until it has loaded, the drawn version of the mat is shown)
  const imageUrl = simRef.current.game.mat.imageUrl;
  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      painter.setImage(image);
      dirtyRef.current = true;
    };
    image.src = imageUrl;
    return () => {
      image.onload = null;
    };
  }, [imageUrl, painter]);

  // ---- follow the size of the container and the pixel density of the screen
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const mat = simRef.current.game.mat;
      viewRef.current = fitView(rect.width, rect.height, mat.width, mat.height, dpr);
      dirtyRef.current = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    // zooming the page or moving the window to another screen changes devicePixelRatio
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [simRef]);

  // ---- draw
  useEffect(
    () =>
      subscribeFrame((changed) => {
        if (!changed && !dirtyRef.current) return;
        const canvas = canvasRef.current;
        const view = viewRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !view || !ctx) return;
        dirtyRef.current = false;
        const p = propsRef.current;
        drawStage(ctx, {
          sim: simRef.current,
          view,
          options: p.options,
          mat: painter,
          trail,
          overlays: p.overlays,
          placing: p.placing,
          ghost: p.ghost,
        });
      }),
    [painter, simRef, subscribeFrame, trail],
  );

  // ---- placing the robot
  const matPoint = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return null;
    const rect = canvas.getBoundingClientRect();
    return viewToMat(view, clientX - rect.left, clientY - rect.top);
  }, []);

  /** The pose under the pointer that can be grabbed: the red outline first, then the robot itself. */
  const grabbable = useCallback(
    (point: Vec2): Pose | null => {
      const p = propsRef.current;
      if (!p.placing) return null;
      const sim = simRef.current;
      if (p.ghost && robotHit(sim.robotConfig, p.ghost, point, GRAB_TOLERANCE)) return p.ghost;
      const pose = sim.world.robot.pose;
      return robotHit(sim.robotConfig, pose, point, GRAB_TOLERANCE) ? pose : null;
    },
    [simRef],
  );

  // Touch screens: a finger that lands on the robot is kept for dragging it (the page must not
  // scroll away under it); a finger anywhere else scrolls the page as usual. Saying "do not
  // scroll" is only possible in a listener that is registered as not passive, which React's
  // own onTouchStart is not.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const point = touch ? matPoint(touch.clientX, touch.clientY) : null;
      if (point && grabbable(point) && event.cancelable) event.preventDefault();
    };
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => canvas.removeEventListener('touchstart', onTouchStart);
  }, [grabbable, matPoint]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const point = matPoint(event.clientX, event.clientY);
    const pose = point && grabbable(point);
    if (!point || !pose) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.style.cursor = 'grabbing';
    dragRef.current = { pointerId: event.pointerId, dx: point.x - pose.x, dy: point.y - pose.y, heading: pose.heading };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = matPoint(event.clientX, event.clientY);
    if (!point) return;
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      propsRef.current.onPlace({ x: point.x - drag.dx, y: point.y - drag.dy, heading: drag.heading }, 'move');
      return;
    }
    event.currentTarget.style.cursor = grabbable(point) ? 'grab' : 'default';
  };

  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.style.cursor = 'grab';
    const point = matPoint(event.clientX, event.clientY);
    if (point) propsRef.current.onPlace({ x: point.x - drag.dx, y: point.y - drag.dy, heading: drag.heading }, 'end');
  };

  // the wheel listener must be able to stop the page from scrolling, which React's onWheel cannot
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      const view = viewRef.current;
      if (!view) return;
      const rect = canvas.getBoundingClientRect();
      const point = viewToMat(view, event.clientX - rect.left, event.clientY - rect.top);
      const p = propsRef.current;
      if (!p.placing) return;
      const sim = simRef.current;
      const onRobot =
        robotHit(sim.robotConfig, sim.world.robot.pose, point, GRAB_TOLERANCE) ||
        (p.ghost !== null && robotHit(sim.robotConfig, p.ghost, point, GRAB_TOLERANCE));
      if (!onRobot) return;
      event.preventDefault();
      // with Shift held some browsers report the wheel as sideways scrolling
      const raw = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      const pixels = event.deltaMode === 1 ? raw * 33 : event.deltaMode === 2 ? raw * 300 : raw;
      const wheel = wheelRef.current;
      const now = performance.now();
      if (now - wheel.lastEvent > WHEEL_FORGET) wheel.travelled = 0;
      wheel.lastEvent = now;
      wheel.travelled += pixels;
      // one notch of a mouse wheel = one step; a long trackpad swipe = a few steps
      if (Math.abs(wheel.travelled) < WHEEL_STEP || now - wheel.lastStep < WHEEL_PAUSE) return;
      const direction = Math.sign(wheel.travelled);
      wheel.travelled = 0;
      wheel.lastStep = now;
      p.onRotate(direction * (event.shiftKey ? 1 : 15));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [simRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (!p.placing) return;
    const step = event.shiftKey ? 1 : 5;
    const base = p.ghost ?? simRef.current.world.robot.pose;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      p.onPlace({ x: base.x + move[0], y: base.y + move[1], heading: base.heading }, 'end');
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'q' || key === 'e') {
      event.preventDefault();
      p.onRotate((key === 'q' ? -1 : 1) * (event.shiftKey ? 1 : 15));
    }
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl bg-slate-600 shadow-inner">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={
          props.placing
            ? 'Competition mat seen from above. The robot can be placed: drag it, or use the arrow keys to move and Q or E to turn.'
            : 'Competition mat seen from above, with the robot and the game elements.'
        }
        className="absolute inset-0 h-full w-full rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-sky-400"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

export const StageCanvas = memo(StageCanvasImpl);
