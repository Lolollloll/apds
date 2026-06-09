/**
 * APDS Input — InputMap
 *
 * Maps serialized key strokes to named editor actions.
 *
 * Design:
 *  - Mutable (LOCK-23 revised): bind()/unbind() mutate in place.
 *    clone() is provided for atomic replacement if needed.
 *  - ActionName is a typed string literal union (C4 approval) — typos
 *    are caught at compile time.
 *  - buildDefaultInputMap(platform) creates a platform-appropriate binding
 *    table (C9 approval). On 'mac', Meta-based shortcuts are used for
 *    undo/redo/copy/cut/paste/selectAll and word movement uses Alt.
 *    On 'other' (Windows/Linux), Ctrl is used throughout.
 */

import { serializeKeyStroke, type KeyEvent } from './KeyEvent';

// ---------------------------------------------------------------------------
// ActionName — typed union (C4 approval)
// ---------------------------------------------------------------------------

export type ActionName =
  // Text insertion
  | 'insertText'
  | 'insertNewline'
  | 'insertTab'
  // Deletion
  | 'deleteBackward'
  | 'deleteForward'
  | 'deleteWordBackward'
  | 'deleteWordForward'
  | 'deleteToLineStart'
  | 'deleteToLineEnd'
  // Cursor movement (no selection)
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'moveToLineStart'
  | 'moveToLineEnd'
  | 'moveToDocStart'
  | 'moveToDocEnd'
  | 'moveWordLeft'
  | 'moveWordRight'
  // Selection extension
  | 'selectLeft'
  | 'selectRight'
  | 'selectUp'
  | 'selectDown'
  | 'selectToLineStart'
  | 'selectToLineEnd'
  | 'selectToDocStart'
  | 'selectToDocEnd'
  | 'selectWordLeft'
  | 'selectWordRight'
  | 'selectAll'
  // History
  | 'undo'
  | 'redo'
  // Clipboard
  | 'copy'
  | 'cut'
  | 'paste'
  // Indent
  | 'dedent';

// ---------------------------------------------------------------------------
// InputMap
// ---------------------------------------------------------------------------

export class InputMap {
  private _bindings: Map<string, ActionName>;

