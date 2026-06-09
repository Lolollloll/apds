/**
 * APDS Autocomplete — CompletionContext
 *
 * Snapshot of the editor state at the moment autocomplete is triggered.
 * Passed to every CompletionProvider so providers never need to query
 * Document themselves.
 *
 * Architecture contract
 * ─────────────────────
 * • CompletionContext is built by CompletionService from Document state.
 * • It is immutable after construction.
 * • Providers read it; they never mutate Document.
 * • Token data comes from Document.getLineTokens() — no direct lexer calls.
 *
 * Prefix extraction rules
 * ───────────────────────
 * The "prefix" is the identifier fragment immediately before the cursor on the
 * current line.  Rules:
 *   1. Walk backwards from cursor.column through ident-continue characters
 *      (a-z, A-Z, 0-9, _).
 *   2. Stop at any non-ident character (operators, spaces, brackets, etc.).
 *   3. The extracted slice is the prefix.
 *   4. Empty prefix ("") is valid — it means "show all completions".
 *
 * Trigger kind
 * ────────────
 * • 'character': user typed a new character (real-time filtering).
 * • 'invoked':   user explicitly pressed the completion shortcut.
 * • 'contentChange': a ContentChangeEvent propagated to CompletionService.
 */

import type { Token } from '../tokenizer/tokenTypes.js';

// ---------------------------------------------------------------------------
// TriggerKind
// ---------------------------------------------------------------------------

export type TriggerKind = 'character' | 'invoked' | 'contentChange';

// ---------------------------------------------------------------------------
// CompletionContext
// ---------------------------------------------------------------------------

export interface CompletionContext {
  /** 0-based line index of the cursor. */
  readonly line: number;

  /** 0-based column (UTF-16 code-unit offset) of the cursor. */
  readonly column: number;

  /** Full text of the cursor's line. */
  readonly lineText: string;

  /**
   * Identifier fragment immediately before the cursor.
   * Empty string if the cursor is not preceded by an identifier character.
   */
  readonly prefix: string;

  /**
   * Column where `prefix` starts.
   * The completion session uses this as the replace-start for insertion.
   * Equals `column - prefix.length`.
   */
  readonly prefixStart: number;

  /** Tokenized spans for the cursor line, from Document.getLineTokens(). */
  readonly lineTokens: readonly Token[];

  /**
   * Monotonic document version at the time context was built.
   * Providers may cache results keyed on (version, line, column).
   */
  readonly documentVersion: number;

  /** How autocomplete was triggered. */
  readonly triggerKind: TriggerKind;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Extract the identifier prefix ending at `column` in `lineText`.
 *
 * Returns { prefix, prefixStart }.
 * Pure function — no Document access needed.
 */
export function extractPrefix(
  lineText: string,
  column: number,
): { prefix: string; prefixStart: number } {
  // Clamp column to valid range (guards against empty line or post-deletion cursor)
  const col = Math.max(0, Math.min(column, lineText.length));
  let start = col;
  while (start > 0) {
    const ch = lineText[start - 1];
    if (ch === undefined || !isIdentContinue(ch)) break;
    start--;
  }
  return {
    prefix:      lineText.slice(start, col),
    prefixStart: start,
  };
}

/** Build a CompletionContext from raw Document state. */
export function buildContext(
  line: number,
  column: number,
  lineText: string,
  lineTokens: readonly Token[],
  documentVersion: number,
  triggerKind: TriggerKind,
): CompletionContext {
  const { prefix, prefixStart } = extractPrefix(lineText, column);
  return {
    line,
    column,
    lineText,
    prefix,
    prefixStart,
    lineTokens,
    documentVersion,
    triggerKind,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isIdentContinue(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90)   // A-Z
      || (c >= 97 && c <= 122)  // a-z
      || (c >= 48 && c <= 57)   // 0-9
      || c === 95               // _
      || c > 127;               // non-ASCII (mirrors lexer.ts)
}
