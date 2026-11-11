/**
 * The simulated robot: a Makeblock mBot2 with a front gripper that can also lift.
 *
 * Everything is measured in the ROBOT FRAME: the origin is the midpoint of the drive axle (the
 * point the robot turns around), "forward" points to the front of the robot and "right" to its
 * right-hand side. All lengths are millimetres.
 *
 *            front
 *        +--[ claw ]--+        the two fingers reach 167 mm ahead of the axle
 *        |  ultrasonic |       chassis front: 105 mm ahead of the axle
 *        |  quad RGB   |       line sensor:    85 mm ahead of the axle
 *      [wheel] + [wheel]       + = origin (midpoint of the axle), wheels 112 mm apart
 *        +-------------+       chassis rear:   70 mm behind the axle
 *
 * Heights that matter for the Fire Rescue elements (tower 50 mm, bucket 40 mm, person 60 mm):
 *   - arm down: the fingers are 5..25 mm above the mat  -> they grip things standing on the mat
 *   - arm up:   the fingers are 75..95 mm above the mat -> they pass over a tower (50 mm) and grip
 *               a bucket standing on it (50..90 mm); a person gripped on the mat is lifted to
 *               70 mm, high enough to be put on a rescue tower.
 */
import { clamp, localRectToOBB, rectContainsOBB, type OBB, type Rect } from './geometry';
import type { GripperConfig, Pose, RobotConfig, ServoPort } from './types';

export const DEFAULT_ROBOT_CONFIG: RobotConfig = {
  // ---- chassis (the real mBot2 is about 179 x 130 x 90 mm)
  chassisFront: 105,
  chassisRear: 70,
  chassisWidth: 130,
  chassisHeight: 90,

  // ---- drive: two encoder motors
  wheelDiameter: 64,
  trackWidth: 112,
  maxRpm: 180,
  /** 0 -> full speed in a quarter of a second */
  rpmPerSecond: 720,

  /** a 90 degree servo move takes half a second */
  servoSpeed: 180,

  // ---- Quad RGB line sensor, under the front of the chassis
  quadRgb: {
    forward: 85,
    // L1 and R1 both sit on a 26 mm line when the robot is centred, L2 and R2 are just off it
    probeOffsets: [-22.5, -7.5, 7.5, 22.5],
    spotRadius: 3,
    // black lines read about 3, the darkest printed colour (red) about 46
    lineThreshold: 35,
  },

  // ---- ultrasonic sensor on the front face of the chassis
  ultrasonic: {
    forward: 105,
    // sees towers (50 mm), people (60 mm) and buckets (40 mm); anything lower is under the beam
    height: 35,
    minRangeCm: 3,
    maxRangeCm: 300,
    halfAngleDeg: 12,
  },

  // ---- add-on: colour sensor looking at whatever is in (or just ahead of) the claw
  frontColorSensor: {
    enabled: true,
    rangeMm: 35,
  },

  // ---- gripper: S1 lifts the arm, S2 opens / closes the claw. Both start at 0 degrees.
  gripper: {
    enabled: true,
    liftServo: 'S1',
    clawServo: 'S2',
    liftDownAngle: 0,
    liftUpAngle: 90,
    liftDownHeight: 5,
    liftUpHeight: 75,
    clawOpenAngle: 0,
    clawClosedAngle: 60,
    // open: wider than a 40 mm bucket / person (even a turned one), narrower than a 70 mm tower
    clawOpenGap: 64,
    // closed: clearly narrower than 40 mm, so the claw clamps buckets and people
    clawClosedGap: 20,
    // a bucket in the middle of a tower is 35 mm behind the tower's face: with the chassis front
    // touching the tower (105 mm) the bucket is 140 mm ahead of the axle, right in the claw
    gripForward: 142,
    fingerLength: 50,
    fingerThickness: 8,
    fingerHeight: 20,
  },

  // ---- a perfect robot by default; raise these to practise with a "real" one
  noise: {
    wheelSlip: 0,
    sensor: 0,
    ultrasonicCm: 0,
  },
};

// =============================================================================================
// Wheels
// =============================================================================================

/** How far the robot rolls (mm) when a wheel turns by one degree. */
export function mmPerWheelDegree(config: RobotConfig): number {
  return (Math.PI * config.wheelDiameter) / 360;
}

/** Wheel rotation (degrees) needed to roll `mm` millimetres. */
export function wheelDegreesForDistance(config: RobotConfig, mm: number): number {
  return mm / mmPerWheelDegree(config);
}

/**
 * Wheel rotation (degrees) needed to turn the robot on the spot by `degrees` (clockwise positive):
 * the left wheel turns by +result and the right wheel by -result.
 */
