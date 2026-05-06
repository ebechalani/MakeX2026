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
          @page { size: A4; margin: 8mm; }
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          .sheet { padding: 0 !important; max-width: 100% !important; }
        }
        .sheet { font-family: 'Calibri', 'Helvetica', sans-serif; max-width: 760px; margin: 0 auto; padding: 14px 20px; color: #111; }
        .sheet h1 { font-size: 14pt; margin: 0 0 2px; font-weight: 800; letter-spacing: 0.3px; line-height: 1.15; }
        .sheet h2 { font-size: 10pt; margin: 7px 0 3px; font-weight: 700; border-bottom: 1.5px solid #111; padding-bottom: 1px; }
        .sheet h3 { font-size: 9pt; margin: 5px 0 2px; font-weight: 700; }
        .sheet p { font-size: 8.5pt; margin: 2px 0; line-height: 1.25; }
        .sheet .meta { font-size: 7.5pt; color: #555; }
        .sheet table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
        .sheet th, .sheet td { border: 0.6px solid #333; padding: 2px 5px; vertical-align: top; line-height: 1.2; }
        .sheet th { background: #f4f4f4; font-weight: 700; text-align: left; }
        .sheet .blank { border-bottom: 1px solid #333; display: inline-block; min-width: 120px; }
        .sheet .check { display: inline-block; width: 10px; height: 10px; border: 1px solid #111; vertical-align: middle; margin-right: 4px; }
        .sheet .row { display: flex; gap: 14px; flex-wrap: wrap; margin: 4px 0; font-size: 8.5pt; }
        .sheet .row > div { flex: 1; min-width: 200px; }
        .sheet .sig-row { margin-top: 10px; display: flex; gap: 20px; }
        .sheet .sig-row > div { flex: 1; height: 32px; }
        .sheet .sig-line { border-top: 1px solid #111; padding-top: 2px; font-size: 7.5pt; color: #333; }
        .sheet .footer { margin-top: 8px; text-align: center; font-size: 7pt; color: #777; }
        .sheet .total-box { float: right; border: 1.5px solid #111; padding: 4px 8px; font-weight: 700; font-size: 10pt; min-width: 110px; text-align: right; }
        .sheet .small { font-size: 7.5pt; color: #444; margin: 1px 0; }
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
