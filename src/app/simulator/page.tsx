import Link from 'next/link';

/** The categories that have a simulator. Fire Rescue comes first; add new ones below it. */
const categories = [
  {
    href: '/simulator/fire-rescue',
    label: 'Fire Rescue',
    age: 'Age 11-13',
    description:
      'Deliver the water buckets to the right buildings and carry the people onto their rescue towers - on any of the 9,216 starting combinations.',
    gradient: 'from-rose-600 to-red-900',
    border: 'border-rose-500',
    badge: 'Ready',
    badgeColor: 'bg-emerald-500',
  },
];

export default function SimulatorHome() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a0f1e] p-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-40 -top-40 h-96 w-96 rounded-full bg-blue-600/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-rose-600/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        <div className="mb-12 text-center">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium tracking-wide text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            MakeX home
          </Link>
          <h1 className="mb-4 text-5xl font-black leading-none tracking-tight text-white sm:text-6xl">
            mBot2<span className="text-blue-400"> Simulator</span>
          </h1>
          <p className="text-lg font-medium text-white/50">
            Code the robot with blocks, like in mBlock, and watch it run on the competition mat.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {categories.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={`group relative flex flex-col gap-4 rounded-2xl border bg-gradient-to-br p-7 shadow-2xl transition-all duration-200 hover:scale-[1.02] hover:shadow-blue-900/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-400 ${c.gradient} ${c.border}`}
            >
              <div className="flex items-start justify-between">
                <div className="rounded-xl bg-white/10 p-2.5 text-white">
                  <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
                  </svg>
                </div>
                <span className={`${c.badgeColor} rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white`}>{c.badge}</span>
              </div>
              <div>
                <h2 className="mb-1 text-xl font-bold text-white">{c.label}</h2>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">{c.age}</p>
                <p className="text-sm leading-relaxed text-white/70">{c.description}</p>
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-white/50 transition-colors group-hover:text-white/80">
                Open the simulator
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}

          <div className="flex flex-col justify-center gap-2 rounded-2xl border border-dashed border-white/15 p-7 text-white/40">
            <h2 className="text-lg font-bold text-white/60">More categories</h2>
            <p className="text-sm leading-relaxed">Simulators for the other MakeX categories will appear here.</p>
          </div>
        </div>

        <p className="mt-10 text-center text-xs text-white/20">MakeX Lebanon · mBot2 Simulator</p>
      </div>
    </main>
  );
}
