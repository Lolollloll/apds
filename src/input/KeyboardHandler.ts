/**
 * APDS Input — KeyboardHandler
 *
 * Translates KeyEvents into editor actions.
 *
 * Dispatch flow:
 *  1. Serialize the event → keystroke string.
 *  2. Look up in InputMap → ActionName | undefined.
 *  3a. If found → dispatch to EditorActions.
 *  3b. If not found AND key is printable (LOCK-27) → insertText(event.key).
 *  3c. Otherwise → return false (unhandled; host may apply browser default).
 *
 * LOCK-27: isPrintable = event.key.length === 1 && !event.ctrl && !event.meta
 */

import { isPrintable, type KeyEvent }       from './KeyEvent';
import { type InputMap, type ActionName }   from './InputMap';
import { type EditorActions }               from './EditorActions';

export class KeyboardHandler {
  private _inputMap: InputMap;
  private readonly _actions: EditorActions;

  constructor(actions: EditorActions, inputMap: InputMap) {
    this._actions  = actions;
    this._inputMap = inputMap;
  }

  /** Replace the active input map atomically (e.g. after user rebinds a key). */
  setInputMap(map: InputMap): void {
    this._inputMap = map;
  }

  /**
   * Handle a key event.
   * @returns true if the event was handled (host should call preventDefault()),
   *          false if the host should apply its default behaviour.
   */
  handleKey(event: KeyEvent): boolean {
    // Step 1+2: InputMap lookup.
    const action = this._inputMap.lookup(event);
    if (action !== undefined) {
      this._dispatch(action, event);
      return true;
    }

    // Step 3b: Printable character fallthrough (LOCK-27).
    if (isPrintable(event)) {
      this._actions.insertText(event.key);
      return true;
    }

    // Step 3c: Unhandled.
    return false;
  }

  private _dispatch(action: ActionName, _event: KeyEvent): void {
    switch (action) {
      // Insertion
      case 'insertText':    this._actions.insertText(_event.key); break;
      case 'insertNewline': this._actions.insertNewline(); break;
      case 'insertTab':     this._actions.insertTab(); break;

      // Deletion
      case 'deleteBackward':     this._actions.deleteBackward(); break;
      case 'deleteForward':      this._actions.deleteForward(); break;
      case 'deleteWordBackward': this._actions.deleteWordBackward(); break;
      case 'deleteWordForward':  this._actions.deleteWordForward(); break;
      case 'deleteToLineStart':  this._actions.deleteToLineStart(); break;
      case 'deleteToLineEnd':    this._actions.deleteToLineEnd(); break;

      // Movement
      case 'moveLeft':       this._actions.moveLeft(); break;
      case 'moveRight':      this._actions.moveRight(); break;
      case 'moveUp':         this._actions.moveUp(); break;
      case 'moveDown':       this._actions.moveDown(); break;
      case 'moveToLineStart': this._actions.moveToLineStart(); break;
      case 'moveToLineEnd':   this._actions.moveToLineEnd(); break;
      case 'moveToDocStart':  this._actions.moveToDocStart(); break;
      case 'moveToDocEnd':    this._actions.moveToDocEnd(); break;
      case 'moveWordLeft':   this._actions.moveWordLeft(); break;
      case 'moveWordRight':  this._actions.moveWordRight(); break;

      // Selection
      case 'selectLeft':        this._actions.selectLeft(); break;
      case 'selectRight':       this._actions.selectRight(); break;
      case 'selectUp':          this._actions.selectUp(); break;
      case 'selectDown':        this._actions.selectDown(); break;
      case 'selectToLineStart': this._actions.selectToLineStart(); break;
      case 'selectToLineEnd':   this._actions.selectToLineEnd(); break;
      case 'selectToDocStart':  this._actions.selectToDocStart(); break;
      case 'selectToDocEnd':    this._actions.selectToDocEnd(); break;
      case 'selectWordLeft':    this._actions.selectWordLeft(); break;
      case 'selectWordRight':   this._actions.selectWordRight(); break;
      case 'selectAll':         this._actions.selectAll(); break;

      // History
      case 'undo': this._actions.undo(); break;
      case 'redo': this._actions.redo(); break;

      // Clipboard — fire and forget (async; host handles Promise if needed)
      case 'copy':  void this._actions.copy(); break;
      case 'cut':   void this._actions.cut(); break;
      case 'paste': void this._actions.pasteFromClipboard(); break;

      // Indent
      case 'dedent': this._actions.dedent(); break;
    }
  }
}
