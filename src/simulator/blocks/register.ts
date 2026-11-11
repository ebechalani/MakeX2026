/**
 * Makes the catalog blocks real Blockly blocks. Browser side (it is also safe under Node, where
 * the tests run Blockly "headless" to check that every block definition is accepted).
 *
 * This file never imports Blockly itself: the caller hands the Blockly module in. That keeps the
 * whole blocks/ folder importable anywhere (server-side rendering included) and lets the page
 * decide when to load Blockly.
 *
 *   import * as Blockly from 'blockly';
 *   const workspace = createEditor(Blockly, div);              // does the three steps below
 *
 *   registerBlocks(Blockly);                                   // once, before Blockly.inject
 *   const workspace = Blockly.inject(div, { toolbox: TOOLBOX, ...EDITOR_LOOK });
 *   attachToolboxCallbacks(Blockly, workspace);                // Scratch-like Variables palette
 */
import type * as BlocklyModule from 'blockly';
import { blocklyDefinitions, LIST_VARIABLE_TYPE } from './catalog';
import { EDITOR_LOOK } from './theme';
import { GROUP_GAP, TOOLBOX, toolboxBlock } from './toolbox';
import type { ToolboxItem, ToolboxJson } from './toolbox';

/** The Blockly module, as you get it from `import * as Blockly from 'blockly'`. */
export type BlocklyApi = typeof BlocklyModule;

/** Name of our colour picker field in block definitions. */
export const COLOUR_FIELD_TYPE = 'field_colour';

/** Colours offered by the LED colour picker (rows of 8). */
export const LED_PALETTE: string[] = [
  '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#8000ff', '#ff00ff',
  '#ff8080', '#ffc080', '#ffff80', '#80ff80', '#80ffff', '#8080ff', '#c080ff', '#ff80ff',
  '#800000', '#804000', '#808000', '#008000', '#008080', '#000080', '#400080', '#800080',
  '#ffffff', '#c0c0c0', '#808080', '#404040', '#000000', '#ff0080', '#00ff80', '#0080ff',
];

/** Toolbox button callbacks registered by attachToolboxCallbacks(). */
export const MAKE_VARIABLE_CALLBACK = 'MBOT2_MAKE_VARIABLE';
export const MAKE_LIST_CALLBACK = 'MBOT2_MAKE_LIST';

// =============================================================================================
// Colour picker field (Blockly 11+ no longer ships one)
// =============================================================================================

/**
 * A small field that shows a colour swatch on the block; clicking it opens a palette.
 * Its value is a '#rrggbb' text. Built as a function because the class has to extend
 * Blockly.Field, which we only have once the Blockly module is handed in.
 */
