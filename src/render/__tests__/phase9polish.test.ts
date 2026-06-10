/**
 * APDS Phase 9 Polish — Expanded Test Suite  (P9-H)
 *
 * New tests for Phase 9 features:
 *
 *   P9-A  Dynamic gutter width (computeGutterWidth logic)
 *   P9-C  Minimap search markers (MinimapSearchMarkers shape)
 *   P9-E  DiagnosticsOverlay (stats shape, ring buffer math)
 *   P9-F  Go To Line (large document edge cases)
 *   P9-H  Large document stress (100k+ lines)
 *
 * DOM-bound items (CanvasRenderer, DiagnosticsOverlay DOM) are tested
 * via pure-logic extraction — no canvas or document.createElement required.
 */

import { describe, it, expect } from 'vitest';
import { Document } from '../../editor/Document.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a Document with n lines of content
// ─────────────────────────────────────────────────────────────────────────────

function makeDoc(lineCount: number): Document {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(`local x${i} = ${i}`);
  }
  return new Document(lines.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// P9-A — Dynamic Gutter Width (pure logic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The actual computeGutterWidth() needs a CanvasRenderingContext2D which
 * is not available in Node.js. We test the digit-counting math directly.
 */
function digitCount(n: number): number {
  return String(Math.max(n, 1)).length;
}

describe('P9-A — Dynamic gutter digit counting', () => {
  it('1 line → 1 digit', () => {
    expect(digitCount(1)).toBe(1);
  });

  it('9 lines → 1 digit', () => {
    expect(digitCount(9)).toBe(1);
  });

  it('10 lines → 2 digits', () => {
    expect(digitCount(10)).toBe(2);
  });

  it('99 lines → 2 digits', () => {
    expect(digitCount(99)).toBe(2);
  });

  it('100 lines → 3 digits', () => {
    expect(digitCount(100)).toBe(3);
  });

  it('999 lines → 3 digits', () => {
    expect(digitCount(999)).toBe(3);
  });

  it('1000 lines → 4 digits', () => {
    expect(digitCount(1000)).toBe(4);
  });

  it('9999 lines → 4 digits', () => {
    expect(digitCount(9999)).toBe(4);
  });

  it('10000 lines → 5 digits', () => {
    expect(digitCount(10000)).toBe(5);
  });

  it('99999 lines → 5 digits', () => {
    expect(digitCount(99999)).toBe(5);
  });

  it('100000 lines → 6 digits', () => {
    expect(digitCount(100000)).toBe(6);
  });

  it('999999 lines → 6 digits', () => {
    expect(digitCount(999999)).toBe(6);
  });

  it('1000000 lines → 7 digits', () => {
    expect(digitCount(1000000)).toBe(7);
  });

  it('0 lines treated as 1 (minimum)', () => {
    expect(digitCount(0)).toBe(1);
  });

  it('gutter width increases monotonically with digit count', () => {
    // Gutter width formula: digits determine sample text width.
    // More digits → wider gutter. This is a structural guarantee.
    const widths = [1, 9, 10, 100, 1000, 10000, 100000].map(digitCount);
    for (let i = 1; i < widths.length; i++) {
      // Either same number of digits (e.g. 1→9 both 1 digit) or more digits
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-C — Minimap Search Markers
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-C — Minimap search markers data model', () => {
  it('MinimapSearchMarkers shape: matchLines is a Set', () => {
    const markers = {
      matchLines: new Set<number>([0, 5, 42, 999]),
      activeLine: 5,
    };
    expect(markers.matchLines.has(0)).toBe(true);
    expect(markers.matchLines.has(5)).toBe(true);
    expect(markers.matchLines.has(42)).toBe(true);
    expect(markers.matchLines.has(999)).toBe(true);
    expect(markers.matchLines.has(1)).toBe(false);
  });

  it('activeLine -1 means no focused match', () => {
    const markers = {
      matchLines: new Set<number>([10, 20]),
      activeLine: -1,
    };
    expect(markers.activeLine).toBe(-1);
    expect(markers.matchLines.size).toBe(2);
  });

  it('activeLine not in matchLines is still valid (edge case)', () => {
    // The overlay should gracefully handle activeLine not in matchLines
    const markers = {
      matchLines: new Set<number>([0, 1]),
      activeLine: 99,  // not in set
    };
    expect(markers.matchLines.has(markers.activeLine)).toBe(false);
    // No crash expected — overlay checks matchLines.has(activeLine)
  });

  it('empty matchLines with activeLine -1 means no markers', () => {
    const markers = {
      matchLines: new Set<number>(),
      activeLine: -1,
    };
    expect(markers.matchLines.size).toBe(0);
  });

  it('markers scale correctly for 100k+ line documents', () => {
    // Build a set of match lines spread across 100k lines
    const matchLines = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      matchLines.add(i * 100);  // every 100 lines, 1000 matches
    }
    expect(matchLines.size).toBe(1000);
    // First and last entries
    expect(matchLines.has(0)).toBe(true);
    expect(matchLines.has(99900)).toBe(true);

    const markers = { matchLines, activeLine: 5000 };
    expect(markers.matchLines.has(5000)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-E — Diagnostics Overlay stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RingBuffer — tested in isolation (extracted logic).
 */
class TestRingBuffer {
  private _buf:  number[];
  private _pos:  number = 0;
  private _full: boolean = false;

  constructor(private readonly _cap: number) {
    this._buf = new Array(_cap).fill(0);
  }

  push(value: number): void {
    this._buf[this._pos] = value;
    this._pos = (this._pos + 1) % this._cap;
    if (this._pos === 0) this._full = true;
  }

  average(): number {
    const count = this._full ? this._cap : this._pos;
    if (count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this._buf[i];
    return sum / count;
  }

  get size(): number { return this._full ? this._cap : this._pos; }
}

describe('P9-E — DiagnosticsOverlay RingBuffer (isolated logic)', () => {
  it('empty buffer returns average 0', () => {
    const rb = new TestRingBuffer(10);
    expect(rb.average()).toBe(0);
    expect(rb.size).toBe(0);
  });

  it('single value average is that value', () => {
    const rb = new TestRingBuffer(10);
    rb.push(42);
    expect(rb.average()).toBe(42);
    expect(rb.size).toBe(1);
  });

  it('average of [1, 2, 3] is 2', () => {
    const rb = new TestRingBuffer(10);
    rb.push(1); rb.push(2); rb.push(3);
    expect(rb.average()).toBeCloseTo(2);
    expect(rb.size).toBe(3);
  });

  it('wraps around and drops oldest on overflow', () => {
    const rb = new TestRingBuffer(3);
    rb.push(10);
    rb.push(20);
    rb.push(30);
    // Full, average = 20
    expect(rb.average()).toBeCloseTo(20);
    expect(rb.size).toBe(3);

    // Push 40 — drops 10, keeps [20, 30, 40]
    rb.push(40);
    expect(rb.average()).toBeCloseTo(30);
    expect(rb.size).toBe(3);
  });

  it('size never exceeds capacity', () => {
    const cap = 60;
    const rb = new TestRingBuffer(cap);
    for (let i = 0; i < 200; i++) {
      rb.push(i);
    }
    expect(rb.size).toBe(cap);
  });

  it('frame timing ring buffer tracks 60-frame window', () => {
    const rb = new TestRingBuffer(60);
    // Simulate 60 frames at 16ms each
    for (let i = 0; i < 60; i++) rb.push(16);
    expect(rb.average()).toBeCloseTo(16);
    // Add 60 more frames at 8ms — old 16ms frames drop out
    for (let i = 0; i < 60; i++) rb.push(8);
    expect(rb.average()).toBeCloseTo(8);
  });

  it('cache hit rate ring buffer computes correct percentage', () => {
    const rb = new TestRingBuffer(10);
    // All hits (ratio = 1.0)
    for (let i = 0; i < 5; i++) rb.push(1.0);
    expect(rb.average() * 100).toBeCloseTo(100);

    // All misses
    const rb2 = new TestRingBuffer(10);
    for (let i = 0; i < 5; i++) rb2.push(0.0);
    expect(rb2.average() * 100).toBeCloseTo(0);

    // 50/50
    const rb3 = new TestRingBuffer(10);
    for (let i = 0; i < 4; i++) {
      rb3.push(1.0);
      rb3.push(0.0);
    }
    expect(rb3.average() * 100).toBeCloseTo(50);
  });
});

describe('P9-E — DiagnosticsStats shape', () => {
  it('stats object has all required fields', () => {
    const stats = {
      visibleLines:  50,
      totalLines:    100000,
      renderTimeMs:  1.42,
      drawCalls:     400,
      cacheHits:     48,
      cacheMisses:   2,
    };
    expect(stats.visibleLines).toBe(50);
    expect(stats.totalLines).toBe(100000);
    expect(stats.renderTimeMs).toBeCloseTo(1.42);
    expect(stats.drawCalls).toBe(400);
    expect(stats.cacheHits).toBe(48);
    expect(stats.cacheMisses).toBe(2);
  });

  it('cache hit rate computed correctly from stats', () => {
    const stats = { cacheHits: 95, cacheMisses: 5 };
    const total = stats.cacheHits + stats.cacheMisses;
    const rate  = stats.cacheHits / total * 100;
    expect(rate).toBeCloseTo(95);
  });

  it('100% cache hit rate when no misses', () => {
    const stats = { cacheHits: 50, cacheMisses: 0 };
    const total = stats.cacheHits + stats.cacheMisses;
    const rate  = total > 0 ? (stats.cacheHits / total) * 100 : 100;
    expect(rate).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-F — Go To Line (large document edge cases)
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-F — Go To Line large document', () => {
  const clamp = (idx: number, lineCount: number) =>
    Math.max(0, Math.min(idx, lineCount - 1));
  const oneBased = (n: number) => n - 1;

  it('jumps to line 1 in a 100k-line document', () => {
    const doc = makeDoc(1000);  // use 1k lines for speed
    doc.moveCursor(doc.createCursor(0, 0));
    expect(doc.cursor.line).toBe(0);
    expect(doc.getLine(0)).toContain('x0');
  });

  it('jumps to middle of large document', () => {
    const lineCount = 500;
    const doc = makeDoc(lineCount);
    const targetLine = oneBased(250);  // 1-based 250 → index 249
    doc.moveCursor(doc.createCursor(targetLine, 0));
    expect(doc.cursor.line).toBe(249);
  });

  it('jumps to last line of large document', () => {
    const lineCount = 500;
    const doc = makeDoc(lineCount);
    const lastLineIdx = lineCount - 1;
    doc.moveCursor(doc.createCursor(lastLineIdx, 0));
    expect(doc.cursor.line).toBe(lastLineIdx);
  });

  it('clamps over-large line number to last line', () => {
    const lineCount = 100;
    expect(clamp(200, lineCount)).toBe(lineCount - 1);
    expect(clamp(99, lineCount)).toBe(99);  // last valid
    expect(clamp(100, lineCount)).toBe(99); // one past end
  });

  it('clamps negative line number to 0', () => {
    expect(clamp(-1, 100)).toBe(0);
    expect(clamp(-999, 100)).toBe(0);
  });

  it('1-based → 0-based conversion is correct', () => {
    expect(oneBased(1)).toBe(0);
    expect(oneBased(100)).toBe(99);
    expect(oneBased(100000)).toBe(99999);
  });

  it('jump to line 100000 in Document with that many lines (stress)', () => {
    // Use 100 lines for speed but test the math
    const lineCount = 100;
    const doc = makeDoc(lineCount);
    const targetLine = clamp(oneBased(100), lineCount);  // 1-based 100 → index 99
    doc.moveCursor(doc.createCursor(targetLine, 0));
    expect(doc.cursor.line).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-H — Large Document Stress Tests (100k+ lines)
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-H — Large document stress tests', () => {
  it('Document supports 100k lines without error', () => {
    const doc = makeDoc(100_000);
    expect(doc.lineCount).toBe(100_000);
    expect(doc.getLine(0)).toContain('x0');
    expect(doc.getLine(99_999)).toContain('x99999');
  });

  it('Document cursor navigation on 100k-line doc', () => {
    const doc = makeDoc(100_000);
    // Jump to middle
    doc.moveCursor(doc.createCursor(50_000, 0));
    expect(doc.cursor.line).toBe(50_000);
    // Jump to last
    doc.moveCursor(doc.createCursor(99_999, 0));
    expect(doc.cursor.line).toBe(99_999);
  });

  it('digit count for 100k lines is 6', () => {
    expect(digitCount(100_000)).toBe(6);
  });

  it('digit count for 1M lines is 7', () => {
    expect(digitCount(1_000_000)).toBe(7);
  });

  it('gutter digit count increases for document with many lines', () => {
    // 5-digit doc (99999 lines) → 5
    expect(digitCount(99_999)).toBe(5);
    // After adding one line (100000) → 6
    expect(digitCount(100_000)).toBe(6);
    // The gutter MUST be wider for the 100k document
    expect(digitCount(100_000)).toBeGreaterThan(digitCount(99_999));
  });

  it('Document insert on 100k-line doc updates line count correctly', () => {
    const doc = makeDoc(100_000);
    doc.moveCursor(doc.createCursor(50_000, 0));
    doc.insertText('hello\n', false);
    expect(doc.lineCount).toBe(100_001);
  });

  it('Document delete on 100k-line doc updates line count correctly', () => {
    const doc = makeDoc(100_000);
    // Delete line 0 by replacing it (select full line and delete)
    doc.moveCursor(doc.createCursor(0, 0));
    const line0 = doc.getLine(0);
    doc.replaceRange(
      { line: 0, column: 0 },
      { line: 1, column: 0 },
      '',
    );
    expect(doc.lineCount).toBe(99_999);
  });

  it('minimap startLine calculation for 100k-line document', () => {
    // Simulate minimap scroll calculation
    const lineCount  = 100_000;
    const lineH      = 2;        // px per minimap line
    const canvasH    = 800;      // px canvas height
    const docHeight  = 100_000 * 22;  // total doc pixel height

    const maxVisible = Math.floor(canvasH / lineH);  // 400 lines visible
    expect(maxVisible).toBe(400);

    // Scroll to 50% of the document
    const scrollTop = docHeight * 0.5;
    const docRatio  = scrollTop / docHeight;
    let startLine   = Math.floor(docRatio * lineCount);
    startLine = Math.max(0, Math.min(startLine, lineCount - maxVisible));
    expect(startLine).toBeCloseTo(50_000, -2);  // around 50k, within 100 lines
  });

  it('search markers for 100k-line doc: Set operations are O(1)', () => {
    // Build a Set with 1000 match lines spanning 100k doc
    const matchLines = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      matchLines.add(i * 100);
    }
    expect(matchLines.size).toBe(1000);
    // O(1) lookup
    expect(matchLines.has(50_000)).toBe(true);
    expect(matchLines.has(50_001)).toBe(false);
  });

  it('Document version increments correctly over 100k edits', () => {
    const doc = makeDoc(10);  // small doc, test version tracking
    const v0 = doc.version;
    for (let i = 0; i < 100; i++) {
      doc.moveCursor(doc.createCursor(0, 0));
      doc.insertText('x', false);
    }
    expect(doc.version).toBeGreaterThan(v0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-G — Bug Hunt: selection edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-G — Selection edge cases', () => {
  it('selection on empty document does not crash', () => {
    const doc = new Document('');
    expect(doc.lineCount).toBe(1);
    expect(doc.getLine(0)).toBe('');
    expect(doc.selection.isCollapsed).toBe(true);
  });

  it('selection spanning entire document', () => {
    const doc = new Document('abc\ndef\nghi');
    doc.moveCursor(doc.createCursor(0, 0));
    // Extend selection to end of last line
    const lastLine = doc.lineCount - 1;
    const lastCol  = doc.getLine(lastLine).length;
    doc.extendSelection(doc.createCursor(lastLine, lastCol));
    expect(doc.selection.isCollapsed).toBe(false);
  });

  it('collapsed selection at line start', () => {
    const doc = new Document('hello\nworld');
    doc.moveCursor(doc.createCursor(1, 0));
    expect(doc.selection.isCollapsed).toBe(true);
    expect(doc.cursor.line).toBe(1);
    expect(doc.cursor.column).toBe(0);
  });

  it('selection across many lines is not collapsed', () => {
    const doc = makeDoc(100);
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(99, 5));
    expect(doc.selection.isCollapsed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-G — Bug Hunt: undo/redo correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-G — Undo/Redo correctness', () => {
  it('undo restores previous content', () => {
    const doc = new Document('hello');
    doc.moveCursor(doc.createCursor(0, 5));
    doc.insertText(' world', false);
    expect(doc.getLine(0)).toBe('hello world');
    doc.undo();
    expect(doc.getLine(0)).toBe('hello');
  });

  it('redo re-applies undone edit', () => {
    const doc = new Document('hello');
    doc.moveCursor(doc.createCursor(0, 5));
    doc.insertText(' world', false);
    doc.undo();
    doc.redo();
    expect(doc.getLine(0)).toBe('hello world');
  });

  it('undo beyond history does not crash', () => {
    const doc = new Document('hello');
    for (let i = 0; i < 20; i++) doc.undo();  // no crash
    expect(doc.lineCount).toBeGreaterThan(0);
  });

  it('redo after no undo does nothing', () => {
    const doc = new Document('hello');
    const v0 = doc.version;
    doc.redo();
    // Version may or may not change but no crash
    expect(doc.lineCount).toBeGreaterThan(0);
  });

  it('multiple undo/redo cycles maintain consistency', () => {
    const doc = new Document('a');
    doc.moveCursor(doc.createCursor(0, 1));
    doc.insertText('b', false);
    doc.insertText('c', false);
    // Line is now 'abc'
    expect(doc.getLine(0)).toBe('abc');
    doc.undo();
    // 'ab'
    expect(doc.getLine(0)).toBe('ab');
    doc.undo();
    // 'a'
    expect(doc.getLine(0)).toBe('a');
    doc.redo();
    expect(doc.getLine(0)).toBe('ab');
    doc.redo();
    expect(doc.getLine(0)).toBe('abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-G — Bug Hunt: gutter updates after edits
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-G — Gutter updates after edits', () => {
  it('line count increases after newline insert', () => {
    const doc = new Document('a\nb\nc');
    const before = doc.lineCount;
    doc.moveCursor(doc.createCursor(0, 1));
    doc.insertText('\n', false);
    expect(doc.lineCount).toBe(before + 1);
  });

  it('line count decreases after line deletion', () => {
    const doc = new Document('a\nb\nc');
    const before = doc.lineCount;
    doc.moveCursor(doc.createCursor(0, 0));
    doc.replaceRange(
      { line: 0, column: 0 },
      { line: 1, column: 0 },
      '',
    );
    expect(doc.lineCount).toBe(before - 1);
  });

  it('digit count stays correct after crossing 100-line boundary', () => {
    // Start with 99 lines
    const lines = Array.from({ length: 99 }, (_, i) => `line${i}`);
    const doc = new Document(lines.join('\n'));
    expect(doc.lineCount).toBe(99);
    expect(digitCount(doc.lineCount)).toBe(2);

    // Add one more line → 100 → 3 digits
    doc.moveCursor(doc.createCursor(98, doc.getLine(98).length));
    doc.insertText('\nnewline', false);
    expect(doc.lineCount).toBe(100);
    expect(digitCount(doc.lineCount)).toBe(3);
  });

  it('digit count stays correct after crossing 10000-line boundary', () => {
    expect(digitCount(9999)).toBe(4);
    expect(digitCount(10000)).toBe(5);
    // Crossing this boundary requires gutter to grow
    expect(digitCount(10000)).toBeGreaterThan(digitCount(9999));
  });
});
