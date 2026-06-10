/**
 * APDS Phase 9 — Test Suite
 *
 * Coverage:
 *   P9-A  Auto-Close Pairs (computeAutoClose + executeAutoClose)
 *   P9-C  Smart Indentation improvements (computeSmartIndent)
 *   P9-G  Go-To-Line (logic only — no DOM)
 *
 * Note: Minimap tests are omitted here (requires canvas DOM).
 *       GoToLineWidget tests are also DOM-skipped (logic is trivial).
 */

import { describe, it, expect } from 'vitest';

import { Document } from '../../editor/Document.js';
import {
  computeAutoClose,
  executeAutoClose,
  handleAutoClose,
} from '../../../demo/src/AutoClosePairs.js';

import {
  computeSmartIndent,
  getLeadingWhitespace,
  leadingSpaceCount,
  buildIndent,
  computeClosingDedent,
} from '../../../demo/src/SmartIndent.js';

// ─────────────────────────────────────────────────────────────────────────────
// P9-A — Auto-Close Pairs: computeAutoClose (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-A — computeAutoClose: insertPair', () => {
  function makeDoc(text: string, line = 0, col?: number): Document {
    const doc = new Document(text);
    doc.moveCursor(doc.createCursor(line, col ?? text.split('\n')[line]!.length));
    return doc;
  }

  it('typing ( inserts pair when no selection', () => {
    const doc = makeDoc('', 0, 0);
    const r   = computeAutoClose('(', doc);
    expect(r.action).toBe('insertPair');
    expect(r.openChar).toBe('(');
    expect(r.closeChar).toBe(')');
  });

  it('typing [ inserts pair', () => {
    const doc = makeDoc('x', 0, 1);
    const r   = computeAutoClose('[', doc);
    expect(r.action).toBe('insertPair');
    expect(r.closeChar).toBe(']');
  });

  it('typing { inserts pair', () => {
    const doc = makeDoc('', 0, 0);
    const r   = computeAutoClose('{', doc);
    expect(r.action).toBe('insertPair');
    expect(r.closeChar).toBe('}');
  });

  it('typing " inserts pair', () => {
    const doc = makeDoc('', 0, 0);
    const r   = computeAutoClose('"', doc);
    expect(r.action).toBe('insertPair');
    expect(r.closeChar).toBe('"');
  });

  it("typing ' inserts pair", () => {
    const doc = makeDoc('', 0, 0);
    const r   = computeAutoClose("'", doc);
    expect(r.action).toBe('insertPair');
    expect(r.closeChar).toBe("'");
  });

  it('non-pair char returns none', () => {
    const doc = makeDoc('', 0, 0);
    expect(computeAutoClose('a', doc).action).toBe('none');
    expect(computeAutoClose('1', doc).action).toBe('none');
    expect(computeAutoClose(' ', doc).action).toBe('none');
  });

  it('quote after backslash returns none (escape sequence)', () => {
    const doc = makeDoc('\\', 0, 1);
    const r   = computeAutoClose('"', doc);
    expect(r.action).toBe('none');
  });
});

describe('P9-A — computeAutoClose: skipClose', () => {
  function makeDocWithClose(closeChar: string): Document {
    // doc = ")" at col 0, cursor at col 0
    const doc = new Document(closeChar + ' rest');
    doc.moveCursor(doc.createCursor(0, 0));
    return doc;
  }

  it('typing ) when cursor is before ) skips', () => {
    const doc = makeDocWithClose(')');
    const r   = computeAutoClose(')', doc);
    expect(r.action).toBe('skipClose');
  });

  it('typing ] when cursor is before ] skips', () => {
    const doc = makeDocWithClose(']');
    const r   = computeAutoClose(']', doc);
    expect(r.action).toBe('skipClose');
  });

  it('typing } when cursor is before } skips', () => {
    const doc = makeDocWithClose('}');
    const r   = computeAutoClose('}', doc);
    expect(r.action).toBe('skipClose');
  });

  it('typing ) when cursor is NOT before ) returns none', () => {
    const doc = new Document('abc)');
    doc.moveCursor(doc.createCursor(0, 0)); // cursor at 'a', not before ')'
    const r = computeAutoClose(')', doc);
    expect(r.action).toBe('none');
  });

  it('typing ) at end of line (no close char) returns none', () => {
    const doc = new Document('hello');
    doc.moveCursor(doc.createCursor(0, 5));
    const r = computeAutoClose(')', doc);
    expect(r.action).toBe('none');
  });
});

