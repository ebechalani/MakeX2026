/**
 * A pretend robot for testing programs without the physics engine.
 *
 * It implements RobotIO in memory: it remembers every command it receives, lets a test set what
 * the sensors report, and has a very simple idea of time (wheels turn at exactly the commanded
 * speed, encoder moves and servos take the time they should). Nothing here knows about the mat.
 *
 *   const io = createFakeIO();
 *   const vm = createVM(program, io);
 *   vm.start();
 *   runFor(vm, io, 2);          // two simulated seconds
 *   io.calls                    // -> ['startMotion 360 360 50', ...]
 */
import type { RobotIO } from '../core/io';
import type {
  ButtonName,
  ProbeName,
  ProbeReading,
  RGB,
  RobotConfig,
  ScreenLabel,
  SensorColor,
  ServoPort,
  VM,
  Wheel,
} from '../core/types';
import { PROBE_NAMES, SERVO_PORTS } from '../core/types';

export interface FakeWheel {
  mode: 'stop' | 'speed' | 'power' | 'motion';
  rpm: number;
  power: number;
  angle: number;
}

export interface FakeMotion {
  leftDeg: number;
  rightDeg: number;
  rpm: number;
  /** seconds this move takes in total / has been running */
  duration: number;
  elapsed: number;
}

export interface FakeLog {
  level: 'info' | 'warn' | 'error';
  text: string;
  blockId?: string;
}

export interface FakeIO extends RobotIO {
  /** number of ticks simulated so far (time = tick * dt) */
  tick: number;
  /** every command received, as text, in order (e.g. 'setWheelRpm left 50') */
  calls: string[];
  logs: FakeLog[];
  wheels: Record<Wheel, FakeWheel>;
  /** the encoder move in progress, if any */
  motion: FakeMotion | null;
  /** every startMotion() received */
  motions: Array<{ leftDeg: number; rightDeg: number; rpm: number }>;
  servos: Record<ServoPort, { angle: number; target: number }>;
  buttons: Partial<Record<ButtonName, boolean>>;
  leds: RGB[];
  lines: string[];
  labels: ScreenLabel[];
  tones: Array<{ frequency: number; seconds: number; time: number }>;
  /** what the sensors report; tests change these */
  sensors: {
    probes: Record<ProbeName, ProbeReading>;
    lineStatus: number;
    lineOffset: number;
    ultrasonicCm: number;
    frontColor: SensorColor | 'none';
    yawDeg: number;
  };
  /** values random() hands out next (falls back to 0.5 when empty) */
  randomQueue: number[];
  /** let one tick of time pass: wheels turn, moves and servos progress */
  advance(): void;
}

/** A plausible mBot2 with a gripper; tests read the numbers from io.config, never hard-code them. */
export const FAKE_ROBOT_CONFIG: RobotConfig = {
  chassisFront: 110,
  chassisRear: 60,
  chassisWidth: 150,
  chassisHeight: 90,
  wheelDiameter: 64,
  trackWidth: 120,
  maxRpm: 200,
  rpmPerSecond: 1000,
  servoSpeed: 300,
  quadRgb: { forward: 70, probeOffsets: [-24, -8, 8, 24], spotRadius: 3, lineThreshold: 50 },
  ultrasonic: { forward: 100, height: 40, minRangeCm: 3, maxRangeCm: 300, halfAngleDeg: 10 },
  frontColorSensor: { enabled: true, rangeMm: 30 },
  gripper: {
    enabled: true,
    liftServo: 'S1',
    clawServo: 'S2',
    liftDownAngle: 20,
    liftUpAngle: 110,
    liftDownHeight: 5,
    liftUpHeight: 80,
    clawOpenAngle: 40,
    clawClosedAngle: 130,
    clawOpenGap: 80,
    clawClosedGap: 30,
    gripForward: 130,
    fingerLength: 50,
    fingerThickness: 6,
    fingerHeight: 30,
  },
  noise: { wheelSlip: 0, sensor: 0, ultrasonicCm: 0 },
};

