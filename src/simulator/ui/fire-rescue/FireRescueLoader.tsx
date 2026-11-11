'use client';

/**
 * Loads the Fire Rescue simulator in the browser only.
 *
 * The simulator remembers things in the browser (blocks, combination, where the robot starts)
 * and draws on a canvas, so there is nothing useful the server could render for it. Loading it
 * with `ssr: false` also keeps Blockly, which needs a real browser, out of the server.
 */
import dynamic from 'next/dynamic';

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-100">
      <div className="flex h-12 shrink-0 items-center bg-[#0a0f1e] px-4 text-sm font-bold text-white">
        mBot2 Simulator <span className="ml-1 font-medium text-sky-300">- Fire Rescue</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6" role="status">
        <div className="flex items-center gap-3 text-slate-600">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden="true" />
          <span className="text-sm font-semibold">Getting the mat and the robot ready…</span>
        </div>
      </div>
    </div>
  );
}

const FireRescueSimulator = dynamic(() => import('./FireRescueSimulator'), {
  ssr: false,
  loading: () => <LoadingScreen />,
});

export function FireRescueLoader() {
  return <FireRescueSimulator />;
}
