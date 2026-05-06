import Link from 'next/link';

const pages = [
  {
    href: '/admin',
    label: 'Admin Panel',
    description: 'Manage categories, tables, and passations. View all judge results.',
    gradient: 'from-slate-700 to-slate-900',
    border: 'border-slate-600',
    badge: 'Admin Only',
    badgeColor: 'bg-red-500',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/judge',
    label: 'Judge Interface',
    description: 'Manage your assigned table — score, signature, and finalize results.',
    gradient: 'from-emerald-700 to-emerald-900',
    border: 'border-emerald-600',
    badge: 'Judges',
    badgeColor: 'bg-emerald-500',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
  },
  {
    href: '/scoresheet',
    label: 'Printable Scoresheets',
    description: 'Open and print the official match scoresheet for each category.',
    gradient: 'from-violet-700 to-violet-900',
    border: 'border-violet-600',
    badge: 'Scoresheets',
    badgeColor: 'bg-violet-500',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: '/live',
    label: 'Public Display',
    description: 'Live venue screen — NOW, NEXT, and PREPARE at every table.',
    gradient: 'from-amber-600 to-orange-800',
    border: 'border-amber-600',
    badge: 'Public',
    badgeColor: 'bg-amber-500',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: '/academy',
    label: 'School / Academy Portal',
    description: 'Verify your team registrations and request add/edit/delete changes.',
    gradient: 'from-cyan-700 to-cyan-900',
    border: 'border-cyan-600',
    badge: 'Academies',
    badgeColor: 'bg-cyan-500',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
      </svg>
    ),
  },
  {
    href: '/organizer',
    label: 'Organizer Tasks',
    description: 'Track all competition tasks — sponsors, venue, logistics, and more.',
    gradient: 'from-purple-700 to-purple-900',
    border: 'border-purple-600',
    badge: 'Organizer',
    badgeColor: 'bg-purple-500',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-white/60 text-sm font-medium tracking-wide">Live System Active</span>
          </div>
          <h1 className="text-6xl font-black text-white mb-4 tracking-tight leading-none">
            MakeX<span className="text-blue-400"> 2026</span>
          </h1>
          <p className="text-white/50 text-lg font-medium">Lebanon National Competition · Queue Management System</p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {pages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className={`group relative bg-gradient-to-br ${p.gradient} border ${p.border} rounded-2xl p-7 flex flex-col gap-4 shadow-2xl transition-all duration-200 hover:scale-[1.02] hover:shadow-blue-900/30`}
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 bg-white/10 rounded-xl text-white">{p.icon}</div>
                <span className={`${p.badgeColor} text-white text-xs font-bold px-2.5 py-1 rounded-full tracking-wide uppercase`}>
                  {p.badge}
                </span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white mb-1">{p.label}</h2>
                <p className="text-white/60 text-sm leading-relaxed">{p.description}</p>
              </div>
              <div className="flex items-center gap-1 text-white/40 text-xs font-medium group-hover:text-white/60 transition-colors">
                Open
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-center text-white/20 text-xs mt-10">MakeX 2026 · Lebanon · Competition Management System</p>
      </div>
    </main>
  );
}
