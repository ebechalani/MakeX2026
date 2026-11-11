'use client';

/**
 * The console: what happened during the run (messages from the program, problems found in the
 * blocks, pick-ups, bumps, restarts). A line that belongs to a block can be clicked: the block
 * is then selected in the workspace.
 */
import { useEffect, useRef } from 'react';
import { formatStamp, type LogLevel, type LogLine } from './format';
import { button } from './widgets';

const LEVEL_STYLE: Record<LogLevel, { dot: string; text: string; name: string }> = {
  info: { dot: 'bg-sky-500', text: 'text-slate-800', name: 'Info' },
  event: { dot: 'bg-slate-400', text: 'text-slate-600', name: 'Event' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-900', name: 'Warning' },
  error: { dot: 'bg-rose-600', text: 'text-rose-800', name: 'Error' },
};

export interface ConsolePanelProps {
  logs: LogLine[];
  onClear: () => void;
  /** select the block a line belongs to; false when the block no longer exists */
  onSelectBlock: (blockId: string) => void;
}

export function ConsolePanel({ logs, onClear, onSelectBlock }: ConsolePanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  /** keep showing the newest line, unless the student has scrolled up to read */
  const stickRef = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [logs]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-56 min-h-16 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-xs"
        role="log"
        aria-label="Console"
        tabIndex={0}
      >
        {logs.length === 0 ? (
          <p className="p-2 text-slate-500">Nothing yet. Messages and problems of your program appear here while it runs.</p>
        ) : (
          <ul className="flex flex-col">
            {logs.map((line) => {
              const style = LEVEL_STYLE[line.level];
              const body = (
                <>
                  <span className="shrink-0 font-mono tabular-nums text-slate-400">{formatStamp(line.time)}</span>
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                  <span className={`min-w-0 flex-1 break-words ${style.text} ${line.level === 'error' ? 'font-semibold' : ''}`}>
                    <span className="sr-only">{style.name}: </span>
                    {line.text}
                    {line.count > 1 && <span className="ml-1 rounded bg-slate-200 px-1 font-mono text-[10px] font-bold text-slate-600">×{line.count}</span>}
                  </span>
                </>
              );
              return (
                <li key={line.n}>
                  {line.blockId ? (
                    <button
                      type="button"
                      onClick={() => onSelectBlock(line.blockId as string)}
                      title="Show the block this message is about"
                      className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left underline decoration-dotted underline-offset-2 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-1.5 py-1">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Underlined lines: click to see the block.</p>
        <button type="button" onClick={onClear} disabled={logs.length === 0} className={`${button.ghost} text-xs`}>
          Clear
        </button>
      </div>
    </div>
  );
}
