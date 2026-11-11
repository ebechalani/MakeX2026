'use client';

/**
 * The block workspace (Blockly with the mBlock-style blocks of ../blocks).
 *
 * Blockly needs a real browser, so it is loaded here, on the client, after the component has
 * appeared on the page (dynamic import inside useEffect). The rest of the page talks to the
 * workspace through a small "handle" object: get the program, load a program, undo, redo,
 * highlight the running blocks, select a block.
 *
 * The blocks are saved to the browser's storage a moment after every change, so a refresh or a
 * closed tab does not lose the student's work.
 */
import { memo, useEffect, useRef, useState } from 'react';
import type * as BlocklyModule from 'blockly';
import { createEditor, type BlocklyApi } from '../blocks';
import type { ProgramJson } from '../core/types';
import { isProgramJson } from './program-file';
import { programFitScale } from './program-view';
import { loadJson, saveJson } from './storage';

export interface BlocklyEditorHandle {
  /** the blocks as they are right now */
  getProgram: () => ProgramJson;
  /** replace the blocks (can be undone); false when the program could not be shown, the old blocks are kept */
  loadProgram: (program: ProgramJson) => boolean;
  undo: () => void;
  redo: () => void;
  /** show these blocks as "running" (and no others) */
  highlight: (ids: readonly string[]) => void;
  /** scroll to a block and select it; false when it no longer exists */
  selectBlock: (id: string) => boolean;
  /** number of blocks in the workspace (white bubbles not counted) */
  blockCount: () => number;
}

export interface EditorStatus {
  canUndo: boolean;
  canRedo: boolean;
  blocks: number;
}

export interface BlocklyEditorProps {
  /** localStorage key the workspace is saved under */
  storageKey: string;
  /** what to show when nothing has been saved yet */
  initialProgram: () => ProgramJson;
  /** folder with Blockly's own pictures (sprites, cursors), ending with a slash */
  mediaPath: string;
  /** called with the handle once the editor is ready, and with null when it goes away */
  onReady: (handle: BlocklyEditorHandle | null) => void;
  /** called after every change of the blocks */
  onStatus?: (status: EditorStatus) => void;
}

/** Space kept free above and to the left of the program after loading (pixels). */
const PROGRAM_MARGIN = 28;

/** Space kept free to the right of and below the program when it is fitted: the scroll bars live there (pixels). */
const SCROLLBAR_ROOM = 20;

/** The smallest zoom a program is shown at after loading: the text on the blocks is still easy to read. */
const MIN_READABLE_SCALE = 0.6;

/**
 * Show a program that was just loaded (an example, a file, the saved blocks): its top-left
 * corner near the top-left corner of the view, and - when it is too large for the editor at the
 * normal zoom - zoomed out so that all of it can be seen, as far as it stays readable
 * (the exact rule is in ./program-view.ts). It never zooms in beyond the normal zoom.
 */
function showProgram(ws: BlocklyModule.WorkspaceSvg): void {
  const metrics = ws.getMetricsManager();
  const whole = metrics.getContentMetrics(true); // the program at zoom 1
  const view = metrics.getViewMetrics(false); // the visible part of the workspace, in pixels
  const scale = programFitScale({
    contentWidth: whole.width,
    contentHeight: whole.height,
    viewWidth: view.width,
    viewHeight: view.height,
    marginX: PROGRAM_MARGIN + SCROLLBAR_ROOM,
    marginY: PROGRAM_MARGIN + SCROLLBAR_ROOM,
    defaultScale: ws.options.zoomOptions.startScale,
    minScale: MIN_READABLE_SCALE,
  });
  if (Math.abs(scale - ws.scale) > 1e-3) ws.setScale(scale);

  const content = metrics.getContentMetrics(false);
  if (content.width === 0 && content.height === 0) return;
  ws.scroll(PROGRAM_MARGIN - content.left, PROGRAM_MARGIN - content.top);
}

/** Wait this long after the last change before saving (ms). */
const SAVE_DELAY = 400;

/** CSS class (see simulator.css) that makes a block flash, and how long it stays on the block (ms). */
const ATTENTION_CLASS = 'mbot2-attention';
const ATTENTION_MS = 2000;

