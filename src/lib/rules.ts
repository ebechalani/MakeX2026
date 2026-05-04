export type RulesDoc = {
  key: string;             // stable identifier stored in DB
  version: string;
  title: string;
  subtitle: string;
  appliesTo: RegExp;       // matches category.name
  htmlUrl: string;         // converted-from-docx HTML, served from /public
  docxUrl: string;         // original Word document, served from /public
  sections: { heading: string; body: string[] }[];
  scoring: { label: string; points: string }[];
  voidConditions: string[];
};

export const RULES: RulesDoc[] = [
  {
    key: 'sportswonderland',
    version: 'v1',
    title: 'SportsWonderland — All-Star Pickup',
    subtitle: 'Official Rules · Ages 4–7 · Match: 120 seconds',
    appliesTo: /sports\s*wonderland/i,
    htmlUrl: '/rules/sportswonderland_rules.html',
    docxUrl: '/rules/sportswonderland_rules.docx',
    sections: [
      {
        heading: 'What this game is about',
        body: [
          'The robot must touch 5 sports items on the map. Each item is worth points.',
          'The robot then drives back to the Huddle Pad to finish.',
          'The whole match is 120 seconds (2 minutes).',
        ],
      },
      {
        heading: '1. The Story',
        body: [
          'It is game day at Capelli Sports. The team needs its equipment — helmets, whistles, and balls — before the match starts.',
          'Your robot is the helper that picks them up. The robot drives around the field, touches each item, and then returns home to show that the team is ready to play.',
        ],
      },
      {
        heading: '2.1 Huddle Pad (Start and Finish)',
        body: [
          'The Huddle Pad is the dashed white box at the bottom of the map.',
          'The robot starts inside the Huddle Pad. At the end of the match, the robot must come back inside the Huddle Pad to earn a bonus.',
        ],
      },
      {
        heading: '2.2 The 5 Items (Tokens)',
        body: [
          'Helmet — 5 points',
          'Whistle — 4 points',
          'Basketball — 3 points',
          'Volleyball — 2 points',
          'Tennis Ball — 1 point',
        ],
      },
      {
        heading: '2.3 Cones (Obstacles)',
        body: [
          'There are 4 cones on the field. Cones are obstacles — the robot should drive around them.',
          'Touching a cone makes the team lose 1 point. The Judge resets the mTiny to its starting position while the timer is still running.',
        ],
      },
      {
        heading: '3. Before the Match Starts',
        body: [
          'The combination is chosen and is the same for all the students (Manual and Automatic) in the same round.',
          'The referee places everything on the field exactly as the combination shows.',
          'The student places the robot fully inside the Huddle Pad, facing forward.',
          'The referee says: "3… 2… 1… GO!"',
        ],
      },
      {
        heading: '4. How to Play',
        body: [
          'Manual mode (ages 4–5): the student scans the code blocks (up, down, left, right) to control the robot. The student does NOT touch the robot itself.',
          'Autonomous mode (ages 6–7): the student builds a program with cards before the match. Once the cards are scanned, the robot runs the program by itself.',
          'Programming time (Autonomous only): student gets 120 s to lay out cards. The judge writes down construction time. Scanning time is not counted in the 120 s.',
          'Touching items: bumping, knocking, or driving over an item all count. Once an item is touched, the referee removes it from the field.',
          'Returning to the Huddle Pad: robot must be FULLY inside the dashed Huddle Pad when the match ends to earn the bonus.',
        ],
      },
      {
        heading: '5. What is Not Allowed',
        body: [
          'After GO: nobody (except the referee) may touch the robot.',
          'After GO: nobody may touch the items on the field.',
          'After GO: nobody may move or reset things on the field.',
          'If anyone except the referee touches the robot or an item during the match, the team loses the round.',
        ],
      },
      {
        heading: '6. When the Match Ends',
        body: [
          'The match ends after 120 seconds, OR when the team says "STOP."',
          'The robot must stop moving immediately. The referee writes down the final score.',
        ],
      },
      {
        heading: '8. Rounds and Ranking',
        body: [
          'Every team plays 2 rounds. The best score of the 2 rounds is used for ranking.',
        ],
      },
      {
        heading: '9. Robots Allowed',
        body: [
          'mTiny',
          'CodyRockey',
          'Both robots run on batteries only. No sharp parts, no parts that could damage the field.',
        ],
      },
    ],
    scoring: [
      { label: 'Helmet collected', points: '+5' },
      { label: 'Whistle collected', points: '+4' },
      { label: 'Basketball collected', points: '+3' },
      { label: 'Volleyball collected', points: '+2' },
      { label: 'Tennis Ball collected', points: '+1' },
      { label: 'Cone touched (each, up to 4)', points: '−1' },
      { label: 'Robot fully inside Huddle Pad at STOP', points: '+5' },
      { label: 'Maximum possible score', points: '20' },
    ],
    voidConditions: [
      'Anyone except the referee touches the robot during the match → ROUND LOST',
      'Anyone except the referee touches an item during the match → ROUND LOST',
    ],
  },
  {
    key: 'smartlogistics',
    version: 'v1',
    title: 'Smart Logistics — Capelli Sports Inspire',
    subtitle: 'Official Rules · Ages 8–12 · Match: 150 seconds · Fully autonomous',
    appliesTo: /capelli\s*inspire/i,
    htmlUrl: '/rules/smartlogistics_rules.html',
    docxUrl: '/rules/smartlogistics_rules.docx',
    sections: [], // shown via embedded HTML; legacy fields kept for backward compat
    scoring: [
      { label: 'Cube delivered to correct bay (each, 3 max)', points: '+20' },
      { label: 'Cube delivered to wrong bay (each)', points: '−10' },
      { label: 'BLUE cube untouched at end', points: '+10' },
      { label: 'BLUE cube moved but still inside locker', points: '0' },
      { label: 'BLUE cube fully outside locker', points: '−20' },
      { label: 'Robot in Finish zone at STOP (partial or full)', points: '+10' },
      { label: 'Maximum possible score', points: '80' },
    ],
    voidConditions: [
      'Anyone except the referee touches the robot, cubes, or field after GO → RUN VOIDED',
      'Student uses a remote, joystick, or any manual control → RUN VOIDED',
    ],
  },
];

export function rulesForCategory(catName: string): RulesDoc | undefined {
  return RULES.find(r => r.appliesTo.test(catName));
}
