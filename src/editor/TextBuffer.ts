/**
 * APDS Editor — TextBuffer
 *
 * Owns the raw line storage for the document. All text mutations go through
 * this layer. TextBuffer is deliberately dumb: it knows nothing about cursors,
 * selections, or tokenization — those concerns live in Document.
 *
 * Design constraints:
 *  - Lines are stored as plain strings (no embedded newlines).
 *  - Column positions are 0-based UTF-16 code-unit offsets (matching Token).
 *  - The buffer always contains at least one line (the empty document is ['']).
 *  - All mutations return a BufferMutation describing exactly what changed so
 *    Document can forward an equivalent BufferChangeEvent to TokenizerEngine.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A half-open [start, end) range within a single line.
 * Invariant: 0 <= start <= end <= line.length
 */
export interface LineRange {
  readonly line:  number;
  readonly start: number; // inclusive column
  readonly end:   number; // exclusive column
}

/**
 * A position in the document: line index + column offset.
 * Both are 0-based.
 */
export interface Position {
  readonly line:   number;
  readonly column: number;
}

/**
 * Describes the splice that was applied to the line array.
 * Mirrors BufferChangeEvent from tokenizerEngine so Document can pass it
 * straight through.
 */
export interface BufferMutation {
  readonly startLine:        number;
  readonly removedLineCount: number;
  readonly insertedLines:    readonly string[];
}

// ---------------------------------------------------------------------------
// TextBuffer
// ---------------------------------------------------------------------------

export class TextBuffer {
  private _lines: string[];

  constructor(initialText = '') {
    // Split on \n; keep trailing empty line if text ends with \n
    this._lines = initialText === '' ? [''] : initialText.split('\n');
    if (this._lines.length === 0) this._lines = [''];
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get lineCount(): number { return this._lines.length; }

  getLine(index: number): string {
    if (index < 0 || index >= this._lines.length) {
      throw new RangeError(`TextBuffer.getLine: index ${index} out of range [0, ${this._lines.length})`);
    }
    return this._lines[index];
  }

  /** All lines as a readonly snapshot (cheap — no copy unless mutated). */
  getLines(): readonly string[] { return this._lines; }

  /** Full document text joined with '\n'. */
  getText(): string { return this._lines.join('\n'); }

  /**
   * Clamp a Position to valid bounds.
   * Useful for cursor placement after edits.
   */
  clamp(pos: Position): Position {
    const line   = Math.max(0, Math.min(pos.line, this._lines.length - 1));
    const column = Math.max(0, Math.min(pos.column, this._lines[line].length));
    return { line, column };
  }

  // ── Primitive mutations ───────────────────────────────────────────────────

  /**
   * Insert `text` at position. `text` may contain '\n' characters, which
   * cause line splits.
   *
   * Returns a BufferMutation that callers (Document) must forward to
   * TokenizerEngine.onBufferChange().
   */
  insert(pos: Position, text: string): BufferMutation {
    const { line, column } = this.clamp(pos);
    const lineText = this._lines[line];

    const before  = lineText.slice(0, column);
    const after   = lineText.slice(column);
    const chunks  = text.split('\n');

    if (chunks.length === 1) {
      // Fast path: single-line insert — one line replaced by one line.
      this._lines[line] = before + chunks[0] + after;
      return { startLine: line, removedLineCount: 1, insertedLines: [this._lines[line]] };
    }

    // Multi-line insert: first chunk appends to `before`, last prepends to `after`.
    const newLines: string[] = [
      before + chunks[0],
      ...chunks.slice(1, -1),
      chunks[chunks.length - 1] + after,
    ];
    this._lines.splice(line, 1, ...newLines);
    return { startLine: line, removedLineCount: 1, insertedLines: newLines };
  }

  /**
   * Delete the text in the half-open range [start, end).
   * `start` and `end` are Positions; they may span multiple lines.
   *
   * Returns a BufferMutation.
   */
  delete(start: Position, end: Position): BufferMutation {
    const s = this.clamp(start);
    const e = this.clamp(end);

    // Normalise so s <= e
    if (s.line > e.line || (s.line === e.line && s.column > e.column)) {
      return this.delete(e, s);
    }
    if (s.line === e.line && s.column === e.column) {
      // No-op deletion.
      return { startLine: s.line, removedLineCount: 0, insertedLines: [] };
    }

    const startLineText  = this._lines[s.line];
    const endLineText    = this._lines[e.line];
    const merged         = startLineText.slice(0, s.column) + endLineText.slice(e.column);
    const removedCount   = e.line - s.line + 1;

    this._lines.splice(s.line, removedCount, merged);
    if (this._lines.length === 0) this._lines = [''];

    return { startLine: s.line, removedLineCount: removedCount, insertedLines: [merged] };
  }

  /**
   * Replace the text in [start, end) with `text`.
   * Equivalent to delete(start, end) + insert(start, text) but produces a
   * single BufferMutation that correctly describes the net splice.
   */
  replace(start: Position, end: Position, text: string): BufferMutation {
    const s = this.clamp(start);
    const e = this.clamp(end);

    // Normalise
    const lo = (s.line < e.line || (s.line === e.line && s.column <= e.column)) ? s : e;
    const hi = lo === s ? e : s;

    const startLineText = this._lines[lo.line];
    const endLineText   = this._lines[hi.line];
    const before        = startLineText.slice(0, lo.column);
    const after         = endLineText.slice(hi.column);
    const chunks        = text.split('\n');

    const newLines: string[] = chunks.length === 1
      ? [before + chunks[0] + after]
      : [before + chunks[0], ...chunks.slice(1, -1), chunks[chunks.length - 1] + after];

    const removedCount = hi.line - lo.line + 1;
    this._lines.splice(lo.line, removedCount, ...newLines);
    if (this._lines.length === 0) this._lines = [''];

    return { startLine: lo.line, removedLineCount: removedCount, insertedLines: newLines };
  }
}
