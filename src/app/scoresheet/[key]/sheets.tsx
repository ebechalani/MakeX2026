import React from 'react';

const Cb = ({ children }: { children: React.ReactNode }) => (
  <span><span className="check"></span>{children}</span>
);

const Header = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <>
    <h1>{title}</h1>
    <p className="meta">{subtitle}</p>
  </>
);

const MatchInfo = ({ extraFields }: { extraFields?: { label: string }[] }) => (
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
          <th style={{ width: '15%' }}>ACADEMY</th>
          <td>&nbsp;</td>
        </tr>
        <tr>
          <th>DATE</th>
          <td>&nbsp;</td>
          <th>FIELD / TABLE #</th>
          <td>&nbsp;</td>
        </tr>
        <tr>
          <th>ROUND</th>
          <td>☐ 1 &nbsp;&nbsp; ☐ 2</td>
          <th>COACH NAME</th>
          <td>&nbsp;</td>
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
            <td colSpan={3}>&nbsp;</td>
          </tr>
        ))}
      </tbody>
    </table>
  </>
);

const Signatures = () => (
  <div className="sig-row">
    <div>
      <div className="sig-line">Referee signature · Print name &amp; date</div>
    </div>
    <div>
      <div className="sig-line">Coach / Team representative signature · Print name &amp; date</div>
    </div>
  </div>
);

// ── SportsWonderland ─────────────────────────────────────────────────────
function SportsWonderlandSheet() {
  return (
    <>
      <Header
        title="SPORTSWONDERLAND — ALL-STAR PICKUP · Official Match Scoresheet"
        subtitle="Match: 120 seconds · Robot: mTiny / CodyRockey · Tokens: Helmet 5 / Whistle 4 / Basketball 3 / Volleyball 2 / Tennis 1 · Bonus: +5 Huddle Pad · Cone touch: −1 each"
      />
      <MatchInfo extraFields={[{ label: 'AGE CATEGORY' }]} />
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

      <h2>6. Tie-breaker Data</h2>
      <table>
        <tbody>
          <tr><th style={{width:'40%'}}>Tokens collected (out of 5)</th><td>______</td></tr>
          <tr><th>Robot returned to Huddle Pad?</th><td>☐ Yes (fully inside) &nbsp; ☐ Partial &nbsp; ☐ No</td></tr>
          <tr><th>Match ended by</th><td>☐ Time expired &nbsp; ☐ Team called STOP &nbsp; ☐ Round lost</td></tr>
        </tbody>
      </table>

      <h2>7. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · SportsWonderland v2.0</div>
    </>
  );
}

// ── SmartLogistics ───────────────────────────────────────────────────────
function SmartLogisticsSheet() {
  return (
    <>
      <Header
        title="SMART LOGISTICS — CAPELLI SPORTS INSPIRE · Official Match Scoresheet"
        subtitle="Season 1 · Match: 150s · Fully autonomous · Cubes: 3 mission (RED/GREEN) + 1 BLUE reserved · Combinations: 1 of 8"
      />
      <MatchInfo extraFields={[{ label: 'COMBINATION # (1–8)' }, { label: 'ROBOT PLATFORM' }, { label: 'ROBOT INSPECTION PASSED?' }]} />

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

      <h2>7. Tie-breaker Data</h2>
      <table>
        <tbody>
          <tr><th style={{width:'40%'}}>Correct deliveries (out of 3)</th><td>______</td></tr>
          <tr><th>Robot returned to Finish zone?</th><td>☐ Fully inside &nbsp; ☐ Partially inside &nbsp; ☐ No</td></tr>
          <tr><th>Match ended by</th><td>☐ Time expired &nbsp; ☐ Run voided &nbsp; ☐ Stopped early</td></tr>
        </tbody>
      </table>

      <h2>8. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · Smart Logistics — Season 1</div>
    </>
  );
}

// ── LockerRoom (Capelli Starter) ─────────────────────────────────────────
function LockerRoomSheet() {
  return (
    <>
      <Header
        title="LOCKER ROOM MISSION — CAPELLI STARTER · Official Match Scoresheet"
        subtitle="Ages 13–15 · Match: 150 seconds · Fully autonomous"
      />
      <MatchInfo extraFields={[{ label: 'TEAM COLOR DRAWN (RED / GREEN)' }, { label: 'ZONE OPTION # (1–6)' }]} />

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

      <h2>6. Tie-breaker Data</h2>
      <table>
        <tbody>
          <tr><th style={{width:'40%'}}>Phases completed (out of 6)</th><td>______</td></tr>
          <tr><th>Tokens scored (out of 3)</th><td>______</td></tr>
          <tr><th>Match ended by</th><td>☐ Referee STOP &nbsp; ☐ Time expired &nbsp; ☐ Run voided</td></tr>
        </tbody>
      </table>

      <h2>7. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · Capelli Sport · Locker Room Mission — Ages 13–15</div>
    </>
  );
}

// ── MakeX Inspire — Code Courier ─────────────────────────────────────────
function CodeCourierSheet() {
  return (
    <>
      <Header
        title="CODE COURIER — MAKEX INSPIRE · Official Match Scoresheet"
        subtitle="Ages 8–12 · Match: 150 seconds · Fully autonomous · Max 800 pts (16 rings × 50)"
      />
      <MatchInfo extraFields={[{ label: 'ROBOT PLATFORM' }, { label: 'ROBOT INSPECTION PASSED?' }]} />

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

      <h2>6. Tie-breaker Data</h2>
      <table>
        <tbody>
          <tr><th style={{width:'40%'}}>Rings on towers (out of 16)</th><td>______</td></tr>
          <tr><th>Match ended by</th><td>☐ Time expired &nbsp; ☐ Disqualified &nbsp; ☐ Stopped early</td></tr>
        </tbody>
      </table>

      <h2>7. Signatures</h2>
      <Signatures />
      <div className="footer">MakeX Lebanon · 2026 MakeX Inspire — Code Courier</div>
    </>
  );
}

export const SCORESHEETS: Record<string, { Body: () => React.JSX.Element }> = {
  sportswonderland: { Body: SportsWonderlandSheet },
  smartlogistics:  { Body: SmartLogisticsSheet },
  lockerroom:      { Body: LockerRoomSheet },
  codecourier:     { Body: CodeCourierSheet },
};
