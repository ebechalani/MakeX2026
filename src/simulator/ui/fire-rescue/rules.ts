/**
 * The Fire Rescue rules in a few short bullets, for the "Rules" button of the simulator.
 * (The referee itself lives in ../../fire-rescue/game.ts; this is only the summary students read.)
 */
import type { RulesSection } from '../SimulatorApp';

export const FIRE_RESCUE_RULES: RulesSection[] = [
  {
    title: 'The field',
    items: [
      'The mat is 1250 x 1250 mm. The robot starts completely inside the Fire Station with nothing loaded, and runs on its own for 3 minutes.',
      'Four water towers (W1 to W4) each hold one coloured bucket. Four rescue towers (RG, RY, RB, RR) stand on their coloured squares in the two safe zones and start empty.',
      'One person waits at each building A to D, in the left (1) or right (2) white dashed square. The other square of that building is its water square.',
      'Before the match the referee draws the combination: which bucket is on which water tower, where each person stands and which colour it is.',
    ],
  },
  {
    title: 'Mission 1 - water (20 points per bucket)',
    items: [
      'Take each bucket to the building of its colour: red to A, blue to B, yellow to C, green to D.',
      'It scores when it is completely inside that building\'s water square (the dashed line counts), standing on the mat and not touching the robot.',
      'A bucket at the wrong building scores 0.',
    ],
  },
  {
    title: 'Mission 2 - rescue (20 points per person)',
    items: [
      'Put each person on top of the rescue tower of its colour: green on RG, yellow on RY, blue on RB, red on RR.',
      'Its whole base must rest on the tower top, and it may touch nothing but its tower - not the robot, not another element. One person per tower.',
      'A person on the mat or on the wrong tower scores 0.',
    ],
  },
  {
    title: 'Towers',
    items: [
      'Towers are not fixed: the robot may push them. A tower is fine as long as some part of its base still touches its own square.',
      'A tower completely outside its square at the end costs 5 points, and a person on such a rescue tower does not score.',
      'The robot may grip, lift, carry and push, and may carry more than one thing.',
    ],
  },
  {
    title: 'Restart, bonus and the end',
    items: [
      'Restart: the robot goes back completely inside the Fire Station, the clock keeps running, and it costs 5 points each time. Whatever the robot carried goes back to where it started; everything else stays.',
      'Bonus: 20 extra points when all eight missions are complete and every tower is still on its square.',
      'Maximum 180 points. The total is never below 0.',
      'The match ends when the time is up, or when the team says "Finished" and the robot has stopped. Only the final field counts.',
    ],
  },
];
