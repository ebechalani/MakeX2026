'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { rulesForCategory, type RulesDoc } from '@/lib/rules';
import type { Category, Passation, RulesAcceptance } from '@/lib/types';
import type SignatureCanvasType from 'react-signature-canvas';

const SignatureCanvas = dynamic(() => import('react-signature-canvas'), { ssr: false }) as unknown as React.ComponentType<{
  ref?: React.Ref<SignatureCanvasType>;
  penColor?: string;
  canvasProps?: React.CanvasHTMLAttributes<HTMLCanvasElement>;
}>;

type Props = {
  academyId: string;
  academyName: string;
  passations: Passation[];
  categories: Category[];
};

export default function RulesTab({ academyId, academyName, passations, categories }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [acceptances, setAcceptances] = useState<RulesAcceptance[]>([]);
  const [openCatId, setOpenCatId] = useState<string | null>(null);

  // Categories the academy is competing in (have at least 1 passation)
  const myCategoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of passations) set.add(p.category_id);
    return Array.from(set);
  }, [passations]);

  const myCategories = useMemo(() =>
    categories.filter(c => myCategoryIds.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [categories, myCategoryIds]
  );

  const load = async () => {
    const { data } = await supabase.from('rules_acceptances').select('*').eq('academy_id', academyId);
    if (data) setAcceptances(data as RulesAcceptance[]);
  };

  useEffect(() => { load(); }, [academyId]); // eslint-disable-line react-hooks/exhaustive-deps

  function acceptanceFor(_catId: string, rulesKey: string, version: string) {
    // One signature per rules document covers all categories that share that document
    return acceptances.find(a => a.rules_key === rulesKey && a.rules_version === version);
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <strong>Required:</strong> for each category your students compete in, the coach / academy representative must read the official rules and sign below to confirm acceptance. The signature is recorded with your name and timestamp.
      </div>

      {myCategories.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-400 text-sm">
          You currently have no students assigned to any category — no rules to confirm yet.
        </div>
      )}

      {myCategories.map(cat => {
        const rules = rulesForCategory(cat.name);
        if (!rules) {
          return (
            <div key={cat.id} className="bg-white border border-slate-200 rounded-2xl p-5 opacity-60">
              <h3 className="font-bold text-slate-700">{cat.name} <span className="text-slate-400 font-normal">{cat.age_range_label}</span></h3>
              <p className="text-xs text-slate-400 mt-1">Rules document not yet published for this category. Coming soon.</p>
            </div>
          );
        }
        const acc = acceptanceFor(cat.id, rules.key, rules.version);
        const isOpen = openCatId === cat.id;
        return (
          <div key={cat.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-800">{cat.name} <span className="text-slate-400 font-normal">{cat.age_range_label}</span></h3>
                <p className="text-xs text-slate-500 mt-0.5">{rules.title} · {rules.subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                {acc ? (
                  <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full">
                    ✓ Signed by {acc.signer_name} · {new Date(acc.signed_at).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-full">
                    ⏳ Not yet signed
                  </span>
                )}
                <button onClick={() => setOpenCatId(isOpen ? null : cat.id)}
                  className="text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-white px-4 py-1.5 rounded-lg">
                  {isOpen ? 'Close' : (acc ? 'Review' : 'Read & Sign')}
                </button>
              </div>
            </div>
            {isOpen && (
              <RulesPanel
                rules={rules}
                acceptance={acc}
                academyId={academyId}
                academyName={academyName}
                categoryId={cat.id}
                onSigned={() => { load(); setOpenCatId(null); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RulesPanel({
  rules, acceptance, academyId, academyName, categoryId, onSigned,
}: {
  rules: RulesDoc;
  acceptance?: RulesAcceptance;
  academyId: string;
  academyName: string;
  categoryId: string;
  onSigned: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const sigRef = useRef<SignatureCanvasType | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('Coach');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!rules.htmlUrl) { setHtml(null); return; }
    let cancel = false;
    fetch(rules.htmlUrl).then(r => r.text()).then(t => { if (!cancel) setHtml(t); }).catch(() => {});
    return () => { cancel = true; };
  }, [rules.htmlUrl]);

  async function submit() {
    setErr('');
    if (acceptance) return; // already signed; read-only
    if (!signerName.trim()) { setErr('Please enter your full name.'); return; }
    if (!acknowledged) { setErr('Please confirm you have read and agree to the rules.'); return; }
    if (!sigRef.current || sigRef.current.isEmpty()) { setErr('Please sign in the box below.'); return; }
    setBusy(true);
    const dataUrl = sigRef.current.toDataURL('image/png');
    const { error } = await supabase.from('rules_acceptances').insert({
      academy_id: academyId,
      category_id: categoryId,
      rules_key: rules.key,
      rules_version: rules.version,
      signer_name: signerName.trim(),
      signer_role: signerRole.trim() || null,
      signature_image: dataUrl,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSigned();
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{rules.title} · {rules.subtitle}</p>
        <div className="flex gap-2">
          {rules.docxUrl && (
            <a href={rules.docxUrl} download
              className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200">
              ⬇ Download .docx
            </a>
          )}
          {rules.pdfUrl && (
            <a href={rules.pdfUrl} download target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200">
              ⬇ Download .pdf
            </a>
          )}
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {rules.pdfUrl ? (
          <iframe src={rules.pdfUrl + '#toolbar=1&navpanes=0'} className="w-full" style={{ height: 600 }} title={rules.title} />
        ) : html ? (
          <div className="p-6 max-h-[520px] overflow-y-auto rules-doc">
            <div className="rules-html" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        ) : (
          <p className="p-6 text-sm text-slate-400">Loading rules document…</p>
        )}
      </div>

      {acceptance ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-emerald-900">Already accepted</p>
          <p className="text-xs text-emerald-700 mt-1">
            Signed by <strong>{acceptance.signer_name}</strong>
            {acceptance.signer_role ? <> ({acceptance.signer_role})</> : null}
            {' · '}
            {new Date(acceptance.signed_at).toLocaleString()}
          </p>
          <img src={acceptance.signature_image} alt="signature" className="bg-white rounded mt-2 max-h-24 border border-emerald-300" />
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Confirm acceptance — {academyName}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Your name *</label>
              <input value={signerName} onChange={e => setSignerName(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Role</label>
              <input value={signerRole} onChange={e => setSignerRole(e.target.value)}
                placeholder="Coach / Director / Representative"
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5" />
            <span>I have read and understood the rules above and confirm that all students from <strong>{academyName}</strong> participating in this category will follow them.</span>
          </label>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Signature *</label>
            <div className="bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
              <SignatureCanvas
                ref={sigRef}
                penColor="#0f172a"
                canvasProps={{ width: 600, height: 160, className: 'w-full h-[160px] touch-none' }}
              />
            </div>
            <button type="button" onClick={() => sigRef.current?.clear()}
              className="text-xs text-slate-500 hover:text-slate-700 mt-1">Clear signature</button>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button onClick={submit} disabled={busy}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl">
            {busy ? 'Saving…' : 'Sign & Accept'}
          </button>
        </div>
      )}
    </div>
  );
}
