'use client';
import { use } from 'react';
import { notFound } from 'next/navigation';
import { SCORESHEETS } from './sheets';

export default function PrintableScoresheetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const sheet = SCORESHEETS[key];
  if (!sheet) notFound();
  const Body = sheet.Body;

  return (
    <main className="bg-white text-black min-h-screen">
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
        }
        .sheet { font-family: 'Calibri', 'Helvetica', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px 24px; color: #111; }
        .sheet h1 { font-size: 18pt; margin: 0 0 4px; font-weight: 800; letter-spacing: 0.4px; }
        .sheet h2 { font-size: 12pt; margin: 14px 0 6px; font-weight: 700; border-bottom: 2px solid #111; padding-bottom: 2px; }
        .sheet h3 { font-size: 10pt; margin: 8px 0 4px; font-weight: 700; }
        .sheet p { font-size: 10pt; margin: 4px 0; }
        .sheet .meta { font-size: 9pt; color: #555; }
        .sheet table { border-collapse: collapse; width: 100%; font-size: 10pt; }
        .sheet th, .sheet td { border: 1px solid #333; padding: 5px 7px; vertical-align: top; }
        .sheet th { background: #f4f4f4; font-weight: 700; text-align: left; }
        .sheet .blank { border-bottom: 1px solid #333; display: inline-block; min-width: 120px; }
        .sheet .check { display: inline-block; width: 12px; height: 12px; border: 1.2px solid #111; vertical-align: middle; margin-right: 6px; }
        .sheet .row { display: flex; gap: 18px; flex-wrap: wrap; margin: 6px 0; font-size: 10pt; }
        .sheet .row > div { flex: 1; min-width: 220px; }
        .sheet .sig-row { margin-top: 18px; display: flex; gap: 24px; }
        .sheet .sig-row > div { flex: 1; }
        .sheet .sig-line { border-top: 1px solid #111; padding-top: 4px; font-size: 9pt; color: #333; }
        .sheet .footer { margin-top: 18px; text-align: center; font-size: 8pt; color: #777; }
        .sheet .total-box { float: right; border: 2px solid #111; padding: 6px 10px; font-weight: 700; font-size: 11pt; min-width: 110px; text-align: right; }
        .sheet .small { font-size: 9pt; color: #444; }
      `}</style>
      <div className="no-print sticky top-0 bg-slate-100 border-b border-slate-300 px-4 py-2 flex justify-between items-center">
        <p className="text-sm text-slate-700">Press <kbd className="bg-white border border-slate-300 px-1.5 py-0.5 rounded">Ctrl+P</kbd> (or Cmd+P) to print this scoresheet.</p>
        <button onClick={() => window.print()} className="bg-slate-800 text-white px-4 py-1.5 rounded text-sm font-semibold">Print</button>
      </div>
      <div className="sheet">
        <Body />
      </div>
    </main>
  );
}
