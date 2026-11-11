'use client';

/**
 * The strip of buttons above the block workspace: New, Examples, Open file, Save to file,
 * Undo and Redo.
 */
import { useRef, useState } from 'react';
import type { ProgramJson } from '../core/types';
import { ExamplesIcon, NewFileIcon, OpenIcon, RedoIcon, SaveIcon, UndoIcon } from './icons';
import { button, Modal } from './widgets';

/** A ready-made program offered in the Examples menu. */
export interface ExampleProgram {
  id: string;
  title: string;
  level: 'starter' | 'intermediate' | 'advanced';
  description: string;
  program: ProgramJson;
}

const LEVELS: Array<{ id: ExampleProgram['level']; title: string; blurb: string; badge: string }> = [
  { id: 'starter', title: 'Starter', blurb: 'first steps', badge: 'bg-emerald-100 text-emerald-800' },
  { id: 'intermediate', title: 'Intermediate', blurb: 'one mission from start to finish', badge: 'bg-amber-100 text-amber-800' },
  { id: 'advanced', title: 'Advanced', blurb: 'programs that adapt to the combination', badge: 'bg-rose-100 text-rose-800' },
];

export interface EditorToolbarProps {
  ready: boolean;
  canUndo: boolean;
  canRedo: boolean;
  blocks: number;
  examples: ExampleProgram[];
  onNew: () => void;
  onExample: (example: ExampleProgram) => void;
  /** the text of the file the student picked */
  onOpenFile: (text: string, fileName: string) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const { ready, examples } = props;
  const [examplesOpen, setExamplesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      props.onOpenFile(await file.text(), file.name);
    } catch {
      props.onOpenFile('', file.name);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5" role="toolbar" aria-label="Program">
      <button type="button" className={button.ghost} onClick={props.onNew} disabled={!ready} title="Start a new, empty program">
        <NewFileIcon className="h-4 w-4" />
        New
      </button>

      <button
        type="button"
        className={button.ghost}
        aria-haspopup="dialog"
        onClick={() => setExamplesOpen(true)}
        disabled={!ready}
        title="Load a ready-made program"
      >
        <ExamplesIcon className="h-4 w-4" />
        Examples
      </button>
      {examplesOpen && (
        <Modal title="Examples" onClose={() => setExamplesOpen(false)} widthClass="max-w-3xl">
          <p className="mb-3 text-sm text-slate-600">
            Ready-made programs to run, read and change. Loading one replaces the blocks in your workspace (Undo brings them back).
          </p>
          {examples.length === 0 && <p className="text-sm text-slate-500">No examples are available yet.</p>}
          {LEVELS.map((level) => {
            const list = examples.filter((e) => e.level === level.id);
            if (list.length === 0) return null;
            return (
              <section key={level.id} className="mb-4 last:mb-0" aria-label={`${level.title} examples`}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <span className={`rounded px-1.5 py-0.5 ${level.badge}`}>{level.title}</span>
                  {level.blurb}
                </h3>
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {list.map((example) => (
                    <li key={example.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-bold text-slate-900">{example.title}</p>
                      <p className="flex-1 text-xs leading-relaxed text-slate-600">{example.description}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setExamplesOpen(false);
                          props.onExample(example);
                        }}
                        className={`${button.plain} self-start py-1.5`}
                        aria-label={`Load the example ${example.title}`}
                      >
                        Load this example
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </Modal>
      )}

      <button type="button" className={button.ghost} onClick={() => fileRef.current?.click()} disabled={!ready} title="Open a program file from this computer">
        <OpenIcon className="h-4 w-4" />
        Open
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void pickFile(event.target.files?.[0]);
          // allow picking the same file again later
          event.target.value = '';
        }}
      />
      <button type="button" className={button.ghost} onClick={props.onSave} disabled={!ready} title="Save the program as a file on this computer">
        <SaveIcon className="h-4 w-4" />
        Save
      </button>

      <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />

      <button type="button" className={button.ghost} onClick={props.onUndo} disabled={!ready || !props.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
        <UndoIcon className="h-4 w-4" />
        <span className="hidden xl:inline">Undo</span>
      </button>
      <button type="button" className={button.ghost} onClick={props.onRedo} disabled={!ready || !props.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
        <RedoIcon className="h-4 w-4" />
        <span className="hidden xl:inline">Redo</span>
      </button>

      <span className="ml-auto hidden pr-1 text-xs text-slate-500 xl:inline" title="Your blocks are saved in this browser a moment after every change.">
        {ready ? `${props.blocks} block${props.blocks === 1 ? '' : 's'} · saved automatically` : 'Loading…'}
      </span>
    </div>
  );
}
