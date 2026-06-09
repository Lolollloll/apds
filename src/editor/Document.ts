/**
 * APDS Editor — Document
 *
 * Document is the central coordinator. It owns:
 *   - TextBuffer       — raw line storage
 *   - TokenizerEngine  — incremental tokenization
 *   - Selection        — primary cursor/selection
 *   - UndoStack        — undo/redo history
 *
 * Additions (additive — zero existing behavior changes):
 *   - ContentChangeEvent / SelectionChangeEvent event streams
 *   - onDidChangeContent() / onDidChangeSelection() subscriptions
 *   - document.version monotonic counter
 *   - createCursor() / getCursorMovedBy() / getCursorMovedTo() helpers
 *     (needed by EditorActions to move cursors without TextBuffer access)
 *
 * LOCK-9:  All text mutations flow through Document.
 * LOCK-10: TokenizerEngine is private to Document.
 * LOCK-11: EditTransaction is immutable.
 * LOCK-12: All positions use UTF-16 code-unit offsets.
 * LOCK-29: onDidChangeContent fires synchronously, in the same call stack
 *          as the mutation, before the mutating method returns.
 * LOCK-30: ContentChangeEvent and SelectionChangeEvent are orthogonal.
 *          ContentChangeEvent carries no cursor/selection data.
 *          SelectionChangeEvent carries no text content data.
 * LOCK-31: document.version increments exactly once per ContentChangeEvent.
 *          It never decrements. Undo and redo both increment it.
 * LOCK-32: Event payload positions use Position (plain {line,column}),
 *          never Cursor or Selection class instances.
 * LOCK-34: onDidChangeSelection fires for every cursor/selection change,
 *          including changes caused by content mutations.
 */

import { TextBuffer, type Position, type BufferMutation } from './TextBuffer';
import { Cursor } from './Cursor';
import { Selection } from './Selection';
import { UndoStack, type EditTransaction } from './EditTransaction';
import { TokenizerEngine, type LineTokens } from '../tokenizer/tokenizerEngine';

// ---------------------------------------------------------------------------
// Event types (LOCK-30, LOCK-32)
// ---------------------------------------------------------------------------

/** Origin of a document change. */
export type ChangeSource = 'user' | 'undo' | 'redo' | 'api';

/**
 * Character-level range of a text change.
 * Positions are pre-mutation (i.e. in the "before" coordinate space).
 * Matches LSP's Range type exactly.
 */
export interface TextRange {
  readonly startLine:   number;
  readonly startColumn: number;
  readonly endLine:     number;
  readonly endColumn:   number;
}

/**
 * Fired on every text content change (LOCK-29, LOCK-30).
 * Contains NO cursor or selection state — see SelectionChangeEvent.
 *
 * Subscriber guidance:
 *   Renderer cache invalidation  — use mutation (line-splice)
 *   LSP incremental sync         — use range + replacedLength + version
 *   Diagnostics debouncing       — use source + version
 *   Symbol indexers              — use range + source
 *   Find/replace invalidation    — use mutation + version
 *   Collaborative OT/CRDT        — use range + replacedLength + version + source
 */
export interface ContentChangeEvent {
  /**
   * Line-splice description — direct input to RenderCache.onBufferSplice()
   * and TokenizerEngine.onBufferChange(). Preserved from BufferMutation.
   */
  readonly mutation:       BufferMutation;
  /**
   * Character-range of the replaced region in pre-mutation coordinates.
   * Matches LSP ContentChangeEvent.range.
   */
  readonly range:          TextRange;
  /**
   * Character count of the removed text (equivalent to LSP rangeLength).
   * Sufficient for OT without copying the full removed text into the event.
   */
  readonly replacedLength: number;
  /**
   * Monotonic document version (LOCK-31).
   * Starts at 1. Increments once per ContentChangeEvent.
   * Undo and redo each increment it — they produce new content states.
   */
  readonly version:        number;
  /** Origin of this change. */
  readonly source:         ChangeSource;
}

/**
 * Fired on every cursor/selection change (LOCK-30, LOCK-34).
 * Also fires for pure cursor moves with no content change.
 * Contains NO text content — see ContentChangeEvent.
 *
 * Subscriber guidance:
 *   Cursor blink reset           — use cursorAfter
 *   Autocomplete trigger         — use cursorAfter + source
 *   Bracket highlighting         — use cursorAfter
 *   Status bar position display  — use cursorAfter
 *   Decorations (current word)   — use cursorAfter
 *
 * Positions are plain Position values, NOT Cursor class instances (LOCK-32).
 * Subscribers needing a Cursor call doc.createCursor(pos.line, pos.column).
 */
