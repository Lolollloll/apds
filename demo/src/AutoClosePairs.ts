/**
 * APDS Demo — Auto-Close Pairs
 *
 * Handles three behaviours for bracket and quote characters:
 *   1. INSERT PAIR     — open char typed with no selection → insert open+close, cursor between.
 *   2. WRAP SELECTION  — open char typed with selection → wrap selection with open+close.
 *   3. SKIP OVER       — close char typed when cursor is immediately before it → move past it.
 *
 * Pure decision function computeAutoClose() + mutation executor executeAutoClose().
 * EditorHost calls handleAutoClose() before forwarding to KeyboardHandler.
 * Returns true if event was consumed.
 */

import type { Document } from '../../src/editor/Document.js';

const OPEN_TO_CLOSE: Readonly<Record<string, string>> = {
  '(': ')', '[': ']', '{': '}', '"': '"', "'": "'",
};
const CLOSE_CHARS: ReadonlySet<string> = new Set([')', ']', '}', '"', "'"]);
const QUOTE_CHARS: ReadonlySet<string> = new Set(['"', "'"]);

export type AutoCloseAction = 'insertPair' | 'wrapSelection' | 'skipClose' | 'none';

export interface AutoCloseResult {
  readonly action:    AutoCloseAction;
  readonly openChar:  string;
  readonly closeChar: string;
}

/**
 * Pure function — decide what to do when user presses `char`.
 * Reads doc state but makes no mutations.
 */
export function computeAutoClose(char: string, doc: Document): AutoCloseResult {
  const NONE: AutoCloseResult = { action: 'none', openChar: char, closeChar: '' };
  const closeChar = OPEN_TO_CLOSE[char];
  const isOpen    = closeChar !== undefined;
  const isClose   = CLOSE_CHARS.has(char);

  if (!isOpen && !isClose) return NONE;

  const cursor    = doc.cursor;
  const selection = doc.selection;

  // ── Open chars take priority (including quotes, which are both open & close) ──
  if (isOpen) {
    const open  = char;
    const close = closeChar!;

    // Wrap non-empty selection
    if (!selection.isCollapsed) {
      return { action: 'wrapSelection', openChar: open, closeChar: close };
    }

    // For chars that are also close chars (quotes): if cursor is immediately
    // before the same char, skip over instead of inserting a new pair.
    if (CLOSE_CHARS.has(char)) {
      const lineText     = doc.getLine(cursor.line);
      const charAtCursor = lineText[cursor.column];
      if (charAtCursor === char) {
        return { action: 'skipClose', openChar: '', closeChar: char };
      }
    }

    // Quote after backslash → don't auto-close (escape sequence)
    if (QUOTE_CHARS.has(open)) {
      const lineText   = doc.getLine(cursor.line);
      const charBefore = cursor.column > 0 ? lineText[cursor.column - 1] : '';
      if (charBefore === '\\') return NONE;
    }

    return { action: 'insertPair', openChar: open, closeChar: close };
  }

  // ── Pure close char (not also an open: ), ], }) — skip-over only ────────
  if (selection.isCollapsed) {
    const lineText     = doc.getLine(cursor.line);
    const charAtCursor = lineText[cursor.column];
    if (charAtCursor === char) {
      return { action: 'skipClose', openChar: '', closeChar: char };
    }
  }
  return NONE;
}

/** Execute an auto-close result against the document. Returns true if consumed. */
export function executeAutoClose(result: AutoCloseResult, doc: Document): boolean {
  switch (result.action) {
    case 'none':
      return false;

    case 'skipClose': {
      const cur  = doc.cursor;
      const line = doc.getLine(cur.line);
      const newCol = Math.min(cur.column + 1, line.length);
      doc.moveCursor(doc.createCursor(cur.line, newCol));
      return true;
    }

    case 'insertPair': {
      doc.insertText(result.openChar + result.closeChar, false);
      const cur    = doc.cursor;
      const newCol = Math.max(0, cur.column - 1);
      doc.moveCursor(doc.createCursor(cur.line, newCol));
      return true;
    }

    case 'wrapSelection': {
      const sel             = doc.selection;
      const { start, end }  = sel.ordered();
      // Insert close first (preserves start position)
      doc.replaceRange(end, end, result.closeChar);
      // Insert open at start
      doc.replaceRange(start, start, result.openChar);
      // Re-select wrapped content (offset by 1 for inserted open char)
      const newStart = doc.createCursor(start.line, start.column + 1);
      const newEnd   = doc.createCursor(
        end.line,
        end.column + (start.line === end.line ? 1 : 0),
      );
      doc.moveCursor(newStart);
      doc.extendSelection(newEnd);
      return true;
    }
  }
}

/** Entry point for EditorHost._onKeyDown(). Returns true if event consumed. */
export function handleAutoClose(char: string, doc: Document): boolean {
  return executeAutoClose(computeAutoClose(char, doc), doc);
}
