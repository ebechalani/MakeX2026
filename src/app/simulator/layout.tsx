import type { Metadata } from 'next';
import './simulator.css';

export const metadata: Metadata = {
  title: 'mBot2 Simulator - MakeX Lebanon',
  description: 'Program a Makeblock mBot2 with blocks and watch it run on the competition mat.',
};

export default function SimulatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
