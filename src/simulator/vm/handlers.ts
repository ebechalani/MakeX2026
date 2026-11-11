/**
 * What each robot / operator block DOES.
 *
 * Every entry is a small function that receives a BlockContext: the already computed values of
 * the block's slots (ctx.num('SPEED') ...), the choices of its dropdowns (ctx.field('PORT')) and
 * the robot (ctx.io). The interpreter (index.ts) takes care of everything around it: evaluating
 * the slots, scripts, loops, waiting.
 *
 *  - A reporter returns its value.
 *  - A statement returns nothing when it is instantaneous, or a `Wait`: a function the interpreter
 *    calls once per simulation tick until it answers true ("until done", "for 1 secs" ...).
 *
 * Blocks that need to know about scripts (control, events, variables, my blocks) live in index.ts.
 */
import type { RobotIO } from '../core/io';
import type { ButtonName, MotorPort, ProbeName, Scalar, SensorColor, ServoPort, Wheel } from '../core/types';
import { BUTTON_NAMES, PROBE_NAMES, SERVO_PORTS } from '../core/types';
import { clampNumber, compare, isWholeNumber, parseColour, toNumber, toText } from './values';

/** Wheel speed used by the "... cm until done" and "... ° until done" blocks (they have no speed slot). */
export const DEFAULT_MOTION_RPM = 50;

/** A gripper helper block stops waiting for its servo after this many seconds (and logs a warning). */
export const SERVO_TIMEOUT_SECONDS = 10;

/** Called once per tick; true = the block has finished. */
export type Wait = () => boolean;

export interface BlockContext {
  readonly io: RobotIO;
  /** id of the block being run */
  readonly blockId: string;
  /** value of a slot as a number (text that is not a number counts as 0) */
  num(name: string): number;
  /** like num(), but never NaN or infinity: safe to send to a motor */
  finite(name: string): number;
  /** value of a slot as text */
  str(name: string): string;
  /** value of a slot as true/false */
  bool(name: string): boolean;
  /** value of a slot exactly as computed */
  value(name: string): Scalar;
  /** stored value of a dropdown / text field (the catalog default when the program has none) */
  field(name: string): string;
  /**
   * Take control of the drive motors. Every block that commands the wheels calls this; the number
   * it returns stays valid until another block (possibly in another script) takes over.
   */
  claimDrive(): number;
  /** true while no other block has taken over the drive motors since claimDrive() returned `token` */
  ownsDrive(token: number): boolean;
  /** tell the student something is odd about this block (logged once per block) */
  warn(text: string): void;
}

export type StatementHandler = (ctx: BlockContext) => Wait | void;
export type ReporterHandler = (ctx: BlockContext) => Scalar;

// =============================================================================================
// Helpers
// =============================================================================================

/**
 * mBot2 wiring. EM1 drives the LEFT wheel and EM2 the RIGHT wheel, and the motors are mounted
 * mirrored: a positive motor speed drives the left wheel forward but the right wheel backward.
 * RobotIO speaks "wheel, + = robot forward", so EM2 values change sign on the way.
 */
const WHEEL_OF: Record<MotorPort, Wheel> = { EM1: 'left', EM2: 'right' };
const FORWARD_SIGN: Record<MotorPort, 1 | -1> = { EM1: 1, EM2: -1 };

function motorPort(ctx: BlockContext): MotorPort {
  return ctx.field('PORT') === 'EM2' ? 'EM2' : 'EM1';
}

function probeName(ctx: BlockContext): ProbeName {
  const name = ctx.field('PROBE') as ProbeName;
  return PROBE_NAMES.includes(name) ? name : 'L1';
}

function buttonName(text: string): ButtonName {
  const name = text.toLowerCase() as ButtonName;
  return BUTTON_NAMES.includes(name) ? name : 'a';
}

function ledIndex(ctx: BlockContext): number | 'all' {
  const text = ctx.field('INDEX');
  if (text === 'all') return 'all';
  return clampNumber(Math.round(toNumber(text)), 1, 5) - 1;
}

/** Wait for a number of simulated seconds (always at least one tick, like Scratch). */
function sleep(io: RobotIO, seconds: number): Wait {
  const end = io.time + Math.max(0, seconds);
  let polls = 0;
  return () => polls++ > 0 && io.time >= end - 1e-9;
}

