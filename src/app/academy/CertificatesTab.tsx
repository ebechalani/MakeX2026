'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Passation } from '@/lib/types';

type Props = {
  academyName: string;
  passations: Passation[];   // already filtered to round 1 for this academy
  categories: Category[];
};

function sanitize(str: string) {
  return (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}

function certUrl(club: string, student: string) {
  // Served by the dynamic route handler — always reflects the latest DB data.
  return `/api/certificate/${encodeURIComponent(sanitize(club))}/${encodeURIComponent(sanitize(student))}`;
}

export default function CertificatesTab({ academyName, passations, categories }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'certificates_enabled')
      .maybeSingle()
      .then(({ data }: { data: { value: string } | null }) => setEnabled(data?.value === 'true'));
  }, [supabase]);

  const catMap = useMemo(
    () => Object.fromEntries(categories.map(c => [c.id, c.name])),
    [categories],
  );

  // Build the list of certificates for this academy
  const certs = useMemo(() =>
    passations.map(p => {
      const studentName = p.student_names?.trim() || p.team_name || '—';
      return {
        studentName,
        categoryName: catMap[p.category_id] || '—',
        url: certUrl(academyName, studentName),
      };
    }),
    [passations, catMap, academyName],
  );

  if (enabled === null) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
        <div className="text-4xl">🎓</div>
        <h3 className="text-base font-bold text-slate-700">Certificates Not Yet Available</h3>
        <p className="text-sm text-slate-400 max-w-sm mx-auto">
          Your participation certificates will be available here once the organizers publish them after the event.
        </p>
      </div>
    );
  }

  if (certs.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-400 text-sm">
        No registered students found.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-800">🎓 E-Certificates</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {certs.length} certificate{certs.length !== 1 ? 's' : ''} available · click to open or right-click → Save
        </p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-800">
        🎉 Congratulations to all participants! Your official participation certificates are ready.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {certs.map(c => (
          <a
            key={c.url}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-2xl px-4 py-4 transition group shadow-sm"
          >
            {/* Certificate icon */}
            <div className="w-10 h-10 rounded-xl bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center flex-shrink-0 transition text-xl">
              📄
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800 text-sm truncate">{c.studentName}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">{c.categoryName}</p>
            </div>
            <span className="text-blue-500 group-hover:text-blue-600 text-xs font-semibold flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
              Open ↗
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