export function wheelDegreesForTurn(config: RobotConfig, degrees: number): number {
  return (degrees * config.trackWidth) / config.wheelDiameter;
}

/** Driving speed in mm per second when both wheels turn at `rpm`. */
export function speedForRpm(config: RobotConfig, rpm: number): number {
  return (rpm / 60) * Math.PI * config.wheelDiameter;
}

/** Top driving speed in mm per second. */
export function maxSpeed(config: RobotConfig): number {
  return speedForRpm(config, config.maxRpm);
}

// =============================================================================================
// Gripper: servo angle <-> arm height and claw gap (linear between the two configured angles)
// =============================================================================================

/** 0 at angle `from`, 1 at angle `to`, limited to 0..1 outside that range. */
function fraction(angle: number, from: number, to: number): number {
  if (to === from) return 0;
  return clamp((angle - from) / (to - from), 0, 1);
}

/** Height of the underside of the claw above the mat (mm) for a lift servo angle. */
export function liftHeightForAngle(g: GripperConfig, angle: number): number {
  const t = fraction(angle, g.liftDownAngle, g.liftUpAngle);
  return g.liftDownHeight + (g.liftUpHeight - g.liftDownHeight) * t;
}

/** Lift servo angle that puts the underside of the claw at `height` mm (limited to the arm's range). */
export function liftAngleForHeight(g: GripperConfig, height: number): number {
  const t = fraction(height, g.liftDownHeight, g.liftUpHeight);
  return g.liftDownAngle + (g.liftUpAngle - g.liftDownAngle) * t;
}

/** Free gap between the two fingers (mm) for a claw servo angle. */
export function clawGapForAngle(g: GripperConfig, angle: number): number {
  const t = fraction(angle, g.clawOpenAngle, g.clawClosedAngle);
  return g.clawOpenGap + (g.clawClosedGap - g.clawOpenGap) * t;
}

/** Claw servo angle that leaves a gap of `gap` mm between the fingers (limited to the claw's range). */
export function clawAngleForGap(g: GripperConfig, gap: number): number {
  const t = fraction(gap, g.clawOpenGap, g.clawClosedGap);
  return g.clawOpenAngle + (g.clawClosedAngle - g.clawOpenAngle) * t;
}

/** Servo angles at the start of a match: arm down, claw open, unused servos at 0. */
export function initialServoAngles(config: RobotConfig): Record<ServoPort, number> {
  const angles: Record<ServoPort, number> = { S1: 0, S2: 0, S3: 0, S4: 0 };
  if (config.gripper.enabled) {
    angles[config.gripper.liftServo] = config.gripper.liftDownAngle;
    angles[config.gripper.clawServo] = config.gripper.clawOpenAngle;
  }
  return angles;
}

// =============================================================================================
// Footprint
// =============================================================================================

/** Widest the claw can open (mm between the fingers). */
export function widestClawGap(config: RobotConfig): number {
  return Math.max(config.gripper.clawOpenGap, config.gripper.clawClosedGap);
}

/**
 * Footprint of the robot seen from above, as oriented boxes: [chassis] or, with a gripper,
 * [chassis, left finger, right finger].
 * @param gap current gap between the fingers; defaults to the claw fully open
 */
export function robotShapesAt(config: RobotConfig, pose: Pose, gap?: number): OBB[] {
  const halfWidth = config.chassisWidth / 2;
  const shapes: OBB[] = [localRectToOBB(pose, -config.chassisRear, config.chassisFront, -halfWidth, halfWidth)];
  const g = config.gripper;
  if (g.enabled) {
    const half = (gap ?? g.clawOpenGap) / 2;
    const rear = g.gripForward - g.fingerLength / 2;
    const front = g.gripForward + g.fingerLength / 2;
    shapes.push(localRectToOBB(pose, rear, front, -half - g.fingerThickness, -half));
    shapes.push(localRectToOBB(pose, rear, front, half, half + g.fingerThickness));
  }
  return shapes;
}

/** True when the whole robot (chassis and fingers) is inside the rectangle; the boundary counts as inside. */
export function robotFitsInRect(config: RobotConfig, pose: Pose, rect: Rect, gap?: number): boolean {
  return robotShapesAt(config, pose, gap).every((shape) => rectContainsOBB(rect, shape));
}

/** Overall size of the robot with the claw fully open: length (front to back) and width, in mm. */
export function robotSize(config: RobotConfig): { length: number; width: number } {
  const g = config.gripper;
  const front = g.enabled ? Math.max(config.chassisFront, g.gripForward + g.fingerLength / 2) : config.chassisFront;
  const width = g.enabled
    ? Math.max(config.chassisWidth, widestClawGap(config) + 2 * g.fingerThickness)
    : config.chassisWidth;
  return { length: front + config.chassisRear, width };
}
