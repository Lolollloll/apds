/**
 * APDS Editor — Phase 3 Document Model Test Suite
 *
 * Covers: TextBuffer, Cursor, Selection, EditTransaction/UndoStack, Document.
 *
 * Convention: each describe block maps to one Phase 3 file/concern.
 * The oracle for token correctness is always the raw Phase 1 lexer run on
 * the same lines — identical to the pattern used in tokenizerEngine.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { TextBuffer } from '../TextBuffer';
import { Cursor } from '../Cursor';
import { Selection } from '../Selection';
import { UndoStack, type EditTransaction } from '../EditTransaction';
import { Document } from '../Document';
import { lex } from '../../tokenizer/lexer';
import { DEFAULT_STATE, type TokenizerState } from '../../tokenizer/tokenizerState';
import type { Token } from '../../tokenizer/tokenTypes';

// ── Oracle helper (same as engine test) ──────────────────────────────────────

function oracleTokens(lines: string[]): Token[][] {
  const out: Token[][] = [];
  let state: TokenizerState = DEFAULT_STATE;
  for (const text of lines) {
    const r = lex(text, state);
    out.push(r.tokens as Token[]);
    state = r.endState;
  }
  return out;
}

function tokensEqual(a: readonly Token[], b: readonly Token[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].length !== b[i].length || a[i].class !== b[i].class) return false;
  }
  return true;
}

function expectDocMatchesOracle(doc: Document): void {
  const lines: string[] = [];
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.getLine(i));
  const oracle = oracleTokens(lines);
  for (let i = 0; i < lines.length; i++) {
    expect(tokensEqual(doc.getLineTokens(i).tokens, oracle[i])).toBe(true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TextBuffer
// ═══════════════════════════════════════════════════════════════════════════

describe('TextBuffer — construction', () => {
  it('empty string gives single empty line', () => {
    const buf = new TextBuffer('');
    expect(buf.lineCount).toBe(1);
    expect(buf.getLine(0)).toBe('');
  });

  it('single line text', () => {
    const buf = new TextBuffer('hello world');
    expect(buf.lineCount).toBe(1);
    expect(buf.getLine(0)).toBe('hello world');
  });

  it('multi-line text splits on \\n', () => {
    const buf = new TextBuffer('a\nb\nc');
    expect(buf.lineCount).toBe(3);
    expect(buf.getLine(0)).toBe('a');
    expect(buf.getLine(1)).toBe('b');
    expect(buf.getLine(2)).toBe('c');
  });

  it('getText() round-trips the initial text', () => {
    const text = 'local x = 1\nlocal y = 2\nreturn x + y';
    expect(new TextBuffer(text).getText()).toBe(text);
  });

  it('getLine() throws on out-of-range index', () => {
    const buf = new TextBuffer('hello');
    expect(() => buf.getLine(-1)).toThrow(RangeError);
    expect(() => buf.getLine(1)).toThrow(RangeError);
  });
});

describe('TextBuffer — insert', () => {
  it('single-char insert in the middle of a line', () => {
    const buf = new TextBuffer('helo');
    const m = buf.insert({ line: 0, column: 3 }, 'l');
    expect(buf.getText()).toBe('hello');
    expect(m.startLine).toBe(0);
    expect(m.removedLineCount).toBe(1);
    expect(m.insertedLines).toEqual(['hello']);
  });

  it('insert at start of line', () => {
    const buf = new TextBuffer('world');
    buf.insert({ line: 0, column: 0 }, 'hello ');
    expect(buf.getText()).toBe('hello world');
  });

  it('insert at end of line', () => {
    const buf = new TextBuffer('hello');
    buf.insert({ line: 0, column: 5 }, ' world');
    expect(buf.getText()).toBe('hello world');
  });

  it('insert newline splits a line', () => {
    const buf = new TextBuffer('helloworld');
    const m = buf.insert({ line: 0, column: 5 }, '\n');
    expect(buf.lineCount).toBe(2);
    expect(buf.getLine(0)).toBe('hello');
    expect(buf.getLine(1)).toBe('world');
    expect(m.removedLineCount).toBe(1);
    expect(m.insertedLines).toEqual(['hello', 'world']);
  });

  it('insert multi-line text', () => {
    const buf = new TextBuffer('ac');
    buf.insert({ line: 0, column: 1 }, 'b\n');
    expect(buf.lineCount).toBe(2);
    expect(buf.getLine(0)).toBe('ab');
    expect(buf.getLine(1)).toBe('c');
  });

  it('insert at out-of-range column is clamped', () => {
    const buf = new TextBuffer('hi');
    buf.insert({ line: 0, column: 999 }, '!');
    expect(buf.getText()).toBe('hi!');
  });
});

describe('TextBuffer — delete', () => {
  it('delete a character within a line', () => {
    const buf = new TextBuffer('hello');
    buf.delete({ line: 0, column: 1 }, { line: 0, column: 2 });
    expect(buf.getText()).toBe('hllo');
  });

  it('delete to end of line', () => {
    const buf = new TextBuffer('hello world');
    buf.delete({ line: 0, column: 5 }, { line: 0, column: 11 });
    expect(buf.getText()).toBe('hello');
  });

  it('delete across line boundary merges lines', () => {
    const buf = new TextBuffer('hello\nworld');
    const m = buf.delete({ line: 0, column: 5 }, { line: 1, column: 0 });
    expect(buf.getText()).toBe('helloworld');
    expect(buf.lineCount).toBe(1);
    expect(m.removedLineCount).toBe(2);
    expect(m.insertedLines).toEqual(['helloworld']);
  });

  it('delete spanning three lines', () => {
    const buf = new TextBuffer('a\nb\nc');
    buf.delete({ line: 0, column: 1 }, { line: 2, column: 0 });
    expect(buf.getText()).toBe('ac');
    expect(buf.lineCount).toBe(1);
  });

  it('no-op delete (same position)', () => {
    const buf = new TextBuffer('hello');
    buf.delete({ line: 0, column: 2 }, { line: 0, column: 2 });
    expect(buf.getText()).toBe('hello');
  });

  it('reversed start/end is normalised', () => {
    const buf = new TextBuffer('hello');
    buf.delete({ line: 0, column: 3 }, { line: 0, column: 1 });
    expect(buf.getText()).toBe('hlo');
  });
});

describe('TextBuffer — replace', () => {
  it('replace word in place', () => {
    const buf = new TextBuffer('local foo = 1');
    buf.replace({ line: 0, column: 6 }, { line: 0, column: 9 }, 'bar');
    expect(buf.getText()).toBe('local bar = 1');
  });

  it('replace with fewer chars (shrink)', () => {
    const buf = new TextBuffer('hello world');
    buf.replace({ line: 0, column: 6 }, { line: 0, column: 11 }, 'X');
    expect(buf.getText()).toBe('hello X');
  });

  it('replace across lines', () => {
    const buf = new TextBuffer('aaa\nbbb\nccc');
    buf.replace({ line: 0, column: 2 }, { line: 1, column: 1 }, 'X');
    expect(buf.getText()).toBe('aaXbb\nccc');
  });
});

describe('TextBuffer — clamp', () => {
  it('clamps line below 0 to 0', () => {
    const buf = new TextBuffer('hi');
    expect(buf.clamp({ line: -5, column: 0 })).toEqual({ line: 0, column: 0 });
  });

  it('clamps line past end to last line', () => {
    const buf = new TextBuffer('a\nb');
    const c = buf.clamp({ line: 99, column: 99 });
    expect(c.line).toBe(1);
    expect(c.column).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cursor
// ═══════════════════════════════════════════════════════════════════════════

describe('Cursor — construction', () => {
  it('Cursor.atStart() is (0,0)', () => {
    const c = Cursor.atStart();
    expect(c.line).toBe(0);
    expect(c.column).toBe(0);
    expect(c.preferredColumn).toBe(0);
  });

  it('Cursor.create clamps to buffer', () => {
    const buf = new TextBuffer('hi');
    const c = Cursor.create(buf, 0, 999);
    expect(c.column).toBe(2);
  });
});

describe('Cursor — movement', () => {
  it('moveRight advances column', () => {
    const buf = new TextBuffer('hello');
    let c = Cursor.atStart();
    c = c.moveRight(buf);
    expect(c.column).toBe(1);
  });

  it('moveRight wraps to next line', () => {
    const buf = new TextBuffer('hi\nworld');
    let c = Cursor.create(buf, 0, 2);
    c = c.moveRight(buf);
    expect(c.line).toBe(1);
    expect(c.column).toBe(0);
  });

  it('moveLeft retreats column', () => {
    const buf = new TextBuffer('hello');
    let c = Cursor.create(buf, 0, 3);
    c = c.moveLeft(buf);
    expect(c.column).toBe(2);
  });

  it('moveLeft wraps to previous line end', () => {
    const buf = new TextBuffer('hi\nworld');
    let c = Cursor.create(buf, 1, 0);
    c = c.moveLeft(buf);
    expect(c.line).toBe(0);
    expect(c.column).toBe(2);
  });

  it('moveUp preserves preferred column through short line', () => {
    const buf = new TextBuffer('hello world\nhi\nhello world');
    let c = Cursor.create(buf, 2, 11); // column 11
    c = c.moveUp(buf);                  // line 1 has only 2 chars
    expect(c.line).toBe(1);
    expect(c.column).toBe(2);
    expect(c.preferredColumn).toBe(11);
    c = c.moveUp(buf);
    expect(c.line).toBe(0);
    expect(c.column).toBe(11); // restored
  });

  it('moveDown preserves preferred column', () => {
    const buf = new TextBuffer('hello world\nhi\nhello world');
    let c = Cursor.create(buf, 0, 8);
    c = c.moveDown(buf);
    expect(c.line).toBe(1);
    expect(c.column).toBe(2);
    expect(c.preferredColumn).toBe(8);
    c = c.moveDown(buf);
    expect(c.column).toBe(8);
  });

  it('moveToLineStart resets to column 0', () => {
    const buf = new TextBuffer('hello');
    let c = Cursor.create(buf, 0, 3);
    c = c.moveToLineStart();
    expect(c.column).toBe(0);
  });

  it('moveToLineEnd goes to end', () => {
    const buf = new TextBuffer('hello');
    let c = Cursor.atStart();
    c = c.moveToLineEnd(buf);
    expect(c.column).toBe(5);
  });

  it('moveRight at end of doc is no-op', () => {
    const buf = new TextBuffer('hi');
    let c = Cursor.create(buf, 0, 2);
    const before = c;
    c = c.moveRight(buf);
    expect(c).toBe(before);
  });

  it('moveLeft at start of doc is no-op', () => {
    const buf = new TextBuffer('hi');
    const c = Cursor.atStart();
    expect(c.moveLeft(buf)).toBe(c);
  });
});

describe('Cursor — comparison', () => {
  it('equals()', () => {
    const buf = new TextBuffer('hello');
    const a = Cursor.create(buf, 0, 2);
    const b = Cursor.create(buf, 0, 2);
    expect(a.equals(b)).toBe(true);
  });

  it('isBefore()', () => {
    const buf = new TextBuffer('hi\nworld');
    const a = Cursor.create(buf, 0, 1);
    const b = Cursor.create(buf, 1, 0);
    expect(a.isBefore(b)).toBe(true);
    expect(b.isBefore(a)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Selection
// ═══════════════════════════════════════════════════════════════════════════

describe('Selection', () => {
  it('collapsed selection isCollapsed', () => {
    const c = Cursor.atStart();
    const sel = Selection.collapsed(c);
    expect(sel.isCollapsed).toBe(true);
    expect(sel.anchor.equals(sel.active)).toBe(true);
  });

  it('non-collapsed selection has correct ordered range', () => {
    const buf = new TextBuffer('hello world');
    const anchor = Cursor.create(buf, 0, 6);
    const active = Cursor.create(buf, 0, 11);
    const sel = Selection.fromCursors(anchor, active);
    expect(sel.isCollapsed).toBe(false);
    const { start, end } = sel.ordered();
    expect(start.column).toBe(6);
    expect(end.column).toBe(11);
  });

  it('reversed selection (active before anchor) is ordered correctly', () => {
    const buf = new TextBuffer('hello world');
    const anchor = Cursor.create(buf, 0, 11);
    const active = Cursor.create(buf, 0, 6);
    const sel = Selection.fromCursors(anchor, active);
    const { start, end } = sel.ordered();
    expect(start.column).toBe(6);
    expect(end.column).toBe(11);
  });

  it('extendTo moves active, keeps anchor', () => {
    const buf = new TextBuffer('hello world');
    const anchor = Cursor.create(buf, 0, 0);
    let sel = Selection.collapsed(anchor);
    const active2 = Cursor.create(buf, 0, 5);
    sel = sel.extendTo(active2);
    expect(sel.anchor.column).toBe(0);
    expect(sel.active.column).toBe(5);
  });

  it('moveTo collapses to new position', () => {
    const buf = new TextBuffer('hello world');
    const c1 = Cursor.create(buf, 0, 3);
    const c2 = Cursor.create(buf, 0, 8);
    let sel = Selection.fromCursors(c1, c2);
    sel = sel.moveTo(c2);
    expect(sel.isCollapsed).toBe(true);
    expect(sel.active.column).toBe(8);
  });

  it('isMultiLine for single-line selection', () => {
    const buf = new TextBuffer('hello');
    const sel = Selection.fromCursors(Cursor.create(buf, 0, 0), Cursor.create(buf, 0, 5));
    expect(sel.isMultiLine).toBe(false);
  });

  it('isMultiLine for cross-line selection', () => {
    const buf = new TextBuffer('a\nb');
    const sel = Selection.fromCursors(Cursor.create(buf, 0, 0), Cursor.create(buf, 1, 1));
    expect(sel.isMultiLine).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// UndoStack
// ═══════════════════════════════════════════════════════════════════════════

function makeTx(
  startCol: number, endCol: number,
  removed: string, inserted: string,
  cursorBefore: number, cursorAfter: number,
): EditTransaction {
  return {
    start:        { line: 0, column: startCol },
    end:          { line: 0, column: endCol },
    removedText:  removed,
    insertedText: inserted,
    cursorBefore: { line: 0, column: cursorBefore },
    cursorAfter:  { line: 0, column: cursorAfter },
  };
}

describe('UndoStack', () => {
  it('starts empty', () => {
    const s = new UndoStack();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.depth).toBe(0);
  });

  it('undo returns null when empty', () => {
    expect(new UndoStack().undo()).toBeNull();
  });

  it('redo returns null when nothing to redo', () => {
    const s = new UndoStack();
    s.push(makeTx(0, 0, '', 'a', 0, 1));
    expect(s.canRedo).toBe(false);
  });

  it('push then undo returns the transaction', () => {
    const s = new UndoStack();
    const tx = makeTx(0, 0, '', 'x', 0, 1);
    s.push(tx);
    expect(s.canUndo).toBe(true);
    const got = s.undo();
    expect(got).toBe(tx);
    expect(s.canUndo).toBe(false);
  });

  it('undo then redo restores', () => {
    const s = new UndoStack();
    const tx = makeTx(0, 0, '', 'x', 0, 1);
    s.push(tx);
    s.undo();
    expect(s.canRedo).toBe(true);
    const got = s.redo();
    expect(got).toBe(tx);
    expect(s.canRedo).toBe(false);
    expect(s.canUndo).toBe(true);
  });

  it('push after undo clears redo branch', () => {
    const s = new UndoStack();
    s.push(makeTx(0, 0, '', 'a', 0, 1));
    s.push(makeTx(1, 1, '', 'b', 1, 2));
    s.undo();
    expect(s.canRedo).toBe(true);
    s.push(makeTx(1, 1, '', 'c', 1, 2));
    expect(s.canRedo).toBe(false);
  });

  it('merges consecutive single-char inserts when allowMerge=true', () => {
    const s = new UndoStack();
    s.push(makeTx(0, 0, '', 'h', 0, 1), true);
    s.push(makeTx(1, 1, '', 'i', 1, 2), true);
    expect(s.depth).toBe(1);
    const got = s.undo();
    expect(got!.insertedText).toBe('hi');
  });

  it('does NOT merge when allowMerge=false', () => {
    const s = new UndoStack();
    s.push(makeTx(0, 0, '', 'h', 0, 1), false);
    s.push(makeTx(1, 1, '', 'i', 1, 2), false);
    expect(s.depth).toBe(2);
  });

  it('does NOT merge when removed text is present', () => {
    const s = new UndoStack();
    s.push(makeTx(0, 3, 'foo', 'bar', 0, 3), true);
    s.push(makeTx(3, 3, '', 'x', 3, 4), true);
    expect(s.depth).toBe(2);
  });

  it('clear() resets everything', () => {
    const s = new UndoStack();
    s.push(makeTx(0, 0, '', 'a', 0, 1));
    s.clear();
    expect(s.canUndo).toBe(false);
    expect(s.depth).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — construction & token access
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — construction & token access', () => {
  it('empty document has one line', () => {
    const doc = new Document('');
    expect(doc.lineCount).toBe(1);
    expect(doc.getLine(0)).toBe('');
  });

  it('multi-line document', () => {
    const doc = new Document('local x = 1\nlocal y = 2');
    expect(doc.lineCount).toBe(2);
    expect(doc.getLine(0)).toBe('local x = 1');
  });

  it('tokens match oracle for initial content', () => {
    const doc = new Document('local x = 1\nprint(x)');
    expectDocMatchesOracle(doc);
  });

  it('cursor starts at (0,0)', () => {
    const doc = new Document('hello');
    expect(doc.cursor.line).toBe(0);
    expect(doc.cursor.column).toBe(0);
  });

  it('selection starts collapsed at (0,0)', () => {
    const doc = new Document('hello');
    expect(doc.selection.isCollapsed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — insertText
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — insertText', () => {
  it('type characters advances cursor', () => {
    const doc = new Document('');
    doc.insertText('h', true);
    doc.insertText('i', true);
    expect(doc.getText()).toBe('hi');
    expect(doc.cursor.column).toBe(2);
  });

  it('insert newline splits line and advances cursor to next line', () => {
    const doc = new Document('helloworld');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 5));
    doc.insertText('\n');
    expect(doc.lineCount).toBe(2);
    expect(doc.getLine(0)).toBe('hello');
    expect(doc.getLine(1)).toBe('world');
    expect(doc.cursor.line).toBe(1);
    expect(doc.cursor.column).toBe(0);
  });

  it('tokens updated after insert', () => {
    const doc = new Document('local x = 1');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 11));
    doc.insertText('\nlocal y = 2');
    expectDocMatchesOracle(doc);
  });

  it('insert replaces non-collapsed selection', () => {
    const doc = new Document('hello world');
    const buf = doc['_buf'] as TextBuffer;
    const anchor = Cursor.create(buf, 0, 6);
    const active = Cursor.create(buf, 0, 11);
    doc['_selection'] = Selection.fromCursors(anchor, active);
    doc.insertText('Luau');
    expect(doc.getText()).toBe('hello Luau');
    expect(doc.cursor.column).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — deleteText
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — deleteText', () => {
  it('backspace removes char before cursor', () => {
    const doc = new Document('hello');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 5));
    doc.deleteText('backward');
    expect(doc.getText()).toBe('hell');
    expect(doc.cursor.column).toBe(4);
  });

  it('forward-delete removes char after cursor', () => {
    const doc = new Document('hello');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 0));
    doc.deleteText('forward');
    expect(doc.getText()).toBe('ello');
    expect(doc.cursor.column).toBe(0);
  });

  it('backspace at start of line merges with previous line', () => {
    const doc = new Document('hello\nworld');
    doc.moveCursor(Cursor.create(doc['_buf'], 1, 0));
    doc.deleteText('backward');
    expect(doc.lineCount).toBe(1);
    expect(doc.getText()).toBe('helloworld');
    expect(doc.cursor.column).toBe(5);
  });

  it('delete removes non-collapsed selection', () => {
    const doc = new Document('hello world');
    const buf = doc['_buf'] as TextBuffer;
    doc['_selection'] = Selection.fromCursors(Cursor.create(buf, 0, 0), Cursor.create(buf, 0, 6));
    doc.deleteText('backward');
    expect(doc.getText()).toBe('world');
    expect(doc.cursor.column).toBe(0);
  });

  it('tokens updated after delete', () => {
    const doc = new Document('local x = 1\nlocal y = 2\nreturn x + y');
    doc.moveCursor(Cursor.create(doc['_buf'], 1, 12));
    doc.deleteText('backward');
    expectDocMatchesOracle(doc);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — replaceRange
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — replaceRange', () => {
  it('replace word', () => {
    const doc = new Document('local foo = 1');
    doc.replaceRange({ line: 0, column: 6 }, { line: 0, column: 9 }, 'bar');
    expect(doc.getText()).toBe('local bar = 1');
    expectDocMatchesOracle(doc);
  });

  it('replace across lines', () => {
    const doc = new Document('aaa\nbbb\nccc');
    doc.replaceRange({ line: 0, column: 2 }, { line: 1, column: 1 }, 'X');
    expect(doc.getText()).toBe('aaXbb\nccc');
    expectDocMatchesOracle(doc);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — undo/redo
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — undo/redo', () => {
  it('undo after insert restores original text', () => {
    const doc = new Document('hello');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 5));
    doc.insertText(' world');
    expect(doc.getText()).toBe('hello world');
    doc.undo();
    expect(doc.getText()).toBe('hello');
    expectDocMatchesOracle(doc);
  });

  it('redo after undo re-applies the change', () => {
    const doc = new Document('hello');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 5));
    doc.insertText(' world');
    doc.undo();
    doc.redo();
    expect(doc.getText()).toBe('hello world');
    expectDocMatchesOracle(doc);
  });

  it('undo after delete restores deleted text', () => {
    const doc = new Document('hello world');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 11));
    doc.deleteText('backward');
    expect(doc.getText()).toBe('hello worl');
    doc.undo();
    expect(doc.getText()).toBe('hello world');
  });

  it('canUndo and canRedo flags', () => {
    const doc = new Document('x');
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 1));
    doc.insertText('y');
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);
  });

  it('undo returns false when nothing to undo', () => {
    const doc = new Document('x');
    expect(doc.undo()).toBe(false);
  });

  it('redo returns false when nothing to redo', () => {
    const doc = new Document('x');
    expect(doc.redo()).toBe(false);
  });

  it('multiple undo steps', () => {
    const doc = new Document('');
    doc.insertText('a', true);
    doc.insertText('b', true);
    doc.insertText('c', false); // force separate entry
    doc.undo(); // undo 'c'
    expect(doc.getText()).toBe('ab');
    doc.undo(); // undo 'ab' (merged)
    expect(doc.getText()).toBe('');
  });

  it('undo cursor position is restored', () => {
    const doc = new Document('hello');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 5));
    doc.insertText(' world');
    doc.undo();
    expect(doc.cursor.line).toBe(0);
    expect(doc.cursor.column).toBe(5);
  });

  it('tokens correct after undo across multiple lines', () => {
    const doc = new Document('local x = 1\nreturn x');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 12));
    doc.insertText('local y = 2\n');
    expectDocMatchesOracle(doc);
    doc.undo();
    expectDocMatchesOracle(doc);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — cursor & selection integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — cursor & selection', () => {
  it('moveCursor updates selection active', () => {
    const doc = new Document('hello');
    const buf = doc['_buf'] as TextBuffer;
    doc.moveCursor(Cursor.create(buf, 0, 3));
    expect(doc.cursor.column).toBe(3);
    expect(doc.selection.isCollapsed).toBe(true);
  });

  it('extendSelection keeps anchor, moves active', () => {
    const doc = new Document('hello world');
    const buf = doc['_buf'] as TextBuffer;
    doc.moveCursor(Cursor.create(buf, 0, 0));
    doc.extendSelection(Cursor.create(buf, 0, 5));
    expect(doc.selection.anchor.column).toBe(0);
    expect(doc.selection.active.column).toBe(5);
    expect(doc.selection.isCollapsed).toBe(false);
  });

  it('collapseSelection makes selection collapsed', () => {
    const doc = new Document('hello world');
    const buf = doc['_buf'] as TextBuffer;
    doc['_selection'] = Selection.fromCursors(Cursor.create(buf, 0, 0), Cursor.create(buf, 0, 5));
    doc.collapseSelection();
    expect(doc.selection.isCollapsed).toBe(true);
    expect(doc.cursor.column).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Document — long-string / comment state propagation through edits
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — multi-line tokenizer state through edits', () => {
  it('insert inside long string updates token correctly', () => {
    const doc = new Document('local s = [[\nhello\n]]');
    expectDocMatchesOracle(doc);
    doc.moveCursor(Cursor.create(doc['_buf'], 1, 5));
    doc.insertText(' world');
    expectDocMatchesOracle(doc);
  });

  it('inserting opening [[ on line 0 propagates state to line 1', () => {
    const doc = new Document('a\nb');
    doc.moveCursor(Cursor.create(doc['_buf'], 0, 1));
    doc.insertText(' = [[');
    expectDocMatchesOracle(doc);
  });

  it('undo from inside a long-string restores correct state', () => {
    const doc = new Document('local s = [[\nhello\n]]');
    doc.moveCursor(Cursor.create(doc['_buf'], 1, 5));
    doc.insertText(' world');
    doc.undo();
    expectDocMatchesOracle(doc);
  });
});