export function createColourFieldClass(Blockly: BlocklyApi) {
  const SWATCH_WIDTH = 28;

  class FieldColour extends Blockly.Field<string> {
    /** the value is saved with the program */
    override SERIALIZABLE = true;

    constructor(value?: string, validator?: BlocklyModule.FieldValidator<string> | null, config?: BlocklyModule.FieldConfig) {
      super(Blockly.Field.SKIP_SETUP);
      if (config) this.configure_(config);
      this.setValue(value ?? '#ff0000');
      if (validator) this.setValidator(validator);
    }

    /** Called by Blockly for `{ "type": "field_colour", "colour": "#ff0000" }` in a block definition. */
    static override fromJson(options: BlocklyModule.FieldConfig & { colour?: string }): FieldColour {
      return new FieldColour(options.colour, undefined, options);
    }

    protected override initView(): void {
      this.createBorderRect_();
      const rect = this.getBorderRect();
      rect.style.fillOpacity = '1';
      rect.setAttribute('stroke', '#ffffff');
      rect.setAttribute('stroke-width', '1.5');
      rect.style.cursor = 'pointer';
    }

    override applyColour(): void {
      if (this.borderRect_) this.borderRect_.style.fill = this.getValue() ?? '#000000';
    }

    /** The swatch has a fixed size (there is no text to measure). */
    protected override updateSize_(): void {
      const constants = this.getConstants();
      const height = constants ? constants.FIELD_BORDER_RECT_HEIGHT : 16;
      this.size_ = new Blockly.utils.Size(SWATCH_WIDTH, height);
      this.positionBorderRect_();
    }

    protected override doClassValidation_(newValue?: unknown): string | null {
      if (typeof newValue !== 'string') return null;
      return Blockly.utils.colour.parse(newValue);
    }

    protected override doValueUpdate_(newValue: string): void {
      this.value_ = newValue;
      if (this.borderRect_) this.borderRect_.style.fill = newValue;
    }

    override getText(): string {
      return this.getValue() ?? '';
    }

    /** Open the palette under the field. */
    protected override showEditor_(): void {
      Blockly.DropDownDiv.clearContent();
      Blockly.DropDownDiv.getContentDiv().appendChild(this.createPalette());
      Blockly.DropDownDiv.setColour('#ffffff', '#cccccc');
      Blockly.DropDownDiv.showPositionedByField<string>(this);
    }

    private createPalette(): HTMLElement {
      const current = (this.getValue() ?? '').toLowerCase();
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(8, 26px)';
      grid.style.gap = '4px';
      grid.style.padding = '8px';
      for (const colour of LED_PALETTE) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.title = colour;
        cell.setAttribute('aria-label', colour);
        cell.style.width = '26px';
        cell.style.height = '26px';
        cell.style.padding = '0';
        cell.style.borderRadius = '6px';
        cell.style.cursor = 'pointer';
        cell.style.background = colour;
        cell.style.border = colour === current ? '3px solid #333333' : '1px solid #bbbbbb';
        cell.addEventListener('click', () => {
          this.setValue(colour);
          Blockly.DropDownDiv.hideIfOwner<string>(this);
        });
        grid.appendChild(cell);
      }
      return grid;
    }
  }

  return FieldColour;
}

// =============================================================================================
// Registration
// =============================================================================================

/**
 * Define every catalog block in Blockly. Safe to call more than once (for example when a React
 * component mounts again): what already exists is left alone.
 */
export function registerBlocks(Blockly: BlocklyApi): void {
  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, COLOUR_FIELD_TYPE)) {
    Blockly.fieldRegistry.register(COLOUR_FIELD_TYPE, createColourFieldClass(Blockly));
  }

  const missing = blocklyDefinitions().filter((def) => !(String(def.type) in Blockly.Blocks));
  if (missing.length > 0) Blockly.common.defineBlocksWithJsonArray(missing);

  usePlainTextBubble(Blockly);

  applyScratchWording(Blockly);
}

/**
 * Blockly's own "text" block draws quote marks around its text box, which makes the bubble of a
 * text slot look like a green block. Scratch shows a plain white bubble, the same as for numbers.
 * We swap the definition for one without the quote marks; type name and field name stay the
 * same ('text' / 'TEXT'), so saved programs are not affected.
 */
function usePlainTextBubble(Blockly: BlocklyApi): void {
  const marker = 'mbot2PlainText';
  const current = Blockly.Blocks['text'] as Record<string, unknown> | undefined;
  if (current && current[marker]) return;
  const plain = Blockly.common.createBlockDefinitionsFromJsonArray([
    {
      type: 'text',
      message0: '%1',
      args0: [{ type: 'field_input', name: 'TEXT', text: '' }],
      output: 'String',
      style: 'text_blocks',
      tooltip: 'A text. Click to type.',
    },
  ])['text'] as Record<string, unknown>;
  plain[marker] = true;
  Blockly.Blocks['text'] = plain;
}

/** Scratch / mBlock words for the Blockly built-ins we show (My Blocks, variable dialogs). */
function applyScratchWording(Blockly: BlocklyApi): void {
  const msg = Blockly.Msg as Record<string, string>;
  msg.PROCEDURES_DEFNORETURN_TITLE = 'define';
  msg.PROCEDURES_DEFNORETURN_PROCEDURE = 'my block';
  msg.PROCEDURES_DEFNORETURN_TOOLTIP = 'Make your own block: the blocks inside run each time the block is used.';
  msg.PROCEDURES_DEFRETURN_TITLE = 'define';
  msg.PROCEDURES_DEFRETURN_PROCEDURE = 'my value';
  msg.PROCEDURES_DEFRETURN_TOOLTIP = 'Make your own round block: it runs the blocks inside and gives back a value.';
  msg.PROCEDURES_CALLNORETURN_TOOLTIP = "Runs your block '%1'.";
  msg.PROCEDURES_CALLRETURN_TOOLTIP = "Runs your block '%1' and uses the value it gives back.";
  msg.NEW_VARIABLE = 'Make a Variable';
  msg.NEW_VARIABLE_TITLE = 'New variable name:';
}

