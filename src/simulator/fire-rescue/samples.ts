/**
 * Ready-made block programs for the Fire Rescue simulator: the ones a teacher shows first.
 *
 *   hello          starter       drive, turn, LEDs, screen
 *   line-follow    starter       follow the black line with the Quad RGB sensor
 *   gripper-demo   starter       every gripper block, on the bucket of water tower W1
 *   one-bucket     intermediate  deliver one bucket (default combination)
 *   smart-bucket   advanced      deliver the W1 bucket for ANY combination (colour + ultrasonic sensor)
 *   one-person     intermediate  rescue one person (default combination)
 *   full-mission   advanced      the whole match, 180 points (default combination; not in the menu)
 *
 * Every program is written with the program builder (vm/builder.ts), so it is exactly what the
 * block editor would save, and every one of them is run by the tests (integration.test.ts) on the
 * real engine with the real referee.
 *
 * The blocks that are not obvious carry a note (`note(block, text)`): in the editor such a block
 * shows a small round "?" icon, and a click on it opens the explanation.
 *
 * How the numbers were found. The mat is measured in millimetres from its top-left corner
 * (see field.ts). The default robot starts in the Fire Station at x = 625, y = 673.2, facing
 * "up" the mat, and the middle of its claw is 142 mm (14.2 cm) ahead of the middle of its axle:
 *
 *   water tower W1 (bucket)        x = 420.85  y = 426.5
 *   building A squares  A1 / A2    x = 1050 / 1160   y = 115.3      (top right)
 *   building B squares  B1 / B2    x = 90 / 200      y = 115.3      (top left)
 *   building C squares  C1 / C2    x = 90.1 / 200.1  y = 1134.8     (bottom left)
 *   building D squares  D1 / D2    x = 1050.1 / 1160.1  y = 1134.7  (bottom right)
 *   rescue tower RR                x = 680     y = 1100.2
 *
 * So "turn left, 20.4 cm" brings the robot under W1 (625 - 204 = 421), and so on. The simulated
 * robot is perfect (no wheel slip unless you switch noise on), so driving by distance alone
 * ("dead reckoning") is exact here. With only 1 % of wheel slip the distance-only programs
 * already miss two times out of three: on a real mBot2 they need sensors as well - which is what
 * the line follower and the smart bucket program start to show.
 *
 * Plain TypeScript, no DOM, no Blockly.
 */
import type { ProgramJson } from '../core/types';
import {
  and,
  arm,
  call,
  clawColor,
  define,
  driveRpm,
  eq,
  forever,
  gripper,
  ifElse,
  ifThen,
  join,
  ledColor,
  lt,
  move,
  moveCm,
  note,
  or,
  print,
  probeDetects,
  program,
  script,
  setVar,
  stop,
  stopMotors,
  turn,
  ultrasonic,
  v,
  wait,
  whenStart,
  type BlockNode,
} from '../vm/builder';

export type SampleLevel = 'starter' | 'intermediate' | 'advanced';

export interface SampleProgram {
  /** stable name, used in links and tests */
  id: string;
  title: string;
  level: SampleLevel;
  /** what the program does and when it works, in a few plain sentences */
  description: string;
  program: ProgramJson;
}

// =============================================================================================
// Pieces shared by several programs
// =============================================================================================

/**
 * From the Fire Station to water tower W1 and grip the bucket that stands on it.
 * The arm is raised first: the fingers then pass over the 50 mm tower, left and right of the bucket.
 */
function fetchBucketFromW1(): BlockNode[] {
  return [
    turn('left', 90),
    note(moveCm('forward', 20.4), 'Now the robot is exactly below water tower W1.'),
    turn('right', 90),
    note(arm('raise'), 'Arm up: the fingers pass over the tower, left and right of the bucket.'),
    note(moveCm('forward', 10.4), 'The claw is around the bucket. The robot stops 3 mm before the tower.'),
    gripper('close'),
  ];
}

/** Lower the bucket to the mat, let go and move away (a bucket that still touches the robot does not score). */
function putDownAndLeave(): BlockNode[] {
  return [
    arm('lower'),
    gripper('open'),
    note(moveCm('backward', 10), 'Move away: a bucket that still touches the robot does not score.'),
  ];
}

// =============================================================================================
// 1. hello
// =============================================================================================