  constructor(platform: 'mac' | 'other' = 'other') {
    this._bindings = new Map();
    this._populateDefaults(platform);
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  /** Look up the action bound to a key event. Returns undefined if unbound. */
  lookup(event: KeyEvent): ActionName | undefined {
    return this._bindings.get(serializeKeyStroke(event));
  }

  /** Look up by raw serialized string (useful for testing). */
  lookupRaw(stroke: string): ActionName | undefined {
    return this._bindings.get(stroke);
  }

  // ── Mutation (LOCK-23 revised) ─────────────────────────────────────────────

  bind(event: KeyEvent, action: ActionName): void {
    this._bindings.set(serializeKeyStroke(event), action);
  }

  bindRaw(stroke: string, action: ActionName): void {
    this._bindings.set(stroke, action);
  }

  unbind(event: KeyEvent): void {
    this._bindings.delete(serializeKeyStroke(event));
  }

  /** Return a deep copy. Useful for atomic replacement on the KeyboardHandler. */
  clone(): InputMap {
    const copy = new InputMap('other'); // base, will be overwritten
    copy._bindings = new Map(this._bindings);
    return copy;
  }

  get size(): number { return this._bindings.size; }

  // ── Default bindings ────────────────────────────────────────────────────────

  private _populateDefaults(platform: 'mac' | 'other'): void {
    const mac = platform === 'mac';

    // Arrows — identical on all platforms
    this._set('ArrowLeft',  'moveLeft');
    this._set('ArrowRight', 'moveRight');
    this._set('ArrowUp',    'moveUp');
    this._set('ArrowDown',  'moveDown');

    // Shift+Arrow — selection
    this._set('Shift+ArrowLeft',  'selectLeft');
    this._set('Shift+ArrowRight', 'selectRight');
    this._set('Shift+ArrowUp',    'selectUp');
    this._set('Shift+ArrowDown',  'selectDown');

    // Enter / Tab / Shift+Tab
    this._set('Enter',     'insertNewline');
    this._set('Tab',       'insertTab');
    this._set('Shift+Tab', 'dedent');

    // Backspace / Delete
    this._set('Backspace', 'deleteBackward');
    this._set('Delete',    'deleteForward');

    if (mac) {
      // macOS: word movement via Alt+Arrow; line/doc via Meta+Arrow
      this._set('Alt+ArrowLeft',         'moveWordLeft');
      this._set('Alt+ArrowRight',        'moveWordRight');
      this._set('Meta+ArrowLeft',        'moveToLineStart');
      this._set('Meta+ArrowRight',       'moveToLineEnd');
      this._set('Meta+ArrowUp',          'moveToDocStart');
      this._set('Meta+ArrowDown',        'moveToDocEnd');

      // Shift selection variants
      this._set('Shift+Alt+ArrowLeft',   'selectWordLeft');
      this._set('Shift+Alt+ArrowRight',  'selectWordRight');
      this._set('Shift+Meta+ArrowLeft',  'selectToLineStart');
      this._set('Shift+Meta+ArrowRight', 'selectToLineEnd');
      this._set('Shift+Meta+ArrowUp',    'selectToDocStart');
      this._set('Shift+Meta+ArrowDown',  'selectToDocEnd');

      // Home/End (also supported on Mac with external keyboards)
      this._set('Home',       'moveToLineStart');
      this._set('End',        'moveToLineEnd');
      this._set('Shift+Home', 'selectToLineStart');
      this._set('Shift+End',  'selectToLineEnd');

      // Word delete
      this._set('Alt+Backspace', 'deleteWordBackward');
      this._set('Alt+Delete',    'deleteWordForward');

      // Edit actions via Meta
      this._set('Meta+z',       'undo');
      this._set('Shift+Meta+z', 'redo');
      this._set('Meta+a',       'selectAll');
      this._set('Meta+c',       'copy');
      this._set('Meta+x',       'cut');
      this._set('Meta+v',       'paste');
    } else {
      // Windows/Linux: word movement via Ctrl+Arrow; line/doc via Home/End/Ctrl+Home/End
      this._set('Ctrl+ArrowLeft',         'moveWordLeft');
      this._set('Ctrl+ArrowRight',        'moveWordRight');
      this._set('Home',                   'moveToLineStart');
      this._set('End',                    'moveToLineEnd');
      this._set('Ctrl+Home',              'moveToDocStart');
      this._set('Ctrl+End',               'moveToDocEnd');

      // Shift selection variants
      this._set('Ctrl+Shift+ArrowLeft',   'selectWordLeft');
      this._set('Ctrl+Shift+ArrowRight',  'selectWordRight');
      this._set('Shift+Home',             'selectToLineStart');
      this._set('Shift+End',              'selectToLineEnd');
      this._set('Ctrl+Shift+Home',        'selectToDocStart');
      this._set('Ctrl+Shift+End',         'selectToDocEnd');

      // Word delete
      this._set('Ctrl+Backspace', 'deleteWordBackward');
      this._set('Ctrl+Delete',    'deleteWordForward');

      // Edit actions via Ctrl
      this._set('Ctrl+z',       'undo');
      this._set('Ctrl+Shift+z', 'redo');
      this._set('Ctrl+y',       'redo');    // Windows alternative
      this._set('Ctrl+a',       'selectAll');
      this._set('Ctrl+c',       'copy');
      this._set('Ctrl+x',       'cut');
      this._set('Ctrl+v',       'paste');
    }
  }

  private _set(stroke: string, action: ActionName): void {
    this._bindings.set(stroke, action);
  }
}

/** Create the platform-appropriate default InputMap. */
export function buildDefaultInputMap(platform: 'mac' | 'other' = 'other'): InputMap {
  return new InputMap(platform);
}
