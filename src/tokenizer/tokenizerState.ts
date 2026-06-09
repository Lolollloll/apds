/**
 * APDS Tokenizer — Tokenizer State
 *
 * Defines the COMPLETE, CLOSED set of persisted cross-line states.
 *
 * LOCK-1 (Implementation Lock v1.0): Persisted states are ONLY:
 *   Default | LongString(level) | LongComment(level) | StringContinued(quote)
 *
 * LOCK-2: Interpolation is strictly intra-line — InterpString/InterpExpr
 * are NEVER persisted and do NOT appear in this type.
 *
 * States are compared with statesEqual() (structural O(1) comparison).
 * Phase 2 will layer integer-interning on top of this module for the
 * line-state chain; consumers of this module must use statesEqual() and
 * never rely on object-reference identity.
 */

import type { Token } from './tokenTypes';

// ---------------------------------------------------------------------------
// State shapes
// ---------------------------------------------------------------------------

export interface DefaultState {
  readonly kind: 'Default';
}

/**
 * The lexer is inside a long string: [=*level*[ … ]=*level*]
 * `level` = number of '=' characters in the opening/closing delimiter (≥ 0).
 * Examples: [[…]] → level 0; [=[…]=] → level 1; [==[…]==] → level 2.
 */
export interface LongStringState {
  readonly kind:  'LongString';
  readonly level: number;
}

/**
 * The lexer is inside a long comment: --[=*level*[ … ]=*level*]
 * Same level semantics as LongStringState.
 */
export interface LongCommentState {
  readonly kind:  'LongComment';
  readonly level: number;
}

/**
 * The lexer is inside a normal string that was continued on the previous
 * line via a trailing backslash.  `quote` identifies which quote char opened
 * the string so the same char closes it.
 */
export interface StringContinuedState {
  readonly kind:  'StringContinued';
  readonly quote: '"' | "'";
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type TokenizerState =
  | DefaultState
  | LongStringState
  | LongCommentState
  | StringContinuedState;

// ---------------------------------------------------------------------------
// Well-known singleton
// ---------------------------------------------------------------------------

/** The starting state for every fresh document and every re-sync point. */
export const DEFAULT_STATE: DefaultState = Object.freeze({ kind: 'Default' });

// ---------------------------------------------------------------------------
// Factory functions (prefer these to raw object literals)
// ---------------------------------------------------------------------------

const longStringCache  = new Map<number, LongStringState>();
const longCommentCache = new Map<number, LongCommentState>();

/** Returns a (cached) LongStringState for the given level. */
export function makeLongStringState(level: number): LongStringState {
  let s = longStringCache.get(level);
  if (!s) { s = Object.freeze({ kind: 'LongString', level }); longStringCache.set(level, s); }
  return s;
}

/** Returns a (cached) LongCommentState for the given level. */
export function makeLongCommentState(level: number): LongCommentState {
  let s = longCommentCache.get(level);
  if (!s) { s = Object.freeze({ kind: 'LongComment', level }); longCommentCache.set(level, s); }
  return s;
}

const STRING_CONTINUED_DOUBLE: StringContinuedState = Object.freeze({ kind: 'StringContinued', quote: '"' });
const STRING_CONTINUED_SINGLE: StringContinuedState = Object.freeze({ kind: 'StringContinued', quote: "'" });

/** Returns the StringContinuedState for the given quote character. */
export function makeStringContinuedState(quote: '"' | "'"): StringContinuedState {
  return quote === '"' ? STRING_CONTINUED_DOUBLE : STRING_CONTINUED_SINGLE;
}

// ---------------------------------------------------------------------------
// Equality (O(1) structural comparison — mandatory; never use ===)
// ---------------------------------------------------------------------------

/**
 * Compares two TokenizerState values for equality.
 *
 * This is the ONLY correct way to compare states.  Object-reference equality
 * (===) MUST NOT be relied upon by consumers because Phase 2 may change how
 * states are constructed (integer interning).
 *
 * Current complexity: O(1) — one to two field comparisons.
 */
export function statesEqual(a: TokenizerState, b: TokenizerState): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'Default':         return true;
    case 'LongString':      return (b as LongStringState).level  === a.level;
    case 'LongComment':     return (b as LongCommentState).level === a.level;
    case 'StringContinued': return (b as StringContinuedState).quote === a.quote;
  }
}

// ---------------------------------------------------------------------------
// LexResult
// ---------------------------------------------------------------------------

/**
 * The output of lex(lineText, startState).
 *
 * `tokens`   — ordered, contiguous, covering the entire line.
 * `endState` — the state to pass as `startState` for the next line.
 *              Equals DEFAULT_STATE for the overwhelming majority of lines.
 *
 * `revision` is NOT part of Phase 1 (pure lexer layer); it lives in the
 * Phase 2 LineTokens cache wrapper.  It is intentionally absent here so the
 * pure function has no mutable state.
 */
export interface LexResult {
  readonly tokens:   readonly Token[];
  readonly endState: TokenizerState;
}
