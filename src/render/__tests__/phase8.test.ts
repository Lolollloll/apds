/**
 * APDS Phase 8 — Test Suite
 *
 * Coverage:
 *   G  — Current Line Highlight (Theme color key presence)
 *   F  — Indentation Guides (leadingIndentLevels helper, pure)
 *   E  — Decoration Layer (DecorationSet, DecorationLayer, DecorationStore)
 *   A  — Bracket Matching (BracketMatcher against real Document)
 *   C  — Smart Indentation (computeSmartIndent, pure function)
 *   D  — Find and Replace (FindReplaceEngine — search, navigate, replace)
 *
 * All tests are DOM-free. CanvasRenderer (DOM-dependent) is not tested here.
 * Tests run under vitest with the NodeNext module resolver.
 *
 * NOTE: DecorationLayer, BracketMatcher, SmartIndent, and FindReplace live
 * under demo/src/ (browser host layer). We import them via relative paths.
 * They have no DOM dependencies in their logic — only the widget classes do.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Core APDS imports ──────────────────────────────────────────────────────
import { DARK_THEME, LIGHT_THEME, ThemeColorKey } from '../Theme.js';
import { Document } from '../../editor/Document.js';

// ── Phase 8 demo-layer imports ─────────────────────────────────────────────
// These files have no DOM dependency in their pure logic paths.
import {
  DecorationSet,
  DecorationLayer,
  DecorationStore,
} from '../../../demo/src/DecorationLayer.js';

import {
  BracketMatcher,
} from '../../../demo/src/BracketMatcher.js';

import {
  computeSmartIndent,
  getLeadingWhitespace,
  leadingSpaceCount,
  buildIndent,
  computeClosingDedent,
} from '../../../demo/src/SmartIndent.js';

import {
  FindReplaceEngine,
} from '../../../demo/src/FindReplace.js';

// ─────────────────────────────────────────────────────────────────────────────
// G — Current Line Highlight
// ─────────────────────────────────────────────────────────────────────────────

describe('G — Theme: CurrentLineBg color key', () => {
  it('DARK_THEME has currentLineBg color', () => {
    expect(DARK_THEME.colors[ThemeColorKey.CurrentLineBg]).toBeDefined();
    expect(typeof DARK_THEME.colors[ThemeColorKey.CurrentLineBg]).toBe('string');
    expect(DARK_THEME.colors[ThemeColorKey.CurrentLineBg].length).toBeGreaterThan(0);
  });

  it('LIGHT_THEME has currentLineBg color', () => {
    expect(LIGHT_THEME.colors[ThemeColorKey.CurrentLineBg]).toBeDefined();
    expect(typeof LIGHT_THEME.colors[ThemeColorKey.CurrentLineBg]).toBe('string');
  });

  it('DARK_THEME currentLineBg is different from background', () => {
    expect(DARK_THEME.colors[ThemeColorKey.CurrentLineBg])
      .not.toBe(DARK_THEME.colors[ThemeColorKey.Background]);
  });

  it('LIGHT_THEME currentLineBg is different from background', () => {
    expect(LIGHT_THEME.colors[ThemeColorKey.CurrentLineBg])
      .not.toBe(LIGHT_THEME.colors[ThemeColorKey.Background]);
  });

  it('DARK_THEME has all new Phase 8 color keys', () => {
    const requiredKeys: ThemeColorKey[] = [
      ThemeColorKey.CurrentLineBg,
      ThemeColorKey.IndentGuideColor,
      ThemeColorKey.IndentGuideActiveColor,
      ThemeColorKey.BracketMatchBg,
      ThemeColorKey.FindMatchBg,
      ThemeColorKey.FindMatchActiveBg,
    ];
    for (const key of requiredKeys) {
      expect(DARK_THEME.colors[key], `missing ${key}`).toBeTruthy();
    }
  });

  it('LIGHT_THEME has all new Phase 8 color keys', () => {
    const requiredKeys: ThemeColorKey[] = [
      ThemeColorKey.CurrentLineBg,
      ThemeColorKey.IndentGuideColor,
      ThemeColorKey.IndentGuideActiveColor,
      ThemeColorKey.BracketMatchBg,
      ThemeColorKey.FindMatchBg,
      ThemeColorKey.FindMatchActiveBg,
    ];
    for (const key of requiredKeys) {
      expect(LIGHT_THEME.colors[key], `missing ${key}`).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — Indentation Guides (pure helper functions)
// ─────────────────────────────────────────────────────────────────────────────

describe('F — Smart Indent: leading whitespace helpers', () => {
  describe('getLeadingWhitespace', () => {
    it('returns empty string for no leading whitespace', () => {
      expect(getLeadingWhitespace('hello')).toBe('');
    });

    it('returns spaces', () => {
      expect(getLeadingWhitespace('  hello')).toBe('  ');
    });

    it('returns tabs', () => {
      expect(getLeadingWhitespace('\t\thello')).toBe('\t\t');
    });

    it('returns mixed whitespace', () => {
      expect(getLeadingWhitespace(' \thello')).toBe(' \t');
    });

    it('returns entire string if all whitespace', () => {
      expect(getLeadingWhitespace('   ')).toBe('   ');
    });
  });

  describe('leadingSpaceCount', () => {
    it('counts spaces (tabSize=2)', () => {
      expect(leadingSpaceCount('  hello', 2)).toBe(2);
    });

    it('counts tabs as tabSize spaces', () => {
      expect(leadingSpaceCount('\thello', 2)).toBe(2);
      expect(leadingSpaceCount('\thello', 4)).toBe(4);
    });

    it('counts mixed spaces and tabs', () => {
      expect(leadingSpaceCount('  \thello', 4)).toBe(4); // 2 spaces + tab aligns to 4
    });

    it('returns 0 for no leading whitespace', () => {
      expect(leadingSpaceCount('hello', 2)).toBe(0);
    });

    it('counts all-whitespace line', () => {
      expect(leadingSpaceCount('    ', 2)).toBe(4);
    });
  });

  describe('buildIndent', () => {
    it('builds correct number of spaces', () => {
      expect(buildIndent(0)).toBe('');
      expect(buildIndent(2)).toBe('  ');
      expect(buildIndent(4)).toBe('    ');
    });

    it('clamps negative to 0', () => {
      expect(buildIndent(-1)).toBe('');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — Decoration Layer
// ─────────────────────────────────────────────────────────────────────────────

describe('E — DecorationSet', () => {
  let set: DecorationSet;

  beforeEach(() => {
    set = new DecorationSet('test');
  });

  it('starts empty', () => {
    expect(set.isEmpty).toBe(true);
    expect(set.getRanges(0)).toEqual([]);
  });

  it('setLine adds ranges for a line', () => {
    set.setLine(5, [{ startColumn: 0, endColumn: 3, color: '#red', inset: false }]);
    expect(set.getRanges(5)).toHaveLength(1);
    expect(set.isEmpty).toBe(false);
  });

  it('setLine with empty array removes the line', () => {
    set.setLine(5, [{ startColumn: 0, endColumn: 3, color: '#red', inset: false }]);
    set.setLine(5, []);
    expect(set.getRanges(5)).toHaveLength(0);
    expect(set.isEmpty).toBe(true);
  });

  it('clear removes all ranges', () => {
    set.setLine(1, [{ startColumn: 0, endColumn: 2, color: '#f00', inset: false }]);
    set.setLine(2, [{ startColumn: 1, endColumn: 3, color: '#0f0', inset: false }]);
    set.clear();
    expect(set.isEmpty).toBe(true);
    expect(set.getRanges(1)).toHaveLength(0);
    expect(set.getRanges(2)).toHaveLength(0);
  });

  it('increments version on setLine', () => {
    const v0 = set.version;
    set.setLine(0, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    expect(set.version).toBeGreaterThan(v0);
  });

  it('increments version on clear', () => {
    set.setLine(0, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    const v1 = set.version;
    set.clear();
    expect(set.version).toBeGreaterThan(v1);
  });

  it('setRanges replaces entire map', () => {
    set.setLine(0, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    const newMap = new Map([[3, [{ startColumn: 2, endColumn: 5, color: '#0f0', inset: true }]]]);
    set.setRanges(newMap);
    expect(set.getRanges(0)).toHaveLength(0);
    expect(set.getRanges(3)).toHaveLength(1);
  });
});

describe('E — DecorationLayer', () => {
  it('merges ranges from multiple sets', () => {
    const s1 = new DecorationSet('s1');
    const s2 = new DecorationSet('s2');
    s1.setLine(0, [{ startColumn: 0, endColumn: 2, color: '#f00', inset: false }]);
    s2.setLine(0, [{ startColumn: 3, endColumn: 5, color: '#0f0', inset: false }]);
    const layer = new DecorationLayer([s1, s2]);
    expect(layer.getForLine(0)).toHaveLength(2);
  });

  it('isEmpty when all sets are empty', () => {
    const s1 = new DecorationSet('s1');
    const s2 = new DecorationSet('s2');
    const layer = new DecorationLayer([s1, s2]);
    expect(layer.isEmpty).toBe(true);
  });

  it('not isEmpty when any set has data', () => {
    const s1 = new DecorationSet('s1');
    const s2 = new DecorationSet('s2');
    s2.setLine(0, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    const layer = new DecorationLayer([s1, s2]);
    expect(layer.isEmpty).toBe(false);
  });

  it('returns empty array for line with no decorations', () => {
    const s1 = new DecorationSet('s1');
    s1.setLine(3, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    const layer = new DecorationLayer([s1]);
    expect(layer.getForLine(0)).toHaveLength(0);
    expect(layer.getForLine(3)).toHaveLength(1);
  });
});

describe('E — DecorationStore', () => {
  it('getOrCreate creates new set', () => {
    const store = new DecorationStore();
    const set   = store.getOrCreate('test');
    expect(set).toBeInstanceOf(DecorationSet);
    expect(set.name).toBe('test');
  });

  it('getOrCreate returns same set on second call', () => {
    const store = new DecorationStore();
    const s1 = store.getOrCreate('test');
    const s2 = store.getOrCreate('test');
    expect(s1).toBe(s2);
  });

  it('buildLayer returns layer with correct sets', () => {
    const store = new DecorationStore();
    const find = store.getOrCreate('find');
    find.setLine(0, [{ startColumn: 0, endColumn: 3, color: '#f00', inset: true }]);
    const layer = store.buildLayer(['find']);
    expect(layer.getForLine(0)).toHaveLength(1);
  });

  it('buildLayer with no names returns all sets', () => {
    const store = new DecorationStore();
    store.getOrCreate('a').setLine(0, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    store.getOrCreate('b').setLine(1, [{ startColumn: 0, endColumn: 1, color: '#0f0', inset: false }]);
    const layer = store.buildLayer();
    expect(layer.getForLine(0)).toHaveLength(1);
    expect(layer.getForLine(1)).toHaveLength(1);
  });

  it('clearAll clears all sets', () => {
    const store = new DecorationStore();
    store.getOrCreate('a').setLine(0, [{ startColumn: 0, endColumn: 1, color: '#f00', inset: false }]);
    store.getOrCreate('b').setLine(1, [{ startColumn: 0, endColumn: 1, color: '#0f0', inset: false }]);
    store.clearAll();
    expect(store.buildLayer().isEmpty).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A — Bracket Matching
// ─────────────────────────────────────────────────────────────────────────────

describe('A — BracketMatcher', () => {
  function makeMatcherFor(code: string): { doc: Document; matcher: BracketMatcher; set: DecorationSet } {
    const doc     = new Document(code);
    const store   = new DecorationStore();
    const set     = store.getOrCreate('bracket');
    const matcher = new BracketMatcher(doc, set);
    return { doc, matcher, set };
  }

  it('finds matching () on same line', () => {
    const { doc, matcher, set } = makeMatcherFor('local x = foo(1, 2)');
    // Move cursor to just after the open paren at col 14
    doc.moveCursor(doc.createCursor(0, 15));
    const found = matcher.update('#bracket');
    expect(found).toBe(true);
    expect(set.getRanges(0)).toHaveLength(2);
  });

  it('finds matching [] on same line', () => {
    const { doc, matcher, set } = makeMatcherFor('local t = a[1]');
    doc.moveCursor(doc.createCursor(0, 12));
    const found = matcher.update('#bracket');
    expect(found).toBe(true);
    expect(set.getRanges(0)).toHaveLength(2);
  });

  it('finds matching {} on same line', () => {
    const { doc, matcher, set } = makeMatcherFor('local t = {1, 2, 3}');
    doc.moveCursor(doc.createCursor(0, 11));
    const found = matcher.update('#bracket');
    expect(found).toBe(true);
    expect(set.getRanges(0)).toHaveLength(2);
  });

  it('returns false when no bracket at cursor', () => {
    const { doc, matcher } = makeMatcherFor('local x = 1');
    doc.moveCursor(doc.createCursor(0, 5));
    expect(matcher.update('#bracket')).toBe(false);
  });

  it('clears previous highlights on each update', () => {
    const { doc, matcher, set } = makeMatcherFor('local x = foo(1)');
    doc.moveCursor(doc.createCursor(0, 15));
    matcher.update('#bracket');
    expect(set.isEmpty).toBe(false);
    // Move away from bracket
    doc.moveCursor(doc.createCursor(0, 0));
    matcher.update('#bracket');
    // Still potentially empty or at new position
    // At col 0 there is no bracket
    expect(set.isEmpty).toBe(true);
  });

  it('finds multi-line bracket match', () => {
    const code = 'local t = {\n  a = 1,\n  b = 2,\n}';
    const { doc, matcher, set } = makeMatcherFor(code);
    // Cursor just after opening brace at line 0, col 11
    doc.moveCursor(doc.createCursor(0, 11));
    const found = matcher.update('#bracket');
    expect(found).toBe(true);
    // Origin on line 0, target on line 3
    expect(set.getRanges(0)).toHaveLength(1);
    expect(set.getRanges(3)).toHaveLength(1);
  });

  it('does not match brackets inside strings (lexer excludes them)', () => {
    // The lexer emits String tokens for "(" — not Bracket tokens.
    // So the bracket matcher won't find them.
    const { doc, matcher } = makeMatcherFor('local s = "hello(world)"');
    doc.moveCursor(doc.createCursor(0, 16));
    // The ( inside the string is a String token, not Bracket
    const found = matcher.update('#bracket');
    expect(found).toBe(false);
  });

  it('handles nested brackets correctly', () => {
    const { doc, matcher, set } = makeMatcherFor('foo(bar(1), baz(2))');
    // Cursor at the outer ( at col 3 → should match col 18 )
    doc.moveCursor(doc.createCursor(0, 4));
    const found = matcher.update('#bracket');
    expect(found).toBe(true);
    const ranges = set.getRanges(0);
    // Should have 2 ranges: open and close of outer pair
    expect(ranges).toHaveLength(2);
    // One at col 3, one at col 18
    const cols = ranges.map(r => r.startColumn).sort((a, b) => a - b);
    expect(cols[0]).toBe(3);
    expect(cols[1]).toBe(18);
  });

  it('handles reverse match — closing bracket finds opening', () => {
    const { doc, matcher, set } = makeMatcherFor('foo(1, 2)');
    // Cursor at closing ) at col 8 → cursor at col 9 (after it)
    doc.moveCursor(doc.createCursor(0, 9));
    const found = matcher.update('#bracket');
    expect(found).toBe(true);
    const ranges = set.getRanges(0);
    expect(ranges).toHaveLength(2);
  });

  it('clear() empties the decoration set', () => {
    const { doc, matcher, set } = makeMatcherFor('foo(1)');
    doc.moveCursor(doc.createCursor(0, 4));
    matcher.update('#bracket');
    expect(set.isEmpty).toBe(false);
    matcher.clear();
    expect(set.isEmpty).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — Smart Indentation
// ─────────────────────────────────────────────────────────────────────────────

describe('C — computeSmartIndent', () => {
  const TAB = 2;

  it('preserves indentation on plain line', () => {
    const r = computeSmartIndent('  local x = 1', 13, TAB);
    expect(r.insertText).toBe('\n  ');
  });

  it('increases indent after "then"', () => {
    const r = computeSmartIndent('  if x > 0 then', 15, TAB);
    expect(r.insertText).toBe('\n    ');
  });

  it('increases indent after "do"', () => {
    const r = computeSmartIndent('  for i = 1, 10 do', 18, TAB);
    expect(r.insertText).toBe('\n    ');
  });

  it('increases indent after "function"', () => {
    const r = computeSmartIndent('local function foo()', 20, TAB);
    expect(r.insertText).toBe('\n  ');
  });

  it('increases indent after "repeat"', () => {
    const r = computeSmartIndent('  repeat', 8, TAB);
    expect(r.insertText).toBe('\n    ');
  });

  it('increases indent after "else"', () => {
    const r = computeSmartIndent('  else', 6, TAB);
    expect(r.insertText).toBe('\n    ');
  });

  it('increases indent after "{"', () => {
    const r = computeSmartIndent('  local t = {', 13, TAB);
    expect(r.insertText).toBe('\n    ');
  });

  it('does NOT increase indent after "end"', () => {
    const r = computeSmartIndent('  end', 5, TAB);
    expect(r.insertText).toBe('\n  ');
  });

  it('handles no indentation baseline', () => {
    const r = computeSmartIndent('if true then', 12, TAB);
    expect(r.insertText).toBe('\n  ');
  });

  it('cursor position mid-line: uses text before cursor', () => {
    // Cursor is in the middle of "then" word — "th" is not a trigger
    const r = computeSmartIndent('if true then', 5, TAB);
    expect(r.insertText).toBe('\n');
  });

  it('works with tabSize=4', () => {
    const r = computeSmartIndent('if x then', 9, 4);
    expect(r.insertText).toBe('\n    ');
  });

  it('preserves deep indent after then', () => {
    const r = computeSmartIndent('      if x then', 15, TAB);
    expect(r.insertText).toBe('\n        ');
  });

  it('always starts with newline', () => {
    const r1 = computeSmartIndent('local x = 1', 11, TAB);
    const r2 = computeSmartIndent('if true then', 12, TAB);
    expect(r1.insertText[0]).toBe('\n');
    expect(r2.insertText[0]).toBe('\n');
  });
});

describe('C — computeClosingDedent', () => {
  it('returns 0 for non-closing lines', () => {
    expect(computeClosingDedent('  local x = 1', 2, '')).toBe(0);
  });

  it('returns tabSize for "end"', () => {
    expect(computeClosingDedent('    end', 2, '')).toBe(2);
  });

  it('returns tabSize for "else"', () => {
    expect(computeClosingDedent('    else', 2, '')).toBe(2);
  });

  it('returns tabSize for "until"', () => {
    expect(computeClosingDedent('    until x', 2, '')).toBe(2);
  });

  it('returns 0 if indent is less than one tabSize', () => {
    expect(computeClosingDedent(' end', 2, '')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — Find and Replace
// ─────────────────────────────────────────────────────────────────────────────

describe('D — FindReplaceEngine: basic search', () => {
  function makeEngine(text: string): FindReplaceEngine {
    const doc   = new Document(text);
    const store = new DecorationStore();
    return new FindReplaceEngine(
      doc,
      store.getOrCreate('find'),
      store.getOrCreate('find-active'),
    );
  }

  it('starts closed', () => {
    const e = makeEngine('hello world');
    expect(e.isOpen).toBe(false);
  });

  it('open() sets isOpen = true', () => {
    const e = makeEngine('hello world');
    e.open('find');
    expect(e.isOpen).toBe(true);
  });

  it('close() sets isOpen = false', () => {
    const e = makeEngine('hello world');
    e.open('find');
    e.close();
    expect(e.isOpen).toBe(false);
  });

  it('finds all occurrences of a query', () => {
    const e = makeEngine('foo foo foo');
    e.open('find', 'foo');
    expect(e.state.matchCount).toBe(3);
  });

  it('no matches for absent query', () => {
    const e = makeEngine('hello world');
    e.open('find', 'xyz');
    expect(e.state.matchCount).toBe(0);
    expect(e.state.currentMatch).toBe(-1);
  });

  it('empty query gives zero matches', () => {
    const e = makeEngine('hello world');
    e.open('find', '');
    expect(e.state.matchCount).toBe(0);
  });

  it('findNext advances currentMatch', () => {
    const e = makeEngine('a b a b a');
    e.open('find', 'a');
    const first = e.state.currentMatch;
    e.findNext();
    expect(e.state.currentMatch).toBe((first + 1) % 3);
  });

  it('findPrev retreats currentMatch', () => {
    const e = makeEngine('a b a b a');
    e.open('find', 'a');
    e.findNext();
    e.findNext();
    const before = e.state.currentMatch;
    e.findPrev();
    expect(e.state.currentMatch).toBe(before - 1);
  });

  it('findNext wraps around at end', () => {
    const e = makeEngine('x x x');
    e.open('find', 'x');
    // Advance to last match
    e.findNext(); e.findNext();  // now at index 2 (last)
    e.findNext();                // should wrap to 0
    expect(e.state.currentMatch).toBe(0);
  });

  it('findPrev wraps around at start', () => {
    const e = makeEngine('x x x');
    e.open('find', 'x');
    // Start is at 0
    e.findPrev();  // should wrap to last
    expect(e.state.currentMatch).toBe(2);
  });

  it('case-insensitive search finds matches', () => {
    const e = makeEngine('Hello HELLO hello');
    e.open('find', 'hello');
    e.setOptions({ caseSensitive: false });
    expect(e.state.matchCount).toBe(3);
  });

  it('case-sensitive search is exact', () => {
    const e = makeEngine('Hello HELLO hello');
    e.open('find', 'hello');
    e.setOptions({ caseSensitive: true });
    expect(e.state.matchCount).toBe(1);
  });

  it('regex search works', () => {
    const e = makeEngine('foo123 bar456 foo789');
    e.open('find', 'foo\\d+');
    e.setOptions({ useRegex: true });
    expect(e.state.matchCount).toBe(2);
  });

  it('invalid regex gives 0 matches (not throws)', () => {
    const e = makeEngine('test');
    e.open('find', '[invalid');
    e.setOptions({ useRegex: true });
    expect(e.state.matchCount).toBe(0);
  });

  it('multi-line document: finds across lines', () => {
    const e = makeEngine('foo\nbar\nfoo\nbaz\nfoo');
    e.open('find', 'foo');
    expect(e.state.matchCount).toBe(3);
  });
});

describe('D — FindReplaceEngine: replace', () => {
  function makeEngineWithDoc(text: string): { engine: FindReplaceEngine; doc: Document } {
    const doc   = new Document(text);
    const store = new DecorationStore();
    const engine = new FindReplaceEngine(
      doc,
      store.getOrCreate('find'),
      store.getOrCreate('find-active'),
    );
    return { engine, doc };
  }

  it('replace() replaces current match', () => {
    const { engine, doc } = makeEngineWithDoc('foo bar foo');
    engine.open('find', 'foo');
    engine.setReplacement('baz');
    engine.replace();
    expect(doc.getLine(0)).toBe('baz bar foo');
  });

  it('replace() reduces match count by 1', () => {
    const { engine } = makeEngineWithDoc('x x x');
    engine.open('find', 'x');
    engine.setReplacement('y');
    engine.replace();
    expect(engine.state.matchCount).toBe(2);
  });

  it('replaceAll() replaces every match', () => {
    const { engine, doc } = makeEngineWithDoc('foo foo foo');
    engine.open('find', 'foo');
    engine.setReplacement('bar');
    engine.replaceAll();
    expect(doc.getLine(0)).toBe('bar bar bar');
    expect(engine.state.matchCount).toBe(0);
  });

  it('replaceAll() on multi-line document replaces all', () => {
    const { engine, doc } = makeEngineWithDoc('foo\nfoo\nfoo');
    engine.open('find', 'foo');
    engine.setReplacement('baz');
    engine.replaceAll();
    expect(doc.getLine(0)).toBe('baz');
    expect(doc.getLine(1)).toBe('baz');
    expect(doc.getLine(2)).toBe('baz');
  });

  it('replace() is no-op with no matches', () => {
    const { engine, doc } = makeEngineWithDoc('hello world');
    engine.open('find', 'xyz');
    engine.setReplacement('abc');
    engine.replace();
    expect(doc.getLine(0)).toBe('hello world');
  });
});

describe('D — FindReplaceEngine: state notifications', () => {
  it('onDidChangeState fires when query changes', () => {
    const doc   = new Document('hello');
    const store = new DecorationStore();
    const e     = new FindReplaceEngine(doc, store.getOrCreate('f'), store.getOrCreate('fa'));

    let callCount = 0;
    const unsub = e.onDidChangeState(() => callCount++);

    e.open('find');
    e.setQuery('h');
    e.setQuery('he');
    expect(callCount).toBeGreaterThanOrEqual(3);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const doc   = new Document('hello');
    const store = new DecorationStore();
    const e     = new FindReplaceEngine(doc, store.getOrCreate('f'), store.getOrCreate('fa'));

    let callCount = 0;
    const unsub = e.onDidChangeState(() => callCount++);
    unsub();

    e.open('find');
    expect(callCount).toBe(0);
  });
});