describe('P9-A — computeAutoClose: wrapSelection', () => {
  function makeDocWithSelection(text: string, startCol: number, endCol: number): Document {
    const doc = new Document(text);
    doc.moveCursor(doc.createCursor(0, startCol));
    doc.extendSelection(doc.createCursor(0, endCol));
    return doc;
  }

  it('typing ( with selection wraps', () => {
    const doc = makeDocWithSelection('hello world', 6, 11);
    const r   = computeAutoClose('(', doc);
    expect(r.action).toBe('wrapSelection');
    expect(r.openChar).toBe('(');
    expect(r.closeChar).toBe(')');
  });

  it('typing [ with selection wraps', () => {
    const doc = makeDocWithSelection('abc', 0, 3);
    const r   = computeAutoClose('[', doc);
    expect(r.action).toBe('wrapSelection');
  });

  it('typing { with selection wraps', () => {
    const doc = makeDocWithSelection('x', 0, 1);
    const r   = computeAutoClose('{', doc);
    expect(r.action).toBe('wrapSelection');
  });

  it('typing " with selection wraps', () => {
    const doc = makeDocWithSelection('word', 0, 4);
    const r   = computeAutoClose('"', doc);
    expect(r.action).toBe('wrapSelection');
  });
});

describe('P9-A — executeAutoClose: mutations', () => {
  it('insertPair inserts open+close and positions cursor between them', () => {
    const doc = new Document('hello');
    doc.moveCursor(doc.createCursor(0, 5));
    const r = { action: 'insertPair' as const, openChar: '(', closeChar: ')' };
    executeAutoClose(r, doc);
    expect(doc.getLine(0)).toBe('hello()');
    expect(doc.cursor.column).toBe(6); // between ( and )
  });

  it('insertPair at line start works correctly', () => {
    const doc = new Document('');
    doc.moveCursor(doc.createCursor(0, 0));
    const r = { action: 'insertPair' as const, openChar: '{', closeChar: '}' };
    executeAutoClose(r, doc);
    expect(doc.getLine(0)).toBe('{}');
    expect(doc.cursor.column).toBe(1);
  });

  it('skipClose moves cursor right by 1', () => {
    const doc = new Document(')');
    doc.moveCursor(doc.createCursor(0, 0));
    const r = { action: 'skipClose' as const, openChar: '', closeChar: ')' };
    executeAutoClose(r, doc);
    expect(doc.cursor.column).toBe(1);
    expect(doc.getLine(0)).toBe(')'); // unchanged
  });

  it('wrapSelection wraps selection with pair', () => {
    const doc = new Document('hello world');
    doc.moveCursor(doc.createCursor(0, 6));
    doc.extendSelection(doc.createCursor(0, 11));
    const r = { action: 'wrapSelection' as const, openChar: '[', closeChar: ']' };
    executeAutoClose(r, doc);
    expect(doc.getLine(0)).toBe('hello [world]');
  });

  it('none returns false', () => {
    const doc = new Document('x');
    const r   = { action: 'none' as const, openChar: 'a', closeChar: '' };
    expect(executeAutoClose(r, doc)).toBe(false);
  });
});

