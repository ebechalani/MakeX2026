/**
 * The mBlock-style block language of the simulator.
 *
 *   catalog.ts   every block as plain data (no Blockly, no DOM)
 *   toolbox.ts   the palette on the left (plain JSON)
 *   theme.ts     Scratch / mBlock look (plain JSON)
 *   register.ts  registerBlocks(Blockly) + the Scratch-like Variables palette (needs the Blockly module)
 *
 * Typical use in a client component:
 *
 *   import * as Blockly from 'blockly';
 *   import { createEditor } from '@/simulator/blocks';
 *
 *   const workspace = createEditor(Blockly, div);                       // blocks + toolbox + look
 *   const program = Blockly.serialization.workspaces.save(workspace);   // -> createVM(program, io)
 *   Blockly.serialization.workspaces.load(program, workspace);          // show a saved program
 */
export * from './catalog';
export * from './toolbox';
export * from './theme';
export * from './register';
