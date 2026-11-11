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

/** Scroll so that the top-left corner of the program sits near the top-left corner of the view. */
function showTopLeft(ws: BlocklyModule.WorkspaceSvg): void {
  const content = ws.getMetricsManager().getContentMetrics(false);
  if (content.width === 0 && content.height === 0) return;
  ws.scroll(PROGRAM_MARGIN - content.left, PROGRAM_MARGIN - content.top);
}

/** Space kept free above and to the left of the program after loading (pixels). */
const PROGRAM_MARGIN = 28;

/** Wait this long after the last change before saving (ms). */
const SAVE_DELAY = 400;

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
      showTopLeft(ws);

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
          showTopLeft(ws);
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
