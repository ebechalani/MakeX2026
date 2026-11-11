/**
 * RobotIO: the ONLY door between a running student program (the VM) and the simulated robot
 * (the engine). The engine implements it, the VM calls it. Nothing here blocks: a block that
 * "waits until done" is implemented by the VM polling (e.g. `motionDone()`) once per tick.
 *
 * Fixed module layout (every module is DOM-free unless noted):
 *   core/robot.ts          export const DEFAULT_ROBOT_CONFIG: RobotConfig
 *   core/engine.ts         export function createSimulation<S>(opts: SimulationOptions<S>): Simulation<S>
 *   vm/index.ts            export function createVM(program: ProgramJson, io: RobotIO): VM
 *   fire-rescue/game.ts    export const fireRescueGame: Game<FireRescueScenario>
 *   blocks/                Blockly block definitions + toolbox (browser only)
 */
import type {
  ButtonName,
  ProbeName,
  ProbeReading,
  RGB,
  RobotConfig,
  SensorColor,
  ServoPort,
  Wheel,
} from './types';

export interface RobotIO {
  /** fixed simulation step, seconds */
  readonly dt: number;
  /** simulated seconds since the match started */
  readonly time: number;
  readonly config: RobotConfig;

  // ------------------------------------------------------------------ drive
  /** run a wheel at a constant speed; rpm > 0 drives the robot forward. Clamped to ±config.maxRpm. */
  setWheelRpm(wheel: Wheel, rpm: number): void;
  /** run a wheel at a power of -100..100 % (100 % = config.maxRpm) */
  setWheelPower(wheel: Wheel, power: number): void;
  stopWheel(wheel: Wheel | 'all'): void;
  /**
   * Encoder-controlled move: turn the left wheel by `leftDeg` and the right wheel by `rightDeg`
   * degrees of wheel rotation (+ = robot forward), the faster wheel at `rpm`, both finishing
   * together, then stop. Replaces any motion in progress.
   */
  startMotion(leftDeg: number, rightDeg: number, rpm: number): void;
  /** true when no startMotion() move is in progress (finished, replaced or stopped) */
  motionDone(): boolean;
  /** encoder angle in degrees since its last reset (+ = robot forward) */
  wheelAngle(wheel: Wheel): number;
  resetWheelAngle(wheel: Wheel | 'all'): void;
  /** actual wheel speed, RPM (+ = robot forward) */
  wheelRpm(wheel: Wheel): number;
  /** current wheel power, -100..100 */
  wheelPower(wheel: Wheel): number;

  // ------------------------------------------------------------------ servos (gripper)
  /** command a servo to an angle (0..180); it moves there at config.servoSpeed */
  setServo(port: ServoPort, angle: number): void;
  /** current (not commanded) angle */
  servoAngle(port: ServoPort): number;
  /** true when the servo has reached its commanded angle (or is blocked by what it grips) */
  servoDone(port: ServoPort): boolean;

  // ------------------------------------------------------------------ sensors
  probe(name: ProbeName): ProbeReading;
  /** 4-bit line status: bit 3 = L2, bit 2 = L1, bit 1 = R1, bit 0 = R2; a bit is 1 when on the line */
  lineStatus(): number;
  /**
   * line deviation, signed like the real mBot2 Quad RGB sensor (Python `get_offset_track`):
   * -100 = the robot is far to the LEFT of the line (the line is under the right probes) ..
   * +100 = the robot is far to the RIGHT of the line (the line is under the left probes);
   * 0 when centred or lost. Makeblock's follower `EM1 = base - kp * deviation`,
   * `EM2 = -(base + kp * deviation)` steers back to the line with this sign.
   */
  lineOffset(): number;
  /** distance to the nearest obstacle in cm; config.ultrasonic.maxRangeCm when nothing is seen */
  ultrasonicCm(): number;
  /** colour of the object in / just ahead of the claw, 'none' if nothing (or sensor not fitted) */
  frontColor(): SensorColor | 'none';
  /** unwrapped yaw since the last reset, degrees, clockwise positive */
  yawDeg(): number;
  resetYaw(): void;

  // ------------------------------------------------------------------ CyberPi
  buttonDown(name: ButtonName): boolean;
  /** index 0..4 (left to right) or 'all' */
  setLed(index: number | 'all', color: RGB): void;
  /** append a line to the screen console */
  print(text: string): void;
  showLabel(text: string, x: number, y: number, size: number): void;
  clearScreen(): void;
  tone(frequency: number, seconds: number): void;
  /** seconds since the last resetTimer() (or program start) */
  timer(): number;
  resetTimer(): void;

  // ------------------------------------------------------------------ misc
  /** deterministic random number in [0, 1) */
  random(): number;
  log(level: 'info' | 'warn' | 'error', text: string, blockId?: string): void;
}
