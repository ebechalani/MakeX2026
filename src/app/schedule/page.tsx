'use client';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Category, Table, Passation } from '@/lib/types';
import Link from 'next/link';
import * as XLSX from 'xlsx';

interface Sheet {
  category: Category;
  table: Table;
  students: Passation[];
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getName(p: Passation) {
  return p.student_names || p.team_name || '—';
}

const STATUS_COLORS: Record<string, string> = {
  Scheduled: '#64748b',
  Prepare: '#d97706',
  Next: '#2563eb',
  'In Progress': '#16a34a',
  Finished: '#15803d',
  Absent: '#dc2626',
  Delayed: '#ea580c',
};

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCatId, setFilterCatId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [printedAt] = useState(() =>
    new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cats }, { data: tabs }, { data: pas }] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('name'),
      supabase.from('tables').select('*').eq('active', true).order('table_number'),
      supabase.from('passations').select('*').order('queue_position').order('scheduled_time'),
    ]);
    if (!cats || !tabs || !pas) { setLoading(false); return; }
    setCategories(cats as Category[]);

    const result: Sheet[] = [];
    for (const cat of cats as Category[]) {
      const catTables = (tabs as Table[]).filter(t => t.category_id === cat.id);
      for (const table of catTables) {
        const students = (pas as Passation[]).filter(p => p.table_id === table.id);
        result.push({ category: cat, table, students });
      }
    }
    setSheets(result);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = filterCatId
    ? sheets.filter(s => s.category.id === filterCatId)
    : sheets;

  const totalStudents = filtered.reduce((n, s) => n + s.students.length, 0);

  const exportExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();

    for (const sheet of filtered) {
      const catName = sheet.category.name;
      const ageLabel = sheet.category.age_range_label;
      const tableNum = sheet.table.table_number;
      const tableLabel = sheet.table.display_label || `Table ${tableNum}`;

      // Sheet tab name: e.g. "Sportswonderland - Table 1"
      const sheetName = `${catName}${ageLabel ? ` ${ageLabel}` : ''} - ${tableLabel}`
        .replace(/[\\/*?[\]:]/g, '').slice(0, 31);

      const rows: (string | number)[][] = [];

      // Header block
      rows.push([`MakeX 2026 Lebanon`]);
      rows.push([`${catName}${ageLabel ? ` (${ageLabel})` : ''}`]);
      rows.push([tableLabel]);
      rows.push([]); // blank spacer
      rows.push(['#', 'Participant Name']);

      // One row per student — name only
      const sorted = [...sheet.students].sort((a, b) => a.queue_position - b.queue_position);
      sorted.forEach((p, idx) => {
        rows.push([idx + 1, getName(p)]);
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 4 }, { wch: 35 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // Use blob URL — more reliable than XLSX.writeFile in Next.js
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellFormula: true } as any);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MakeX2026_Tables_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <>
      {/* ── Print styles injected inline ── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sheet-card { page-break-after: always; break-after: page; }
          .sheet-card:last-child { page-break-after: avoid; break-after: avoid; }
          body { background: white !important; }
          .print-page { padding: 0 !important; background: white !important; }
        }
        @media screen {
          .sheet-card { margin-bottom: 24px; }
        }
      `}</style>

      <div className="print-page min-h-screen bg-slate-100">

        {/* ── Screen-only header ── */}
        <div className="no-print sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-slate-400 hover:text-slate-600 text-sm transition">← Home</Link>
            <div>
              <h1 className="text-lg font-bold text-slate-800 leading-tight">Table Schedule Sheets</h1>
              <p className="text-xs text-slate-400">
                {filtered.length} tables · {totalStudents} students
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              value={filterCatId}
              onChange={e => setFilterCatId(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.age_range_label ? ` (${c.age_range_label})` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={exportExcel}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Excel
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print All
            </button>
            <button
              onClick={load}
              className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl transition">
              Refresh
            </button>
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-32 no-print">
            <div className="w-8 h-8 border-2 border-slate-400 border-t-transparent rounded-full animate-spin mr-3" />
            <p className="text-slate-500">Loading schedule…</p>
          </div>
        )}

        {/* ── Empty ── */}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 no-print">
            <p className="text-slate-400 text-xl font-semibold">No tables found</p>
            <p className="text-slate-300 text-sm mt-2">Add passations in the admin panel first</p>
          </div>
        )}

        {/* ── Sheets ── */}
        {!loading && (
          <div className="p-6">
            {filtered.map((sheet, si) => {
              const catName = sheet.category.name;
              const ageLabel = sheet.category.age_range_label;
              const tableLabel = sheet.table.display_label || `Table ${sheet.table.table_number}`;
              const finished = sheet.students.filter(p => p.live_status === 'Finished').length;
              const pending = sheet.students.filter(p => !['Finished', 'Absent'].includes(p.live_status)).length;
              const absent = sheet.students.filter(p => p.live_status === 'Absent').length;

              return (
                <div key={`${sheet.category.id}-${sheet.table.id}`}
                  className="sheet-card bg-white rounded-2xl overflow-hidden shadow-md border border-slate-200">

                  {/* Sheet header */}
                  <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}
                    className="px-8 py-6 flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-white/40 text-xs font-bold uppercase tracking-widest">
                          MakeX 2026 · Lebanon
                        </span>
                        <span className="text-white/20 text-xs">|</span>
                        <span className="text-white/40 text-xs font-bold uppercase tracking-widest">
                          Schedule Sheet #{si + 1}
                        </span>
                      </div>
                      <h2 className="text-white font-black leading-tight"
                        style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)' }}>
                        {catName}
                        {ageLabel && (
                          <span className="ml-3 text-blue-400 font-semibold"
                            style={{ fontSize: '70%' }}>
                            {ageLabel}
                          </span>
                        )}
                      </h2>
                      <p className="text-white font-black mt-1"
                        style={{ fontSize: 'clamp(1rem, 2vw, 1.35rem)', color: '#60a5fa' }}>
                        {tableLabel}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-6">
                      {/* Summary pills */}
                      <div className="flex flex-col gap-1.5 items-end">
                        <span className="text-xs font-bold px-3 py-1 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>
                          {sheet.students.length} student{sheet.students.length !== 1 ? 's' : ''}
                        </span>
                        {finished > 0 && (
                          <span className="text-xs font-bold px-3 py-1 rounded-full"
                            style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }}>
                            ✓ {finished} finished
                          </span>
                        )}
                        {absent > 0 && (
                          <span className="text-xs font-bold px-3 py-1 rounded-full"
                            style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>
                            ✗ {absent} absent
                          </span>
                        )}
                        {pending > 0 && (
                          <span className="text-xs font-bold px-3 py-1 rounded-full"
                            style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}>
                            ◷ {pending} pending
                          </span>
                        )}
                      </div>
                      <p className="text-white/20 text-xs mt-3">Printed: {printedAt}</p>
                    </div>
                  </div>

                  {/* Students table */}
                  {sheet.students.length === 0 ? (
                    <div className="px-8 py-12 text-center text-slate-400">
                      <p className="font-semibold">No students assigned to this table yet</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider w-10">#</th>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Student Name</th>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Coach</th>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Appt. Time</th>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Score</th>
                            <th className="text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Mission Time</th>
                            <th className="no-print text-left px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Judge</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.students
                            .sort((a, b) => a.queue_position - b.queue_position)
                            .map((p, idx) => {
                              const isFinished = p.live_status === 'Finished';
                              const isAbsent = p.live_status === 'Absent';
                              const isActive = p.live_status === 'In Progress';
                              return (
                                <tr key={p.id}
                                  style={{
                                    borderBottom: '1px solid #f1f5f9',
                                    background: isActive ? 'rgba(22,163,74,0.05)' : isAbsent ? 'rgba(239,68,68,0.03)' : 'white',
                                  }}>
                                  {/* # */}
                                  <td className="px-6 py-4">
                                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black"
                                      style={{ background: isActive ? '#16a34a' : '#e2e8f0', color: isActive ? 'white' : '#64748b' }}>
                                      {idx + 1}
                                    </span>
                                  </td>
                                  {/* Name */}
                                  <td className="px-6 py-4">
                                    <p className="font-bold text-slate-800 text-base">{getName(p)}</p>
                                    {p.parent_contact && (
                                      <p className="text-xs text-slate-400 mt-0.5">{p.parent_contact}</p>
                                    )}
                                  </td>
                                  {/* Coach */}
                                  <td className="px-6 py-4 text-slate-600 text-sm">{p.coach_name || '—'}</td>
                                  {/* Time */}
                                  <td className="px-6 py-4">
                                    <span className="font-mono font-bold text-slate-700">{fmt(p.scheduled_time)}</span>
                                  </td>
                                  {/* Status */}
                                  <td className="px-6 py-4">
                                    <span className="px-2.5 py-1 rounded-full text-xs font-bold"
                                      style={{
                                        background: `${STATUS_COLORS[p.live_status] || '#64748b'}18`,
                                        color: STATUS_COLORS[p.live_status] || '#64748b',
                                        border: `1px solid ${STATUS_COLORS[p.live_status] || '#64748b'}40`,
                                      }}>
                                      {p.live_status}
                                    </span>
                                  </td>
                                  {/* Score */}
                                  <td className="px-6 py-4">
                                    {isFinished && p.score != null ? (
                                      <span className="font-black text-lg text-slate-800">{p.score}</span>
                                    ) : (
                                      <span className="text-slate-300 text-lg">—</span>
                                    )}
                                  </td>
                                  {/* Mission time */}
                                  <td className="px-6 py-4">
                                    {isFinished && p.time_seconds != null ? (
                                      <span className="font-mono font-bold text-slate-700">{p.time_seconds}s</span>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  {/* Judge — screen only */}
                                  <td className="no-print px-6 py-4 text-slate-400 text-xs">{p.judge_name || '—'}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Sheet footer */}
                  <div className="px-8 py-3 border-t border-slate-100 flex items-center justify-between"
                    style={{ background: '#fafafa' }}>
                    <p className="text-xs text-slate-400">
                      {catName}{ageLabel ? ` · ${ageLabel}` : ''} · {tableLabel}
                    </p>
                    <p className="text-xs text-slate-300">MakeX 2026 Lebanon</p>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
