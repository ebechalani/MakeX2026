import type { Metadata } from 'next';
import { FireRescueLoader } from '@/simulator/ui/fire-rescue/FireRescueLoader';

export const metadata: Metadata = {
  title: 'mBot2 Simulator - Fire Rescue',
  description:
    'Build a program with mBlock-style blocks and watch the mBot2 run it on the MakeX Lebanon 2027 Fire Rescue mat, on any starting combination.',
};

/** The page itself is rendered on the server; the simulator inside it runs in the browser only. */
export default function FireRescueSimulatorPage() {
  return <FireRescueLoader />;
}