const hello: SampleProgram = {
  id: 'hello',
  title: 'Hello, mBot2',
  level: 'starter',
  description:
    'A first program: the robot says hello on its screen, lights its LEDs green, drives 20 cm forward and ' +
    '20 cm back, turns a quarter turn to the right and lights its LEDs blue. Works for every combination ' +
    '(it scores no points). Try changing the numbers and the colours.',
  program: program([
    script(note(whenStart(), 'A first program. Change the numbers, the colours and the texts, then press Start again.'), [
      print('Hello MakeX!'),
      ledColor('all', '#00ff00'),
      moveCm('forward', 20),
      moveCm('backward', 20),
      turn('right', 90),
      ledColor('all', '#0000ff'),
      print('Ready for the mission'),
    ]),
  ]),
};

// =============================================================================================
// 2. line-follow
// =============================================================================================

const lineFollow: SampleProgram = {
  id: 'line-follow',
  title: 'Follow the black line',
  level: 'starter',
  description:
    'A line follower with the Quad RGB sensor. The robot drives 11 cm out of the Fire Station (the picture ' +
    'inside it has dark spots that are not a line), then follows the black line to the upper safe zone. ' +
    'The rule inside "forever": both middle probes (L1 and R1) on the line = straight on; line under a left ' +
    'probe = steer left; line under a right probe = steer right; no line at all (the yellow marker) = keep ' +
    'going straight. It stops when the ultrasonic sensor sees the rescue towers closer than 12 cm. ' +
    'Put the robot a little crooked in the Fire Station and watch it steer back onto the line. ' +
    'In "EM1 / EM2" blocks the right motor (EM2) is mirrored: a negative speed drives it forward. ' +
    'Works for every combination (it scores no points).',
  program: program([
    script(whenStart(), [
      print('Line follower'),
      note(
        moveCm('forward', 11),
        'Out of the Fire Station first: the picture inside it has dark spots that are not a line. After this move the sensor is over the black line.',
      ),
      forever([
        note(
          ifElse(
            lt(ultrasonic(), 12),
            // the rescue towers are close ahead: stop the motors and end the program
            [stopMotors('all'), print('Safe zone reached'), stop('all')],
            [
              note(
                ifElse(
                  and(probeDetects('L1', 'line'), probeDetects('R1', 'line')),
                  [move('forward', 40)],
                  [
                    ifElse(
                      or(probeDetects('L1', 'line'), probeDetects('L2', 'line')),
                      // the line is to the left: left wheel slower, the robot curves left
                      [
                        note(
                          driveRpm(15, -40),
                          'The line is to the left: the left wheel (EM1) turns slower, so the robot curves left. EM2, the right wheel, is mounted mirrored: a negative speed drives it forward.',
                        ),
                      ],
                      [
                        ifElse(
                          or(probeDetects('R1', 'line'), probeDetects('R2', 'line')),
                          // the line is to the right: right wheel slower, the robot curves right
                          [note(driveRpm(40, -15), 'The line is to the right: the right wheel (EM2) turns slower, so the robot curves right.')],
                          // no line under the sensor: straight on until it shows up again
                          [note(move('forward', 40), 'No line under the sensor (the yellow marker): straight on until the line shows up again.')],
                        ),
                      ],
                    ),
                  ],
                ),
                'L1 and R1 are the two middle probes of the sensor. Both on the line: the robot is centred, straight on.',
              ),
            ],
          ),
          'The rescue towers are closer than 12 cm: stop the motors and end the program. Otherwise: follow the line.',
        ),
      ]),
    ]),
  ]),
};

// =============================================================================================
// 3. gripper-demo
// =============================================================================================

const gripperDemo: SampleProgram = {
  id: 'gripper-demo',
  title: 'Gripper: grab, put down, lift',
  level: 'starter',
  description:
    'Shows every gripper block. The robot opens its claw, raises the arm (so the fingers pass over the ' +
    'tower), drives to water tower W1 and closes the claw around the bucket. It backs away, lowers the arm ' +
    'until the bucket stands on the mat and lets go. Then it grips the bucket again, on the mat this time, ' +
    'and lifts it. Works for every combination, whatever the colour of the bucket on W1 (it scores no points). ' +
    'Like all the programs that drive by distance, it needs the robot at its default start position.',
  program: program([
    script(whenStart(), [
      gripper('open'),
      ...fetchBucketFromW1(),
      moveCm('backward', 12),
      // put the bucket down on the mat ...
      note(arm('lower'), 'Put the bucket down on the mat ...'),
      gripper('open'),
      wait(1),
      // ... and pick it up again
      note(gripper('close'), '... and pick it up again, from the mat this time.'),
      arm('raise'),
      print('Got it!'),
    ]),
  ]),
};

