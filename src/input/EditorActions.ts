/**
 * APDS Input — EditorActions
 *
 * All named editor action implementations. Each action:
 *  1. Reads document state via the public Document API.
 *  2. Mutates text or cursor exclusively through Document's public methods.
 *  3. Returns void — Document events propagate changes to subscribers
 *     (Renderer, diagnostics, etc.) automatically via onDidChangeContent /
 *     onDidChangeSelection (LOCK-24 revised, LOCK-29).
 *
 * LOCK-21: All text mutations go through Document's public mutation API only.
 *          No direct TextBuffer, TokenizerEngine, or RenderCache access.
 * LOCK-24: EditorActions does not call Renderer.notifyEdit().
 *          Document event subscriptions handle renderer synchronization.
 * LOCK-25: Word boundary detection is a pure function of
 *          (lineText, column, direction). No document state is read inside it.
 * LOCK-26: Arrow movement with a non-collapsed selection collapses to the
 *          selection boundary without additional movement.
 *          Shift+Arrow always extends the active end from its current position.
 * LOCK-28: copy() and cut() both return Promise<void>.
 */

import type { Document } from '../editor/Document';
import type { Position }  from '../editor/TextBuffer';

// ---------------------------------------------------------------------------
// ClipboardAdapter (injectable for testing)
// ---------------------------------------------------------------------------

export interface ClipboardAdapter {
  read():                  Promise<string>;
  write(text: string):     Promise<void>;
}

/** In-memory clipboard for testing (no browser dependency). */
export class MemoryClipboard implements ClipboardAdapter {
  private _text = '';
  async read():               Promise<string> { return this._text; }
  async write(text: string):  Promise<void>   { this._text = text; }
  get contents(): string { return this._text; }
}

// ---------------------------------------------------------------------------
// Word boundary detection (LOCK-25)
// ---------------------------------------------------------------------------

function isIdentChar(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch);
}

/**
 * Find the column of the previous word boundary moving left from `col`.
 * Pure function — no external state reads (LOCK-25).
 */
export function wordBoundaryLeft(text: string, col: number): number {
  if (col <= 0) return 0;
  let c = col - 1;
  // Skip trailing whitespace
  while (c > 0 && (text[c] === ' ' || text[c] === '\t')) c--;
  if (c <= 0) return 0;
  if (isIdentChar(text[c])) {
    // Skip backwards through identifier chars
    while (c > 0 && isIdentChar(text[c - 1])) c--;
  } else {
    // Skip backwards through a run of operator/punctuation chars
    while (c > 0 && !isIdentChar(text[c - 1]) && text[c - 1] !== ' ' && text[c - 1] !== '\t') c--;
  }
  return c;
}

/**
 * Find the column of the next word boundary moving right from `col`.
 * Pure function — no external state reads (LOCK-25).
 */
