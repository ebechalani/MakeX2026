'use client';

type FileEntry = { label: string; file: string; type: 'pdf' | 'docx' | 'html' };

type RuleSection = {
  category: string;
  color: string;
  files: FileEntry[];
};

const SECTIONS: RuleSection[] = [
  {
    category: 'Sportswonderland',
    color: 'indigo',
    files: [
      { label: 'Rules',        file: 'sportswonderland_rules.docx',        type: 'docx' },
      { label: 'Rules (HTML)', file: 'sportswonderland_rules.html',        type: 'html' },
      { label: 'Combinations', file: 'sportswonderland_combinations.pdf',  type: 'pdf'  },
    ],
  },
  {
    category: 'Smart Logistics',
    color: 'blue',
    files: [
      { label: 'Rules',         file: 'smartlogistics_rules.docx',      type: 'docx' },
      { label: 'Rules (HTML)',  file: 'smartlogistics_rules.html',      type: 'html' },
      { label: 'Scoresheet',    file: 'smartlogistics_scoresheet.docx', type: 'docx' },
    ],
  },
  {
    category: 'Locker Room',
    color: 'emerald',
    files: [
      { label: 'Rules',        file: 'lockerroom_rules.docx', type: 'docx' },
      { label: 'Rules (HTML)', file: 'lockerroom_rules.html', type: 'html' },
    ],
  },
  {
    category: 'Code Courier',
    color: 'amber',
    files: [
      { label: 'Rules', file: 'codecourier_rules.pdf', type: 'pdf' },
    ],
  },
  {
    category: 'Signal Rise',
    color: 'purple',
    files: [
      { label: 'Rules', file: 'signalrise_rules.pdf', type: 'pdf' },
    ],
  },
  {
    category: 'Soccer',
    color: 'rose',
    files: [
      { label: 'Rules',        file: 'soccer_rules.docx', type: 'docx' },
      { label: 'Rules (HTML)', file: 'soccer_rules.html', type: 'html' },
    ],
  },
];

const TYPE_BADGE: Record<string, string> = {
  pdf:  'bg-red-100 text-red-700 border-red-200',
  docx: 'bg-blue-100 text-blue-700 border-blue-200',
  html: 'bg-slate-100 text-slate-600 border-slate-200',
};

const TYPE_ICON: Record<string, string> = {
  pdf:  '📄',
  docx: '📝',
  html: '🌐',
};

const COLOR_RING: Record<string, string> = {
  indigo:  'border-indigo-200 bg-indigo-50',
  blue:    'border-blue-200 bg-blue-50',
  emerald: 'border-emerald-200 bg-emerald-50',
  amber:   'border-amber-200 bg-amber-50',
  purple:  'border-purple-200 bg-purple-50',
  rose:    'border-rose-200 bg-rose-50',
};

const COLOR_TITLE: Record<string, string> = {
  indigo:  'text-indigo-800',
  blue:    'text-blue-800',
  emerald: 'text-emerald-800',
  amber:   'text-amber-800',
  purple:  'text-purple-800',
  rose:    'text-rose-800',
};

const COLOR_BTN: Record<string, string> = {
  indigo:  'bg-indigo-600 hover:bg-indigo-500',
  blue:    'bg-blue-600 hover:bg-blue-500',
  emerald: 'bg-emerald-600 hover:bg-emerald-500',
  amber:   'bg-amber-500 hover:bg-amber-400',
  purple:  'bg-purple-600 hover:bg-purple-500',
  rose:    'bg-rose-600 hover:bg-rose-500',
};

export default function RulesTab() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-800">Rules & Documents</h2>
        <p className="text-xs text-slate-400 mt-0.5">Download official rules for each category. Click to open in browser or right-click to save.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {SECTIONS.map(sec => (
          <div key={sec.category}
            className={`rounded-2xl border p-5 ${COLOR_RING[sec.color]}`}>
            <h3 className={`font-bold text-base mb-4 ${COLOR_TITLE[sec.color]}`}>
              {sec.category}
            </h3>
            <div className="space-y-2">
              {sec.files.map(f => (
                <a
                  key={f.file}
                  href={`/rules/${f.file}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className={`flex items-center justify-between gap-3 w-full px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition ${COLOR_BTN[sec.color]}`}
                >
                  <span className="flex items-center gap-2">
                    <span>{TYPE_ICON[f.type]}</span>
                    {f.label}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${TYPE_BADGE[f.type]}`}>
                    {f.type}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
