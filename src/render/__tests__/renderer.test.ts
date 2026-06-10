/**
 * APDS Renderer — Phase 4 Test Suite
 *
 * Tests: Theme, TokenStyleMap, Viewport, LineLayout, RenderCache, Renderer.
 *
 * All tests are DOM-free. No browser APIs are used.
 *
 * Oracle pattern: RenderedLine.spans are verified against the Phase 1 lexer
 * directly, confirming the renderer faithfully reflects token output without
 * any independent lexing (LOCK-13).
 */

import { describe, it, expect } from 'vitest';

// Phase 4 modules under test
import { DARK_THEME, LIGHT_THEME, ThemeColorKey, type TokenStyle, type Theme } from '../Theme';
import { TokenStyleMap } from '../TokenStyleMap';
import { Viewport }      from '../Viewport';
import { LineLayout, type RenderedLine } from '../LineLayout';
import { RenderCache }   from '../RenderCache';
import { Renderer }      from '../Renderer';

// Phase 3 — needed to construct test documents
import { Document } from '../../editor/Document';
import { Cursor }   from '../../editor/Cursor';
import { Selection } from '../../editor/Selection';

// Phase 1 — oracle
import { lex }             from '../../tokenizer/lexer';
import { DEFAULT_STATE, type TokenizerState } from '../../tokenizer/tokenizerState';
import { TokenClass }      from '../../tokenizer/tokenTypes';
import type { Token }      from '../../tokenizer/tokenTypes';
import type { LineTokens } from '../../tokenizer/tokenizerEngine';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DEFAULT_LINE_HEIGHT = 20;
const DEFAULT_CHAR_WIDTH  = 8;

/** Build a Viewport with a window that shows `lines` lines from offset `scrollTop`. */
function vp(scrollTop = 0, visibleLines = 10, scrollLeft = 0): Viewport {
  return new Viewport(
    scrollTop,
    scrollLeft,
    DEFAULT_CHAR_WIDTH * 80,
    DEFAULT_LINE_HEIGHT * visibleLines,
    DEFAULT_LINE_HEIGHT,
    DEFAULT_CHAR_WIDTH,
  );
}

/** Build a Renderer over a Document with sensible defaults. */
function makeRenderer(
  doc: Document,
  viewport: Viewport = vp(),
  theme: Theme = DARK_THEME,
): Renderer {
  const r = new Renderer(doc, theme, {
    lineHeight: DEFAULT_LINE_HEIGHT,
    charWidth:  DEFAULT_CHAR_WIDTH,
    overscanLines: 0,   // No overscan — easier to reason about counts in tests
    cacheCapacity: 500,
  });
  r.setViewport(viewport);
  return r;
}

/** Oracle: run the Phase 1 lexer over `lines` and return token arrays. */
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

/** Minimal stub for LineTokens used in unit tests of cache/layout. */
function stubLineTokens(
  tokens: Token[],
  revision = 1,
): LineTokens {
  return { tokens, startState: 0, endState: 0, revision };
}

// ═══════════════════════════════════════════════════════════════════════════
// Theme
// ═══════════════════════════════════════════════════════════════════════════

describe('Theme — DARK_THEME', () => {
  it('has all ThemeColorKey entries', () => {
    for (const key of Object.values(ThemeColorKey)) {
      expect(DARK_THEME.colors[key]).toBeDefined();
      expect(typeof DARK_THEME.colors[key]).toBe('string');
    }
  });

  it('tokenStyles covers all lexer-emitted TokenClasses (0–20)', () => {
    for (let cls = 0; cls <= 20; cls++) {
      const style = (DARK_THEME.tokenStyles as Record<number, TokenStyle | undefined>)[cls];
      expect(style).toBeDefined();
      expect(typeof style!.color).toBe('string');
    }
  });

  it('fallbackStyle has a color property', () => {
    expect(typeof DARK_THEME.fallbackStyle.color).toBe('string');
    expect(DARK_THEME.fallbackStyle.color.length).toBeGreaterThan(0);
  });

  it('comments use italic font style', () => {
    const commentStyle = DARK_THEME.tokenStyles[TokenClass.Comment]!;
    expect(commentStyle.fontStyle).toBe('italic');
  });
});

