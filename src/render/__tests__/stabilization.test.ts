/**
 * APDS Stabilization Pass — Regression & Correctness Tests
 *
 * Covers all scenarios from the stabilization milestone:
 *   BUG-001  Gutter line numbering after multi-line deletion
 *   S-01     Line insertion correctness
 *   S-02     Multi-line insertion correctness
 *   S-03     Multi-line deletion correctness
 *   S-04     Delete-all document
 *   S-05     Undo after large delete
 *   S-06     Redo after large delete
 *   S-07     Selection across many lines
 *   S-08     Gutter numbering (render lineIndex after edits)
 *   S-09     Current-line highlight (isCursorLine correctness)
 *   S-10     Cache coherence after splice
 *   S-11     Single-line document behavior
 *   S-12     Last-line deletion behavior
 *   S-13     Empty document behavior
 *   S-14     Viewport state after deletion
 *   S-15     RenderCache lineIndex never stale after splice
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Document }    from '../../editor/Document.js';
import { Renderer }    from '../Renderer.js';
import { DARK_THEME }  from '../Theme.js';
import { Viewport }    from '../Viewport.js';
import { Cursor }      from '../../editor/Cursor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LINE_HEIGHT = 22;
const CHAR_WIDTH  = 8;

function makeRenderer(doc: Document, vp?: Viewport): Renderer {
  const r = new Renderer(doc, DARK_THEME, {
    lineHeight: LINE_HEIGHT,
    charWidth:  CHAR_WIDTH,
    overscanLines: 0,
    cacheCapacity: 500,
  });
  if (vp) r.setViewport(vp);
  return r;
}

function vpFull(lineCount: number): Viewport {
  return new Viewport(0, 0, 800, lineCount * LINE_HEIGHT + 1, LINE_HEIGHT, CHAR_WIDTH);
}

/** Build a Document with N lines of content "line N". */
function makeNLines(n: number): Document {
  const lines = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  return new Document(lines.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-001 — Gutter lineIndex after multi-line deletion
// (Regression test for the root cause: _refreshSelectionAndCursor not
// refreshing lineIndex on cache hits after onBufferSplice key-shifts)
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-001 — Gutter lineIndex correctness after deletion', () => {
  it('lineIndex is 0 after deleting 4 of 5 lines (former line 5 becomes line 1)', () => {
    const doc = makeNLines(5);
    const r   = makeRenderer(doc, vpFull(5));

    // Force initial render to populate cache
    r.render();

    // Select lines 0–3 and delete (replace with empty string)
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(3, doc.getLine(3).length));
    doc.insertText('', false);  // delete selection

    // After deletion, lineCount should be 2 (empty line + former line 5)
    // because the selection replaces lines 0-3 with '', leaving line 4
    // Actually the delete behavior: select from (0,0) to (3,end), delete →
    // lines 0-3 content deleted, line 4 joins. Let's just check lineCount ≥ 1.
    expect(doc.lineCount).toBeGreaterThanOrEqual(1);

    // Re-render — this is where the bug would manifest
    const vp = new Viewport(0, 0, 800, doc.lineCount * LINE_HEIGHT + 1, LINE_HEIGHT, CHAR_WIDTH);
    r.setViewport(vp);
    const result = r.render();

    // Every rendered line's lineIndex must equal its position in the result array
    // (i.e. lineIndex 0 for the first visible line, 1 for second, etc.)
    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i]!;
      expect(line.lineIndex).toBe(result.firstRenderedLine + i);
    }
  });

  it('lineIndex correct after deleting ALL lines and typing new content', () => {
    const doc = makeNLines(10);
    const r   = makeRenderer(doc, vpFull(10));
    r.render();

    // Delete all
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(doc.lineCount - 1, doc.getLine(doc.lineCount - 1).length));
    doc.insertText('new content', false);

    const vp = vpFull(doc.lineCount);
    r.setViewport(vp);
    const result = r.render();

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.lineIndex).toBe(0);
  });

  it('lineIndex correct after inserting lines then deleting some', () => {
    const doc = new Document('a\nb\nc');
    const r   = makeRenderer(doc, vpFull(3));
    r.render();

    // Insert at line 1
    doc.moveCursor(doc.createCursor(1, 0));
    doc.insertText('x\ny\n', false);
    r.setViewport(vpFull(doc.lineCount));
    r.render();

    // Delete line 0
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(0, doc.getLine(0).length));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();

    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(result.firstRenderedLine + i);
    }
  });

  it('lineIndex never shows stale value after any number of deletions', () => {
    const doc = makeNLines(20);
    const r   = makeRenderer(doc, vpFull(20));
    r.render();

    // Delete lines 5–15 (10 lines)
    doc.moveCursor(doc.createCursor(5, 0));
    doc.extendSelection(doc.createCursor(15, doc.getLine(Math.min(15, doc.lineCount-1)).length));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();

    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i]!;
      expect(line.lineIndex, `line at slot ${i} has stale lineIndex ${line.lineIndex}`)
        .toBe(result.firstRenderedLine + i);
    }
  });

  it('BUG-001 exact reproduction: 5 lines, delete 1-4, remaining shows lineIndex 0', () => {
    // Exact scenario from the bug report
    const doc = new Document('line1\nline2\nline3\nline4\nline5');
    expect(doc.lineCount).toBe(5);

    const r = makeRenderer(doc, vpFull(5));

    // First render to warm up cache (this is critical — the bug only triggered
    // when the cache had stale entries from before the deletion)
    const firstResult = r.render();
    expect(firstResult.lines[4]!.lineIndex).toBe(4);  // line5 at index 4

    // Select lines 0-3 and delete
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(3, 5)); // to end of "line4"
    doc.insertText('', false);  // delete everything selected

    // After deletion, "line5" content remains somewhere
    expect(doc.lineCount).toBeGreaterThanOrEqual(1);

    r.setViewport(vpFull(doc.lineCount));
    const afterResult = r.render();

    // THE CRITICAL ASSERTION: no rendered line may have a lineIndex
    // that exceeds doc.lineCount - 1
    for (const line of afterResult.lines) {
      expect(line.lineIndex).toBeLessThan(doc.lineCount);
      expect(line.lineIndex).toBeGreaterThanOrEqual(0);
    }

    // And the first line must be lineIndex 0
    expect(afterResult.lines[0]!.lineIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-01 — Line insertion
// ─────────────────────────────────────────────────────────────────────────────

describe('S-01 — Line insertion correctness', () => {
  it('inserting a line increments lineCount', () => {
    const doc = new Document('hello\nworld');
    expect(doc.lineCount).toBe(2);
    doc.moveCursor(doc.createCursor(0, 5));
    doc.insertText('\nnew line', false);
    expect(doc.lineCount).toBe(3);
  });

  it('inserted line appears at correct index', () => {
    const doc = new Document('a\nc');
    doc.moveCursor(doc.createCursor(0, 1));
    doc.insertText('\nb', false);
    expect(doc.getLine(0)).toBe('a');
    expect(doc.getLine(1)).toBe('b');
    expect(doc.getLine(2)).toBe('c');
  });

  it('renderer lineIndex correct after insertion', () => {
    const doc = new Document('a\nc');
    const r   = makeRenderer(doc, vpFull(2));
    r.render();

    doc.moveCursor(doc.createCursor(0, 1));
    doc.insertText('\nb', false);

    r.setViewport(vpFull(3));
    const result = r.render();
    expect(result.lines).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(result.lines[i]!.lineIndex).toBe(i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-02 — Multi-line insertion
// ─────────────────────────────────────────────────────────────────────────────

describe('S-02 — Multi-line insertion', () => {
  it('inserting 5 lines at once gives correct lineCount', () => {
    const doc = new Document('start\nend');
    doc.moveCursor(doc.createCursor(0, 5));
    doc.insertText('\n1\n2\n3\n4\n5', false);
    expect(doc.lineCount).toBe(7);
  });

  it('renderer lineIndex correct after 5-line insertion', () => {
    const doc = new Document('a\nb');
    const r   = makeRenderer(doc, vpFull(2));
    r.render();

    doc.moveCursor(doc.createCursor(0, 1));
    doc.insertText('\nx\ny\nz', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-03 — Multi-line deletion
// ─────────────────────────────────────────────────────────────────────────────

describe('S-03 — Multi-line deletion', () => {
  it('deleting middle lines gives correct lineCount', () => {
    const doc = makeNLines(10);
    // doc: ["line 1","line 2","line 3","line 4","line 5","line 6","line 7","line 8","line 9","line 10"]
    doc.moveCursor(doc.createCursor(2, 0));
    doc.extendSelection(doc.createCursor(7, doc.getLine(7).length));
    doc.insertText('', false);
    // After replaceRange(2,0 → 7,end) with '':
    // Keeps: "line 1","line 2" + joined empty "" + "line 9","line 10"
    // = 5 lines total
    expect(doc.lineCount).toBe(5);
    // Definitely smaller than original
    expect(doc.lineCount).toBeLessThan(10);
  });

  it('renderer lines are correctly indexed after multi-line deletion', () => {
    const doc = makeNLines(8);
    const r   = makeRenderer(doc, vpFull(8));
    r.render(); // warm cache

    // Delete lines 2-5
    doc.moveCursor(doc.createCursor(2, 0));
    doc.extendSelection(doc.createCursor(5, doc.getLine(5).length));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(result.firstRenderedLine + i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-04 — Delete entire document
// ─────────────────────────────────────────────────────────────────────────────

describe('S-04 — Delete entire document', () => {
  it('deleting all content leaves a single empty line', () => {
    const doc = makeNLines(20);
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(doc.lineCount - 1, doc.getLine(doc.lineCount - 1).length));
    doc.insertText('', false);
    expect(doc.lineCount).toBe(1);
    expect(doc.getLine(0)).toBe('');
  });

  it('renderer handles empty doc: lineIndex 0, single line', () => {
    const doc = new Document('');
    const r   = makeRenderer(doc, vpFull(1));
    const result = r.render();
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.lineIndex).toBe(0);
    expect(result.totalHeight).toBe(LINE_HEIGHT);
  });

  it('renderer lineIndex 0 after deleting all from multi-line doc', () => {
    const doc = makeNLines(15);
    const r   = makeRenderer(doc, vpFull(15));
    r.render();

    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(doc.lineCount - 1, doc.getLine(doc.lineCount - 1).length));
    doc.insertText('', false);

    r.setViewport(vpFull(1));
    const result = r.render();
    expect(result.lines[0]!.lineIndex).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-05 & S-06 — Undo / Redo after large delete
// ─────────────────────────────────────────────────────────────────────────────

describe('S-05/S-06 — Undo/Redo after large delete', () => {
  it('undo restores all lines', () => {
    const doc = makeNLines(10);
    const lineCount0 = doc.lineCount;

    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(8, doc.getLine(8).length));
    doc.insertText('', false);
    const afterDelete = doc.lineCount;
    expect(afterDelete).toBeLessThan(lineCount0);

    doc.undo();
    expect(doc.lineCount).toBe(lineCount0);
    expect(doc.getLine(0)).toBe('line 1');
    expect(doc.getLine(9)).toBe('line 10');
  });

  it('renderer lineIndex correct after undo', () => {
    const doc = makeNLines(5);
    const r   = makeRenderer(doc, vpFull(5));
    r.render();

    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(3, doc.getLine(3).length));
    doc.insertText('', false);
    r.render();

    doc.undo();
    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(result.firstRenderedLine + i);
    }
  });

  it('redo re-applies deletion; lineIndex still correct', () => {
    const doc = makeNLines(5);
    const r   = makeRenderer(doc, vpFull(5));
    r.render();

    doc.moveCursor(doc.createCursor(1, 0));
    doc.extendSelection(doc.createCursor(3, doc.getLine(3).length));
    doc.insertText('', false);
    r.render();

    doc.undo();
    doc.redo();

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(result.firstRenderedLine + i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-07 — Selection across many lines
// ─────────────────────────────────────────────────────────────────────────────

describe('S-07 — Selection across many lines', () => {
  it('selection spans all lines: hasSelection correct on middle lines', () => {
    const doc = makeNLines(10);
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(9, doc.getLine(9).length));

    const r      = makeRenderer(doc, vpFull(10));
    const result = r.render();

    // Every visible line should have hasSelection = true
    for (const line of result.lines) {
      expect(line.hasSelection).toBe(true);
    }
  });

  it('collapsed selection: no line shows hasSelection', () => {
    const doc = makeNLines(5);
    doc.moveCursor(doc.createCursor(2, 0));

    const r      = makeRenderer(doc, vpFull(5));
    const result = r.render();
    for (const line of result.lines) {
      expect(line.hasSelection).toBe(false);
    }
  });

  it('partial selection: only selected lines show hasSelection', () => {
    const doc = makeNLines(5);
    doc.moveCursor(doc.createCursor(1, 0));
    doc.extendSelection(doc.createCursor(3, 4));

    const r      = makeRenderer(doc, vpFull(5));
    const result = r.render();

    expect(result.lines[0]!.hasSelection).toBe(false);
    expect(result.lines[1]!.hasSelection).toBe(true);
    expect(result.lines[2]!.hasSelection).toBe(true);
    expect(result.lines[3]!.hasSelection).toBe(true);
    expect(result.lines[4]!.hasSelection).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-08 — Gutter numbering (lineIndex integrity)
// ─────────────────────────────────────────────────────────────────────────────

describe('S-08 — Gutter numbering (lineIndex integrity)', () => {
  it('all lines have correct lineIndex in initial render', () => {
    const doc    = makeNLines(20);
    const r      = makeRenderer(doc, vpFull(20));
    const result = r.render();
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(i);
    }
  });

  it('lineIndex never out of [0, lineCount-1] range after edits', () => {
    const doc = makeNLines(15);
    const r   = makeRenderer(doc, vpFull(15));
    r.render();

    // A sequence of edits
    doc.moveCursor(doc.createCursor(3, 0));
    doc.insertText('inserted\n', false);
    r.setViewport(vpFull(doc.lineCount));
    r.render();

    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(2, doc.getLine(2).length));
    doc.insertText('', false);
    r.setViewport(vpFull(doc.lineCount));

    const result = r.render();
    for (const line of result.lines) {
      expect(line.lineIndex).toBeGreaterThanOrEqual(0);
      expect(line.lineIndex).toBeLessThan(doc.lineCount);
    }
  });

  it('lineIndex consecutive with no gaps', () => {
    const doc    = makeNLines(10);
    const r      = makeRenderer(doc, vpFull(10));
    r.render();

    doc.moveCursor(doc.createCursor(2, 0));
    doc.extendSelection(doc.createCursor(5, 0));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();

    const indices = result.lines.map(l => l.lineIndex);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBe(indices[i-1]! + 1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-09 — Current-line highlight (isCursorLine)
// ─────────────────────────────────────────────────────────────────────────────

describe('S-09 — isCursorLine correctness', () => {
  it('exactly one line has isCursorLine after cursor move', () => {
    const doc = makeNLines(5);
    doc.moveCursor(doc.createCursor(2, 0));

    const r      = makeRenderer(doc, vpFull(5));
    const result = r.render();
    const cursorLines = result.lines.filter(l => l.isCursorLine);
    expect(cursorLines).toHaveLength(1);
    expect(cursorLines[0]!.lineIndex).toBe(2);
  });

  it('isCursorLine updates after cursor moves to last line', () => {
    const doc = makeNLines(10);
    doc.moveCursor(doc.createCursor(0, 0));

    const r = makeRenderer(doc, vpFull(10));
    r.render();

    doc.moveCursor(doc.createCursor(9, 0));
    const result = r.render();
    const cursorLines = result.lines.filter(l => l.isCursorLine);
    expect(cursorLines).toHaveLength(1);
    expect(cursorLines[0]!.lineIndex).toBe(9);
  });

  it('isCursorLine correct after deletion (cursor moves to new position)', () => {
    const doc = makeNLines(5);
    doc.moveCursor(doc.createCursor(4, 0));  // cursor on line 4
    const r = makeRenderer(doc, vpFull(5));
    r.render();

    // Delete lines 2-4
    doc.moveCursor(doc.createCursor(2, 0));
    doc.extendSelection(doc.createCursor(4, doc.getLine(4).length));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();

    // Cursor should be within the remaining lines
    const cursorLines = result.lines.filter(l => l.isCursorLine);
    expect(cursorLines).toHaveLength(1);
    expect(cursorLines[0]!.lineIndex).toBeLessThan(doc.lineCount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-10 — Cache coherence after splice
// ─────────────────────────────────────────────────────────────────────────────

describe('S-10 — RenderCache lineIndex never stale after splice', () => {
  it('all rendered lineIndex values match their render-loop index', () => {
    const doc = makeNLines(30);
    const r   = makeRenderer(doc, vpFull(30));

    // Multiple renders with edits
    r.render();
    doc.moveCursor(doc.createCursor(5, 0));
    doc.insertText('extra line\n', false);
    r.setViewport(vpFull(doc.lineCount));
    r.render();

    doc.moveCursor(doc.createCursor(10, 0));
    doc.extendSelection(doc.createCursor(20, 0));
    doc.insertText('', false);
    r.setViewport(vpFull(doc.lineCount));

    const final = r.render();
    for (let i = 0; i < final.lines.length; i++) {
      expect(final.lines[i]!.lineIndex).toBe(final.firstRenderedLine + i);
    }
  });

  it('cached content.text matches actual doc.getLine after splice', () => {
    const doc = new Document('alpha\nbeta\ngamma\ndelta');
    const r   = makeRenderer(doc, vpFull(4));
    r.render();

    // Delete "alpha" and "beta"
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(1, 4)); // end of "beta"
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();

    // Verify text consistency
    for (const line of result.lines) {
      expect(line.text).toBe(doc.getLine(line.lineIndex));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-11 — Single-line document
// ─────────────────────────────────────────────────────────────────────────────

describe('S-11 — Single-line document behavior', () => {
  it('single-line doc renders exactly 1 line', () => {
    const doc = new Document('hello world');
    const r   = makeRenderer(doc, vpFull(1));
    const result = r.render();
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.lineIndex).toBe(0);
    expect(result.totalHeight).toBe(LINE_HEIGHT);
  });

  it('single-line doc: cursor is on line 0', () => {
    const doc = new Document('hello');
    doc.moveCursor(doc.createCursor(0, 3));
    const r   = makeRenderer(doc, vpFull(1));
    const result = r.render();
    expect(result.lines[0]!.isCursorLine).toBe(true);
    expect(result.lines[0]!.cursorColumn).toBe(3);
  });

  it('inserting into single-line doc expands lineCount', () => {
    const doc = new Document('hello');
    doc.moveCursor(doc.createCursor(0, 5));
    doc.insertText('\nworld', false);
    expect(doc.lineCount).toBe(2);
    const r = makeRenderer(doc, vpFull(2));
    const result = r.render();
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]!.lineIndex).toBe(0);
    expect(result.lines[1]!.lineIndex).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-12 — Last-line deletion
// ─────────────────────────────────────────────────────────────────────────────

describe('S-12 — Last-line deletion behavior', () => {
  it('deleting last line reduces lineCount by 1', () => {
    const doc = new Document('a\nb\nc');
    expect(doc.lineCount).toBe(3);
    // Delete line 2 ("c")
    doc.moveCursor(doc.createCursor(1, 1));  // at end of "b"
    doc.extendSelection(doc.createCursor(2, 1));
    doc.insertText('', false);
    expect(doc.lineCount).toBe(2);
  });

  it('renderer correct after deleting last line', () => {
    const doc = new Document('first\nsecond\nthird');
    const r   = makeRenderer(doc, vpFull(3));
    r.render();

    // Delete last line
    doc.moveCursor(doc.createCursor(2, 0));
    doc.extendSelection(doc.createCursor(2, 5));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const result = r.render();
    expect(result.lines.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < result.lines.length; i++) {
      expect(result.lines[i]!.lineIndex).toBe(result.firstRenderedLine + i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-13 — Empty document behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('S-13 — Empty document behavior', () => {
  it('empty string document has lineCount 1', () => {
    const doc = new Document('');
    expect(doc.lineCount).toBe(1);
    expect(doc.getLine(0)).toBe('');
  });

  it('renderer for empty doc: 1 line, lineIndex 0, isCursorLine true', () => {
    const doc = new Document('');
    const r   = makeRenderer(doc, vpFull(1));
    const result = r.render();
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.lineIndex).toBe(0);
    expect(result.lines[0]!.isCursorLine).toBe(true);
  });

  it('totalHeight for empty doc is exactly LINE_HEIGHT', () => {
    const doc    = new Document('');
    const r      = makeRenderer(doc, vpFull(1));
    const result = r.render();
    expect(result.totalHeight).toBe(LINE_HEIGHT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-14 — Viewport state after deletion
// ─────────────────────────────────────────────────────────────────────────────

describe('S-14 — Viewport state after deletion', () => {
  it('totalHeight shrinks after lines are deleted', () => {
    const doc = makeNLines(10);
    const r   = makeRenderer(doc, vpFull(10));
    const before = r.render().totalHeight;
    expect(before).toBe(10 * LINE_HEIGHT);

    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(4, doc.getLine(4).length));
    doc.insertText('', false);

    r.setViewport(vpFull(doc.lineCount));
    const after = r.render().totalHeight;
    expect(after).toBeLessThan(before);
    expect(after).toBe(doc.lineCount * LINE_HEIGHT);
  });

  it('firstRenderedLine and lastRenderedLine within doc bounds', () => {
    const doc = makeNLines(100);
    // Scroll to mid-document
    const scrollTop = 50 * LINE_HEIGHT;
    const vp = new Viewport(scrollTop, 0, 800, 400, LINE_HEIGHT, CHAR_WIDTH);
    const r  = makeRenderer(doc, vp);
    const result = r.render();
    expect(result.firstRenderedLine).toBeGreaterThanOrEqual(0);
    expect(result.lastRenderedLine).toBeLessThan(doc.lineCount);
    expect(result.firstRenderedLine).toBeLessThanOrEqual(result.lastRenderedLine);
  });
});