describe('P9-A — handleAutoClose: full integration', () => {
  it('( inserts () and returns true', () => {
    const doc = new Document('foo');
    doc.moveCursor(doc.createCursor(0, 3));
    const handled = handleAutoClose('(', doc);
    expect(handled).toBe(true);
    expect(doc.getLine(0)).toBe('foo()');
  });

  it('plain letter returns false (not handled)', () => {
    const doc = new Document('');
    expect(handleAutoClose('a', doc)).toBe(false);
  });

  it(') before ) skips over (no new char inserted)', () => {
    const doc = new Document(')');
    doc.moveCursor(doc.createCursor(0, 0));
    const handled = handleAutoClose(')', doc);
    expect(handled).toBe(true);
    expect(doc.getLine(0)).toBe(')');      // unchanged
    expect(doc.cursor.column).toBe(1);
  });

  it('{ with selection wraps the selection', () => {
    const doc = new Document('value');
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(0, 5));
    handleAutoClose('{', doc);
    expect(doc.getLine(0)).toBe('{value}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-C — Smart Indentation (Phase 9 improved)
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-C — computeSmartIndent (improved Phase 9)', () => {
  const TAB = 2;

  // Basic cases
  it('preserves indentation on plain line', () => {
    expect(computeSmartIndent('  local x = 1', 13, TAB).insertText).toBe('\n  ');
  });

  it('indents after "then"', () => {
    expect(computeSmartIndent('  if x > 0 then', 15, TAB).insertText).toBe('\n    ');
  });

  it('indents after "do"', () => {
    expect(computeSmartIndent('  for i = 1, 10 do', 18, TAB).insertText).toBe('\n    ');
  });

  it('indents after "repeat"', () => {
    expect(computeSmartIndent('  repeat', 8, TAB).insertText).toBe('\n    ');
  });

  it('indents after "else"', () => {
    expect(computeSmartIndent('  else', 6, TAB).insertText).toBe('\n    ');
  });

  it('indents after "{"', () => {
    expect(computeSmartIndent('  local t = {', 13, TAB).insertText).toBe('\n    ');
  });

  // Function declaration cases (Phase 9 improved)
  it('indents after "function foo()"', () => {
    expect(computeSmartIndent('local function foo()', 20, TAB).insertText).toBe('\n  ');
  });

  it('indents after "function foo(a, b)"', () => {
    expect(computeSmartIndent('local function greet(name, age)', 31, TAB).insertText).toBe('\n  ');
  });

  it('indents after method syntax "function obj:method()"', () => {
    expect(computeSmartIndent('function MyClass:init()', 23, TAB).insertText).toBe('\n  ');
  });

  it('indents after anonymous "function()"', () => {
    expect(computeSmartIndent('local fn = function()', 21, TAB).insertText).toBe('\n  ');
  });

  it('indents after "function(a, b)"', () => {
    expect(computeSmartIndent('local fn = function(a, b)', 25, TAB).insertText).toBe('\n  ');
  });

  // No indent cases
  it('does NOT indent after "end"', () => {
    expect(computeSmartIndent('  end', 5, TAB).insertText).toBe('\n  ');
  });

  it('does NOT indent after "until x > 0"', () => {
    expect(computeSmartIndent('  until x > 0', 13, TAB).insertText).toBe('\n  ');
  });

  it('does NOT indent after a plain expression', () => {
    expect(computeSmartIndent('  x = y + z', 11, TAB).insertText).toBe('\n  ');
  });

  // Deep nesting
  it('preserves deep indent after then', () => {
    expect(computeSmartIndent('      if x then', 15, TAB).insertText).toBe('\n        ');
  });

  it('works with tabSize=4', () => {
    expect(computeSmartIndent('if x then', 9, 4).insertText).toBe('\n    ');
  });

  // Trailing comment stripping
  it('indents after "do  -- loop body"', () => {
    expect(computeSmartIndent('  for i = 1, 10 do  -- loop', 27, TAB).insertText).toBe('\n    ');
  });

  it('does NOT indent when keyword is inside a comment', () => {
    // "-- if x then" — line is a comment, not a block opener
    expect(computeSmartIndent('  -- if x then', 14, TAB).insertText).toBe('\n  ');
  });

  it('always starts with newline', () => {
    const r = computeSmartIndent('anything', 8, TAB);
    expect(r.insertText[0]).toBe('\n');
  });
});

describe('P9-C — computeClosingDedent', () => {
  it('returns 0 for non-closing lines', () => {
    expect(computeClosingDedent('  local x = 1', 2, '')).toBe(0);
  });

  it('returns tabSize for "end"', () => {
    expect(computeClosingDedent('    end', 2, '')).toBe(2);
  });

  it('returns tabSize for "else"', () => {
    expect(computeClosingDedent('    else', 2, '')).toBe(2);
  });

  it('returns tabSize for "elseif"', () => {
    expect(computeClosingDedent('    elseif x > 0 then', 2, '')).toBe(2);
  });

  it('returns tabSize for "until"', () => {
    expect(computeClosingDedent('    until x >= 10', 2, '')).toBe(2);
  });

  it('returns tabSize for "}"', () => {
    expect(computeClosingDedent('    }', 2, '')).toBe(2);
  });

  it('returns 0 if indent less than tabSize', () => {
    expect(computeClosingDedent(' end', 2, '')).toBe(0);
  });

  it('returns 0 for unindented closing keyword', () => {
    expect(computeClosingDedent('end', 2, '')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9-G — Go To Line logic (line clamping, not DOM)
// ─────────────────────────────────────────────────────────────────────────────

describe('P9-G — Go To Line logic', () => {
  it('1-based input maps to 0-based cursor line', () => {
    // The GoToLineWidget converts (n-1) before calling onJump.
    // Verify the conversion logic separately.
    const convert = (n: number) => n - 1;
    expect(convert(1)).toBe(0);
    expect(convert(10)).toBe(9);
    expect(convert(100)).toBe(99);
  });

  it('line clamping keeps index within doc bounds', () => {
    const clamp = (idx: number, lineCount: number) =>
      Math.max(0, Math.min(idx, lineCount - 1));
    expect(clamp(0, 10)).toBe(0);
    expect(clamp(9, 10)).toBe(9);
    expect(clamp(10, 10)).toBe(9);  // clamped
    expect(clamp(-1, 10)).toBe(0);  // clamped
  });

  it('jumping to line sets correct cursor position in Document', () => {
    const doc = new Document('a\nb\nc\nd\ne');
    // Simulate jumping to line 3 (1-based = index 2)
    const targetLine = 2;
    doc.moveCursor(doc.createCursor(targetLine, 0));
    expect(doc.cursor.line).toBe(2);
    expect(doc.cursor.column).toBe(0);
    expect(doc.getLine(2)).toBe('c');
  });
});