// =============================================================================================
// 4. one-bucket
// =============================================================================================

const oneBucket: SampleProgram = {
  id: 'one-bucket',
  title: 'Deliver one bucket',
  level: 'intermediate',
  description:
    'Takes the bucket from water tower W1 and delivers it to square A2 of building A (the Apartment, top ' +
    'right), driving by distance only - no sensors. This scores 20 points ONLY when the bucket on W1 is the ' +
    'red one and the person of building A stands in square 1, as in the default combination. With another ' +
    'combination the bucket ends up at the wrong building, or the robot runs into the person. ' +
    'The robot gets in front of A2 by driving backwards, so its gripper never sticks out over the edge of the mat. ' +
    'Distances alone are exact only for the perfect simulated robot at its default start position: move the ' +
    'robot, or switch on wheel slip, and it starts to miss.',
  program: program([
    script(whenStart(), [
      ...fetchBucketFromW1(),
      moveCm('backward', 10),
      // across the field to building A
      note(turn('right', 90), 'Across the field to building A (top right).'),
      moveCm('forward', 62.9),
      turn('left', 90),
      note(moveCm('forward', 35.9), 'Now in front of square A1, where the person stands.'),
      // one square to the right, driving backwards
      note(turn('left', 90), 'One square to the right, driving backwards: this way the gripper never sticks out over the edge of the mat.'),
      moveCm('backward', 11),
      turn('right', 90),
      // into square A2
      note(moveCm('forward', 5.3), 'Into square A2.'),
      ...putDownAndLeave(),
    ]),
  ]),
};

// =============================================================================================
// 5. smart-bucket
// =============================================================================================

const smartBucket: SampleProgram = {
  id: 'smart-bucket',
  title: 'Smart bucket: any colour, any square',
  level: 'advanced',
  description:
    'Takes the bucket from water tower W1, reads its colour with the colour sensor at the claw and keeps it ' +
    'in the variable "colour". The colour decides the building: red = A, blue = B, yellow = C, green = D. ' +
    'In front of the building the robot faces the inner one of the two white squares and measures with the ' +
    'ultrasonic sensor: closer than 20 cm means a person stands there, so the water goes into the other ' +
    'square (the my-block "deliver" does this; it steps sideways by driving backwards, so the gripper stays ' +
    'over the mat). Delivers the W1 bucket correctly (20 points) for every one of the 9216 combinations. ' +
    'It drives by distance, so it relies on the perfect simulated robot at its default start position; switch ' +
    'on wheel slip to see why real robots also use the lines.',
  program: program([
    // "deliver": the robot stands in front of one square of a building, the bucket in its claw.
    // `other` says on which side the building's second square is: left or right.
    note(
      define('deliver', ['other'], [
        note(
          ifThen(lt(ultrasonic(), 20), [
            // a person is standing in this square: move over to the other one
            print('Person here - other square'),
            ifElse(
              eq(v('other'), 'right'),
              [turn('left', 90), moveCm('backward', 11), turn('right', 90)],
              [turn('right', 90), moveCm('backward', 11), turn('left', 90)],
            ),
          ]),
          'Closer than 20 cm: a person is standing in this square. The robot steps sideways to the other square, driving backwards so that the gripper stays over the mat.',
        ),
        note(moveCm('forward', 5.3), 'Into the square.'),
        ...putDownAndLeave(),
      ]),
      'The robot stands in front of one square of a building, the bucket in its claw. "other" tells on which side the second square of that building is: left or right.',
    ),

    script(whenStart(), [
      ...fetchBucketFromW1(),
      note(setVar('colour', clawColor()), 'Remember the colour of the bucket: it decides the building.'),
      print(join('Bucket: ', v('colour'))),
      moveCm('backward', 10),

      // red -> building A (top right)
      note(ifThen(eq(v('colour'), 'red'), [
        turn('right', 90),
        moveCm('forward', 62.9),
        turn('left', 90),
        moveCm('forward', 35.9),
        call('deliver', 'right'),
      ]), 'Red goes to building A (top right).'),
      // blue -> building B (top left)
      note(ifThen(eq(v('colour'), 'blue'), [
        turn('left', 90),
        moveCm('forward', 22.1),
        turn('right', 90),
        moveCm('forward', 35.9),
        call('deliver', 'left'),
      ]), 'Blue goes to building B (top left).'),
      // yellow -> building C (bottom left)
      note(ifThen(eq(v('colour'), 'yellow'), [
        turn('left', 90),
        moveCm('forward', 22.1),
        turn('left', 90),
        moveCm('forward', 27.1),
        call('deliver', 'right'),
      ]), 'Yellow goes to building C (bottom left).'),
      // green -> building D (bottom right)
      note(ifThen(eq(v('colour'), 'green'), [
        turn('right', 90),
        moveCm('forward', 62.9),
        turn('right', 90),
        moveCm('forward', 27.1),
        call('deliver', 'left'),
      ]), 'Green goes to building D (bottom right).'),
    ]),
  ]),
};

