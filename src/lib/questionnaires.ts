// Per-category coach quizzes. Each question has 1 correct answer (auto-graded).
// `rulesKey` MUST match the keys in src/lib/rules.ts so quizzes show up for
// the right academies based on the categories they're competing in.

export type Question = {
  id: string;
  q: string;
  choices: string[];
  correct: number; // index into choices
  hint?: string;
};

export type Quiz = {
  rulesKey: string;
  title: string;
  subtitle: string;
  passMark: number; // minimum correct answers to pass
  questions: Question[];
};

export const QUIZZES: Quiz[] = [
  {
    rulesKey: 'sportswonderland',
    title: 'SportsWonderland — Coach Knowledge Check',
    subtitle: '10 questions · pass mark 8 / 10',
    passMark: 8,
    questions: [
      { id: 'sw1', q: 'How long does a SportsWonderland match last?', choices: ['60 seconds', '90 seconds', '120 seconds', '150 seconds'], correct: 2 },
      { id: 'sw2', q: 'How many tokens are placed on the field every match?', choices: ['3', '4', '5', '6'], correct: 2 },
      { id: 'sw3', q: 'How many points is the Helmet worth?', choices: ['1', '3', '5', '10'], correct: 2 },
      { id: 'sw4', q: 'Which token has the LOWEST point value?', choices: ['Helmet', 'Whistle', 'Volleyball', 'Tennis Ball'], correct: 3 },
      { id: 'sw5', q: 'What is the penalty when the robot touches a cone?', choices: ['0 (no penalty)', '−1 point', '−5 points', 'Round lost'], correct: 1 },
      { id: 'sw6', q: 'Robot fully inside the Huddle Pad at the end gets…', choices: ['+5 points', '+10 points', '+20 points', 'No bonus'], correct: 0 },
      { id: 'sw7', q: 'Which age group plays in MANUAL mode?', choices: ['4–5 years', '6–7 years', 'Both', 'Neither'], correct: 0 },
      { id: 'sw8', q: 'Anyone except the referee touches the robot during the match. What happens?', choices: ['Nothing', '−5 points', 'The team loses the round', 'Time penalty'], correct: 2 },
      { id: 'sw9', q: 'How many rounds does each team play?', choices: ['1', '2', '3', '4'], correct: 1 },
      { id: 'sw10', q: 'Which round score counts for ranking?', choices: ['Round 1 only', 'Round 2 only', 'Sum of both', 'Best of the two'], correct: 3 },
    ],
  },

  {
    rulesKey: 'smartlogistics',
    title: 'Smart Logistics (Capelli Inspire) — Coach Knowledge Check',
    subtitle: '10 questions · pass mark 8 / 10',
    passMark: 8,
    questions: [
      { id: 'sl1', q: 'Smart Logistics match duration?', choices: ['120 s', '150 s', '180 s', '210 s'], correct: 1 },
      { id: 'sl2', q: 'How many cubes total are on the field at the start?', choices: ['3', '4', '5', '6'], correct: 1, hint: '3 mission + 1 BLUE' },
      { id: 'sl3', q: 'Correct cube delivery to its matching colored bay scores…', choices: ['+10', '+15', '+20', '+30'], correct: 2 },
      { id: 'sl4', q: 'Cube delivered to the WRONG-color bay scores…', choices: ['0', '−5', '−10', '−20'], correct: 2 },
      { id: 'sl5', q: 'The BLUE cube must be…', choices: ['Delivered to BLUE bay', 'Pushed out of the locker', 'Left untouched', 'Picked up first'], correct: 2 },
      { id: 'sl6', q: 'BLUE cube ends fully OUTSIDE its locker. Score?', choices: ['+10', '0', '−10', '−20'], correct: 3 },
      { id: 'sl7', q: 'RED cubes are delivered to…', choices: ['Home (RED) bay', 'Training (GREEN) bay', 'Either bay', 'The Finish zone'], correct: 0 },
      { id: 'sl8', q: 'GREEN cubes are delivered to…', choices: ['Home (RED) bay', 'Training (GREEN) bay', 'Either bay', 'The Finish zone'], correct: 1 },
      { id: 'sl9', q: 'Robot partially or fully inside the Finish zone at STOP scores…', choices: ['+5', '+10', '+15', '+20'], correct: 1 },
      { id: 'sl10', q: 'During the match the robot must run…', choices: ['Manually with a remote', 'With pre-loaded cards', 'Fully autonomously', 'Half manual half auto'], correct: 2 },
    ],
  },

  {
    rulesKey: 'lockerroom',
    title: 'Locker Room Mission (Capelli Starter) — Coach Knowledge Check',
    subtitle: '10 questions · pass mark 8 / 10',
    passMark: 8,
    questions: [
      { id: 'lr1', q: 'Locker Room match duration?', choices: ['120 s', '150 s', '180 s', '210 s'], correct: 1 },
      { id: 'lr2', q: 'Step 1 — robot leaves the Locker Room with the Team Box. Reward?', choices: ['+5', '+10', '+15', '+20'], correct: 0 },
      { id: 'lr3', q: 'Step 2 — robot reaches the Scan Station with the Team Box. Reward?', choices: ['+5', '+10', '+15', '+20'], correct: 1 },
      { id: 'lr4', q: 'Step 3 — Coach Approval (referee lifts the Team Box). Reward?', choices: ['+5', '+10', '+15', '+20'], correct: 2 },
      { id: 'lr5', q: 'Step 5 — correct team-color cube delivered to the matching big circle. Reward?', choices: ['+10', '+15', '+20', '+25'], correct: 2 },
      { id: 'lr6', q: 'The Stadium Gate bonus is only awarded if Step 5 was…', choices: ['Skipped', 'Wrong color', 'Correct delivery', 'Repeated twice'], correct: 2 },
      { id: 'lr7', q: 'Maze token ends FULLY inside its matching color target. Score?', choices: ['+5', '+10', '+15', '+20'], correct: 1 },
      { id: 'lr8', q: 'Maze token ends PARTIALLY inside its matching color target. Score?', choices: ['0', '+5', '+10', '+15'], correct: 1 },
      { id: 'lr9', q: 'Maze token delivered to the WRONG color target. Score?', choices: ['0', '−5', '−10', '−20'], correct: 2 },
      { id: 'lr10', q: 'Robot touches the Stadium Gate. Penalty?', choices: ['0', '−5', '−10', '−20'], correct: 2 },
    ],
  },

  {
    rulesKey: 'codecourier',
    title: 'Code Courier (MakeX Inspire) — Coach Knowledge Check',
    subtitle: '9 questions · pass mark 7 / 9',
    passMark: 7,
    questions: [
      { id: 'cc1', q: 'Code Courier match duration?', choices: ['120 s', '150 s', '180 s', '240 s'], correct: 1 },
      { id: 'cc2', q: 'How many secure rings total are on the field?', choices: ['8', '12', '16', '20'], correct: 2, hint: '4 colors × 4 rings' },
      { id: 'cc3', q: 'How many signal towers are placed on the field?', choices: ['2', '3', '4', '5'], correct: 2 },
      { id: 'cc4', q: 'Ring fully inserted onto its matching-color signal tower (a + b + c + d) scores…', choices: ['+10', '+20', '+50', '+100'], correct: 2 },
      { id: 'cc5', q: 'Ring in matching-color zone but NOT on the tower (a + b + c only) scores…', choices: ['+5', '+10', '+20', '+50'], correct: 1 },
      { id: 'cc6', q: 'Maximum possible match score?', choices: ['400', '600', '800', '1000'], correct: 2 },
      { id: 'cc7', q: 'Each confirmed E02 violation deducts…', choices: ['−5', '−10', '−20', '−50'], correct: 2 },
      { id: 'cc8', q: 'E04 disqualifies the team for the match. Score becomes…', choices: ['Halved', 'Set to 0', 'Set to −100', 'Unchanged'], correct: 1 },
      { id: 'cc9', q: 'How is the robot operated during the match?', choices: ['Fully autonomous', 'Bluetooth controller (remote)', 'Wired remote', 'Voice-controlled'], correct: 1 },
    ],
  },

  {
    rulesKey: 'soccer',
    title: 'Capelli Sport Cup — Soccer (1-vs-1) — Coach Knowledge Check',
    subtitle: '10 questions · pass mark 8 / 10',
    passMark: 8,
    questions: [
      { id: 'sc1', q: 'How long is each half?', choices: ['1 minute', '2 minutes', '3 minutes', '5 minutes'], correct: 1 },
      { id: 'sc2', q: 'How many halves does a match have?', choices: ['1', '2', '3', '4'], correct: 1 },
      { id: 'sc3', q: 'Halftime break duration?', choices: ['15 s', '30 s', '60 s', '90 s'], correct: 1 },
      { id: 'sc4', q: 'Allowed robot platform?', choices: ['mBot', 'mBot2', 'mTiny', 'CyberPi only'], correct: 1 },
      { id: 'sc5', q: 'Maximum motor speed (RPM)?', choices: ['20', '30', '40', '60'], correct: 2 },
      { id: 'sc6', q: 'Maximum robot footprint (with arms extended)?', choices: ['18 × 18 cm', '20 × 20 cm', '22 × 22 cm', '25 × 25 cm'], correct: 2 },
      { id: 'sc7', q: 'Maximum robot weight?', choices: ['1.0 kg', '1.5 kg', '2.0 kg', '2.5 kg'], correct: 1 },
      { id: 'sc8', q: 'Minimum battery charge before a match?', choices: ['25 %', '50 %', '75 %', '100 %'], correct: 1 },
      { id: 'sc9', q: 'A robot stalls on the ball for more than 10 seconds. What happens?', choices: ['Nothing', 'Free kick to the opposing team', 'Yellow card', 'Disqualification'], correct: 1 },
      { id: 'sc10', q: 'A boost mode or hidden speed change is discovered during play. Result?', choices: ['Warning only', 'Free kick', '−5 points', 'Disqualification'], correct: 3 },
    ],
  },
];

export function quizForRulesKey(key: string): Quiz | undefined {
  return QUIZZES.find(q => q.rulesKey === key);
}

// Map a category name to its rulesKey (mirrors the regex matchers in rules.ts)
export function rulesKeyForCategory(catName: string): string | null {
  if (/sports\s*wonderland/i.test(catName)) return 'sportswonderland';
  if (/capelli\s*inspire/i.test(catName)) return 'smartlogistics';
  if (/capelli\s*starter/i.test(catName)) return 'lockerroom';
  if (/capelli\s*soccer/i.test(catName)) return 'soccer';
  if (/makex\s*inspire/i.test(catName)) return 'codecourier';
  if (/makex\s*starter|signal\s*rise/i.test(catName)) return 'signalrise';
  return null;
}
