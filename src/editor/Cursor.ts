/**
 * APDS Editor — Cursor
 *
 * A Cursor is a validated, clamped document position. It is immutable; any
 * movement produces a new Cursor. Document is responsible for clamping to
 * valid bounds after edits.
 *
 * Column positions are 0-based UTF-16 code-unit offsets (matching Token and
 * TextBuffer). Line positions are 0-based line indices.
 *
 * The "preferred column" is remembered for vertical movement (↑/↓) so that
 * moving through shorter lines does not permanently reduce the column.
 */

import type { Position } from './TextBuffer';
import type { TextBuffer } from './TextBuffer';

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export class Cursor {
  readonly line:            number;
  readonly column:          number;
  /** Column to restore when moving vertically through shorter lines. */
  readonly preferredColumn: number;

  private constructor(line: number, column: number, preferredColumn: number) {
    this.line            = line;
    this.column          = column;
    this.preferredColumn = preferredColumn;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /** Create a cursor clamped to valid bounds within `buffer`. */
  static create(buf: TextBuffer, line: number, column: number): Cursor {
    const clamped = buf.clamp({ line, column });
    return new Cursor(clamped.line, clamped.column, clamped.column);
  }

  /** Create a cursor at the very start of the document. */
  static atStart(): Cursor {
    return new Cursor(0, 0, 0);
  }

  // ── Position access ───────────────────────────────────────────────────────

  toPosition(): Position {
    return { line: this.line, column: this.column };
  }

  equals(other: Cursor): boolean {
    return this.line === other.line && this.column === other.column;
  }

  isBefore(other: Cursor): boolean {
    return this.line < other.line ||
      (this.line === other.line && this.column < other.column);
  }

  isAfter(other: Cursor): boolean {
    return other.isBefore(this);
  }

  // ── Movement (returns new Cursor) ─────────────────────────────────────────

  /** Move one character left. Wraps to end of previous line. */
  moveLeft(buf: TextBuffer): Cursor {
    if (this.column > 0) {
      const c = this.column - 1;
      return new Cursor(this.line, c, c);
    }
    if (this.line > 0) {
      const prevLine = this.line - 1;
      const c = buf.getLine(prevLine).length;
      return new Cursor(prevLine, c, c);
    }
    return this;
  }

  /** Move one character right. Wraps to start of next line. */
  moveRight(buf: TextBuffer): Cursor {
    const lineLen = buf.getLine(this.line).length;
    if (this.column < lineLen) {
      const c = this.column + 1;
      return new Cursor(this.line, c, c);
    }
    if (this.line < buf.lineCount - 1) {
      return new Cursor(this.line + 1, 0, 0);
    }
    return this;
  }

  /** Move one line up, restoring preferredColumn where possible. */
  moveUp(buf: TextBuffer): Cursor {
    if (this.line === 0) return this;
    const targetLine = this.line - 1;
    const c = Math.min(this.preferredColumn, buf.getLine(targetLine).length);
    return new Cursor(targetLine, c, this.preferredColumn);
  }

  /** Move one line down, restoring preferredColumn where possible. */
  moveDown(buf: TextBuffer): Cursor {
    if (this.line >= buf.lineCount - 1) return this;
    const targetLine = this.line + 1;
    const c = Math.min(this.preferredColumn, buf.getLine(targetLine).length);
    return new Cursor(targetLine, c, this.preferredColumn);
  }

  /** Move to start of line. */
  moveToLineStart(): Cursor {
    return new Cursor(this.line, 0, 0);
  }

  /** Move to end of line. */
  moveToLineEnd(buf: TextBuffer): Cursor {
    const c = buf.getLine(this.line).length;
    return new Cursor(this.line, c, c);
  }

  /** Move to start of first line. */
  moveToDocStart(): Cursor {
    return new Cursor(0, 0, 0);
  }

  /** Move to end of last line. */
  moveToDocEnd(buf: TextBuffer): Cursor {
    const lastLine = buf.lineCount - 1;
    const c = buf.getLine(lastLine).length;
    return new Cursor(lastLine, c, c);
  }

  /**
   * Clamp this cursor to valid bounds after a buffer edit.
   * Returns the same instance if already within bounds.
   */
  clamp(buf: TextBuffer): Cursor {
    const clamped = buf.clamp({ line: this.line, column: this.column });
    if (clamped.line === this.line && clamped.column === this.column) return this;
    const pref = Math.min(this.preferredColumn, buf.getLine(clamped.line).length);
    return new Cursor(clamped.line, clamped.column, pref);
  }
}
