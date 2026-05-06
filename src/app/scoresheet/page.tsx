import Link from 'next/link';

const sheets = [
  { key: 'sportswonderland', title: 'SportsWonderland — All-Star Pickup', meta: 'Ages 4–7 · 120 s · Capelli SportsWonderland' },
  { key: 'smartlogistics',   title: 'Smart Logistics',                     meta: 'Ages 8–12 · 150 s · Capelli Inspire' },
  { key: 'lockerroom',       title: 'Locker Room Mission',                 meta: 'Ages 13–15 · 150 s · Capelli Starter' },
  { key: 'codecourier',      title: 'Code Courier',                         meta: 'Ages 8–12 · 150 s · MakeX Inspire' },
];

export default function ScoresheetIndex() {
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700">← Admin</Link>
        <h1 className="text-2xl font-bold text-slate-800 mt-2 mb-1">Printable Scoresheets</h1>
        <p className="text-sm text-slate-500 mb-6">Pick a category, then press Ctrl+P (Cmd+P on Mac) to print.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sheets.map(s => (
            <Link key={s.key} href={`/scoresheet/${s.key}`}
              className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-blue-400 transition">
              <p className="font-bold text-slate-800">{s.title}</p>
              <p className="text-xs text-slate-500 mt-1">{s.meta}</p>
              <p className="text-xs text-blue-600 font-semibold mt-3">Open →</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
