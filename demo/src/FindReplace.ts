/**
 * APDS Demo — Find and Replace
 *
 * Self-contained find/replace engine for the editor.
 *
 * Architectural guarantees:
 *   - Search results are stored as DecorationRanges on the "find" DecorationSet
 *     (never entering LineContent, RenderCache, or the token system).
 *   - Search cache is keyed by (query, documentVersion, caseSensitive, useRegex).
 *     Results are reused across renders on the same version.
 *   - All text access is via doc.getLine() only (LOCK-13 compliance).
 *   - Document mutations are performed via doc.replaceRange() only (LOCK-21).
 *
 * Public API:
 *   open(mode)         — show find bar in 'find' or 'replace' mode
 *   close()            — hide the bar, clear highlights
 *   findNext()         — advance to next match
 *   findPrev()         — retreat to previous match
 *   replace()          — replace current match
 *   replaceAll()       — replace every match
 *   setQuery(q)        — update search string
 *   setReplacement(r)  — update replacement string
 *   setOptions(o)      — update case / regex flags
 */

import type { Document } from '../../src/editor/Document.js';
import type { DecorationSet } from './DecorationLayer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FindMatch {
  line:        number;
  startColumn: number;
  endColumn:   number;
}

export interface FindOptions {
  caseSensitive: boolean;
  useRegex:      boolean;
  wholeWord:     boolean;
}

export type FindMode = 'find' | 'replace';

export interface FindReplaceState {
  isOpen:        boolean;
  mode:          FindMode;
  query:         string;
  replacement:   string;
  options:       FindOptions;
  matchCount:    number;
  currentMatch:  number;  // 0-based index into matches, -1 = no match
}