function BlocklyEditorImpl(props: BlocklyEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const { storageKey, mediaPath } = props;

  useEffect(() => {
    let disposed = false;
    let workspace: BlocklyModule.WorkspaceSvg | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let observer: ResizeObserver | null = null;
    let saveNow: (() => void) | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;

    const setUp = async () => {
      const Blockly: BlocklyApi = await import('blockly');
      const host = hostRef.current;
      if (disposed || !host) return;

      // Blockly's standard palette is used: a category opens its blocks over the workspace and
      // closes again when a block has been dragged out. (The always-open palette of
      // '@blockly/continuous-toolbox' is as wide as its widest block, which would leave almost
      // no room for the program in this half-screen editor.)
      const ws = createEditor(Blockly, host, {
        media: mediaPath,
        // a classroom full of clicking robots is loud enough
        sounds: false,
      });
      workspace = ws;
      const serializer = Blockly.serialization.workspaces;

      // Development only: lets an automated browser test reach the editor (window.__sim).
      // It is never set in the published site.
      if (process.env.NODE_ENV !== 'production') {
        (window as unknown as { __sim?: unknown }).__sim = { Blockly, workspace: ws };
      }

      // ---- show the saved program (or the starting one)
      const saved = loadJson(storageKey, isProgramJson);
      const first = saved ?? propsRef.current.initialProgram();
      try {
        serializer.load(first, ws, { recordUndo: false });
      } catch {
        // a damaged save must not lock the student out: start fresh
        ws.clear();
        try {
          serializer.load(propsRef.current.initialProgram(), ws, { recordUndo: false });
        } catch {
          ws.clear();
        }
      }
      ws.clearUndo();
      showProgram(ws);

      // ---- save and report after every change
      const status = (): EditorStatus => ({
        canUndo: ws.getUndoStack().length > 0,
        canRedo: ws.getRedoStack().length > 0,
        blocks: ws.getAllBlocks(false).filter((b) => !b.isShadow()).length,
      });
      saveNow = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = null;
        saveJson(storageKey, serializer.save(ws));
      };
      ws.addChangeListener((event) => {
        // clicks, scrolling, zooming and opening the palette do not change the program
        if (event.isUiEvent) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveNow?.(), SAVE_DELAY);
        propsRef.current.onStatus?.(status());
      });

      // ---- keep Blockly's drawing area as large as its container
      observer = new ResizeObserver(() => Blockly.svgResize(ws));
      observer.observe(host);

      // ---- the handle the rest of the page uses
      let highlighted: string[] = [];
      const handle: BlocklyEditorHandle = {
        getProgram: () => serializer.save(ws) as ProgramJson,
        loadProgram: (program) => {
          const before = serializer.save(ws);
          Blockly.Events.setGroup(true);
          try {
            serializer.load(program, ws, { recordUndo: true });
          } catch {
            try {
              serializer.load(before, ws, { recordUndo: false });
            } catch {
              ws.clear();
            }
            return false;
          } finally {
            Blockly.Events.setGroup(false);
          }
          highlighted = [];
          showProgram(ws);
          return true;
        },
        undo: () => ws.undo(false),
        redo: () => ws.undo(true),
        highlight: (ids) => {
          for (const id of highlighted) if (!ids.includes(id)) ws.highlightBlock(id, false);
          for (const id of ids) if (!highlighted.includes(id)) ws.highlightBlock(id, true);
          highlighted = [...ids];
        },
        selectBlock: (id) => {
          const block = ws.getBlockById(id);
          if (!block) return false;
          ws.centerOnBlock(id);
          Blockly.common.setSelected(block);
          // Blockly's own mark for a selected block is a thin yellow line, easy to miss on a
          // yellow or orange block: let the block flash for a moment as well (see simulator.css)
          const svg = block.getSvgRoot();
          svg.classList.remove(ATTENTION_CLASS);
          // (reading a size makes the browser notice that the class was gone, so the flash restarts)
          void svg.getBoundingClientRect();
          svg.classList.add(ATTENTION_CLASS);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => svg.classList.remove(ATTENTION_CLASS), ATTENTION_MS);
          return true;
        },
        blockCount: () => status().blocks,
      };

      setPhase('ready');
      propsRef.current.onStatus?.(status());
      propsRef.current.onReady(handle);
    };

    setUp().catch(() => {
      if (!disposed) setPhase('failed');
    });

    const onLeave = () => saveNow?.();
    window.addEventListener('pagehide', onLeave);

    return () => {
      disposed = true;
      window.removeEventListener('pagehide', onLeave);
      if (saveTimer) saveNow?.();
      if (flashTimer) clearTimeout(flashTimer);
      observer?.disconnect();
      propsRef.current.onReady(null);
      workspace?.dispose();
      workspace = null;
    };
  }, [mediaPath, storageKey]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="mbot2-blockly absolute inset-0" />
      {phase !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm text-slate-500" role="status">
          {phase === 'loading' ? 'Loading the blocks…' : 'The block editor could not be loaded. Please reload the page.'}
        </div>
      )}
    </div>
  );
}

export const BlocklyEditor = memo(BlocklyEditorImpl);