// =============================================================================================
// The Variables palette (dynamic toolbox category)
// =============================================================================================

type VariableModel = BlocklyModule.IVariableModel<BlocklyModule.IVariableState>;

function byName(a: VariableModel, b: VariableModel): number {
  return a.getName().localeCompare(b.getName());
}

/**
 * Content of the Variables category, Scratch style: a "Make a Variable" button, one round block
 * per variable, "set" / "change" blocks; then the same for lists.
 */
export function variablesFlyout(workspace: BlocklyModule.Workspace): ToolboxItem[] {
  const map = workspace.getVariableMap();
  const variables = [...map.getVariablesOfType('')].sort(byName);
  const lists = [...map.getVariablesOfType(LIST_VARIABLE_TYPE)].sort(byName);
  const ref = (v: VariableModel): { id: string; name: string; type: string } => ({ id: v.getId(), name: v.getName(), type: v.getType() });

  const items: ToolboxItem[] = [{ kind: 'button', text: 'Make a Variable', callbackkey: MAKE_VARIABLE_CALLBACK }];
  for (const variable of variables) items.push(toolboxBlock('data_variable', { VARIABLE: ref(variable) }));
  if (variables.length > 0) {
    const first = ref(variables[0]);
    items.push({ kind: 'sep', gap: GROUP_GAP });
    items.push(toolboxBlock('data_setvariableto', { VARIABLE: first }));
    items.push(toolboxBlock('data_changevariableby', { VARIABLE: first }));
  }

  items.push({ kind: 'button', text: 'Make a List', callbackkey: MAKE_LIST_CALLBACK });
  for (const list of lists) items.push(toolboxBlock('data_listcontents', { LIST: ref(list) }));
  if (lists.length > 0) {
    const first = ref(lists[0]);
    items.push({ kind: 'sep', gap: GROUP_GAP });
    for (const type of [
      'data_addtolist',
      'data_deleteoflist',
      'data_deletealloflist',
      'data_insertatlist',
      'data_replaceitemoflist',
      'data_itemoflist',
      'data_itemnumoflist',
      'data_lengthoflist',
      'data_listcontainsitem',
    ]) {
      items.push(toolboxBlock(type, { LIST: first }));
    }
  }
  return items;
}

/**
 * Call once after Blockly.inject(): replaces Blockly's standard Variables palette by the
 * Scratch-like one above and wires its two buttons. Without this call the Variables category
 * still works, with Blockly's plain variable blocks (the interpreter understands those too).
 */
export function attachToolboxCallbacks(Blockly: BlocklyApi, workspace: BlocklyModule.WorkspaceSvg): void {
  workspace.registerToolboxCategoryCallback('VARIABLE', (ws) => variablesFlyout(ws) as BlocklyModule.utils.toolbox.FlyoutDefinition);
  workspace.registerButtonCallback(MAKE_VARIABLE_CALLBACK, (button) => {
    Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace(), undefined, '');
  });
  workspace.registerButtonCallback(MAKE_LIST_CALLBACK, (button) => {
    // Blockly has one question for this dialog ("New variable name:"); it reads the text at the
    // moment the dialog opens, so for a list the wording is swapped just for that moment.
    const msg = Blockly.Msg as Record<string, string>;
    const question = msg.NEW_VARIABLE_TITLE;
    msg.NEW_VARIABLE_TITLE = 'New list name:';
    try {
      Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace(), undefined, LIST_VARIABLE_TYPE);
    } finally {
      msg.NEW_VARIABLE_TITLE = question;
    }
  });
  // show the new palette straight away
  workspace.getToolbox()?.refreshSelection();
}