const white = (): ProbeReading => ({ rgb: { r: 255, g: 255, b: 255 }, light: 100, gray: 0, onLine: false, color: 'white' });

/** number -> short text for the call log (no long decimals) */
const n = (value: number): string => String(Math.round(value * 1000) / 1000);

export function createFakeIO(options: { dt?: number; config?: Partial<RobotConfig> } = {}): FakeIO {
  const dt = options.dt ?? 0.02;
  const config: RobotConfig = { ...FAKE_ROBOT_CONFIG, ...options.config };
  let timerStart = 0;

  const wheel = (): FakeWheel => ({ mode: 'stop', rpm: 0, power: 0, angle: 0 });
  const both = (which: Wheel | 'all'): Wheel[] => (which === 'all' ? ['left', 'right'] : [which]);

  const io: FakeIO = {
    dt,
    get time() {
      return io.tick * dt;
    },
    config,

    tick: 0,
    calls: [],
    logs: [],
    wheels: { left: wheel(), right: wheel() },
    motion: null,
    motions: [],
    servos: Object.fromEntries(SERVO_PORTS.map((port) => [port, { angle: 90, target: 90 }])) as FakeIO['servos'],
    buttons: {},
    leds: Array.from({ length: 5 }, () => ({ r: 0, g: 0, b: 0 })),
    lines: [],
    labels: [],
    tones: [],
    sensors: {
      probes: Object.fromEntries(PROBE_NAMES.map((name) => [name, white()])) as FakeIO['sensors']['probes'],
      lineStatus: 0,
      lineOffset: 0,
      ultrasonicCm: config.ultrasonic.maxRangeCm,
      frontColor: 'none',
      yawDeg: 0,
    },
    randomQueue: [],

    // ---------------------------------------------------------------- drive
    setWheelRpm(which, rpm) {
      io.calls.push(`setWheelRpm ${which} ${n(rpm)}`);
      io.motion = null;
      const clamped = Math.max(-config.maxRpm, Math.min(config.maxRpm, rpm));
      io.wheels[which] = { ...io.wheels[which], mode: 'speed', rpm: clamped, power: (clamped / config.maxRpm) * 100 };
    },
    setWheelPower(which, power) {
      io.calls.push(`setWheelPower ${which} ${n(power)}`);
      io.motion = null;
      const clamped = Math.max(-100, Math.min(100, power));
      io.wheels[which] = { ...io.wheels[which], mode: 'power', power: clamped, rpm: (clamped / 100) * config.maxRpm };
    },
    stopWheel(which) {
      io.calls.push(`stopWheel ${which}`);
      io.motion = null;
      for (const w of both(which)) io.wheels[w] = { ...io.wheels[w], mode: 'stop', rpm: 0, power: 0 };
    },
    startMotion(leftDeg, rightDeg, rpm) {
      io.calls.push(`startMotion ${n(leftDeg)} ${n(rightDeg)} ${n(rpm)}`);
      io.motions.push({ leftDeg, rightDeg, rpm });
      const longest = Math.max(Math.abs(leftDeg), Math.abs(rightDeg));
      // rpm * 6 = degrees per second
      const duration = rpm > 0 ? longest / (rpm * 6) : 0;
      io.motion = duration > 0 ? { leftDeg, rightDeg, rpm, duration, elapsed: 0 } : null;
      for (const w of both('all')) io.wheels[w] = { ...io.wheels[w], mode: io.motion ? 'motion' : 'stop', rpm: 0, power: 0 };
    },
    motionDone: () => io.motion === null,
    wheelAngle: (which) => io.wheels[which].angle,
    resetWheelAngle(which) {
      io.calls.push(`resetWheelAngle ${which}`);
      for (const w of both(which)) io.wheels[w].angle = 0;
    },
    wheelRpm: (which) => io.wheels[which].rpm,
    wheelPower: (which) => io.wheels[which].power,

    // ---------------------------------------------------------------- servos
    setServo(port, angle) {
      io.calls.push(`setServo ${port} ${n(angle)}`);
      io.servos[port].target = angle;
    },
    servoAngle: (port) => io.servos[port].angle,
    servoDone: (port) => Math.abs(io.servos[port].angle - io.servos[port].target) < 1e-6,

    // ---------------------------------------------------------------- sensors
    probe: (name) => io.sensors.probes[name],
    lineStatus: () => io.sensors.lineStatus,
    lineOffset: () => io.sensors.lineOffset,
    ultrasonicCm: () => io.sensors.ultrasonicCm,
    frontColor: () => io.sensors.frontColor,
    yawDeg: () => io.sensors.yawDeg,
    resetYaw() {
      io.calls.push('resetYaw');
      io.sensors.yawDeg = 0;
    },

    // ---------------------------------------------------------------- CyberPi
    buttonDown: (name) => io.buttons[name] === true,
    setLed(index, color) {
      io.calls.push(`setLed ${index} ${color.r},${color.g},${color.b}`);
      if (index === 'all') io.leds = io.leds.map(() => ({ ...color }));
      else if (index >= 0 && index < io.leds.length) io.leds[index] = { ...color };
    },
    print(text) {
      io.calls.push(`print ${text}`);
      io.lines.push(text);
    },
    showLabel(text, x, y, size) {
      io.calls.push(`showLabel ${text} ${n(x)} ${n(y)} ${n(size)}`);
      io.labels.push({ text, x, y, size });
    },
    clearScreen() {
      io.calls.push('clearScreen');
      io.lines = [];
      io.labels = [];
    },
    tone(frequency, seconds) {
      io.calls.push(`tone ${n(frequency)} ${n(seconds)}`);
      io.tones.push({ frequency, seconds, time: io.time });
    },
    timer: () => io.time - timerStart,
    resetTimer() {
      timerStart = io.time;
    },

    // ---------------------------------------------------------------- misc
    random: () => io.randomQueue.shift() ?? 0.5,
    log(level, text, blockId) {
      io.logs.push({ level, text, blockId });
    },

    advance() {
      if (io.motion) {
        const m = io.motion;
        const step = Math.min(dt, m.duration - m.elapsed);
        io.wheels.left.angle += (m.leftDeg * step) / m.duration;
        io.wheels.right.angle += (m.rightDeg * step) / m.duration;
        m.elapsed += step;
        if (m.elapsed >= m.duration - 1e-9) {
          io.motion = null;
          for (const w of both('all')) io.wheels[w].mode = 'stop';
        }
      } else {
        for (const w of both('all')) io.wheels[w].angle += io.wheels[w].rpm * 6 * dt;
      }
      for (const port of SERVO_PORTS) {
        const servo = io.servos[port];
        const diff = servo.target - servo.angle;
        const max = config.servoSpeed * dt;
        servo.angle += Math.max(-max, Math.min(max, diff));
      }
      io.tick++;
    },
  };
  return io;
}

/** Run the program for a number of simulated seconds: one vm.step() then one io.advance() per tick. */
export function runFor(vm: VM, io: FakeIO, seconds: number): void {
  const ticks = Math.round(seconds / io.dt);
  for (let i = 0; i < ticks; i++) {
    vm.step();
    io.advance();
  }
}

/** Run exactly this many ticks. */
export function runTicks(vm: VM, io: FakeIO, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    vm.step();
    io.advance();
  }
}

/** Run until no script is running any more (or give up after maxSeconds). Returns the seconds it took. */
export function runUntilDone(vm: VM, io: FakeIO, maxSeconds = 60): number {
  const start = io.time;
  while (vm.running && io.time - start < maxSeconds) {
    vm.step();
    io.advance();
  }
  return io.time - start;
}