export function wordBoundaryRight(text: string, col: number): number {
  const len = text.length;
  if (col >= len) return len;
  let c = col;
  // Skip leading whitespace
  while (c < len && (text[c] === ' ' || text[c] === '\t')) c++;
  if (c >= len) return len;
  if (isIdentChar(text[c])) {
    // Skip forwards through identifier chars
    while (c < len && isIdentChar(text[c])) c++;
  } else {
    // Skip forwards through a run of operator/punctuation chars
    while (c < len && !isIdentChar(text[c]) && text[c] !== ' ' && text[c] !== '\t') c++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Internal helper — extract text from a range via public Document API
// ---------------------------------------------------------------------------

function extractRange(doc: Document, start: Position, end: Position): string {
  if (start.line === end.line) {
    return doc.getLine(start.line).slice(start.column, end.column);
  }
  const parts: string[] = [doc.getLine(start.line).slice(start.column)];
  for (let i = start.line + 1; i < end.line; i++) {
    parts.push(doc.getLine(i));
  }
  parts.push(doc.getLine(end.line).slice(0, end.column));
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// EditorActions
// ---------------------------------------------------------------------------

export class EditorActions {
  private readonly _doc:       Document;
  private readonly _clipboard: ClipboardAdapter;
  private readonly _tabSize:   number;

  constructor(doc: Document, clipboard: ClipboardAdapter, tabSize = 2) {
    this._doc       = doc;
    this._clipboard = clipboard;
    this._tabSize   = tabSize;
  }

  // ── Text insertion ──────────────────────────────────────────────────────────

  /**
   * Insert `text` at cursor (or replace selection).
   * Single-character inserts allow UndoStack merging (word-level undo).
   */
  insertText(text: string): void {
    this._doc.insertText(text, text.length === 1);
  }

  insertNewline(): void {
    this._doc.insertText('\n', false);
  }

  insertTab(): void {
    this._doc.insertText(' '.repeat(this._tabSize), false);
  }

  // ── Deletion ────────────────────────────────────────────────────────────────

  deleteBackward(): void {
    this._doc.deleteText('backward');
  }

  deleteForward(): void {
    this._doc.deleteText('forward');
  }

  /**
   * Delete from cursor to previous word boundary (Ctrl+Backspace / Alt+Backspace).
   * If selection is non-collapsed, deletes the selection.
   */
  deleteWordBackward(): void {
    if (!this._doc.selection.isCollapsed) {
      this._doc.deleteText('backward');
      return;
    }
    const cursor = this._doc.cursor;
    if (cursor.column === 0) {
      if (cursor.line === 0) return;
      // Merge with previous line (same as plain backspace at line start)
      this._doc.deleteText('backward');
      return;
    }
    const lineText = this._doc.getLine(cursor.line);
    const newCol   = wordBoundaryLeft(lineText, cursor.column);
    const start: Position = { line: cursor.line, column: newCol };
    const end: Position   = { line: cursor.line, column: cursor.column };
    this._doc.replaceRange(start, end, '');
  }

  /**
   * Delete from cursor to next word boundary (Ctrl+Delete / Alt+Delete).
   * If selection is non-collapsed, deletes the selection.
   */
  deleteWordForward(): void {
    if (!this._doc.selection.isCollapsed) {
      this._doc.deleteText('forward');
      return;
    }
    const cursor   = this._doc.cursor;
    const lineText = this._doc.getLine(cursor.line);
    if (cursor.column >= lineText.length) {
      if (cursor.line >= this._doc.lineCount - 1) return;
      // Merge with next line
      this._doc.deleteText('forward');
      return;
    }
    const newCol  = wordBoundaryRight(lineText, cursor.column);
    const start: Position = { line: cursor.line, column: cursor.column };
    const end: Position   = { line: cursor.line, column: newCol };
    this._doc.replaceRange(start, end, '');
  }

  /** Delete from cursor to start of line. Merges with previous line if at column 0. */
  deleteToLineStart(): void {
    if (!this._doc.selection.isCollapsed) {
      this._doc.deleteText('backward');
      return;
    }
    const cursor = this._doc.cursor;
    if (cursor.column === 0) {
      if (cursor.line === 0) return;
      this._doc.deleteText('backward'); // merge
      return;
    }
    const start: Position = { line: cursor.line, column: 0 };
    const end: Position   = { line: cursor.line, column: cursor.column };
    this._doc.replaceRange(start, end, '');
  }

  /** Delete from cursor to end of line. Merges with next line if at end. */
  deleteToLineEnd(): void {
    if (!this._doc.selection.isCollapsed) {
      this._doc.deleteText('forward');
      return;
    }
    const cursor   = this._doc.cursor;
    const lineText = this._doc.getLine(cursor.line);
    if (cursor.column >= lineText.length) {
      if (cursor.line >= this._doc.lineCount - 1) return;
      this._doc.deleteText('forward'); // merge
      return;
    }
    const start: Position = { line: cursor.line, column: cursor.column };
    const end: Position   = { line: cursor.line, column: lineText.length };
    this._doc.replaceRange(start, end, '');
  }

  // ── Cursor movement (LOCK-26) ───────────────────────────────────────────────

  /** Move cursor left. Non-collapsed selection collapses to its start (LOCK-26). */
  moveLeft(): void {
    if (!this._doc.selection.isCollapsed) {
      const { start } = this._doc.selection.ordered();
      this._doc.moveCursor(this._doc.createCursor(start.line, start.column));
      return;
    }
    this._doc.moveCursor(this._doc.getCursorMovedBy(this._doc.cursor, 'left'));
  }

  /** Move cursor right. Non-collapsed selection collapses to its end (LOCK-26). */
  moveRight(): void {
    if (!this._doc.selection.isCollapsed) {
      const { end } = this._doc.selection.ordered();
      this._doc.moveCursor(this._doc.createCursor(end.line, end.column));
      return;
    }
    this._doc.moveCursor(this._doc.getCursorMovedBy(this._doc.cursor, 'right'));
  }

  moveUp(): void {
    if (!this._doc.selection.isCollapsed) {
      const { start } = this._doc.selection.ordered();
      this._doc.moveCursor(this._doc.createCursor(start.line, start.column));
      return;
    }
    this._doc.moveCursor(this._doc.getCursorMovedBy(this._doc.cursor, 'up'));
  }

  moveDown(): void {
    if (!this._doc.selection.isCollapsed) {
      const { end } = this._doc.selection.ordered();
      this._doc.moveCursor(this._doc.createCursor(end.line, end.column));
      return;
    }
    this._doc.moveCursor(this._doc.getCursorMovedBy(this._doc.cursor, 'down'));
  }

  moveToLineStart(): void {
    this._doc.moveCursor(this._doc.getCursorMovedTo(this._doc.cursor, 'lineStart'));
  }

  moveToLineEnd(): void {
    this._doc.moveCursor(this._doc.getCursorMovedTo(this._doc.cursor, 'lineEnd'));
  }

  moveToDocStart(): void {
    this._doc.moveCursor(this._doc.getCursorMovedTo(this._doc.cursor, 'docStart'));
  }

  moveToDocEnd(): void {
    this._doc.moveCursor(this._doc.getCursorMovedTo(this._doc.cursor, 'docEnd'));
  }

  /** Move to previous word boundary. Collapses non-collapsed selection to start first (LOCK-26). */
  moveWordLeft(): void {
    if (!this._doc.selection.isCollapsed) {
      const { start } = this._doc.selection.ordered();
      this._doc.moveCursor(this._doc.createCursor(start.line, start.column));
      return;
    }
    const cursor = this._doc.cursor;
    if (cursor.column === 0) {
      if (cursor.line === 0) return;
      const prevLine = cursor.line - 1;
      const prevLen  = this._doc.getLine(prevLine).length;
      this._doc.moveCursor(this._doc.createCursor(prevLine, prevLen));
      return;
    }
    const lineText = this._doc.getLine(cursor.line);
    const newCol   = wordBoundaryLeft(lineText, cursor.column);
    this._doc.moveCursor(this._doc.createCursor(cursor.line, newCol));
  }

  /** Move to next word boundary. Collapses non-collapsed selection to end first (LOCK-26). */
  moveWordRight(): void {
    if (!this._doc.selection.isCollapsed) {
      const { end } = this._doc.selection.ordered();
      this._doc.moveCursor(this._doc.createCursor(end.line, end.column));
      return;
    }
    const cursor   = this._doc.cursor;
    const lineText = this._doc.getLine(cursor.line);
    if (cursor.column >= lineText.length) {
      if (cursor.line >= this._doc.lineCount - 1) return;
      this._doc.moveCursor(this._doc.createCursor(cursor.line + 1, 0));
      return;
    }
    const newCol = wordBoundaryRight(lineText, cursor.column);
    this._doc.moveCursor(this._doc.createCursor(cursor.line, newCol));
  }

  // ── Selection extension (LOCK-26) ───────────────────────────────────────────

  selectLeft(): void {
    this._doc.extendSelection(this._doc.getCursorMovedBy(this._doc.cursor, 'left'));
  }

  selectRight(): void {
    this._doc.extendSelection(this._doc.getCursorMovedBy(this._doc.cursor, 'right'));
  }

  selectUp(): void {
    this._doc.extendSelection(this._doc.getCursorMovedBy(this._doc.cursor, 'up'));
  }

  selectDown(): void {
    this._doc.extendSelection(this._doc.getCursorMovedBy(this._doc.cursor, 'down'));
  }

  selectToLineStart(): void {
    this._doc.extendSelection(this._doc.getCursorMovedTo(this._doc.cursor, 'lineStart'));
  }

  selectToLineEnd(): void {
    this._doc.extendSelection(this._doc.getCursorMovedTo(this._doc.cursor, 'lineEnd'));
  }

  selectToDocStart(): void {
    this._doc.extendSelection(this._doc.getCursorMovedTo(this._doc.cursor, 'docStart'));
  }

  selectToDocEnd(): void {
    this._doc.extendSelection(this._doc.getCursorMovedTo(this._doc.cursor, 'docEnd'));
  }

  selectWordLeft(): void {
    const cursor = this._doc.cursor;
    if (cursor.column === 0) {
      if (cursor.line === 0) return;
      const prevLen = this._doc.getLine(cursor.line - 1).length;
      this._doc.extendSelection(this._doc.createCursor(cursor.line - 1, prevLen));
      return;
    }
    const newCol = wordBoundaryLeft(this._doc.getLine(cursor.line), cursor.column);
    this._doc.extendSelection(this._doc.createCursor(cursor.line, newCol));
  }

  selectWordRight(): void {
    const cursor   = this._doc.cursor;
    const lineText = this._doc.getLine(cursor.line);
    if (cursor.column >= lineText.length) {
      if (cursor.line >= this._doc.lineCount - 1) return;
      this._doc.extendSelection(this._doc.createCursor(cursor.line + 1, 0));
      return;
    }
    const newCol = wordBoundaryRight(lineText, cursor.column);
    this._doc.extendSelection(this._doc.createCursor(cursor.line, newCol));
  }

  selectAll(): void {
    const lastLine = this._doc.lineCount - 1;
    const lastCol  = this._doc.getLine(lastLine).length;
    const anchor   = this._doc.createCursor(0, 0);
    const active   = this._doc.createCursor(lastLine, lastCol);
    this._doc.moveCursor(anchor);
    this._doc.extendSelection(active);
  }

  // ── History ─────────────────────────────────────────────────────────────────

  undo(): void { this._doc.undo(); }
  redo(): void { this._doc.redo(); }

  // ── Clipboard (LOCK-28) ─────────────────────────────────────────────────────

  /** Copy selected text to clipboard. No-op if selection is collapsed (LOCK-28). */
  async copy(): Promise<void> {
    if (this._doc.selection.isCollapsed) return;
    const { start, end } = this._doc.selection.ordered();
    const text = extractRange(this._doc, start, end);
    await this._clipboard.write(text);
  }

  /** Cut selected text (copy + delete). No-op if selection is collapsed (LOCK-28). */
  async cut(): Promise<void> {
    if (this._doc.selection.isCollapsed) return;
    const { start, end } = this._doc.selection.ordered();
    const text = extractRange(this._doc, start, end);
    await this._clipboard.write(text);
    this._doc.deleteText('backward'); // selection is not collapsed — deletes it
  }

  /** Insert `text` at cursor, replacing any selection. (Caller has already read clipboard.) */
  paste(text: string): void {
    this._doc.insertText(text, false);
  }

  /** Read from clipboard then insert at cursor. */
  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await this._clipboard.read();
      this.paste(text);
    } catch {
      // Clipboard access denied or unavailable — silently ignore.
    }
  }

  // ── Indent / dedent ─────────────────────────────────────────────────────────

  /**
   * Remove up to `tabSize` leading spaces from the cursor's line.
   * No-op if the line has no leading spaces.
   */
  dedent(): void {
    const cursor   = this._doc.cursor;
    const lineText = this._doc.getLine(cursor.line);
    let spaces = 0;
    while (spaces < lineText.length && lineText[spaces] === ' ' && spaces < this._tabSize) {
      spaces++;
    }
    if (spaces === 0) return;
    this._doc.replaceRange(
      { line: cursor.line, column: 0 },
      { line: cursor.line, column: spaces },
      '',
    );
  }
}