describe('Theme — LIGHT_THEME', () => {
  it('has all ThemeColorKey entries', () => {
    for (const key of Object.values(ThemeColorKey)) {
      expect(LIGHT_THEME.colors[key]).toBeDefined();
    }
  });

  it('tokenStyles covers all lexer-emitted TokenClasses (0–20)', () => {
    for (let cls = 0; cls <= 20; cls++) {
      const style = (LIGHT_THEME.tokenStyles as Record<number, TokenStyle | undefined>)[cls];
      expect(style).toBeDefined();
    }
  });

  it('DARK and LIGHT themes have different background colors', () => {
    expect(DARK_THEME.colors[ThemeColorKey.Background])
      .not.toBe(LIGHT_THEME.colors[ThemeColorKey.Background]);
  });

  it('DARK and LIGHT keyword colors differ', () => {
    expect(DARK_THEME.tokenStyles[TokenClass.Keyword]!.color)
      .not.toBe(LIGHT_THEME.tokenStyles[TokenClass.Keyword]!.color);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TokenStyleMap
// ═══════════════════════════════════════════════════════════════════════════

describe('TokenStyleMap', () => {
  const map = new TokenStyleMap(DARK_THEME);

  it('constructs without error', () => {
    expect(map).toBeDefined();
  });

  it('getStyle returns non-null for all lexer classes 0–20', () => {
    for (let cls = 0; cls <= 20; cls++) {
      const style = map.getStyle(cls as TokenClass);
      expect(style).toBeDefined();
      expect(typeof style.color).toBe('string');
    }
  });

  it('toCSSText returns string containing "color:" for all classes 0–20', () => {
    for (let cls = 0; cls <= 20; cls++) {
      const css = map.toCSSText(cls as TokenClass);
      expect(css).toContain('color:');
    }
  });

  it('toCSSText for Comment class contains "font-style:italic"', () => {
    expect(map.toCSSText(TokenClass.Comment)).toContain('font-style:italic');
  });

  it('toCSSText for Identifier does NOT contain font-style', () => {
    expect(map.toCSSText(TokenClass.Identifier)).not.toContain('font-style');
  });

  it('getStyle for out-of-range semantic class returns fallback', () => {
    // TokenClass._SemanticStart = 100; never emitted but should not throw
    const style = map.getStyle(100 as TokenClass);
    expect(style).toBe(DARK_THEME.fallbackStyle);
  });

  it('rebuildFrom updates styles from new theme', () => {
    const darkKeywordCSS  = map.toCSSText(TokenClass.Keyword);
    map.rebuildFrom(LIGHT_THEME);
    const lightKeywordCSS = map.toCSSText(TokenClass.Keyword);
    expect(darkKeywordCSS).not.toBe(lightKeywordCSS);
    // Restore for subsequent tests
    map.rebuildFrom(DARK_THEME);
  });

  it('toCSSText is stable (same result on repeated calls)', () => {
    const a = map.toCSSText(TokenClass.String);
    const b = map.toCSSText(TokenClass.String);
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Viewport
// ═══════════════════════════════════════════════════════════════════════════

describe('Viewport — visible line range', () => {
  it('firstVisibleLine = 0 when scrollTop = 0', () => {
    expect(vp(0).firstVisibleLine).toBe(0);
  });

  it('firstVisibleLine = 2 when scrollTop = 40 and lineHeight = 20', () => {
    expect(vp(40).firstVisibleLine).toBe(2);
  });

  it('firstVisibleLine = 2 when scrollTop = 41 (floor)', () => {
    expect(vp(41).firstVisibleLine).toBe(2);
  });

  it('lastVisibleLine includes partially visible line', () => {
    // scrollTop=0, viewportHeight=200, lineHeight=20 → lines 0–9 visible (200/20)
    expect(vp(0, 10).lastVisibleLine).toBe(9);
  });

  it('lastVisibleLine includes partial final line', () => {
    // scrollTop=5, viewportHeight=200, lineHeight=20 → lines 0..10
    const v = new Viewport(5, 0, 640, 200, 20, 8);
    expect(v.lastVisibleLine).toBeGreaterThanOrEqual(10);
  });

  it('visibleLineCount ≥ 1 for any positive viewport', () => {
    expect(vp(0, 1).visibleLineCount).toBeGreaterThanOrEqual(1);
  });

  it('visibleLineCount reflects viewport height', () => {
    expect(vp(0, 5).visibleLineCount).toBe(5);
    expect(vp(0, 10).visibleLineCount).toBe(10);
  });
});

describe('Viewport — coordinate conversion', () => {
  const v = new Viewport(100, 50, 640, 400, 20, 8);

  it('lineToPixelY at scrollTop = 0', () => {
    const v0 = new Viewport(0, 0, 640, 400, 20, 8);
    expect(v0.lineToPixelY(0)).toBe(0);
    expect(v0.lineToPixelY(5)).toBe(100);
  });

  it('lineToPixelY accounts for scrollTop', () => {
    // line 5 is at pixel 100 from document top; viewport scrolled to 100 → pixelY = 0
    expect(v.lineToPixelY(5)).toBe(0);
    expect(v.lineToPixelY(0)).toBe(-100);
  });

  it('pixelToLine inverse of lineToPixelY (round trip)', () => {
    const v0 = new Viewport(0, 0, 640, 400, 20, 8);
    for (const line of [0, 1, 5, 10]) {
      const y = v0.lineToPixelY(line);
      expect(v0.pixelToLine(y)).toBe(line);
    }
  });

  it('columnToPixelX accounts for scrollLeft', () => {
    // col 10 = pixel 80; scrollLeft = 50 → x = 30
    expect(v.columnToPixelX(10)).toBe(30);
  });

  it('pixelToColumn rounds to nearest', () => {
    const v0 = new Viewport(0, 0, 640, 400, 20, 8);
    expect(v0.pixelToColumn(0)).toBe(0);
    expect(v0.pixelToColumn(8)).toBe(1);
    expect(v0.pixelToColumn(4)).toBe(1); // rounds up
  });
});

describe('Viewport — immutable updaters', () => {
  it('scrollToLine returns new Viewport, original unchanged', () => {
    const original = vp(0);
    const scrolled = original.scrollToLine(5);
    expect(scrolled.scrollTop).toBe(5 * DEFAULT_LINE_HEIGHT);
    expect(original.scrollTop).toBe(0); // unchanged
  });

  it('scrollToLine sets firstVisibleLine to target line', () => {
    const v2 = vp(0).scrollToLine(10);
    expect(v2.firstVisibleLine).toBe(10);
  });

  it('scrollToPixel clamps negative to 0', () => {
    const v2 = vp(100).scrollToPixel(-50, -10);
    expect(v2.scrollTop).toBe(0);
    expect(v2.scrollLeft).toBe(0);
  });

  it('withSize returns new Viewport with updated dimensions', () => {
    const original = vp(0, 10);
    const resized  = original.withSize(1280, 600);
    expect(resized.viewportWidth).toBe(1280);
    expect(resized.viewportHeight).toBe(600);
    expect(original.viewportHeight).toBe(DEFAULT_LINE_HEIGHT * 10);
  });

  it('guards against zero lineHeight', () => {
    const v0 = new Viewport(0, 0, 640, 400, 0, 8);
    expect(v0.lineHeight).toBe(1); // clamped
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LineLayout
// ═══════════════════════════════════════════════════════════════════════════

describe('LineLayout — spans', () => {
  const styleMap = new TokenStyleMap(DARK_THEME);

  function buildLine(
    lineIndex: number,
    text: string,
    tokens: LineTokens,
    sel = Selection.collapsed(Cursor.atStart()),
    cursor = Cursor.atStart(),
  ) {
    return LineLayout.buildLine(lineIndex, text, tokens, styleMap, sel, cursor);
  }

  it('span count matches token count', () => {
    const text  = 'local x = 1';
    const lt    = stubLineTokens(lex(text, DEFAULT_STATE).tokens as Token[]);
    const line  = buildLine(0, text, lt);
    expect(line.spans.length).toBe(lt.tokens.length);
  });

  it('span text slices match token positions', () => {
    const text   = 'local x = 1';
    const oracle = lex(text, DEFAULT_STATE).tokens as Token[];
    const lt     = stubLineTokens(oracle);
    const line   = buildLine(0, text, lt);
    for (let i = 0; i < oracle.length; i++) {
      const t = oracle[i];
      expect(line.spans[i].text).toBe(text.slice(t.start, t.start + t.length));
    }
  });

  it('span tokenClass matches token.class', () => {
    const text   = 'local x = 1';
    const oracle = lex(text, DEFAULT_STATE).tokens as Token[];
    const lt     = stubLineTokens(oracle);
    const line   = buildLine(0, text, lt);
    for (let i = 0; i < oracle.length; i++) {
      expect(line.spans[i].tokenClass).toBe(oracle[i].class);
    }
  });

  it('span cssText is a non-empty string', () => {
    const text = 'local x = 1';
    const lt   = stubLineTokens(lex(text, DEFAULT_STATE).tokens as Token[]);
    const line = buildLine(0, text, lt);
    for (const span of line.spans) {
      expect(typeof span.cssText).toBe('string');
      expect(span.cssText.length).toBeGreaterThan(0);
    }
  });

  it('spans concatenate to full line text', () => {
    const text = 'function foo(x, y)';
    const lt   = stubLineTokens(lex(text, DEFAULT_STATE).tokens as Token[]);
    const line = buildLine(0, text, lt);
    const joined = line.spans.map(s => s.text).join('');
    expect(joined).toBe(text);
  });

  it('empty line produces zero spans', () => {
    const lt   = stubLineTokens([]);
    const line = buildLine(0, '', lt);
    expect(line.spans.length).toBe(0);
    expect(line.text).toBe('');
  });

  it('revision mirrors LineTokens.revision', () => {
    const lt   = stubLineTokens([], 42);
    const line = buildLine(0, '', lt);
    expect(line.revision).toBe(42);
  });
});

describe('LineLayout — selection', () => {
  const styleMap = new TokenStyleMap(DARK_THEME);
  const text = 'hello world foo';

  function build(sel: Selection, lineIndex = 0) {
    const lt = stubLineTokens(lex(text, DEFAULT_STATE).tokens as Token[]);
    return LineLayout.buildLine(lineIndex, text, lt, styleMap, sel, Cursor.atStart());
  }

  it('collapsed selection: selectionStart = selectionEnd = -1', () => {
    const buf = { clamp: (p: {line:number;column:number}) => p, lineCount: 1, getLine: () => text };
    const cur = Cursor.create(buf as any, 0, 3);
    const sel = Selection.collapsed(cur);
    const line = build(sel);
    expect(line.selectionStart).toBe(-1);
    expect(line.selectionEnd).toBe(-1);
    expect(line.hasSelection).toBe(false);
  });

  it('selection entirely on this line', () => {
    const buf = { clamp: (p:{line:number;column:number}) => p, lineCount:1, getLine: () => text };
    const anchor = Cursor.create(buf as any, 0, 2);
    const active = Cursor.create(buf as any, 0, 7);
    const sel = Selection.fromCursors(anchor, active);
    const line = build(sel);
    expect(line.selectionStart).toBe(2);
    expect(line.selectionEnd).toBe(7);
    expect(line.hasSelection).toBe(true);
  });

  it('reversed selection (active before anchor) is still ordered', () => {
    const buf = { clamp: (p:{line:number;column:number}) => p, lineCount:2, getLine: () => text };
    const anchor = Cursor.create(buf as any, 0, 7);
    const active = Cursor.create(buf as any, 0, 2);
    const sel = Selection.fromCursors(anchor, active);
    const line = build(sel);
    expect(line.selectionStart).toBe(2);
    expect(line.selectionEnd).toBe(7);
  });

  it('multi-line: selection starts on this line → selectionEnd = lineText.length', () => {
    // Selection from (line 0, col 5) to (line 2, col 3)
    const doc = new Document('hello world foo\nmiddle\nlast line');
    const buf = (doc as any)._buf;
    const anchor = Cursor.create(buf, 0, 5);
    const active = Cursor.create(buf, 2, 3);
    const sel = Selection.fromCursors(anchor, active);
    const lt  = stubLineTokens(lex(text, DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(0, text, lt, styleMap, sel, Cursor.atStart());
    expect(line.selectionStart).toBe(5);
    expect(line.selectionEnd).toBe(text.length);
    expect(line.hasSelection).toBe(true);
  });

  it('multi-line: selection ends on this line → selectionStart = 0', () => {
    const doc = new Document('hello world foo\nmiddle\nlast line');
    const buf = (doc as any)._buf;
    const anchor = Cursor.create(buf, 0, 5);
    const active = Cursor.create(buf, 2, 3);
    const sel = Selection.fromCursors(anchor, active);
    const lastText = 'last line';
    const lt = stubLineTokens(lex(lastText, DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(2, lastText, lt, styleMap, sel, Cursor.atStart());
    expect(line.selectionStart).toBe(0);
    expect(line.selectionEnd).toBe(3);
  });

  it('multi-line: middle line fully covered → 0 to lineText.length', () => {
    const doc = new Document('hello world foo\nmiddle\nlast line');
    const buf = (doc as any)._buf;
    const anchor = Cursor.create(buf, 0, 5);
    const active = Cursor.create(buf, 2, 3);
    const sel = Selection.fromCursors(anchor, active);
    const midText = 'middle';
    const lt = stubLineTokens(lex(midText, DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(1, midText, lt, styleMap, sel, Cursor.atStart());
    expect(line.selectionStart).toBe(0);
    expect(line.selectionEnd).toBe(midText.length);
    expect(line.hasSelection).toBe(true);
  });

  it('selection on different line → no selection on this line', () => {
    const doc = new Document('line0\nline1');
    const buf = (doc as any)._buf;
    const anchor = Cursor.create(buf, 1, 0);
    const active = Cursor.create(buf, 1, 5);
    const sel = Selection.fromCursors(anchor, active);
    const lt = stubLineTokens(lex(text, DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(0, text, lt, styleMap, sel, Cursor.atStart());
    expect(line.hasSelection).toBe(false);
    expect(line.selectionStart).toBe(-1);
  });

  it('selection ending at column 0 of this line → hasSelection = false (empty range)', () => {
    const doc = new Document('line0\nline1');
    const buf = (doc as any)._buf;
    // Selection from line0 col2 to line1 col0 → line1 has [0,0) which is empty
    const anchor = Cursor.create(buf, 0, 2);
    const active = Cursor.create(buf, 1, 0);
    const sel = Selection.fromCursors(anchor, active);
    const lt = stubLineTokens(lex('line1', DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(1, 'line1', lt, styleMap, sel, Cursor.atStart());
    expect(line.hasSelection).toBe(false);
  });
});

describe('LineLayout — cursor', () => {
  const styleMap = new TokenStyleMap(DARK_THEME);

  it('isCursorLine = true when cursor is on this line', () => {
    const doc = new Document('hello');
    const buf = (doc as any)._buf;
    const cursor = Cursor.create(buf, 0, 3);
    const lt = stubLineTokens(lex('hello', DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(0, 'hello', lt, styleMap, Selection.collapsed(cursor), cursor);
    expect(line.isCursorLine).toBe(true);
    expect(line.cursorColumn).toBe(3);
  });

  it('isCursorLine = false and cursorColumn = -1 when cursor is on another line', () => {
    const doc = new Document('hello\nworld');
    const buf = (doc as any)._buf;
    const cursor = Cursor.create(buf, 1, 2);
    const lt = stubLineTokens(lex('hello', DEFAULT_STATE).tokens as Token[]);
    const line = LineLayout.buildLine(0, 'hello', lt, styleMap, Selection.collapsed(cursor), cursor);
    expect(line.isCursorLine).toBe(false);
    expect(line.cursorColumn).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RenderCache
// ═══════════════════════════════════════════════════════════════════════════

describe('RenderCache — basic operations', () => {
  it('isStale returns true for uncached line', () => {
    const cache = new RenderCache();
    expect(cache.isStale(0, 1)).toBe(true);
  });

  it('isStale returns false after set with matching revision', () => {
    const cache   = new RenderCache();
    const content = LineLayout.buildLine(
      0, '', stubLineTokens([]),
      new TokenStyleMap(DARK_THEME),
      Selection.collapsed(Cursor.atStart()),
      Cursor.atStart(),
    );
    cache.set(0, { lineIndex: 0, revision: 5, content });
    expect(cache.isStale(0, 5)).toBe(false);
  });

  it('isStale returns true when revision differs', () => {
    const cache   = new RenderCache();
    const content = LineLayout.buildLine(
      0, '', stubLineTokens([]),
      new TokenStyleMap(DARK_THEME),
      Selection.collapsed(Cursor.atStart()),
      Cursor.atStart(),
    );
    cache.set(0, { lineIndex: 0, revision: 5, content });
    expect(cache.isStale(0, 6)).toBe(true);
  });

  it('get returns undefined for uncached line', () => {
    expect(new RenderCache().get(99)).toBeUndefined();
  });

  it('get returns entry after set', () => {
    const cache   = new RenderCache();
    const content = LineLayout.buildLine(
      0, '', stubLineTokens([]),
      new TokenStyleMap(DARK_THEME),
      Selection.collapsed(Cursor.atStart()),
      Cursor.atStart(),
    );
    const entry = { lineIndex: 0, revision: 1, content };
    cache.set(0, entry);
    expect(cache.get(0)).toBe(entry);
  });

  it('invalidateLine removes the entry', () => {
    const cache   = new RenderCache();
    const content = LineLayout.buildLine(
      0, '', stubLineTokens([]),
      new TokenStyleMap(DARK_THEME),
      Selection.collapsed(Cursor.atStart()),
      Cursor.atStart(),
    );
    cache.set(0, { lineIndex: 0, revision: 1, content });
    cache.invalidateLine(0);
    expect(cache.get(0)).toBeUndefined();
    expect(cache.isStale(0, 1)).toBe(true);
  });

  it('invalidateFrom removes entries at and after startLine', () => {
    const cache = new RenderCache();
    const mk = (i: number) => {
      const content = LineLayout.buildLine(
        i, '', stubLineTokens([]),
        new TokenStyleMap(DARK_THEME),
        Selection.collapsed(Cursor.atStart()),
        Cursor.atStart(),
      );
      cache.set(i, { lineIndex: i, revision: 1, content });
    };
    mk(0); mk(1); mk(2); mk(3);
    cache.invalidateFrom(2);
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(1)).toBeDefined();
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(3)).toBeUndefined();
  });

  it('clear removes all entries', () => {
    const cache = new RenderCache();
    const content = LineLayout.buildLine(
      0, '', stubLineTokens([]),
      new TokenStyleMap(DARK_THEME),
      Selection.collapsed(Cursor.atStart()),
      Cursor.atStart(),
    );
    cache.set(0, { lineIndex: 0, revision: 1, content });
    cache.set(1, { lineIndex: 1, revision: 1, content });
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('RenderCache — onBufferSplice key shifting (LOCK-19)', () => {
  function makeCache(indices: number[]): RenderCache {
    const cache = new RenderCache(200);
    const content = LineLayout.buildLine(
      0, '', stubLineTokens([]),
      new TokenStyleMap(DARK_THEME),
      Selection.collapsed(Cursor.atStart()),
      Cursor.atStart(),
    );
    for (const i of indices) {
      cache.set(i, { lineIndex: i, revision: 1, content });
    }
    return cache;
  }

  it('inserting 2 lines at start shifts all keys by +2', () => {
    const cache = makeCache([0, 1, 2]);
    cache.onBufferSplice(0, 0, 2); // insert 2 lines at line 0
    expect(cache.get(2)).toBeDefined(); // was 0
    expect(cache.get(3)).toBeDefined(); // was 1
    expect(cache.get(4)).toBeDefined(); // was 2
    expect(cache.get(0)).toBeUndefined();
  });

  it('inserting 1 line at middle shifts later keys by +1', () => {
    const cache = makeCache([0, 1, 2, 3]);
    cache.onBufferSplice(2, 0, 1); // insert 1 line before line 2
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(1)).toBeDefined();
    expect(cache.get(2)).toBeUndefined(); // inserted; was dropped
    expect(cache.get(3)).toBeDefined();   // was 2
    expect(cache.get(4)).toBeDefined();   // was 3
  });

  it('deleting 1 line shifts later keys by -1', () => {
    const cache = makeCache([0, 1, 2, 3]);
    cache.onBufferSplice(1, 1, 0); // delete line 1; delta = -1
    // key=0 (<1) → stays at 0
    // key=1 (in [1,2)) → dropped (deleted line)
    // key=2 (>=2) → shifts to 2+(-1) = 1
    // key=3 (>=2) → shifts to 3+(-1) = 2
    expect(cache.get(0)).toBeDefined();   // unchanged
    expect(cache.get(1)).toBeDefined();   // was key 2, now at key 1
    expect(cache.get(2)).toBeDefined();   // was key 3, now at key 2
    expect(cache.get(3)).toBeUndefined(); // key 3 was shifted away
    expect(cache.get(4)).toBeUndefined(); // never existed
  });

  it('replace (remove 2, insert 1) shifts tail by -1', () => {
    const cache = makeCache([0, 1, 2, 3, 4]);
    cache.onBufferSplice(1, 2, 1); // remove lines 1-2, insert 1; delta = -1
    // key=0 (<1)        → stays at 0
    // key=1 (in [1,3))  → dropped (replaced)
    // key=2 (in [1,3))  → dropped (replaced)
    // key=3 (>=3)       → shifts to 3+(-1) = 2
    // key=4 (>=3)       → shifts to 4+(-1) = 3
    expect(cache.get(0)).toBeDefined();   // unchanged
    expect(cache.get(1)).toBeUndefined(); // replaced & not yet rebuilt
    expect(cache.get(2)).toBeDefined();   // was key 3, now at key 2
    expect(cache.get(3)).toBeDefined();   // was key 4, now at key 3
    expect(cache.get(4)).toBeUndefined(); // shifted away
  });

  it('no-op splice (0 removed, 0 inserted) preserves all entries', () => {
    const cache = makeCache([0, 1, 2]);
    cache.onBufferSplice(1, 0, 0);
    expect(cache.get(0)).toBeDefined();
    expect(cache.get(1)).toBeDefined();
    expect(cache.get(2)).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Renderer — integration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Renderer — construction & render basics', () => {
  it('render returns correct number of lines for viewport', () => {
    const doc = new Document(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'));
    const r   = makeRenderer(doc, vp(0, 5));
    const res = r.render();
    // overscan=0, 5 visible lines, doc has 20 lines → 5 lines
    expect(res.lines.length).toBe(5);
    expect(res.firstRenderedLine).toBe(0);
    expect(res.lastRenderedLine).toBe(4);
  });

  it('render clamps to document bounds at document end', () => {
    const doc = new Document('a\nb\nc'); // 3 lines
    const r   = makeRenderer(doc, vp(0, 10)); // viewport requests 10 lines
    const res = r.render();
    expect(res.lines.length).toBe(3);
    expect(res.lastRenderedLine).toBe(2);
  });

  it('render clamps at document start (firstVisibleLine < 0 is impossible via Viewport)', () => {
    const doc = new Document('only one line');
    const r   = makeRenderer(doc, vp(0, 10));
    const res = r.render();
    expect(res.firstRenderedLine).toBe(0);
    expect(res.lines.length).toBe(1);
  });

  it('empty document (1 line) renders 1 line', () => {
    const doc = new Document('');
    const r   = makeRenderer(doc, vp(0, 10));
    const res = r.render();
    expect(res.lines.length).toBe(1);
    expect(res.lines[0].lineIndex).toBe(0);
    expect(res.lines[0].text).toBe('');
  });
});

describe('Renderer — totalHeight and totalWidth', () => {
  it('totalHeight = doc.lineCount * lineHeight', () => {
    const doc = new Document('a\nb\nc\nd\ne'); // 5 lines
    const r   = makeRenderer(doc, vp(0, 10));
    const res = r.render();
    expect(res.totalHeight).toBe(5 * DEFAULT_LINE_HEIGHT);
  });

  it('totalWidth = maxLineLength * charWidth', () => {
    const doc = new Document('hello world\nhi\nfoo'); // max length = 11
    const r   = makeRenderer(doc, vp(0, 10));
    const res = r.render();
    expect(res.totalWidth).toBe(11 * DEFAULT_CHAR_WIDTH);
  });

  it('totalWidth reflects max line after edit', () => {
    const doc = new Document('short\nshort');
    const r   = makeRenderer(doc, vp(0, 10));
    // Move cursor to end of line 0 and insert a long string
    doc.moveCursor(Cursor.create((doc as any)._buf, 0, 5));
    doc.insertText(' and now this line is very long');
    r.notifyEdit(0, 1, 1);
    const res = r.render();
    const maxLen = Math.max(...[0,1].map(i => doc.getLine(i).length));
    expect(res.totalWidth).toBe(maxLen * DEFAULT_CHAR_WIDTH);
  });
});

describe('Renderer — token accuracy (LOCK-13 via oracle)', () => {
  it('rendered spans match Phase 1 lexer oracle for simple Luau code', () => {
    const source = 'local x = 1\nprint(x)\nreturn x';
    const doc = new Document(source);
    const r   = makeRenderer(doc, vp(0, 10));
    const res = r.render();
    const oracle = oracleTokens(source.split('\n'));

    for (let i = 0; i < res.lines.length; i++) {
      const rendered = res.lines[i];
      const expected = oracle[i];
      expect(rendered.spans.length).toBe(expected.length);
      for (let j = 0; j < expected.length; j++) {
        expect(rendered.spans[j].tokenClass).toBe(expected[j].class);
        expect(rendered.spans[j].text).toBe(
          doc.getLine(i).slice(expected[j].start, expected[j].start + expected[j].length)
        );
      }
    }
  });

  it('rendered spans correct for long-string content spanning lines', () => {
    const source = 'local s = [[\nhello inside\n]]';
    const doc = new Document(source);
    const r   = makeRenderer(doc, vp(0, 10));
    const res = r.render();
    const oracle = oracleTokens(source.split('\n'));

    for (let i = 0; i < res.lines.length; i++) {
      expect(res.lines[i].spans.length).toBe(oracle[i].length);
      for (let j = 0; j < oracle[i].length; j++) {
        expect(res.lines[i].spans[j].tokenClass).toBe(oracle[i][j].class);
      }
    }
  });
});

describe('Renderer — caching behaviour (LOCK-14, LOCK-15)', () => {
  it('second render() with no edit reuses cached content', () => {
    const doc = new Document('local x = 1\nprint(x)');
    const r   = makeRenderer(doc, vp(0, 10));

    // First render — populates cache
    const res1 = r.render();
    // Second render — should be cache hits; spans arrays should be same references
    const res2 = r.render();

    for (let i = 0; i < res1.lines.length; i++) {
      expect(res2.lines[i].spans).toBe(res1.lines[i].spans); // same array reference
      expect(res2.lines[i].revision).toBe(res1.lines[i].revision);
    }
  });

  it('pixelY changes on scroll without rebuilding spans (LOCK-15)', () => {
    // Use a doc with many lines and a viewport large enough that line 0
    // remains in the rendered range even after scrolling by 1 line.
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const doc = new Document(lines);
    // overscan=0, but viewport is 20 lines tall — shows all 20 lines.
    const r = new Renderer(doc, DARK_THEME, {
      lineHeight: DEFAULT_LINE_HEIGHT,
      charWidth:  DEFAULT_CHAR_WIDTH,
      overscanLines: 5, // ensure line 0 stays in range after small scroll
      cacheCapacity: 500,
    });

    r.setViewport(vp(0, 10));
    const res1 = r.render();

    // Scroll down by 1 line (20px) — with overscan=5 line 0 is still rendered
    r.setViewport(vp(DEFAULT_LINE_HEIGHT, 10));
    const res2 = r.render();

    const line0v1 = res1.lines.find(l => l.lineIndex === 0);
    const line0v2 = res2.lines.find(l => l.lineIndex === 0);
    expect(line0v1).toBeDefined();
    expect(line0v2).toBeDefined();
    // pixelY changes with scroll
    expect(line0v1!.pixelY).toBe(0);
    expect(line0v2!.pixelY).toBe(-DEFAULT_LINE_HEIGHT);

    // Span content is the same array reference — no rebuild (LOCK-15)
    expect(line0v2!.spans).toBe(line0v1!.spans);
  });

  it('after notifyEdit cache entry is stale and line is rebuilt', () => {
    const doc = new Document('local x = 1');
    const r   = makeRenderer(doc, vp(0, 10));
    const res1 = r.render();
    const spansBeforeEdit = res1.lines[0].spans;

    // Modify the document
    doc.moveCursor(Cursor.create((doc as any)._buf, 0, 11));
    doc.insertText(' + 2');
    r.notifyEdit(0, 1, 1); // line 0 replaced

    const res2 = r.render();
    // The line text changed, so spans should be rebuilt (different reference)
    expect(res2.lines[0].text).toBe('local x = 1 + 2');
    // Content is rebuilt — spans array is a new reference
    expect(res2.lines[0].spans).not.toBe(spansBeforeEdit);
  });

  it('setTheme() clears cache — all lines rebuilt (LOCK-17)', () => {
    const doc = new Document('local x = 1\nprint(x)');
    const r   = makeRenderer(doc, vp(0, 10));
    const res1 = r.render();
    const spans0Before = res1.lines[0].spans;

    r.setTheme(LIGHT_THEME);
    const res2 = r.render();

    // After theme change, all CSS text is different — spans array is rebuilt
    expect(res2.lines[0].spans).not.toBe(spans0Before);
    // CSS text should now use light theme colors
    const kw = res2.lines[0].spans.find(s => s.tokenClass === TokenClass.Keyword);
    if (kw) {
      const lightKwCSS = new TokenStyleMap(LIGHT_THEME).toCSSText(TokenClass.Keyword);
      expect(kw.cssText).toBe(lightKwCSS);
    }
  });
});

describe('Renderer — overscan', () => {
  it('overscanLines extends the rendered range', () => {
    // Viewport shows lines 5-9 (scrollTop=100, lineHeight=20, height=100)
    const doc = new Document(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'));
    const r = new Renderer(doc, DARK_THEME, {
      lineHeight: DEFAULT_LINE_HEIGHT,
      charWidth:  DEFAULT_CHAR_WIDTH,
      overscanLines: 3,
      cacheCapacity: 500,
    });
    r.setViewport(vp(100, 5)); // lines 5-9 visible
    const res = r.render();
    // With overscan=3: first=max(0,5-3)=2, last=min(19,9+3)=12
    expect(res.firstRenderedLine).toBe(2);
    expect(res.lastRenderedLine).toBe(12);
    expect(res.lines.length).toBe(11);
  });

  it('overscan is clamped at document start', () => {
    const doc = new Document(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'));
    const r = new Renderer(doc, DARK_THEME, {
      lineHeight: DEFAULT_LINE_HEIGHT,
      charWidth: DEFAULT_CHAR_WIDTH,
      overscanLines: 5,
      cacheCapacity: 500,
    });
    r.setViewport(vp(0, 3)); // lines 0-2 visible, overscan would go negative
    const res = r.render();
    expect(res.firstRenderedLine).toBe(0); // clamped to 0
  });
});

describe('Renderer — pixelY values', () => {
  it('pixelY = lineIndex * lineHeight - scrollTop for each rendered line', () => {
    const scrollTop = 40; // 2 lines scrolled
    const doc = new Document(Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'));
    const r   = makeRenderer(doc, vp(scrollTop, 5));
    const res = r.render();
    for (const line of res.lines) {
      const expectedPixelY = line.lineIndex * DEFAULT_LINE_HEIGHT - scrollTop;
      expect(line.pixelY).toBe(expectedPixelY);
    }
  });
});

describe('Renderer — multi-line state after edit', () => {
  it('spans correct after inserting into a long-string document', () => {
    const doc = new Document('local s = [[\nhello\n]]');
    const r   = makeRenderer(doc, vp(0, 10));
    r.render();

    // Insert text inside the long string
    doc.moveCursor(Cursor.create((doc as any)._buf, 1, 5));
    doc.insertText(' world');
    r.notifyEdit(1, 1, 1);

    const res = r.render();
    const oracle = oracleTokens([doc.getLine(0), doc.getLine(1), doc.getLine(2)]);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < oracle[i].length; j++) {
        expect(res.lines[i].spans[j].tokenClass).toBe(oracle[i][j].class);
      }
    }
  });
});