// =============================================================================================
// White bubbles for "My Blocks"
// =============================================================================================

/** The value slots of Blockly's my-block blocks that should hold a bubble to type into. */
function slotsToFill(block: BlocklyModule.Block): BlocklyModule.Input[] {
  switch (block.type) {
    case 'procedures_callnoreturn':
    case 'procedures_callreturn':
      // one slot per parameter: ARG0, ARG1 ...
      return block.inputList.filter((input) => input.name.startsWith('ARG'));
    case 'procedures_defreturn':
      return block.inputList.filter((input) => input.name === 'RETURN');
    case 'procedures_ifreturn':
      return block.inputList.filter((input) => input.name === 'VALUE');
    default:
      return [];
  }
}

/**
 * Blockly leaves the value slots of a my-block call (and of "return") as empty holes, and our
 * palette has no loose number block to plug into them. Scratch and mBlock show a white bubble
 * there instead: type a number or a word, or drop a round block on it. This gives every such slot
 * its bubble, when the block is dragged out of the palette and whenever the parameters of a
 * my-block change. Call once after Blockly.inject().
 */
export function addBubblesToMyBlocks(Blockly: BlocklyApi, workspace: BlocklyModule.WorkspaceSvg): void {
  const fill = (id: string | undefined): void => {
    const block = id ? workspace.getBlockById(id) : null;
    if (!block || block.isInFlyout) return;
    for (const input of slotsToFill(block)) {
      const connection = input.connection;
      if (!connection) continue;
      const known = connection.getShadowState();
      if (known) {
        // The slot knows its bubble. It can still be missing: Blockly takes the bubble away when
        // a parameter is moved or removed in the gear dialog of the my-block. Put it back.
        if (!connection.targetBlock()) connection.setShadowState(known);
        continue;
      }
      // The bubble always gets the same id for the same slot. Undo / redo count on that: after
      // "undo" has removed the block and "redo" has put it back, a later step ("typed 25 into the
      // bubble") must find its bubble again.
      const bubbleId = `${block.id}_${input.name}`;
      const state: BlocklyModule.serialization.blocks.State = { type: 'text', fields: { TEXT: '' } };
      if (!workspace.getBlockById(bubbleId)) state.id = bubbleId;
      connection.setShadowState(state);
    }
  };
  workspace.addChangeListener((event: BlocklyModule.Events.Abstract) => {
    if (event.type === Blockly.Events.BLOCK_CREATE) {
      for (const id of (event as BlocklyModule.Events.BlockCreate).ids ?? []) fill(id);
    } else if (event.type === Blockly.Events.BLOCK_CHANGE) {
      // the parameters of a my-block were changed: its calls got new slots
      const change = event as BlocklyModule.Events.BlockChange;
      if (change.element === 'mutation') fill(change.blockId);
    }
  });
}

// =============================================================================================
// One call that sets up a complete editor
// =============================================================================================

export interface EditorOptions extends Omit<BlocklyModule.BlocklyOptions, 'toolbox'> {
  /** defaults to the complete TOOLBOX; pass buildToolbox([...]) for a smaller one */
  toolbox?: ToolboxJson;
}

/**
 * Register the blocks, create a Blockly workspace inside `container` with the mBlock toolbox and
 * look, and install the Scratch-like Variables palette and the bubbles of the my-block slots. Any
 * Blockly option can be overridden
 * (readOnly, media, plugins: CONTINUOUS_TOOLBOX_PLUGINS, zoom ...).
 */
export function createEditor(Blockly: BlocklyApi, container: Element | string, options: EditorOptions = {}): BlocklyModule.WorkspaceSvg {
  registerBlocks(Blockly);
  const { toolbox = TOOLBOX, ...rest } = options;
  const workspace = Blockly.inject(container, {
    ...EDITOR_LOOK,
    ...rest,
    // our toolbox type is a strict subset of Blockly's loosely typed toolbox JSON
    toolbox: toolbox as unknown as BlocklyModule.utils.toolbox.ToolboxDefinition,
  });
  attachToolboxCallbacks(Blockly, workspace);
  addBubblesToMyBlocks(Blockly, workspace);
  return workspace;
}
