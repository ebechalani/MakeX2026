import React from 'react';

const Cb = ({ children }: { children: React.ReactNode }) => (
  <span><span className="check"></span>{children}</span>
);

const Header = ({ title, subtitle, round }: { title: string; subtitle: string; round?: number }) => (
  <>
    <h1>{title}{round ? <span className="round-badge">ROUND {round}</span> : null}</h1>
    <p className="meta">{subtitle}</p>
  </>
);

const MatchInfo = ({ extraFields, round }: { extraFields?: { label: string; value?: string }[]; round?: number }) => (
  <>
    <h2>1. Match Information</h2>
    <table>
      <tbody>
        <tr>
          <th style={{ width: '22%' }}>TEAM NAME</th>
          <td colSpan={3}>&nbsp;</td>
        </tr>
        <tr>
          <th>STUDENT NAME</th>
          <td>&nbsp;</td>
          <th style={{ width: '18%' }}>FIELD / TABLE #</th>
          <td>&nbsp;</td>
        </tr>
        <tr>
          <th>ROUND</th>
          <td>{round === 1 ? '☑ 1 ☐ 2' : round === 2 ? '☐ 1 ☑ 2' : '☐ 1 ☐ 2'}</td>
          <th>ROBOT INSPECTION PASSED?</th>
          <td>☐ Yes &nbsp;&nbsp; ☐ No</td>
        </tr>
        <tr>
          <th>REFEREE NAME</th>
          <td>&nbsp;</td>
          <th>JUDGE SIGNATURE</th>
          <td>&nbsp;</td>
        </tr>
        {extraFields?.map(f => (
          <tr key={f.label}>
            <th>{f.label}</th>
            <td colSpan={3}>{f.value ?? ' '}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
);

const Signatures = () => (
  <div className="sig-row">
    <div>
      <div className="sig-line">Student / Team signature · Print name</div>
    </div>
  </div>
);

// ── SportsWonderland ─────────────────────────────────────────────────────
function SportsWonderlandSheet({ round }: { round?: number }) {
  return (
    <>
      <Header
        round={round}
        title="SPORTSWONDERLAND — ALL-STAR PICKUP · Official Match Scoresheet"
        subtitle="Match: 120 seconds · Robot: mTiny / CodyRockey · Tokens: Helmet 5 / Whistle 4 / Basketball 3 / Volleyball 2 / Tennis 1 · Bonus: +5 Huddle Pad · Cone touch: −1 each"
      />
      <MatchInfo round={round} extraFields={[{ label: 'AGE CATEGORY' }]} />
      <p className="small" style={{ marginTop: 6 }}>Age category: ☐ 4–5 (Manual) &nbsp;&nbsp; ☐ 6–7 (Autonomous)</p>

      <h2>2. Token Collection</h2>
      <p className="small">All 5 tokens are present every match. Mark which were collected — only collected tokens score points.</p>
      <table>
        <thead>
          <tr><th style={{width:'5%'}}>#</th><th>Token</th><th style={{width:'12%'}}>Points</th><th style={{width:'25%'}}>Collected?</th><th style={{width:'15%'}}>Pts</th></tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>Helmet</td><td>5</td><td>☐ Yes &nbsp; ☐ No</td><td>&nbsp;</td></tr>
          <tr><td>2</td><td>Whistle</td><td>4</td><td>☐ Yes &nbsp; ☐ No</td><td>&nbsp;</td></tr>
          <tr><td>3</td><td>Basketball</td><td>3</td><td>☐ Yes &nbsp; ☐ No</td><td>&nbsp;</td></tr>
          <tr><td>4</td><td>Volleyball</td><td>2</td><td>☐ Yes &nbsp; ☐ No</td><td>&nbsp;</td></tr>
          <tr><td>5</td><td>Tennis Ball</td><td>1</td><td>☐ Yes &nbsp; ☐ No</td><td>&nbsp;</td></tr>
          <tr><td colSpan={3}><strong>Cone touches</strong> (−1 each, max −4)</td><td>Count: ____</td><td>−______</td></tr>
          <tr><th colSpan={4}>TOKEN SUBTOTAL (A)</th><th>&nbsp;</th></tr>
        </tbody>
      </table>

      <h2>3. Huddle Pad Bonus</h2>
      <table>
        <tbody>
          <tr><td><strong>Robot fully inside Huddle Pad at STOP</strong></td>
              <td>☐ Awarded (+5)</td><td>☐ Not awarded (0)</td><td style={{width:'15%'}}><strong>(B):</strong> ______</td></tr>
        </tbody>
      </table>

      <h2>4. Run Validity</h2>
      <table>
        <tbody>
          <tr><td>Anyone except referee touched robot or items after GO</td><td>☐ No</td><td>☐ Yes → ROUND LOST</td></tr>
        </tbody>
      </table>

      <h2>5. Final Score</h2>
      <div className="total-box">FINAL = A + B = ______</div>
      <div style={{ clear:'both' }} />

      <h2>6. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · SportsWonderland v2.0</div>
    </>
  );
}

// ── SmartLogistics ───────────────────────────────────────────────────────
function SmartLogisticsSheet({ round }: { round?: number }) {
  return (
    <>
      <Header
        round={round}
        title="SMART LOGISTICS — CAPELLI SPORTS INSPIRE · Official Match Scoresheet"
        subtitle="Season 1 · Match: 150s · Fully autonomous · Cubes: 3 mission (RED/GREEN) + 1 BLUE reserved · Combinations: 1 of 8"
      />
      <MatchInfo round={round} extraFields={[{ label: 'COMBINATION # (1–8)' }]} />

      <h2>2. Mission Cube Deliveries</h2>
      <p className="small">For each of the 3 mission cubes: mark its color and the delivery outcome. Correct = fully inside the matching colored bay. Wrong = inside the opposite colored bay. RED → Home, GREEN → Training.</p>
      <table>
        <thead>
          <tr><th style={{width:'5%'}}>#</th><th style={{width:'18%'}}>Color</th><th>Correct bay (+20)</th><th>Wrong bay (−10)</th><th>Not delivered (0)</th><th style={{width:'12%'}}>Pts</th></tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>☐ RED &nbsp; ☐ GREEN</td><td>☐</td><td>☐</td><td>☐</td><td>&nbsp;</td></tr>
          <tr><td>2</td><td>☐ RED &nbsp; ☐ GREEN</td><td>☐</td><td>☐</td><td>☐</td><td>&nbsp;</td></tr>
          <tr><td>3</td><td>☐ RED &nbsp; ☐ GREEN</td><td>☐</td><td>☐</td><td>☐</td><td>&nbsp;</td></tr>
          <tr><th colSpan={2}>TOTALS</th><td>count ___ × 20 = ___</td><td>count ___ × 10 = ___</td><td>count ___</td><td>&nbsp;</td></tr>
        </tbody>
      </table>

      <h2>3. BLUE Cube Status</h2>
      <table>
        <tbody>
          <tr><td>☐ Untouched — stayed exactly in place</td><td>+10</td></tr>
          <tr><td>☐ Moved, but still inside locker rectangle</td><td>0</td></tr>
          <tr><td>☐ Completely outside locker rectangle</td><td>−20</td></tr>
          <tr><th>BLUE OUTCOME</th><th>______</th></tr>
        </tbody>
      </table>

      <h2>4. Park / Finish Bonus</h2>
      <table>
        <tbody>
          <tr><td>Robot partially or completely inside Finish zone at STOP</td><td>☐ Awarded (+10)</td><td>☐ Not awarded (0)</td></tr>
        </tbody>
      </table>

      <h2>5. Field Protection &amp; Autonomy</h2>
      <p className="small">Any breach of autonomy after GO voids the run. Mark as Yes only if the violation is confirmed by the referee.</p>
      <table>
        <tbody>
          <tr><td>Illegal assistance after GO (touching robot / steering / cube adjustment)</td><td>☐ No</td><td>☐ Yes → RUN VOIDED</td></tr>
          <tr><td>Student used remote / joystick / manual control</td><td>☐ No</td><td>☐ Yes → RUN VOIDED</td></tr>
        </tbody>
      </table>

      <h2>6. Final Score</h2>
      <table>
        <tbody>
          <tr><th>A. Correct deliveries (count × 20)</th><td>______</td></tr>
          <tr><th>B. Wrong-bay deliveries (count × 10) (−)</th><td>______</td></tr>
          <tr><th>C. BLUE cube outcome (+10 / 0 / −20)</th><td>______</td></tr>
          <tr><th>D. Park / Finish bonus (+10 / 0)</th><td>______</td></tr>
          <tr><th>FINAL SCORE = A − B + C + D</th><td><strong>______</strong></td></tr>
        </tbody>
      </table>

      <h2>7. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · Smart Logistics — Season 1</div>
    </>
  );
}

// ── LockerRoom (Capelli Starter) ─────────────────────────────────────────
function LockerRoomSheet({ round }: { round?: number }) {
  return (
    <>
      <Header
        round={round}
        title="LOCKER ROOM MISSION — CAPELLI STARTER · Official Match Scoresheet"
        subtitle="Ages 13–15 · Match: 150 seconds · Fully autonomous"
      />
      <MatchInfo round={round} extraFields={[{ label: 'TEAM COLOR DRAWN (RED / GREEN)' }, { label: 'ZONE OPTION # (1–6)' }]} />

      <h2>2. Mission Phases (in order)</h2>
      <table>
        <thead>
          <tr><th style={{width:'8%'}}>Step</th><th>Description</th><th style={{width:'25%'}}>Outcome</th><th style={{width:'14%'}}>Pts</th></tr>
        </thead>
        <tbody>
          <tr><td>1</td><td>Robot left Locker Room with Team Box</td><td>☐ Yes (+5) &nbsp; ☐ No (0)</td><td>&nbsp;</td></tr>
          <tr><td>2</td><td>Reached Scan Station with Team Box</td><td>☐ Yes (+10) &nbsp; ☐ No (0)</td><td>&nbsp;</td></tr>
          <tr><td>3</td><td>Coach Approval — Team Box lifted by referee after scan</td><td>☐ Yes (+15) &nbsp; ☐ No (0)</td><td>&nbsp;</td></tr>
          <tr><td>5</td><td>Team-color cube delivered to matching big circle</td><td>☐ Correct (+20) &nbsp; ☐ Wrong circle (−10) &nbsp; ☐ Not delivered (0)</td><td>&nbsp;</td></tr>
          <tr><td>6</td><td>Stadium Gate bonus (only if Step 5 correct)</td><td>☐ Awarded (+5) &nbsp; ☐ Not awarded (0)</td><td>&nbsp;</td></tr>
          <tr><th colSpan={3}>PHASE SUBTOTAL (A)</th><th>&nbsp;</th></tr>
        </tbody>
      </table>

      <h2>3. Maze Sorting (3 tokens)</h2>
      <p className="small">Each token must end inside its matching color target. Fully inside = +10, partially inside = +5, wrong target = −10, not delivered = 0.</p>
      <table>
        <thead>
          <tr><th style={{width:'15%'}}>Token</th><th>Outcome</th><th style={{width:'14%'}}>Pts</th></tr>
        </thead>
        <tbody>
          <tr><td>🟥 RED</td><td>☐ Fully inside (+10) &nbsp; ☐ Partially (+5) &nbsp; ☐ Wrong (−10) &nbsp; ☐ Not delivered (0)</td><td>&nbsp;</td></tr>
          <tr><td>🟩 GREEN</td><td>☐ Fully inside (+10) &nbsp; ☐ Partially (+5) &nbsp; ☐ Wrong (−10) &nbsp; ☐ Not delivered (0)</td><td>&nbsp;</td></tr>
          <tr><td>🟦 BLUE</td><td>☐ Fully inside (+10) &nbsp; ☐ Partially (+5) &nbsp; ☐ Wrong (−10) &nbsp; ☐ Not delivered (0)</td><td>&nbsp;</td></tr>
          <tr><th colSpan={2}>MAZE SUBTOTAL (B)</th><th>&nbsp;</th></tr>
        </tbody>
      </table>

      <h2>4. Penalties &amp; Run Validity</h2>
      <table>
        <tbody>
          <tr><td>Robot touched Stadium Gate</td><td>☐ No (0) &nbsp; ☐ Yes (−10)</td><td><strong>(C):</strong> ______</td></tr>
          <tr><td>Anyone except referee touched robot/field after GO</td><td>☐ No</td><td>☐ Yes → SCORE = 0</td></tr>
          <tr><td>Student used remote / joystick / manual control</td><td>☐ No</td><td>☐ Yes → SCORE = 0</td></tr>
        </tbody>
      </table>

      <h2>5. Final Score</h2>
      <div className="total-box">FINAL = A + B − |C| = ______</div>
      <div style={{ clear:'both' }} />

      <h2>6. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · Locker Room Mission — Ages 13–15</div>
    </>
  );
}

// ── MakeX Inspire — Code Courier ─────────────────────────────────────────
function CodeCourierSheet({ round }: { round?: number }) {
  return (
    <>
      <Header
        round={round}
        title="CODE COURIER — MAKEX INSPIRE · Official Match Scoresheet"
        subtitle="Ages 8–12 · Match: 150 seconds · Fully autonomous · Max 800 pts (16 rings × 50)"
      />
      <MatchInfo round={round} />

      <h2>2. Rings on Signal Towers (+50 each)</h2>
      <p className="small">Color matches, ring upright in delivery area, no robot contact, ring fully inserted onto matching signal tower (a + b + c + d).</p>
      <table>
        <thead>
          <tr><th style={{width:'25%'}}>Tower</th><th>Rings on tower</th><th style={{width:'18%'}}>×50</th><th style={{width:'14%'}}>Pts</th></tr>
        </thead>
        <tbody>
          <tr><td>🔴 Red tower</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 50</td><td>&nbsp;</td></tr>
          <tr><td>🟡 Yellow tower</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 50</td><td>&nbsp;</td></tr>
          <tr><td>🔵 Blue tower</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 50</td><td>&nbsp;</td></tr>
          <tr><td>🟢 Green tower</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 50</td><td>&nbsp;</td></tr>
          <tr><th colSpan={3}>TOWER SUBTOTAL (A)</th><th>&nbsp;</th></tr>
        </tbody>
      </table>

      <h2>3. Rings in Matching Color Zone (+10 each)</h2>
      <p className="small">Color matches, upright, in correct color zone, no robot contact — but NOT inserted onto tower (a + b + c only). Don&apos;t double-count rings already counted above.</p>
      <table>
        <thead>
          <tr><th style={{width:'25%'}}>Zone</th><th>Rings in zone (not on tower)</th><th style={{width:'18%'}}>×10</th><th style={{width:'14%'}}>Pts</th></tr>
        </thead>
        <tbody>
          <tr><td>🔴 Red zone</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 10</td><td>&nbsp;</td></tr>
          <tr><td>🟡 Yellow zone</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 10</td><td>&nbsp;</td></tr>
          <tr><td>🔵 Blue zone</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 10</td><td>&nbsp;</td></tr>
          <tr><td>🟢 Green zone</td><td>☐ 0 ☐ 1 ☐ 2 ☐ 3 ☐ 4</td><td>____ × 10</td><td>&nbsp;</td></tr>
          <tr><th colSpan={3}>ZONE SUBTOTAL (B)</th><th>&nbsp;</th></tr>
        </tbody>
      </table>

      <h2>4. Penalties</h2>
      <table>
        <tbody>
          <tr><td>Confirmed E02 violations (each −20)</td><td>Count: ____ × 20</td><td><strong>(C):</strong> −______</td></tr>
          <tr><td>E03 — invalid prop(s) removed from scoring</td><td colSpan={2}>☐ None &nbsp; ☐ Confirmed (those props score 0)</td></tr>
          <tr><td>E04 — match disqualified</td><td>☐ No</td><td>☐ Yes → MATCH SCORE = 0</td></tr>
        </tbody>
      </table>

      <h2>5. Final Score</h2>
      <div className="total-box">FINAL = A + B − C = ______</div>
      <div style={{ clear:'both' }} />

      <h2>6. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · 2026 MakeX Inspire — Code Courier</div>
    </>
  );
}

// ── Soccer (Capelli Sport Cup) ──────────────────────────────────────────
function SoccerSheet() {
  return (
    <>
      <Header
        title="CAPELLI SPORT CUP — SOCCER · Official Match Scoresheet"
        subtitle="1-vs-1 · 2 halves × 2 minutes · 30 s halftime · mBot2 · max 40 RPM · 22 × 22 cm · 1.5 kg"
      />

      <h2>1. Match Information</h2>
      <table>
        <tbody>
          <tr><th style={{ width: '20%' }}>MATCH #</th><td>&nbsp;</td><th style={{ width: '20%' }}>FIELD / TABLE</th><td>&nbsp;</td></tr>
          <tr><th>STAGE</th><td>☐ Group &nbsp; ☐ Round of 16 &nbsp; ☐ Quarter &nbsp; ☐ Semi &nbsp; ☐ Final</td><th>REFEREE</th><td>&nbsp;</td></tr>
        </tbody>
      </table>

      <h2>2. Teams</h2>
      <table>
        <thead>
          <tr><th style={{ width: '10%' }}></th><th>TEAM A</th><th>TEAM B</th></tr>
        </thead>
        <tbody>
          <tr><th>Student</th><td>&nbsp;</td><td>&nbsp;</td></tr>
          <tr><th>Academy</th><td>&nbsp;</td><td>&nbsp;</td></tr>
          <tr><th>Coin toss winner</th><td>☐ A</td><td>☐ B</td></tr>
          <tr><th>1st-half kickoff</th><td>☐ A</td><td>☐ B</td></tr>
        </tbody>
      </table>

      <h2>3. Pre-Match Inspection</h2>
      <p className="small">Both teams must pass every item before the match starts.</p>
      <table>
        <thead><tr><th>Item</th><th style={{width:'18%', textAlign:'center'}}>Team A</th><th style={{width:'18%', textAlign:'center'}}>Team B</th></tr></thead>
        <tbody>
          <tr><td>Footprint fits 22 × 22 cm (arms extended)</td><td>☐ Pass ☐ Fail</td><td>☐ Pass ☐ Fail</td></tr>
          <tr><td>Weight ≤ 1.5 kg</td><td>☐ Pass ☐ Fail</td><td>☐ Pass ☐ Fail</td></tr>
          <tr><td>Battery ≥ 50 % charge</td><td>☐ Pass ☐ Fail</td><td>☐ Pass ☐ Fail</td></tr>
          <tr><td>Firmware up-to-date</td><td>☐ Pass ☐ Fail</td><td>☐ Pass ☐ Fail</td></tr>
          <tr><td>No sharp / aggressive components</td><td>☐ Pass ☐ Fail</td><td>☐ Pass ☐ Fail</td></tr>
          <tr><td>Speed test passed (40 RPM, 7 s side-to-side)</td><td>☐ Pass ☐ Fail</td><td>☐ Pass ☐ Fail</td></tr>
        </tbody>
      </table>

      <h2>4. Goals</h2>
      <table>
        <thead><tr><th>Half</th><th style={{width:'30%'}}>Team A goals</th><th style={{width:'30%'}}>Team B goals</th></tr></thead>
        <tbody>
          <tr><td>1st half (2 min)</td><td>Tally: ____&nbsp;&nbsp;&nbsp; Total: ____</td><td>Tally: ____&nbsp;&nbsp;&nbsp; Total: ____</td></tr>
          <tr><td>2nd half (2 min)</td><td>Tally: ____&nbsp;&nbsp;&nbsp; Total: ____</td><td>Tally: ____&nbsp;&nbsp;&nbsp; Total: ____</td></tr>
          <tr><th>SUBTOTAL</th><th>____</th><th>____</th></tr>
        </tbody>
      </table>

      <h2>5. Free Kicks &amp; Resets</h2>
      <table>
        <tbody>
          <tr><th style={{width:'40%'}}>Free kicks awarded to Team A</th><td>____</td><th style={{width:'15%'}}>To Team B</th><td>____</td></tr>
          <tr><th>Resets used by Team A</th><td>____ / 2</td><th>By Team B</th><td>____ / 2</td></tr>
        </tbody>
      </table>

      <h2>6. Penalty Shootout (only if tied after both halves)</h2>
      <p className="small">Each team takes 3 alternate penalty kicks. If still tied → sudden death.</p>
      <table>
        <thead><tr><th></th><th style={{width:'15%'}}>Kick 1</th><th style={{width:'15%'}}>Kick 2</th><th style={{width:'15%'}}>Kick 3</th><th style={{width:'15%'}}>Goals</th></tr></thead>
        <tbody>
          <tr><th>Team A</th><td>☐ ✓ ☐ ✗</td><td>☐ ✓ ☐ ✗</td><td>☐ ✓ ☐ ✗</td><td>____</td></tr>
          <tr><th>Team B</th><td>☐ ✓ ☐ ✗</td><td>☐ ✓ ☐ ✗</td><td>☐ ✓ ☐ ✗</td><td>____</td></tr>
          <tr><td colSpan={5}>Sudden death (extra kicks if still tied):&nbsp;&nbsp; A: ______&nbsp;&nbsp;&nbsp; B: ______</td></tr>
        </tbody>
      </table>

      <h2>7. Cards / Penalties</h2>
      <table>
        <tbody>
          <tr><th style={{width:'40%'}}>Yellow card to Team A?</th><td>☐ No &nbsp; ☐ Yes — reason: ____________________</td></tr>
          <tr><th>Yellow card to Team B?</th><td>☐ No &nbsp; ☐ Yes — reason: ____________________</td></tr>
          <tr><th>Disqualification (boost mode / forbidden attachment / battery swap)</th><td>☐ Team A &nbsp; ☐ Team B &nbsp; ☐ None</td></tr>
        </tbody>
      </table>

      <h2>8. Final Result</h2>
      <table>
        <tbody>
          <tr><th style={{width:'30%'}}>Final score</th><td>A: ______ &nbsp;&nbsp; B: ______</td></tr>
          <tr><th>Winner</th><td>☐ Team A &nbsp; ☐ Team B &nbsp; ☐ Draw (group stage only)</td></tr>
          <tr><th>Decided by</th><td>☐ Regulation &nbsp; ☐ Penalty shootout &nbsp; ☐ Sudden death &nbsp; ☐ Disqualification</td></tr>
        </tbody>
      </table>

      <h2>9. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · Soccer Category</div>
    </>
  );
}

export const SCORESHEETS: Record<string, { Body: (props: { round?: number }) => React.JSX.Element; rounds?: number }> = {
  sportswonderland: { Body: SportsWonderlandSheet, rounds: 2 },
  smartlogistics:  { Body: SmartLogisticsSheet, rounds: 2 },
  lockerroom:      { Body: LockerRoomSheet, rounds: 2 },
  codecourier:     { Body: CodeCourierSheet, rounds: 2 },
  soccer:          { Body: SoccerSheet, rounds: 1 },
};
