/**
 * APDS Demo — Bracket Matcher
 *
 * Finds the matching bracket for the character at (or before) the cursor
 * position using the document's existing token data. Results are delivered
 * as DecorationRanges to the "bracket" DecorationSet — they never enter
 * LineContent, RenderCache, or the tokenizer.
 *
 * Rules:
 *   - Match pairs: () [] {}
 *   - Only considers TokenClass.Bracket tokens (emitted by the lexer for
 *     bracket characters OUTSIDE strings and comments). String and comment
 *     suppression is handled automatically by the existing lexer.
 *   - Searches forward (for open bracket) or backward (for close bracket)
 *     up to MAX_SEARCH_LINES away from the cursor.
 *   - Updates on every SelectionChangeEvent (cursor move).
 *   - Stateless pure scan: no caching, no internal mutation between calls.
 *
 * Architectural guarantees:
 *   - Reads only doc.getLineTokens(), doc.getLine(), doc.cursor
 *   - Never calls lex() directly
 *   - Never writes to Document
 *   - Output: two DecorationRanges (one per bracket) or none
 */

import type { Document } from '../../src/editor/Document.js';
import { TokenClass }    from '../../src/tokenizer/tokenTypes.js';
import type { DecorationSet, DecorationRange } from './DecorationLayer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SEARCH_LINES = 500;

const OPEN_BRACKETS:  ReadonlySet<string> = new Set(['(', '[', '{']);
const CLOSE_BRACKETS: ReadonlySet<string> = new Set([')', ']', '}']);

const PAIR: Readonly<Record<string, string>> = {
  '(': ')', '[': ']', '{': '}',
  ')': '(', ']': '[', '}': '{',
};

// ─────────────────────────────────────────────────────────────────────────────
// Token position shape
// ─────────────────────────────────────────────────────────────────────────────

interface BracketPos {
  line:   number;
  start:  number;   // column start (inclusive)
  end:    number;   // column end   (exclusive)
  char:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BracketMatcher
// ─────────────────────────────────────────────────────────────────────────────

export class BracketMatcher {
  private readonly _doc: Document;
  private readonly _set: DecorationSet;

  constructor(doc: Document, bracketSet: DecorationSet) {
    this._doc = doc;
    this._set = bracketSet;
  }

  /**
   * Update bracket highlights for the current cursor position.
   * Called by EditorHost on every SelectionChangeEvent.
   * Returns true if a match was found and highlighted.
   */
  update(matchColor: string): boolean {
    this._set.clear();

    const cursor    = this._doc.cursor;
    const curLine   = cursor.line;
    const curCol    = cursor.column;

    // Find a bracket token at or immediately before the cursor
    const origin = this._findBracketAtCursor(curLine, curCol);
    if (!origin) return false;

    const target = this._findMatchingBracket(origin);
    if (!target) return false;

    // Build decoration ranges
    const makeRange = (b: BracketPos): DecorationRange => ({
      startColumn: b.start,
      endColumn:   b.end,
      color:       matchColor,
      inset:       false,
    });

    const originRanges = this._set.getRanges(origin.line).slice();
    originRanges.push(makeRange(origin));
    this._set.setLine(origin.line, originRanges);

    if (target.line === origin.line) {
      const combined = this._set.getRanges(origin.line).slice();
      combined.push(makeRange(target));
      this._set.setLine(origin.line, combined);
    } else {
      const targetRanges = this._set.getRanges(target.line).slice();
      targetRanges.push(makeRange(target));
      this._set.setLine(target.line, targetRanges);
    }

    return true;
  }

  /** Clear bracket highlights (call when editor loses focus, etc.). */
  clear(): void {
    this._set.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find a Bracket token at or immediately before the cursor on `curLine`.
   * Tries curCol-1 first (just typed a bracket), then curCol (cursor is on it).
   */
  private _findBracketAtCursor(curLine: number, curCol: number): BracketPos | null {
    const lt   = this._doc.getLineTokens(curLine);
    const text = this._doc.getLine(curLine);

    for (const tok of lt.tokens) {
      if (tok.class !== TokenClass.Bracket) continue;
      const tokEnd = tok.start + tok.length;

      // Cursor is right after this token OR on this token
      if (
        (tok.start < curCol && tokEnd <= curCol) ||
        (tok.start === curCol)
      ) {
        // Use the last character of the token at the relevant position
        const col = (tok.start < curCol && tokEnd <= curCol)
          ? tokEnd - 1
          : tok.start;
        const ch = text[col];
        if (ch !== undefined && (OPEN_BRACKETS.has(ch) || CLOSE_BRACKETS.has(ch))) {
          return { line: curLine, start: col, end: col + 1, char: ch };
        }
      }
    }
    return null;
  }

  /**
   * Walk the document to find the matching bracket for `origin`.
   * Uses a depth counter to handle nested brackets.
   * Only crosses Bracket tokens (strings and comments are already excluded
   * by the lexer, which only emits Bracket for real bracket chars).
   */
  private _findMatchingBracket(origin: BracketPos): BracketPos | null {
    const isOpen = OPEN_BRACKETS.has(origin.char);
    const target = PAIR[origin.char]!;
    let depth = 1;

    if (isOpen) {
      // Search forward
      return this._searchForward(origin, target, depth);
    } else {
      // Search backward
      return this._searchBackward(origin, target, depth);
    }
  }

  private _searchForward(
    origin: BracketPos,
    closeChar: string,
    depth: number,
  ): BracketPos | null {
    const doc    = this._doc;
    const maxLine = Math.min(doc.lineCount - 1, origin.line + MAX_SEARCH_LINES);

    for (let li = origin.line; li <= maxLine; li++) {
      const lt   = doc.getLineTokens(li);
      const text = doc.getLine(li);

      for (const tok of lt.tokens) {
        if (tok.class !== TokenClass.Bracket) continue;

        // On the origin line, skip up to and including the origin column
        if (li === origin.line && tok.start <= origin.start) continue;

        for (let ci = 0; ci < tok.length; ci++) {
          const col = tok.start + ci;
          const ch  = text[col];
          if (ch === undefined) continue;

          if (ch === origin.char) {
            depth++;
          } else if (ch === closeChar) {
            depth--;
            if (depth === 0) {
              return { line: li, start: col, end: col + 1, char: ch };
            }
          }
        }
      }
    }
    return null;
  }

  private _searchBackward(
    origin: BracketPos,
    openChar: string,
    depth: number,
  ): BracketPos | null {
    const doc    = this._doc;
    const minLine = Math.max(0, origin.line - MAX_SEARCH_LINES);

    for (let li = origin.line; li >= minLine; li--) {
      const lt   = doc.getLineTokens(li);
      const text = doc.getLine(li);

      // Collect bracket tokens for this line, then iterate in reverse
      const bracketToks = lt.tokens.filter(t => t.class === TokenClass.Bracket);

      for (let ti = bracketToks.length - 1; ti >= 0; ti--) {
        const tok = bracketToks[ti]!;

        // On origin line, skip the origin token and anything after it
        if (li === origin.line && tok.start >= origin.start) continue;

        // Iterate chars within this token in reverse
        for (let ci = tok.length - 1; ci >= 0; ci--) {
          const col = tok.start + ci;
          const ch  = text[col];
          if (ch === undefined) continue;

          if (ch === origin.char) {
            depth++;
          } else if (ch === openChar) {
            depth--;
            if (depth === 0) {
              return { line: li, start: col, end: col + 1, char: ch };
            }
          }
        }
      }
    }
    return null;
  }
}
