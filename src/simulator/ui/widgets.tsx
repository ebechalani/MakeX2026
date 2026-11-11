'use client';

/**
 * Building blocks shared by the simulator screens: button looks, a section that folds open and
 * shut, a dialog window and a small pop-up panel.
 */
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronIcon, CloseIcon } from './icons';

// =============================================================================================
// Button looks (Tailwind class lists)
// =============================================================================================

const BUTTON_BASE =
  'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-semibold transition ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

export const button = {
  /** white button with a thin border: the everyday button */
  plain: `${BUTTON_BASE} border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100`,
  /** small square button that only shows an icon */
  icon: `${BUTTON_BASE} h-9 w-9 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100`,
  /** the main action of a dialog */
  primary: `${BUTTON_BASE} bg-sky-600 px-4 py-2 text-sm text-white shadow-sm hover:bg-sky-700 active:bg-sky-800`,
  /** text-only button inside toolbars */
  ghost: `${BUTTON_BASE} px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200`,
} as const;

/** A two-state button (pressed / not pressed), e.g. "show zones". */
export function toggleClass(on: boolean): string {
  return (
    `${BUTTON_BASE} gap-1.5 border px-2.5 py-1.5 text-xs ` +
    (on
      ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700'
      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
  );
}

// =============================================================================================
// Section that folds open and shut
// =============================================================================================

export interface SectionProps {
  title: string;
  /** short text shown on the right of the title, also while the section is closed */
  summary?: ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export function Section({ title, summary, open, onToggle, children }: SectionProps) {
  const bodyId = useId();
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(!open)}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <ChevronIcon open={open} className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="shrink-0">{title}</span>
          {summary !== undefined && <span className="ml-auto min-w-0 truncate text-xs font-medium text-slate-500">{summary}</span>}
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="border-t border-slate-100 p-3">
          {children}
        </div>
      )}
    </section>
  );
}

// =============================================================================================
// Dialog window
// =============================================================================================

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class of the window */
  widthClass?: string;
}

/** A window on top of the page. Escape or a click beside it closes it; Tab stays inside. */
export function Modal({ title, onClose, children, widthClass = 'max-w-lg' }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-1.5rem)] w-full ${widthClass} flex-col rounded-2xl bg-white shadow-2xl outline-none`}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id={titleId} className="text-base font-bold text-slate-900">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`${button.icon} ml-auto h-8 w-8 border-transparent`}>
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// =============================================================================================
// Pop-up panel under a button
// =============================================================================================

/**
 * Open / closed state of a small panel that belongs to a button. A click anywhere else or the
 * Escape key closes it. Put `ref` on the element that wraps both the button and the panel.
 */
export function usePopover<T extends HTMLElement>(): { open: boolean; setOpen: (open: boolean) => void; ref: RefObject<T | null> } {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}