// =============================================================================================
// 6. one-person
// =============================================================================================

const onePerson: SampleProgram = {
  id: 'one-person',
  title: 'Rescue one person',
  level: 'intermediate',
  description:
    'Drives to square A1 of building A, grips the person standing there, lifts it and carries it to the ' +
    'red rescue tower RR in the lower safe zone, where it is put down on top of the tower. This scores 20 ' +
    'points ONLY when the red person waits in A1, as in the default combination: with another combination ' +
    'the square is empty, or the person has another colour and RR is the wrong tower for it. ' +
    'It drives by distance only, which is exact for the perfect simulated robot at its default start position.',
  program: program([
    script(whenStart(), [
      // to building A, square 1 (arm down, claw open: that is how the robot starts)
      note(turn('right', 90), 'To building A, square 1. The robot starts with its arm down and its claw open.'),
      moveCm('forward', 42.5),
      turn('left', 90),
      note(moveCm('forward', 41.6), 'The open claw slides around the person.'),
      gripper('close'),
      note(arm('raise'), 'High enough to pass over a tower.'),
      // to rescue tower RR, coming from above
      note(turn('right', 180), 'To rescue tower RR in the lower safe zone, coming from above.'),
      moveCm('forward', 44.3),
      turn('right', 90),
      moveCm('forward', 37),
      turn('left', 90),
      note(moveCm('forward', 25.8), 'The person hangs exactly over the tower.'),
      note(arm('lower'), 'The arm stops by itself when the person stands on the tower.'),
      gripper('open'),
      note(moveCm('backward', 10), 'Move away: a person that still touches the robot does not score.'),
    ]),
  ]),
};

// =============================================================================================
// Extra: the whole match
// =============================================================================================

const left = (): BlockNode => turn('left', 90);
const right = (): BlockNode => turn('right', 90);
const forward = (cm: number): BlockNode => moveCm('forward', cm);
const backward = (cm: number): BlockNode => moveCm('backward', cm);

/**
 * All eight missions of the default combination, one after the other: 180 points in about
 * 103 seconds of match time. Each bucket is delivered first, then the person waiting in the
 * square next to it is carried to its rescue tower, which leaves the robot close to the next
 * water tower. Two my-blocks keep it short: "pick up" and "put down".
 *
 * It is not in the sample menu (SAMPLE_PROGRAMS): it hands out a complete solution, so whether
 * students get to see it is the teacher's choice. The tests run it to prove that a full score,
 * bonus included, can be reached through blocks.
 *
 * Rules the route follows, worth knowing when you change it:
 *  - near a water tower the robot only drives straight in and straight out with the arm up
 *    (turning there would sweep the fingers through the bucket);
 *  - it turns around only where nothing is within 172 mm (the reach of the finger tips), or with
 *    the arm up where only towers are that close;
 *  - at the outer squares (x = 90 and x = 1160) it arrives backwards, so the gripper stays over
 *    the mat.
 */
