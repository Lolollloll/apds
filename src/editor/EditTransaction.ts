/**
 * APDS Editor — EditTransaction
 *
 * An EditTransaction is an atomic unit of change that can be applied and
 * undone. It is the foundation of the undo/redo stack.
 *
 * Design:
 *  - Each transaction records the text that was replaced (for undo) and the
 *    text that replaced it (for redo).
 *  - Transactions are immutable value objects — they describe a change but
 *    do not apply it.
 *  - Document calls TextBuffer.replace() and translates the result into an
 *    EditTransaction before pushing it onto the undo stack.
 *  - "Compound" transactions (e.g. paste + format) can be built by composing
 *    multiple EditTransactions; this is reserved for future phases.
 *
 * All positions are document-order (start ≤ end).
 */

import type { Position } from './TextBuffer';

// ---------------------------------------------------------------------------
// EditTransaction
// ---------------------------------------------------------------------------

export interface EditTransaction {
  /** Inclusive start of the replaced range. */
  readonly start: Position;
  /**
   * Exclusive end of the replaced range (in the BEFORE state, i.e. before
   * `insertedText` was written).
   */
  readonly end: Position;
  /** The text that was removed (for undo). May be ''. */
  readonly removedText: string;
  /** The text that replaced it (for redo / reapply). May be ''. */
  readonly insertedText: string;
  /**
   * The cursor position BEFORE the edit (for undo cursor restore).
   */
  readonly cursorBefore: Position;
  /**
   * The cursor position AFTER the edit (for redo cursor restore).
   */
  readonly cursorAfter: Position;
}

// ---------------------------------------------------------------------------
// UndoStack
// ---------------------------------------------------------------------------

/**
 * A simple linear undo/redo stack.
 *
 * Design rules:
 *  - push() adds a new entry and clears the redo branch.
 *  - undo() returns the entry to be reversed and moves the pointer back.
 *  - redo() returns the entry to be reapplied and moves the pointer forward.
 *  - The stack is bounded to MAX_DEPTH entries; oldest entries are dropped.
 *  - Consecutive "trivial" edits (single characters typed, no selection) are
 *    merged into the top entry up to a configurable word-break interval.
 *    Merging is advisory: callers pass `allowMerge` = true for each character
 *    insertion and false for deletes, pastes, replacements, and newlines.
 */

const MAX_DEPTH = 500;

/**
 * Merge two adjacent single-character-insert transactions into one.
 * `prev` was applied first; `next` was applied immediately after.
 */
function mergeTransactions(prev: EditTransaction, next: EditTransaction): EditTransaction | null {
  // Only merge sequential character inserts (no removed text, no selection).
  if (prev.removedText !== '' || next.removedText !== '') return null;
  if (prev.insertedText.length === 0 || next.insertedText.length === 0) return null;
  // Ensure `next` begins exactly where `prev` ended.
  const prevEndLine   = prev.cursorAfter.line;
  const prevEndColumn = prev.cursorAfter.column;
  if (next.start.line !== prevEndLine || next.start.column !== prevEndColumn) return null;
  // Don't merge across newlines.
  if (next.insertedText.includes('\n')) return null;

  return {
    start:        prev.start,
    end:          next.end,
    removedText:  '',
    insertedText: prev.insertedText + next.insertedText,
    cursorBefore: prev.cursorBefore,
    cursorAfter:  next.cursorAfter,
  };
}

export class UndoStack {
  private stack: EditTransaction[] = [];
  /** Index of the next undo slot (= stack.length when nothing to undo). */
  private pointer: number = 0;

  get canUndo(): boolean { return this.pointer > 0; }
  get canRedo(): boolean { return this.pointer < this.stack.length; }
  get depth():   number  { return this.pointer; }

  /**
   * Record a new edit.
   * `allowMerge` — pass true for consecutive character-only inserts to enable
   * word-level grouping. Pass false for all other operations.
   */
  push(tx: EditTransaction, allowMerge = false): void {
    // Drop redo branch.
    if (this.pointer < this.stack.length) {
      this.stack.length = this.pointer;
    }

    // Attempt merge with the top entry.
    if (allowMerge && this.pointer > 0) {
      const top = this.stack[this.pointer - 1];
      const merged = mergeTransactions(top, tx);
      if (merged !== null) {
        this.stack[this.pointer - 1] = merged;
        return; // Replace top in place; pointer unchanged.
      }
    }

    this.stack.push(tx);
    this.pointer++;

    // Enforce MAX_DEPTH by dropping oldest entries.
    if (this.stack.length > MAX_DEPTH) {
      const excess = this.stack.length - MAX_DEPTH;
      this.stack.splice(0, excess);
      this.pointer -= excess;
    }
  }

  /**
   * Return the transaction to undo and step the pointer back.
   * Returns null if nothing to undo.
   */
  undo(): EditTransaction | null {
    if (!this.canUndo) return null;
    this.pointer--;
    return this.stack[this.pointer];
  }

  /**
   * Return the transaction to redo and step the pointer forward.
   * Returns null if nothing to redo.
   */
  redo(): EditTransaction | null {
    if (!this.canRedo) return null;
    const tx = this.stack[this.pointer];
    this.pointer++;
    return tx;
  }

  /** Clear the stack entirely (e.g. on document reload). */
  clear(): void {
    this.stack = [];
    this.pointer = 0;
  }
}