// ─────────────────────────────────────────────────────────────────────────────
// Search engine helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a RegExp from a query string, with options. Returns null on invalid regex. */
function buildSearchRegex(query: string, options: FindOptions): RegExp | null {
  if (query.length === 0) return null;
  try {
    let pattern = options.useRegex ? query : escapeRegex(query);
    if (options.wholeWord && !options.useRegex) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = options.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    return null;  // invalid regex
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find all matches of `regex` in `text`. */
function findInLine(
  lineIndex: number,
  text: string,
  regex: RegExp,
): FindMatch[] {
  const matches: FindMatch[] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end   = start + m[0].length;
    if (m[0].length === 0) { regex.lastIndex++; continue; }  // skip zero-length
    matches.push({ line: lineIndex, startColumn: start, endColumn: end });
  }
  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// FindReplaceEngine
// ─────────────────────────────────────────────────────────────────────────────

export class FindReplaceEngine {
  private readonly _doc:  Document;
  private readonly _findSet: DecorationSet;
  private readonly _activeSet: DecorationSet;

  private _state: FindReplaceState = {
    isOpen:       false,
    mode:         'find',
    query:        '',
    replacement:  '',
    options:      { caseSensitive: false, useRegex: false, wholeWord: false },
    matchCount:   0,
    currentMatch: -1,
  };

  // Cache
  private _cachedQuery:    string  = '';
  private _cachedVersion:  number  = -1;
  private _cachedCase:     boolean = false;
  private _cachedRegex:    boolean = false;
  private _cachedWord:     boolean = false;
  private _matches:        FindMatch[] = [];

  private _onChangeCallbacks: Array<(state: FindReplaceState) => void> = [];

  // Colors (set from theme on construction or theme change)
  private _matchColor:       string = '#613315';
  private _activeMatchColor: string = '#9e6a03';

  constructor(
    doc:       Document,
    findSet:   DecorationSet,
    activeSet: DecorationSet,
  ) {
    this._doc       = doc;
    this._findSet   = findSet;
    this._activeSet = activeSet;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  get state(): Readonly<FindReplaceState> { return this._state; }
  get isOpen(): boolean { return this._state.isOpen; }

  setColors(matchColor: string, activeMatchColor: string): void {
    this._matchColor       = matchColor;
    this._activeMatchColor = activeMatchColor;
  }

  onDidChangeState(cb: (state: FindReplaceState) => void): () => void {
    this._onChangeCallbacks.push(cb);
    return () => {
      const idx = this._onChangeCallbacks.indexOf(cb);
      if (idx >= 0) this._onChangeCallbacks.splice(idx, 1);
    };
  }

  open(mode: FindMode = 'find', initialQuery?: string): void {
    this._state = {
      ...this._state,
      isOpen: true,
      mode,
    };
    if (initialQuery !== undefined) {
      this._state = { ...this._state, query: initialQuery };
    }
    this._runSearch();
    this._notify();
  }

  close(): void {
    this._state = { ...this._state, isOpen: false };
    this._findSet.clear();
    this._activeSet.clear();
    this._matches = [];
    this._notify();
  }

  setMode(mode: FindMode): void {
    this._state = { ...this._state, mode };
    this._notify();
  }

  setQuery(query: string): void {
    this._state = { ...this._state, query };
    this._runSearch();
    this._notify();
  }

  setReplacement(replacement: string): void {
    this._state = { ...this._state, replacement };
    this._notify();
  }

  setOptions(options: Partial<FindOptions>): void {
    this._state = { ...this._state, options: { ...this._state.options, ...options } };
    this._runSearch();
    this._notify();
  }

  findNext(): void {
    if (!this._state.isOpen) return;
    this._ensureSearchCurrent();
    if (this._matches.length === 0) return;

    const next = (this._state.currentMatch + 1) % this._matches.length;
    this._state = { ...this._state, currentMatch: next };
    this._updateDecorations();
    this._scrollToCurrentMatch();
    this._notify();
  }

  findPrev(): void {
    if (!this._state.isOpen) return;
    this._ensureSearchCurrent();
    if (this._matches.length === 0) return;

    const prev = this._state.currentMatch <= 0
      ? this._matches.length - 1
      : this._state.currentMatch - 1;
    this._state = { ...this._state, currentMatch: prev };
    this._updateDecorations();
    this._scrollToCurrentMatch();
    this._notify();
  }

  /**
   * Replace the current match with the replacement string.
   * Advances to the next match after replacing.
   */
  replace(): void {
    if (!this._state.isOpen) return;
    this._ensureSearchCurrent();
    if (this._matches.length === 0 || this._state.currentMatch < 0) return;

    const match = this._matches[this._state.currentMatch];
    if (!match) return;

    const replacement = this._resolveReplacement(match);
    this._doc.replaceRange(
      { line: match.line, column: match.startColumn },
      { line: match.line, column: match.endColumn },
      replacement,
    );

    // Re-run search (version changed) and move to next
    this._invalidateCache();
    this._runSearch();

    // Clamp currentMatch
    const clampedIdx = Math.min(this._state.currentMatch, this._matches.length - 1);
    this._state = {
      ...this._state,
      currentMatch: clampedIdx,
    };
    this._updateDecorations();
    this._notify();
  }

  /**
   * Replace all matches with the replacement string.
   * Replaces in reverse order to preserve column positions.
   */
  replaceAll(): void {
    if (!this._state.isOpen) return;
    this._ensureSearchCurrent();
    if (this._matches.length === 0) return;

    // Replace in reverse document order to keep positions valid
    const matches = [...this._matches].reverse();
    for (const match of matches) {
      const replacement = this._resolveReplacement(match);
      this._doc.replaceRange(
        { line: match.line, column: match.startColumn },
        { line: match.line, column: match.endColumn },
        replacement,
      );
    }

    this._invalidateCache();
    this._runSearch();
    this._state = { ...this._state, currentMatch: -1 };
    this._updateDecorations();
    this._notify();
  }

  /**
   * Call when document content changes so the cache is refreshed next search.
   * EditorHost calls this on every ContentChangeEvent.
   */
  onDocumentChanged(): void {
    if (!this._state.isOpen) return;
    this._ensureSearchCurrent();
    this._updateDecorations();
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _notify(): void {
    for (const cb of this._onChangeCallbacks) cb(this._state);
  }

  private _invalidateCache(): void {
    this._cachedVersion = -1;
  }

  private _ensureSearchCurrent(): void {
    const docVersion = this._doc.version;
    const { query, options } = this._state;
    if (
      this._cachedVersion === docVersion &&
      this._cachedQuery   === query &&
      this._cachedCase    === options.caseSensitive &&
      this._cachedRegex   === options.useRegex &&
      this._cachedWord    === options.wholeWord
    ) {
      return;  // cache is current
    }
    this._runSearch();
  }

  private _runSearch(): void {
    const { query, options } = this._state;
    this._findSet.clear();
    this._activeSet.clear();

    if (query.length === 0) {
      this._matches = [];
      this._state = { ...this._state, matchCount: 0, currentMatch: -1 };
      this._updateCache();
      return;
    }

    const regex = buildSearchRegex(query, options);
    if (!regex) {
      this._matches = [];
      this._state = { ...this._state, matchCount: 0, currentMatch: -1 };
      this._updateCache();
      return;
    }

    const allMatches: FindMatch[] = [];
    const lineCount = this._doc.lineCount;
    for (let li = 0; li < lineCount; li++) {
      const text    = this._doc.getLine(li);
      const matches = findInLine(li, text, regex);
      for (const m of matches) allMatches.push(m);
    }

    this._matches = allMatches;

    // Preserve current match index if still valid
    let currentMatch = this._state.currentMatch;
    if (allMatches.length === 0) {
      currentMatch = -1;
    } else if (currentMatch >= allMatches.length) {
      currentMatch = allMatches.length - 1;
    } else if (currentMatch < 0) {
      // Auto-select first match closest to cursor
      currentMatch = this._findNearestMatch();
    }

    this._state = { ...this._state, matchCount: allMatches.length, currentMatch };
    this._updateCache();
    this._updateDecorations();
  }

  private _updateCache(): void {
    const { query, options } = this._state;
    this._cachedVersion = this._doc.version;
    this._cachedQuery   = query;
    this._cachedCase    = options.caseSensitive;
    this._cachedRegex   = options.useRegex;
    this._cachedWord    = options.wholeWord;
  }

  private _findNearestMatch(): number {
    if (this._matches.length === 0) return -1;
    const cursor = this._doc.cursor;
    for (let i = 0; i < this._matches.length; i++) {
      const m = this._matches[i]!;
      if (m.line > cursor.line || (m.line === cursor.line && m.startColumn >= cursor.column)) {
        return i;
      }
    }
    return 0;  // wrap to first
  }

  private _updateDecorations(): void {
    // Group all matches by line → find set
    const lineMap = new Map<number, Array<{ start: number; end: number; isActive: boolean }>>();
    for (let i = 0; i < this._matches.length; i++) {
      const m        = this._matches[i]!;
      const isActive = i === this._state.currentMatch;
      let arr = lineMap.get(m.line);
      if (!arr) { arr = []; lineMap.set(m.line, arr); }
      arr.push({ start: m.startColumn, end: m.endColumn, isActive });
    }

    // Build decoration ranges per line
    const findRanges  = new Map<number, import('./DecorationLayer.js').DecorationRange[]>();
    const activeRanges = new Map<number, import('./DecorationLayer.js').DecorationRange[]>();

    for (const [line, entries] of lineMap) {
      const findArr:   import('./DecorationLayer.js').DecorationRange[] = [];
      const activeArr: import('./DecorationLayer.js').DecorationRange[] = [];

      for (const e of entries) {
        if (e.isActive) {
          activeArr.push({ startColumn: e.start, endColumn: e.end, color: this._activeMatchColor, inset: true });
        } else {
          findArr.push({ startColumn: e.start, endColumn: e.end, color: this._matchColor, inset: true });
        }
      }

      if (findArr.length > 0)   findRanges.set(line, findArr);
      if (activeArr.length > 0) activeRanges.set(line, activeArr);
    }

    this._findSet.setRanges(findRanges);
    this._activeSet.setRanges(activeRanges);
  }

  private _scrollToCurrentMatch(): void {
    if (this._state.currentMatch < 0) return;
    const match = this._matches[this._state.currentMatch];
    if (!match) return;
    // Move cursor to match start (EditorHost will scroll to it)
    this._doc.moveCursor(this._doc.createCursor(match.line, match.startColumn));
  }

  /** Resolve replacement string, handling regex capture groups ($1, $2...). */
  private _resolveReplacement(match: FindMatch): string {
    const { replacement, options, query } = this._state;
    if (!options.useRegex) return replacement;

    // For regex mode, re-run the regex on the matched text to get groups
    try {
      const regex = buildSearchRegex(query, { ...options });
      if (!regex) return replacement;
      const lineText   = this._doc.getLine(match.line);
      const matchedText = lineText.slice(match.startColumn, match.endColumn);
      const result = matchedText.replace(new RegExp(regex.source, regex.flags.replace('g', '')), replacement);
      return result;
    } catch {
      return replacement;
    }
  }
}