const fullMission: SampleProgram = {
  id: 'full-mission',
  title: 'The whole match: 180 points',
  level: 'advanced',
  description:
    'All eight missions in one run, for the default combination only: every bucket is delivered to its ' +
    'building and every person is carried to the rescue tower of its colour - 160 points plus the 20 point ' +
    'bonus, in about 103 of the 180 seconds. It drives by distance only (no sensors), so it works for the ' +
    'default combination, the default start position and the perfect simulated robot; any other ' +
    'combination needs the ideas of the "smart bucket" program. The my-blocks "pick up" and "put down" ' +
    'keep the script short.',
  program: program([
    note(define('pick up', [], [gripper('close'), arm('raise')]), 'Grip what is in the claw and lift it.'),
    note(
      define('put down', [], [arm('lower'), gripper('open'), moveCm('backward', 10)]),
      'Lower the arm, let go and move away: what still touches the robot does not score.',
    ),

    script(whenStart(), [
      // ---- 1. red bucket: water tower W1 -> square A2
      note(left(), '1. Red bucket: from water tower W1 to square A2.'),
      ...fetchBucketFromW1().slice(1),
      backward(10), right(), forward(62.9), left(), forward(35.9),
      left(), backward(11), right(), forward(5.3),
      call('put down'),

      // ---- 2. red person: square A1 -> rescue tower RR
      note(left(), '2. Red person: from square A1 to rescue tower RR.'),
      forward(11), right(), forward(10),
      call('pick up'),
      turn('right', 180), forward(44.3), right(), forward(37), left(), forward(25.8),
      call('put down'),

      // ---- 3. blue bucket: water tower W3 (from its right side) -> square B2
      note(backward(3.3), '3. Blue bucket: from water tower W3 (taken from its right side) to square B2.'),
      arm('raise'), right(), forward(11.6),
      gripper('close'),
      backward(6), right(), forward(15.6), left(), forward(42.4), right(), forward(41.2),
      call('put down'),

      // ---- 4. blue person: square B1 -> rescue tower RB
      note(right(), '4. Blue person: from square B1 to rescue tower RB.'),
      backward(11), left(), forward(10),
      call('pick up'),
      backward(3), right(), forward(48), right(), forward(67.1),
      call('put down'),

      // ---- 5. yellow bucket: water tower W4 (from its left side) -> square C2
      note(backward(3.1), '5. Yellow bucket: from water tower W4 (taken from its left side) to square C2.'),
      arm('raise'), left(), forward(11.4),
      gripper('close'),
      backward(6), left(), forward(15.8), left(), forward(42.4), left(), forward(32.4),
      call('put down'),

      // ---- 6. yellow person: square C1 -> rescue tower RY
      note(left(), '6. Yellow person: from square C1 to rescue tower RY.'),
      backward(11), right(), forward(10),
      call('pick up'),
      backward(32.4), left(), forward(59), left(), forward(38.3),
      call('put down'),

      // ---- 7. green bucket: water tower W2 (from below) -> square D2
      note(backward(28.3), '7. Green bucket: from water tower W2 (taken from below) to square D2.'),
      right(), forward(14.5), left(), arm('raise'), forward(9.9),
      gripper('close'),
      backward(9.9), right(), forward(22.5), right(), forward(27.1),
      right(), backward(11), left(), forward(5.3),
      call('put down'),

      // ---- 8. green person: square D1 -> rescue tower RG
      note(right(), '8. Green person: from square D1 to rescue tower RG.'),
      forward(11), left(), forward(10),
      call('pick up'),
      backward(32.4), right(), forward(48), right(), forward(38.4),
      call('put down'),

      ledColor('all', '#00ff00'),
      print('Mission complete!'),
    ]),
  ]),
};

// =============================================================================================
// The lists
// =============================================================================================

/** The programs of the sample menu (the menu groups them by level). */
export const SAMPLE_PROGRAMS: SampleProgram[] = [hello, lineFollow, gripperDemo, oneBucket, smartBucket, onePerson];

/**
 * A complete solution of the default combination (180 points). Kept out of SAMPLE_PROGRAMS on
 * purpose; add it to a menu only if students are meant to see it.
 */
export const FULL_MISSION_SAMPLE: SampleProgram = fullMission;

/** Find a sample by its id (the menu samples and 'full-mission'). */
export function getSampleProgram(id: string): SampleProgram | undefined {
  return [...SAMPLE_PROGRAMS, FULL_MISSION_SAMPLE].find((sample) => sample.id === id);
}
