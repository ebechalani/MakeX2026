'use client';

/**
 * The simulator for the MakeX "Fire Rescue" category: the general simulator screen
 * (../SimulatorApp) filled in with this category's game, robot, examples, rules and
 * combination editor.
 */
import type { ReactNode } from 'react';
import { DEFAULT_ROBOT_CONFIG } from '../../core/robot';
import { WATER_TOWER_IDS } from '../../fire-rescue/field';
import { fireRescueGame, startPoseFor } from '../../fire-rescue/game';
import { SAMPLE_PROGRAMS } from '../../fire-rescue/samples';
import { COLOR_PERMUTATIONS, type FireRescueScenario } from '../../fire-rescue/scenario';
import type { BatchPreset } from '../BatchDialog';
import { SimulatorApp } from '../SimulatorApp';
import { CombinationEditor } from './CombinationEditor';
import { FIRE_RESCUE_RULES } from './rules';

/** Every way to put the four buckets on the four water towers, with the people left as they are. */
function allBucketArrangements(current: FireRescueScenario): FireRescueScenario[] {
  return COLOR_PERMUTATIONS.map((colors) => {
    const buckets = { ...current.buckets };
    WATER_TOWER_IDS.forEach((tower, i) => {
      buckets[tower] = colors[i];
    });
    return { buckets, people: { ...current.people } };
  });
}

const BATCH_PRESETS: BatchPreset<FireRescueScenario>[] = [
  {
    id: 'all-buckets',
    label: 'All bucket arrangements (24)',
    hint: 'Every way to place the four buckets on W1 to W4. The people stay as on the stage.',
    scenarios: allBucketArrangements,
  },
];

function renderCombinationEditor(scenario: FireRescueScenario, onChange: (next: FireRescueScenario) => void): ReactNode {
  return <CombinationEditor scenario={scenario} onChange={onChange} />;
}

/** The robot starts facing up the mat, in the middle of the Fire Station. */
const START_POSE = startPoseFor(DEFAULT_ROBOT_CONFIG);

export default function FireRescueSimulator() {
  return (
    <SimulatorApp
      game={fireRescueGame}
      robotConfig={DEFAULT_ROBOT_CONFIG}
      title="Fire Rescue"
      startZoneName="Fire Station"
      examples={SAMPLE_PROGRAMS}
      rules={FIRE_RESCUE_RULES}
      initialStartPose={START_POSE}
      renderCombinationEditor={renderCombinationEditor}
      batchPresets={BATCH_PRESETS}
    />
  );
}