export interface SelectionChangeEvent {
  readonly cursorBefore: Position;
  readonly cursorAfter:  Position;
  readonly anchorBefore: Position;
  readonly anchorAfter:  Position;
  readonly source:       ChangeSource;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export class Document {
  private readonly _buf:       TextBuffer;
  private readonly _engine:    TokenizerEngine;
  private readonly _undoStack: UndoStack = new UndoStack();
  private _selection:          Selection;

  // ── Event system (LOCK-29 through LOCK-34) ──────────────────────────────────
  private _version:           number = 0;
  private readonly _contentListeners:   Set<(e: ContentChangeEvent)   => void> = new Set();
  private readonly _selectionListeners: Set<(e: SelectionChangeEvent) => void> = new Set();

  // ── Construction ──────────────────────────────────────────────────────────

  constructor(initialText = '') {
    this._buf    = new TextBuffer(initialText);
    this._engine = new TokenizerEngine(this._buf.getLines().slice());
    this._selection = Selection.collapsed(Cursor.atStart());
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get lineCount(): number { return this._buf.lineCount; }

  getLine(index: number): string { return this._buf.getLine(index); }

  getText(): string { return this._buf.getText(); }

  get selection(): Selection { return this._selection; }

  get cursor(): Cursor { return this._selection.active; }

  /** Monotonic document version. Increments once per ContentChangeEvent (LOCK-31). */
  get version(): number { return this._version; }

  // ── Token access ────────────────────────────────────────────────────────────

  getLineTokens(line: number): LineTokens {
    return this._engine.getLineTokens(line);
  }

  // ── Event subscriptions (LOCK-29, LOCK-30) ──────────────────────────────────

  /**
   * Subscribe to text content changes.
   * The handler fires synchronously, in the same call stack as the mutation,
   * before the mutating method returns (LOCK-29).
   * @returns Unsubscribe function — call to cancel the subscription.
   */
  onDidChangeContent(handler: (event: ContentChangeEvent) => void): () => void {
    this._contentListeners.add(handler);
    return () => { this._contentListeners.delete(handler); };
  }

  /**
   * Subscribe to cursor and selection changes.
   * Fires for pure cursor moves AND for cursor changes caused by content mutations.
   * @returns Unsubscribe function.
   */
  onDidChangeSelection(handler: (event: SelectionChangeEvent) => void): () => void {
    this._selectionListeners.add(handler);
    return () => { this._selectionListeners.delete(handler); };
  }

  // ── Cursor construction helpers ──────────────────────────────────────────────

  /**
   * Build a Cursor clamped to valid document bounds.
   * Required by EditorActions so it can construct cursors without direct
   * TextBuffer access.
   */
  createCursor(line: number, column: number): Cursor {
    return Cursor.create(this._buf, line, column);
  }

  /**
   * Return the cursor that results from moving `cursor` one step in `direction`.
   * Wraps Cursor.move*() without exposing TextBuffer to the caller.
   */
  getCursorMovedBy(
    cursor: Cursor,
    direction: 'left' | 'right' | 'up' | 'down',
  ): Cursor {
    switch (direction) {
      case 'left':  return cursor.moveLeft(this._buf);
      case 'right': return cursor.moveRight(this._buf);
      case 'up':    return cursor.moveUp(this._buf);
      case 'down':  return cursor.moveDown(this._buf);
    }
  }

  /**
   * Return the cursor moved to a named position within the document.
   * Wraps Cursor.moveTo*() without exposing TextBuffer to the caller.
   */
  getCursorMovedTo(
    cursor: Cursor,
    destination: 'lineStart' | 'lineEnd' | 'docStart' | 'docEnd',
  ): Cursor {
    switch (destination) {
      case 'lineStart': return cursor.moveToLineStart();
      case 'lineEnd':   return cursor.moveToLineEnd(this._buf);
      case 'docStart':  return cursor.moveToDocStart();
      case 'docEnd':    return cursor.moveToDocEnd(this._buf);
    }
  }

  // ── Cursor / Selection movement ───────────────────────────────────────────

  /** Move the cursor without extending the selection. Fires SelectionChangeEvent. */
  moveCursor(cursor: Cursor): void {
    const before = this._selection;
    this._selection = this._selection.moveTo(cursor);
    this._notifySelectionChange(before, this._selection, 'user');
  }

  /** Extend the selection's active end to `cursor`. Fires SelectionChangeEvent. */
  extendSelection(cursor: Cursor): void {
    const before = this._selection;
    this._selection = this._selection.extendTo(cursor);
    this._notifySelectionChange(before, this._selection, 'user');
  }

  /** Collapse selection to the active (caret) end. Fires SelectionChangeEvent. */
  collapseSelection(): void {
    const before = this._selection;
    this._selection = this._selection.collapse();
    this._notifySelectionChange(before, this._selection, 'user');
  }

  // ── Text mutation API ─────────────────────────────────────────────────────

  /**
   * Insert `text` at the current cursor (replaces selection if not collapsed).
   * Fires ContentChangeEvent then SelectionChangeEvent.
   */
  insertText(text: string, allowMerge = false): void {
    const selBefore = this._selection;

    if (!this._selection.isCollapsed) {
      this._replaceSelection(text, allowMerge, 'user');
      this._notifySelectionChange(selBefore, this._selection, 'user');
      return;
    }

    const cursorBefore = this._selection.active.toPosition();
    const mutation     = this._buf.insert(cursorBefore, text);
    this._syncEngine(
      mutation, 'user',
      { startLine: cursorBefore.line, startColumn: cursorBefore.column,
        endLine:   cursorBefore.line, endColumn:   cursorBefore.column },
      0,
    );

    const newCursorPos = this._positionAfterInsert(cursorBefore, text);
    const newCursor    = Cursor.create(this._buf, newCursorPos.line, newCursorPos.column);

    const tx: EditTransaction = {
      start: cursorBefore, end: cursorBefore,
      removedText: '', insertedText: text,
      cursorBefore, cursorAfter: newCursor.toPosition(),
    };
    this._undoStack.push(tx, allowMerge);
    this._selection = Selection.collapsed(newCursor);
    this._notifySelectionChange(selBefore, this._selection, 'user');
  }

  /**
   * Delete text. Deletes selection if non-collapsed, otherwise deletes one character.
   * Fires ContentChangeEvent then SelectionChangeEvent.
   */
  deleteText(direction: 'backward' | 'forward' = 'backward'): void {
    const selBefore = this._selection;

    if (!this._selection.isCollapsed) {
      this._replaceSelection('', false, 'user');
      this._notifySelectionChange(selBefore, this._selection, 'user');
      return;
    }

    const cursor = this._selection.active;
    let start: Cursor;
    let end: Cursor;

    if (direction === 'backward') {
      start = cursor.moveLeft(this._buf);
      end   = cursor;
    } else {
      start = cursor;
      end   = cursor.moveRight(this._buf);
    }

    if (start.equals(end)) return;

    const startPos    = start.toPosition();
    const endPos      = end.toPosition();
    const removedText = this._extractText(startPos, endPos);
    const mutation    = this._buf.delete(startPos, endPos);
    this._syncEngine(
      mutation, 'user',
      { startLine: startPos.line, startColumn: startPos.column,
        endLine:   endPos.line,   endColumn:   endPos.column },
      removedText.length,
    );

    const newCursor = Cursor.create(this._buf, startPos.line, startPos.column);
    const tx: EditTransaction = {
      start: startPos, end: endPos, removedText, insertedText: '',
      cursorBefore: cursor.toPosition(), cursorAfter: newCursor.toPosition(),
    };
    this._undoStack.push(tx, false);
    this._selection = Selection.collapsed(newCursor);
    this._notifySelectionChange(selBefore, this._selection, 'user');
  }

  /**
   * Replace the text in [start, end) with `text`.
   * Fires ContentChangeEvent then SelectionChangeEvent.
   */
  replaceRange(start: Position, end: Position, text: string): void {
    const selBefore = this._selection;

    const s  = this._buf.clamp(start);
    const e  = this._buf.clamp(end);
    const lo = (s.line < e.line || (s.line === e.line && s.column <= e.column)) ? s : e;
    const hi = lo === s ? e : s;

    const removedText = this._extractText(lo, hi);
    const mutation    = this._buf.replace(lo, hi, text);
    this._syncEngine(
      mutation, 'api',
      { startLine: lo.line, startColumn: lo.column,
        endLine:   hi.line, endColumn:   hi.column },
      removedText.length,
    );

    const newCursorPos = this._positionAfterInsert(lo, text);
    const newCursor    = Cursor.create(this._buf, newCursorPos.line, newCursorPos.column);
    const tx: EditTransaction = {
      start: lo, end: hi, removedText, insertedText: text,
      cursorBefore: this._selection.active.toPosition(),
      cursorAfter:  newCursor.toPosition(),
    };
    this._undoStack.push(tx, false);
    this._selection = this._selection.clamp(this._buf);
    this._selection = this._selection.moveTo(newCursor);
    this._notifySelectionChange(selBefore, this._selection, 'api');
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  get canUndo(): boolean { return this._undoStack.canUndo; }
  get canRedo(): boolean { return this._undoStack.canRedo; }

  undo(): boolean {
    const tx = this._undoStack.undo();
    if (!tx) return false;
    const selBefore     = this._selection;
    const postInsertEnd = this._positionAfterInsert(tx.start, tx.insertedText);
    const mutation      = this._buf.replace(tx.start, postInsertEnd, tx.removedText);
    this._syncEngine(
      mutation, 'undo',
      { startLine: tx.start.line,     startColumn: tx.start.column,
        endLine:   postInsertEnd.line, endColumn:   postInsertEnd.column },
      tx.insertedText.length,
    );
    const restoreCursor = Cursor.create(this._buf, tx.cursorBefore.line, tx.cursorBefore.column);
    this._selection = Selection.collapsed(restoreCursor);
    this._notifySelectionChange(selBefore, this._selection, 'undo');
    return true;
  }

  redo(): boolean {
    const tx = this._undoStack.redo();
    if (!tx) return false;
    const selBefore = this._selection;
    const mutation  = this._buf.replace(tx.start, tx.end, tx.insertedText);
    this._syncEngine(
      mutation, 'redo',
      { startLine: tx.start.line, startColumn: tx.start.column,
        endLine:   tx.end.line,   endColumn:   tx.end.column },
      tx.removedText.length,
    );
    const restoreCursor = Cursor.create(this._buf, tx.cursorAfter.line, tx.cursorAfter.column);
    this._selection = Selection.collapsed(restoreCursor);
    this._notifySelectionChange(selBefore, this._selection, 'redo');
    return true;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Forward a buffer mutation to TokenizerEngine and fire ContentChangeEvent. */
  private _syncEngine(
    mutation:       BufferMutation,
    source:         ChangeSource,
    range:          TextRange,
    replacedLength: number,
  ): void {
    this._engine.onBufferChange({
      startLine:        mutation.startLine,
      removedLineCount: mutation.removedLineCount,
      insertedLines:    mutation.insertedLines,
    });
    this._version++;
    if (this._contentListeners.size > 0) {
      const event: ContentChangeEvent = { mutation, range, replacedLength, version: this._version, source };
      for (const h of this._contentListeners) h(event);
    }
  }

  /** Fire SelectionChangeEvent if listeners exist and state actually changed. */
  private _notifySelectionChange(
    before: Selection,
    after:  Selection,
    source: ChangeSource,
  ): void {
    if (this._selectionListeners.size === 0) return;
    // Only fire if something actually changed.
    if (before.anchor.equals(after.anchor) && before.active.equals(after.active)) return;
    const event: SelectionChangeEvent = {
      cursorBefore: before.active.toPosition(),
      cursorAfter:  after.active.toPosition(),
      anchorBefore: before.anchor.toPosition(),
      anchorAfter:  after.anchor.toPosition(),
      source,
    };
    for (const h of this._selectionListeners) h(event);
  }

  /** Replace the current selection with `text`. */
  private _replaceSelection(text: string, allowMerge: boolean, source: ChangeSource): void {
    const { start, end } = this._selection.ordered();
    const removedText    = this._extractText(start, end);
    const mutation       = this._buf.replace(start, end, text);
    this._syncEngine(
      mutation, source,
      { startLine: start.line, startColumn: start.column,
        endLine:   end.line,   endColumn:   end.column },
      removedText.length,
    );

    const newCursorPos = this._positionAfterInsert(start, text);
    const newCursor    = Cursor.create(this._buf, newCursorPos.line, newCursorPos.column);
    const tx: EditTransaction = {
      start, end, removedText, insertedText: text,
      cursorBefore: this._selection.active.toPosition(),
      cursorAfter:  newCursor.toPosition(),
    };
    this._undoStack.push(tx, allowMerge);
    this._selection = Selection.collapsed(newCursor);
    // Caller fires SelectionChangeEvent after _replaceSelection returns.
  }

  /** Compute where the cursor lands after inserting `text` at `pos`. */
  private _positionAfterInsert(pos: Position, text: string): Position {
    const parts = text.split('\n');
    if (parts.length === 1) {
      return { line: pos.line, column: pos.column + text.length };
    }
    return {
      line:   pos.line + parts.length - 1,
      column: parts[parts.length - 1].length,
    };
  }

  /** Extract the raw text in [start, end) from the buffer. */
  private _extractText(start: Position, end: Position): string {
    const s = this._buf.clamp(start);
    const e = this._buf.clamp(end);
    if (s.line === e.line) {
      return this._buf.getLine(s.line).slice(s.column, e.column);
    }
    const parts: string[] = [this._buf.getLine(s.line).slice(s.column)];
    for (let i = s.line + 1; i < e.line; i++) {
      parts.push(this._buf.getLine(i));
    }
    parts.push(this._buf.getLine(e.line).slice(0, e.column));
    return parts.join('\n');
  }
}
