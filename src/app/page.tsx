import Link from 'next/link';

const pages = [
  {
    href: '/admin',
    label: 'Admin Panel',
    description: 'Manage categories, tables, and passations. View all judge results.',
    color: 'bg-blue-600 hover:bg-blue-700',
    icon: '⚙️',
  },
  {
    href: '/judge',
    label: 'Judge Interface',
    description: 'Manage your table queue, enter scores, and finalize results.',
    color: 'bg-green-600 hover:bg-green-700',
    icon: '🏆',
  },
  {
    href: '/coach',
    label: 'Coach / Teacher View',
    description: 'Track your teams live — see status, table, and timing.',
    color: 'bg-purple-600 hover:bg-purple-700',
    icon: '👨‍🏫',
  },
  {
    href: '/live',
    label: 'Public Display Screen',
    description: 'Live screen for venue displays — NOW / NEXT / PREPARE.',
    color: 'bg-orange-600 hover:bg-orange-700',
    icon: '📺',
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-black text-white mb-3 tracking-tight">MakeX 2026</h1>
        <p className="text-blue-200 text-xl">Lebanon National Competition — Live Management System</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
        {pages.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className={`${p.color} text-white rounded-2xl p-8 flex flex-col gap-3 shadow-xl transition-transform hover:scale-105`}
          >
            <span className="text-4xl">{p.icon}</span>
            <span className="text-2xl font-bold">{p.label}</span>
            <span className="text-sm opacity-90">{p.description}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