/** Wheel rotation (degrees) needed to roll `mm` millimetres. */
export function wheelDegreesForDistance(io: RobotIO, mm: number): number {
  return (mm / (Math.PI * io.config.wheelDiameter)) * 360;
}

/**
 * Wheel rotation (degrees) needed to turn the robot on the spot by `robotDeg` degrees: each wheel
 * rolls along a circle whose diameter is the track width, one forward and one backward.
 */
export function wheelDegreesForTurn(io: RobotIO, robotDeg: number): number {
  return (robotDeg * io.config.trackWidth) / io.config.wheelDiameter;
}

/** Left / right wheel speed for the "moves forward / backward / turns left / right" dropdown. */
function directionSpeeds(direction: string, rpm: number): [number, number] {
  switch (direction) {
    case 'backward':
      return [-rpm, -rpm];
    case 'left':
      return [-rpm, rpm];
    case 'right':
      return [rpm, -rpm];
    default:
      return [rpm, rpm];
  }
}

/** Start an encoder-controlled move and wait until it is done (or another block takes the motors). */
function motion(ctx: BlockContext, leftDeg: number, rightDeg: number, rpm: number): Wait | void {
  const speed = Math.abs(rpm);
  if ((leftDeg === 0 && rightDeg === 0) || speed === 0) return;
  const token = ctx.claimDrive();
  ctx.io.startMotion(leftDeg, rightDeg, speed);
  let polls = 0;
  return () => !ctx.ownsDrive(token) || (polls++ > 0 && ctx.io.motionDone());
}

/** Send a servo to an angle and wait until it got there (or is blocked by what it grips). */
function servoMove(ctx: BlockContext, port: ServoPort, angle: number): Wait {
  const io = ctx.io;
  io.setServo(port, clampNumber(angle, 0, 180));
  const giveUpAt = io.time + SERVO_TIMEOUT_SECONDS;
  let polls = 0;
  return () => {
    if (polls++ === 0) return false;
    if (io.servoDone(port)) return true;
    if (io.time >= giveUpAt) {
      ctx.warn(`Servo ${port} did not reach its angle after ${SERVO_TIMEOUT_SECONDS} seconds; the program carries on.`);
      return true;
    }
    return false;
  };
}

/** Round to a number of decimals (sensor values look like on the real robot). */
function roundTo(value: number, decimals: number): number {
  const k = 10 ** decimals;
  return Math.round(value * k) / k;
}

/** Trigonometry results without binary noise (sin 180 = 0, not 1.2e-16). */
const tidy = (n: number): number => Math.round(n * 1e10) / 1e10;

const NO_GRIPPER = 'This robot has no gripper fitted, so this block does nothing.';

// =============================================================================================
// Statements
// =============================================================================================

