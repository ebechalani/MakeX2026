'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type CertRow = {
  studentName: string;
  clubName: string;
  categoryName: string;
  url: string;
};

function sanitize(str: string) {
  return (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
}

function certUrl(club: string, student: string) {
  return `/certificates/${encodeURIComponent(sanitize(club))}/${encodeURIComponent(sanitize(student))}.pdf`;
}

export default function CertificatesTab() {
  const supabase = useMemo(() => createClient(), []);
  const [enabled, setEnabled] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [storageOk, setStorageOk] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Load setting
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'certificates_enabled')
      .maybeSingle();
    setEnabled(setting?.value === 'true');

    // Load categories
    const { data: catData } = await supabase.from('categories').select('id, name');
    const catMap: Record<string, string> = {};
    for (const c of catData || []) catMap[c.id] = c.name;
    setCats(catMap);

    // Load all R1 passations to derive certificate list
    const { data: rows } = await supabase
      .from('passations')
      .select('team_name, student_names, club_name, category_id')
      .eq('round_number', 1)
      .order('club_name')
      .order('team_name');

    const list: CertRow[] = (rows || []).map((r: { student_names: string | null; team_name: string; club_name: string | null; category_id: string }) => {
      const studentName = (r.student_names?.trim()) || r.team_name || '—';
      return {
        studentName,
        clubName: r.club_name || 'Unknown',
        categoryName: catMap[r.category_id] || '—',
        url: certUrl(r.club_name || 'Unknown', studentName),
      };
    });
    setCerts(list);

    // Ping a known cert file to verify files are served
    const testRes = await fetch('/certificates/', { method: 'HEAD' }).catch(() => null);
    setStorageOk(testRes ? testRes.ok || testRes.status === 403 : true); // 403 = folder exists, just not browsable

    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function toggle() {
    setToggling(true);
    const next = !enabled;
    await supabase.from('app_settings').upsert({ key: 'certificates_enabled', value: next ? 'true' : 'false' });
    setEnabled(next);
    setToggling(false);
  }

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return certs;
    return certs.filter(c =>
      c.studentName.toLowerCase().includes(q) ||
      c.clubName.toLowerCase().includes(q) ||
      c.categoryName.toLowerCase().includes(q)
    );
  }, [certs, filter]);

  // Group by club
  const byClub = useMemo(() => {
    const m = new Map<string, CertRow[]>();
    for (const c of filtered) {
      if (!m.has(c.clubName)) m.set(c.clubName, []);
      m.get(c.clubName)!.push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (loading) return <p className="text-slate-400 text-sm">Loading certificates…</p>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-slate-800">E-Certificates</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {certs.length} certificates · {byClub.length} clubs
          </p>
        </div>

        {/* Toggle */}
        <button
          onClick={toggle}
          disabled={toggling}
          className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold border transition disabled:opacity-50 ${
            enabled
              ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500'
              : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
            enabled ? 'bg-white border-white' : 'border-slate-400'
          }`} />
          {toggling ? 'Saving…' : enabled ? '🟢 Live — academies can download' : '⛔ Hidden from academies'}
        </button>
      </div>

      {/* Storage status */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
        💡 To regenerate after data changes: run <code className="bg-blue-100 px-1 rounded font-mono">node scripts/generate_certificates.mjs</code> then restart the dev server (or redeploy).
      </div>

      {/* Search */}
      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Search by student, club or category…"
        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />

      {/* Clubs grid */}
      {byClub.length === 0 ? (
        <p className="text-slate-400 text-sm">No certificates match your search.</p>
      ) : (
        <div className="space-y-4">
          {byClub.map(([club, rows]) => (
            <div key={club} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 text-sm">{club}</h3>
                <span className="text-xs text-slate-400">{rows.length} certificate{rows.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {rows.map(r => (
                  <a
                    key={r.url}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-xl px-3 py-2.5 transition group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{r.studentName}</p>
                      <p className="text-[11px] text-slate-400 truncate">{r.categoryName}</p>
                    </div>
                    <span className="text-blue-500 group-hover:text-blue-600 text-xs flex-shrink-0">↗ PDF</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
