'use client';

/**
 * The "combination" (the random starting arrangement the referee draws before a match):
 * its short code, buttons to draw a random one or go back to the default, a box to type in a
 * code from the board, and - passed in by the game - a small editor to set it up by hand.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Game } from '../core/types';
import { CopyIcon, DiceIcon } from './icons';
import { button } from './widgets';

export interface CombinationPanelProps<S> {
  game: Game<S>;
  scenario: S;
  onChange: (scenario: S) => void;
  /** the game's own editor for the combination */
  children?: ReactNode;
}

export function CombinationPanel<S>({ game, scenario, onChange, children }: CombinationPanelProps<S>) {
  const code = game.encodeScenario(scenario);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = typed.trim();
    if (text === '') return;
    const decoded = game.decodeScenario(text);
    if (!decoded) {
      setError(`"${text}" is not a combination code. A code looks like ${game.encodeScenario(game.defaultScenario())}.`);
      return;
    }
    setError(null);
    setTyped('');
    onChange(decoded);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // copying is a convenience; the code can still be read and typed
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-sm font-bold tracking-wide text-white" aria-label={`Combination code ${code}`}>
          {code}
        </span>
        <button type="button" onClick={() => void copy()} className={button.icon} aria-label="Copy the combination code" title="Copy the code">
          <CopyIcon className="h-4 w-4" />
        </button>
        {copied && (
          <span className="text-xs font-semibold text-emerald-700" role="status">
            Copied
          </span>
        )}
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={() => onChange(game.randomScenario(Math.random))} className={button.plain} title="Draw a random combination, like the referee does">
            <DiceIcon className="h-4 w-4 text-sky-600" />
            Random
          </button>
          <button type="button" onClick={() => onChange(game.defaultScenario())} className={button.plain} title="The combination drawn in the rule book">
            Default
          </button>
        </span>
      </div>

      {children}

      <form onSubmit={submit} className="flex flex-col gap-1">
        <label htmlFor="combination-code" className="text-xs font-semibold text-slate-600">
          Enter a code
        </label>
        <div className="flex gap-2">
          <input
            id="combination-code"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setError(null);
            }}
            placeholder={game.encodeScenario(game.defaultScenario())}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== null}
            aria-describedby={error ? 'combination-code-error' : undefined}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-sm uppercase placeholder:normal-case placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          />
          <button type="submit" className={button.plain} disabled={typed.trim() === ''}>
            Use
          </button>
        </div>
        {error && (
          <p id="combination-code-error" role="alert" className="text-xs font-medium text-rose-700">
            {error}
          </p>
        )}
      </form>

      <p className="text-xs text-slate-500">
        {game.scenarioCount().toLocaleString('en')} combinations are possible. Changing the combination puts the field back to the start.
      </p>
    </div>
  );
}