export const STATEMENTS: Record<string, StatementHandler> = {
  // ------------------------------------------------------------------ mBot2 chassis
  mbot2_move_direction_with_time(ctx) {
    const [left, right] = directionSpeeds(ctx.field('DIRECTION'), ctx.finite('SPEED'));
    const token = ctx.claimDrive();
    ctx.io.setWheelRpm('left', left);
    ctx.io.setWheelRpm('right', right);
    const timeUp = sleep(ctx.io, ctx.num('DURATION'));
    return () => {
      if (!ctx.ownsDrive(token)) return true; // another block took over the motors: leave them alone
      if (!timeUp()) return false;
      ctx.io.stopWheel('all');
      return true;
    };
  },

  mbot2_straight_cm(ctx) {
    const sign = ctx.field('DIRECTION') === 'backward' ? -1 : 1;
    const deg = sign * wheelDegreesForDistance(ctx.io, ctx.finite('DISTANCE') * 10);
    return motion(ctx, deg, deg, DEFAULT_MOTION_RPM);
  },

  mbot2_turn_deg(ctx) {
    const deg = wheelDegreesForTurn(ctx.io, ctx.finite('ANGLE'));
    // turning left: left wheel backward, right wheel forward
    return ctx.field('DIRECTION') === 'right'
      ? motion(ctx, deg, -deg, DEFAULT_MOTION_RPM)
      : motion(ctx, -deg, deg, DEFAULT_MOTION_RPM);
  },

  mbot2_move_direction(ctx) {
    const [left, right] = directionSpeeds(ctx.field('DIRECTION'), ctx.finite('SPEED'));
    ctx.claimDrive();
    ctx.io.setWheelRpm('left', left);
    ctx.io.setWheelRpm('right', right);
  },

  mbot2_drive_speed(ctx) {
    ctx.claimDrive();
    ctx.io.setWheelRpm('left', FORWARD_SIGN.EM1 * ctx.finite('EM1'));
    ctx.io.setWheelRpm('right', FORWARD_SIGN.EM2 * ctx.finite('EM2'));
  },

  mbot2_drive_power(ctx) {
    ctx.claimDrive();
    ctx.io.setWheelPower('left', FORWARD_SIGN.EM1 * clampNumber(ctx.finite('EM1'), -100, 100));
    ctx.io.setWheelPower('right', FORWARD_SIGN.EM2 * clampNumber(ctx.finite('EM2'), -100, 100));
  },

  mbot2_motor_speed(ctx) {
    const port = motorPort(ctx);
    ctx.claimDrive();
    ctx.io.setWheelRpm(WHEEL_OF[port], FORWARD_SIGN[port] * ctx.finite('SPEED'));
  },

  mbot2_motor_power(ctx) {
    const port = motorPort(ctx);
    ctx.claimDrive();
    ctx.io.setWheelPower(WHEEL_OF[port], FORWARD_SIGN[port] * clampNumber(ctx.finite('POWER'), -100, 100));
  },

  mbot2_motor_rotate_deg(ctx) {
    const which = ctx.field('PORT');
    const speed = ctx.finite('SPEED');
    // a negative speed turns the motor the other way
    const motorDeg = ctx.finite('ANGLE') * (speed < 0 ? -1 : 1);
    const left = which === 'EM1' || which === 'all' ? FORWARD_SIGN.EM1 * motorDeg : 0;
    const right = which === 'EM2' || which === 'all' ? FORWARD_SIGN.EM2 * motorDeg : 0;
    return motion(ctx, left, right, speed);
  },

  mbot2_stop(ctx) {
    const which = ctx.field('PORT');
    ctx.claimDrive();
    ctx.io.stopWheel(which === 'EM1' || which === 'EM2' ? WHEEL_OF[which] : 'all');
  },

  mbot2_motor_reset_angle(ctx) {
    const which = ctx.field('PORT');
    ctx.io.resetWheelAngle(which === 'EM1' || which === 'EM2' ? WHEEL_OF[which] : 'all');
  },

  // ------------------------------------------------------------------ servos
  mbot2_servo_set(ctx) {
    const which = ctx.field('PORT');
    const angle = clampNumber(ctx.finite('ANGLE'), 0, 180);
    const ports = SERVO_PORTS.includes(which as ServoPort) ? [which as ServoPort] : SERVO_PORTS;
    for (const port of ports) ctx.io.setServo(port, angle);
  },

  // ------------------------------------------------------------------ gripper helpers
  gripper_claw(ctx) {
    const g = ctx.io.config.gripper;
    if (!g.enabled) return ctx.warn(NO_GRIPPER);
    return servoMove(ctx, g.clawServo, ctx.field('ACTION') === 'close' ? g.clawClosedAngle : g.clawOpenAngle);
  },

  gripper_arm(ctx) {
    const g = ctx.io.config.gripper;
    if (!g.enabled) return ctx.warn(NO_GRIPPER);
    return servoMove(ctx, g.liftServo, ctx.field('ACTION') === 'raise' ? g.liftUpAngle : g.liftDownAngle);
  },

  gripper_arm_height(ctx) {
    const g = ctx.io.config.gripper;
    if (!g.enabled) return ctx.warn(NO_GRIPPER);
    const t = clampNumber(ctx.finite('HEIGHT'), 0, 100) / 100;
    return servoMove(ctx, g.liftServo, g.liftDownAngle + (g.liftUpAngle - g.liftDownAngle) * t);
  },

  // ------------------------------------------------------------------ CyberPi
  cyberpi_led_color(ctx) {
    ctx.io.setLed(ledIndex(ctx), parseColour(ctx.field('COLOR')));
  },

  cyberpi_led_rgb(ctx) {
    const channel = (name: string): number => clampNumber(Math.round(ctx.finite(name)), 0, 255);
    ctx.io.setLed(ledIndex(ctx), { r: channel('R'), g: channel('G'), b: channel('B') });
  },

  cyberpi_led_off(ctx) {
    ctx.io.setLed(ledIndex(ctx), { r: 0, g: 0, b: 0 });
  },

  cyberpi_print(ctx) {
    ctx.io.print(ctx.str('TEXT'));
  },

  cyberpi_show_label(ctx) {
    ctx.io.showLabel(ctx.str('TEXT'), ctx.finite('X'), ctx.finite('Y'), ctx.finite('SIZE'));
  },

  cyberpi_clear_screen(ctx) {
    ctx.io.clearScreen();
  },

  cyberpi_play_tone(ctx) {
    const seconds = ctx.finite('DURATION');
    if (seconds <= 0) return;
    ctx.io.tone(ctx.finite('FREQUENCY'), seconds);
    return sleep(ctx.io, seconds);
  },

  cyberpi_reset_timer(ctx) {
    ctx.io.resetTimer();
  },

  cyberpi_reset_yaw(ctx) {
    ctx.io.resetYaw();
  },
};

