/**
 * APDS Editor — Selection
 *
 * A Selection is a directed range [anchor, active) in the document.
 *
 * anchor — the fixed end (where the selection started).
 * active — the moving end (where the cursor/caret is).
 *
 * When anchor === active the selection is "collapsed" (i.e. just a cursor).
 * The selection is always stored in (anchor, active) direction so we
 * preserve which end the user is dragging. Callers that need an ordered
 * [start, end) range must use Selection.ordered().
 *
 * Column positions are 0-based UTF-16 code-unit offsets (matching Token).
 */

import type { Position } from './TextBuffer';
import { Cursor } from './Cursor';
import type { TextBuffer } from './TextBuffer';

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export class Selection {
  /** Fixed end — where the selection was initiated. */
  readonly anchor: Cursor;
  /** Moving end — where the caret currently is. */
  readonly active: Cursor;

  private constructor(anchor: Cursor, active: Cursor) {
    this.anchor = anchor;
    this.active = active;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /** Collapsed selection (just a cursor position). */
  static collapsed(cursor: Cursor): Selection {
    return new Selection(cursor, cursor);
  }

  /** Directed selection from anchor to active. */
  static fromCursors(anchor: Cursor, active: Cursor): Selection {
    return new Selection(anchor, active);
  }

  /**
   * Create a collapsed selection at a position, clamped to the buffer.
   */
  static atPosition(buf: TextBuffer, line: number, column: number): Selection {
    const c = Cursor.create(buf, line, column);
    return Selection.collapsed(c);
  }

  // ── Properties ────────────────────────────────────────────────────────────

  /** True when anchor === active (no text selected). */
  get isCollapsed(): boolean {
    return this.anchor.equals(this.active);
  }

  /**
   * Returns [start, end) as Positions such that start is always before end
   * in document order. Use this for text extraction and deletion.
   */
  ordered(): { start: Position; end: Position } {
    if (this.active.isBefore(this.anchor)) {
      return { start: this.active.toPosition(), end: this.anchor.toPosition() };
    }
    return { start: this.anchor.toPosition(), end: this.active.toPosition() };
  }

  /** True when the selection spans more than one line. */
  get isMultiLine(): boolean {
    return this.anchor.line !== this.active.line;
  }

  // ── Manipulation ──────────────────────────────────────────────────────────

  /** Collapse to the active (caret) end. */
  collapse(): Selection {
    return Selection.collapsed(this.active);
  }

  /** Collapse to the start (leftmost) end in document order. */
  collapseToStart(): Selection {
    const { start } = this.ordered();
    return Selection.collapsed(cursorFromPosition(start));
  }

  /** Collapse to the end (rightmost) end in document order. */
  collapseToEnd(): Selection {
    const { end } = this.ordered();
    return Selection.collapsed(cursorFromPosition(end));
  }

  /**
   * Extend the selection by moving only the active end to `cursor`.
   * The anchor remains fixed.
   */
  extendTo(cursor: Cursor): Selection {
    return new Selection(this.anchor, cursor);
  }

  /**
   * Replace both anchor and active with `cursor` (collapse and move).
   */
  moveTo(cursor: Cursor): Selection {
    return Selection.collapsed(cursor);
  }

  /**
   * Clamp both ends after a buffer edit.
   */
  clamp(buf: TextBuffer): Selection {
    const newAnchor = this.anchor.clamp(buf);
    const newActive = this.active.clamp(buf);
    if (newAnchor === this.anchor && newActive === this.active) return this;
    return new Selection(newAnchor, newActive);
  }
}

// ---------------------------------------------------------------------------
// Internal helper — build a Cursor from an already-valid Position.
// Bypasses the buffer check because we know the position is already clamped.
// ---------------------------------------------------------------------------

function cursorFromPosition(p: Position): Cursor {
  // Cursor.create() needs a TextBuffer for clamping, but we already know
  // this position is valid, so we use a minimal duck-typed proxy.
  const fakeBuf = {
    lineCount: p.line + 1,
    clamp: (pos: Position): Position => pos,
    getLine: (_: number): string => '',
  } as unknown as TextBuffer;
  return Cursor.create(fakeBuf, p.line, p.column);
}