// =============================================================================================
// Reporters (round and pointed blocks)
// =============================================================================================

export const REPORTERS: Record<string, ReporterHandler> = {
  // ------------------------------------------------------------------ mBot2 chassis
  mbot2_motor_angle(ctx) {
    const port = motorPort(ctx);
    return roundTo(FORWARD_SIGN[port] * ctx.io.wheelAngle(WHEEL_OF[port]), 1);
  },
  mbot2_motor_rpm(ctx) {
    const port = motorPort(ctx);
    return roundTo(FORWARD_SIGN[port] * ctx.io.wheelRpm(WHEEL_OF[port]), 1);
  },
  mbot2_motor_power_value(ctx) {
    const port = motorPort(ctx);
    return roundTo(FORWARD_SIGN[port] * ctx.io.wheelPower(WHEEL_OF[port]), 1);
  },

  // ------------------------------------------------------------------ servos
  mbot2_servo_angle(ctx) {
    const which = ctx.field('PORT') as ServoPort;
    return roundTo(ctx.io.servoAngle(SERVO_PORTS.includes(which) ? which : 'S1'), 1);
  },

  // ------------------------------------------------------------------ Quad RGB sensor
  sensing_quadrgb_line_status(ctx) {
    const status = ctx.io.lineStatus() & 15;
    // 'inner' keeps only the two middle probes: L1 -> 2, R1 -> 1
    return ctx.field('MODE') === 'inner' ? (status >> 1) & 3 : status;
  },
  sensing_quadrgb_status_is(ctx) {
    return (ctx.io.lineStatus() & 15) === toNumber(ctx.field('STATUS'));
  },
  sensing_quadrgb_deviation(ctx) {
    return roundTo(ctx.io.lineOffset(), 1);
  },
  sensing_quadrgb_probe_detects(ctx) {
    const onLine = ctx.io.probe(probeName(ctx)).onLine;
    return ctx.field('TARGET') === 'background' ? !onLine : onLine;
  },
  sensing_quadrgb_probe_color_is(ctx) {
    return ctx.io.probe(probeName(ctx)).color === (ctx.field('COLOR') as SensorColor);
  },
  sensing_quadrgb_probe_color(ctx) {
    return ctx.io.probe(probeName(ctx)).color;
  },
  sensing_quadrgb_probe_rgb(ctx) {
    const rgb = ctx.io.probe(probeName(ctx)).rgb;
    const channel = ctx.field('CHANNEL');
    return Math.round(channel === 'g' ? rgb.g : channel === 'b' ? rgb.b : rgb.r);
  },
  sensing_quadrgb_probe_gray(ctx) {
    return Math.round(ctx.io.probe(probeName(ctx)).gray);
  },
  sensing_quadrgb_probe_light(ctx) {
    return Math.round(ctx.io.probe(probeName(ctx)).light);
  },

  // ------------------------------------------------------------------ ultrasonic sensor 2
  sensing_ultrasonic_distance(ctx) {
    return roundTo(ctx.io.ultrasonicCm(), 1);
  },

  // ------------------------------------------------------------------ colour sensor at the claw
  sensing_claw_color_is(ctx) {
    return ctx.io.frontColor() === ctx.field('COLOR');
  },
  sensing_claw_color(ctx) {
    return ctx.io.frontColor();
  },
  sensing_claw_object_detected(ctx) {
    return ctx.io.frontColor() !== 'none';
  },

  // ------------------------------------------------------------------ CyberPi
  cyberpi_button_pressed(ctx) {
    return ctx.io.buttonDown(buttonName(ctx.field('BUTTON')));
  },
  cyberpi_joystick_pulled(ctx) {
    return ctx.io.buttonDown(buttonName(ctx.field('DIRECTION')));
  },
  cyberpi_timer(ctx) {
    return roundTo(ctx.io.timer(), 3);
  },
  cyberpi_rotation_z(ctx) {
    return roundTo(ctx.io.yawDeg(), 1);
  },
  cyberpi_yaw(ctx) {
    // fold the ever-growing angle into -180 .. 180
    let yaw = ctx.io.yawDeg() % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw <= -180) yaw += 360;
    return roundTo(yaw, 1);
  },

  // ------------------------------------------------------------------ operators
  operator_add: (ctx) => ctx.num('NUM1') + ctx.num('NUM2'),
  operator_subtract: (ctx) => ctx.num('NUM1') - ctx.num('NUM2'),
  operator_multiply: (ctx) => ctx.num('NUM1') * ctx.num('NUM2'),
  operator_divide: (ctx) => ctx.num('NUM1') / ctx.num('NUM2'),

  operator_random(ctx) {
    const from = ctx.value('FROM');
    const to = ctx.value('TO');
    const low = Math.min(toNumber(from), toNumber(to));
    const high = Math.max(toNumber(from), toNumber(to));
    if (low === high) return low;
    // two whole numbers give a whole number (both ends included), otherwise any number in between
    if (isWholeNumber(from) && isWholeNumber(to)) return low + Math.floor(ctx.io.random() * (high - low + 1));
    return low + ctx.io.random() * (high - low);
  },

  operator_gt: (ctx) => compare(ctx.value('OPERAND1'), ctx.value('OPERAND2')) > 0,
  operator_lt: (ctx) => compare(ctx.value('OPERAND1'), ctx.value('OPERAND2')) < 0,
  operator_equals: (ctx) => compare(ctx.value('OPERAND1'), ctx.value('OPERAND2')) === 0,

  operator_and: (ctx) => ctx.bool('OPERAND1') && ctx.bool('OPERAND2'),
  operator_or: (ctx) => ctx.bool('OPERAND1') || ctx.bool('OPERAND2'),
  operator_not: (ctx) => !ctx.bool('OPERAND'),

  operator_join: (ctx) => ctx.str('STRING1') + ctx.str('STRING2'),
  operator_letter_of(ctx) {
    const index = Math.floor(ctx.num('LETTER')) - 1; // 1 = first letter
    const text = ctx.str('STRING');
    return index >= 0 && index < text.length ? text.charAt(index) : '';
  },
  operator_length: (ctx) => ctx.str('STRING').length,
  operator_contains: (ctx) => ctx.str('STRING1').toLowerCase().includes(ctx.str('STRING2').toLowerCase()),

  operator_mod(ctx) {
    const n = ctx.num('NUM1');
    const m = ctx.num('NUM2');
    let result = n % m;
    // like Scratch: the result takes the sign of the second number (-1 mod 5 = 4)
    if (result / m < 0) result += m;
    return result;
  },
  operator_round: (ctx) => Math.round(ctx.num('NUM')),

  operator_mathop(ctx) {
    const n = ctx.num('NUM');
    const rad = (n * Math.PI) / 180;
    const deg = (r: number): number => (r * 180) / Math.PI;
    switch (ctx.field('OPERATOR')) {
      case 'abs':
        return Math.abs(n);
      case 'floor':
        return Math.floor(n);
      case 'ceiling':
        return Math.ceil(n);
      case 'sqrt':
        return Math.sqrt(n);
      case 'sin':
        return tidy(Math.sin(rad));
      case 'cos':
        return tidy(Math.cos(rad));
      case 'tan':
        // tan 90 is "infinitely steep"
        if (Math.abs(n % 180) === 90) return n % 360 === 90 || n % 360 === -270 ? Infinity : -Infinity;
        return tidy(Math.tan(rad));
      case 'asin':
        return tidy(deg(Math.asin(n)));
      case 'acos':
        return tidy(deg(Math.acos(n)));
      case 'atan':
        return tidy(deg(Math.atan(n)));
      case 'ln':
        return Math.log(n);
      case 'log':
        return Math.log(n) / Math.LN10;
      case 'e ^':
        return Math.exp(n);
      case '10 ^':
        return 10 ** n;
      default:
        ctx.warn(`Unknown maths function "${toText(ctx.field('OPERATOR'))}".`);
        return 0;
    }
  },
};
