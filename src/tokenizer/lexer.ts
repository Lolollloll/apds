/**
 * APDS Tokenizer — Core Lexer
 *
 * Implements the single public function:
 *   lex(lineText: string, startState: TokenizerState): LexResult
 *
 * Contracts (all from Implementation Lock v1.0):
 *
 * LOCK-1  Persisted states: Default | LongString(level) | LongComment(level)
 *         | StringContinued(quote).  Nothing else crosses line boundaries.
 *
 * LOCK-2  Interpolated strings are strictly intra-line.  An unterminated
 *         backtick at EOL emits Invalid and returns DEFAULT_STATE.
 *
 * LOCK-3  All classification uses same-line context only.
 *         No previous-line token lookback is permitted.
 *
 * LOCK-8  Long comments open ONLY on '--[[' or '--[=*[' (no intervening
 *         chars between '--' and '[=*[').  Every other '--[' is a line comment.
 *
 * Purity: lex() depends only on (lineText, startState).
 *   – No DOM, no I/O, no globals mutated.
 *   – Fully unit-testable in isolation.
 *
 * Token coverage: the returned token array is contiguous and covers every
 * code unit of lineText exactly once.  No gaps, no zero-length tokens.
 */

import { TokenClass, type Token } from './tokenTypes';
import {
  DEFAULT_STATE,
  makeLongStringState,
  makeLongCommentState,
  makeStringContinuedState,
  type TokenizerState,
  type LexResult,
} from './tokenizerState';
import { ROBLOX_GLOBALS } from './robloxGlobals';
import { ROBLOX_TYPES }   from './robloxTypes';

// ---------------------------------------------------------------------------
// Keyword tables
// ---------------------------------------------------------------------------

/**
 * Hard reserved keywords — cannot be used as identifiers in Luau.
 */
const KEYWORDS: ReadonlySet<string> = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
  'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
  'return', 'then', 'true', 'until', 'while',
  'continue',  // Luau extension
]);

/**
 * Type-context soft-keywords.
 * These are highlighted as KeywordType regardless of surrounding context
 * (same-line-only heuristic per LOCK-3).
 */
const TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  'type',    // soft keyword for type alias declarations
  'typeof',  // Luau type-of operator (type-level, not runtime type())
  'export',  // soft keyword for export type declarations
]);

// ---------------------------------------------------------------------------
// Character helpers (operate on single-char strings)
// ---------------------------------------------------------------------------

function isDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function isHexDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) ||
         (c >= 65 && c <= 70) ||
         (c >= 97 && c <= 102);
}

function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) ||   // A-Z
         (c >= 97 && c <= 122) ||  // a-z
         c === 95 ||               // _
         c > 127;                  // non-ASCII (defensive; Luau is mostly ASCII)
}

function isIdentContinue(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isWhitespace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c === 32 || c === 9 || c === 13; // space, tab, CR
}

/** Returns the first position ≥ pos where text[pos] is not a space or tab. */
function skipSpaces(text: string, pos: number): number {
  while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos++;
  return pos;
}

// ---------------------------------------------------------------------------
// Long-bracket helpers
// ---------------------------------------------------------------------------

/**
 * Given the text and the position IMMEDIATELY AFTER the first '[', counts
 * leading '=' characters and checks whether they are followed by another '['.
 *
 * Returns the level (number of '=') on success, or -1 if this is not a valid
 * long-bracket opening.
 *
 * Examples (afterFirstBracket = position of the char after the initial '['):
 *   "[["  → afterFirstBracket points to second '[' → level 0
 *   "[=["  → afterFirstBracket points to '=' → level 1
 *   "[x"  → afterFirstBracket points to 'x' → -1
 */
function scanLongBracketOpen(text: string, afterFirstBracket: number): number {
  let pos = afterFirstBracket;
  let eqCount = 0;
  while (pos < text.length && text[pos] === '=') { eqCount++; pos++; }
  if (pos < text.length && text[pos] === '[') return eqCount;
  return -1;
}

/**
 * Scans for the long-bracket close pattern ]=^level] starting from bodyStart.
 * Emits exactly ONE token covering [tokenStart .. closeEnd) with class `cls`.
 *
 * If the close is found:  returns { closed: true,  nextPos: closeEnd }
 * If the close is absent: returns { closed: false, nextPos: text.length }
 *   (entire remaining line becomes the token)
 */
function consumeLongContent(
  text:       string,
  tokenStart: number,   // where the whole token begins (inclusive)
  bodyStart:  number,   // where to start searching for the close
  level:      number,
  cls:        TokenClass,
  tokens:     Token[],
): { closed: boolean; nextPos: number } {
  const closePattern = ']' + '='.repeat(level) + ']';
  const idx = text.indexOf(closePattern, bodyStart);
  if (idx !== -1) {
    const end = idx + closePattern.length;
    pushToken(tokens, tokenStart, end - tokenStart, cls);
    return { closed: true, nextPos: end };
  }
  pushToken(tokens, tokenStart, text.length - tokenStart, cls);
  return { closed: false, nextPos: text.length };
}

// ---------------------------------------------------------------------------
// String body scanner
// ---------------------------------------------------------------------------

interface StringBodyResult {
  readonly closed:        boolean;  // true  → found closing quote
  readonly isContinuation:boolean;  // true  → trailing backslash at EOL
  readonly nextPos:       number;   // position after the last consumed char
}

/**
 * Scans string content starting from `contentStart`, accumulating a segment
 * that began at `segOrigin` (which may be before contentStart to include an
 * opening quote char in the first String token).
 *
 * Emits String / StringEscape sub-tokens.  All tokens are closed before the
 * function returns.
 *
 * - closing quote found → closed=true
 * - trailing backslash at EOL → isContinuation=true, closed=false
 * - EOL without backslash → unterminated (error recovery), both false
 */
function scanStringBody(
  text:         string,
  contentStart: number,  // first char to scan (AFTER opening quote if fresh)
  segOrigin:    number,  // first char of the first String token segment
                         // (= position of opening quote for fresh strings,
                         //  = 0 for continuation lines)
  quote:        '"' | "'",
  tokens:       Token[],
): StringBodyResult {
  const len = text.length;
  let pos     = contentStart;
  let segStart = segOrigin;  // start of currently accumulating String span

  while (pos < len) {
    const ch = text[pos];

    // ── Closing quote ───────────────────────────────────────────────────────
    if (ch === quote) {
      // Flush accumulated String span (may include opening quote if fresh)
      if (pos > segStart) {
        pushToken(tokens, segStart, pos - segStart, TokenClass.String);
      }
      // Emit closing quote as its own String token
      pushToken(tokens, pos, 1, TokenClass.String);
      return { closed: true, isContinuation: false, nextPos: pos + 1 };
    }

    // ── Escape sequence ─────────────────────────────────────────────────────
    if (ch === '\\') {
      // Flush accumulated String span before the escape
      if (pos > segStart) {
        pushToken(tokens, segStart, pos - segStart, TokenClass.String);
      }

      // Trailing backslash → line continuation (LOCK-1: StringContinued state)
      if (pos + 1 >= len) {
        pushToken(tokens, pos, 1, TokenClass.StringEscape);
        return { closed: false, isContinuation: true, nextPos: len };
      }

      const escLen = measureEscapeSequence(text, pos);
      pushToken(tokens, pos, escLen, TokenClass.StringEscape);
      pos     += escLen;
      segStart = pos;
      continue;
    }

    pos++;
  }

  // ── End of line without closing quote ────────────────────────────────────
  // Unterminated string (lexical error).  Emit remaining content and
  // return Default state — do NOT propagate (LOCK-2 spirit for plain strings).
  if (pos > segStart) {
    pushToken(tokens, segStart, pos - segStart, TokenClass.String);
  }
  return { closed: false, isContinuation: false, nextPos: pos };
}

// ---------------------------------------------------------------------------
// Escape sequence measurement
// ---------------------------------------------------------------------------

/**
 * Returns the total length (in code units) of the escape sequence beginning
 * at `backslashPos` (where text[backslashPos] === '\\').
 * Never returns 0; returns at least 1 even for a lone trailing backslash
 * (caller must guard against pos+1 >= len before calling if needed).
 */
function measureEscapeSequence(text: string, backslashPos: number): number {
  if (backslashPos + 1 >= text.length) return 1;

  const next = text[backslashPos + 1];

  switch (next) {
    case 'a': case 'b': case 'f': case 'n': case 'r':
    case 't': case 'v': case '\\': case '"': case "'":
      return 2;

    case 'x': {
      // \xNN — consume up to 2 hex digits (may be malformed; best-effort)
      let end = backslashPos + 2;
      let count = 0;
      while (end < text.length && count < 2 && isHexDigit(text[end])) { end++; count++; }
      return end - backslashPos;
    }

    case 'u': {
      // \u{NNNN} — consume to matching '}'
      if (backslashPos + 2 < text.length && text[backslashPos + 2] === '{') {
        let end = backslashPos + 3;
        while (end < text.length && text[end] !== '}') end++;
        if (end < text.length) end++; // consume '}'
        return end - backslashPos;
      }
      return 2; // malformed
    }

    case 'z': {
      // \z — skip following horizontal whitespace
      let end = backslashPos + 2;
      while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
      return end - backslashPos;
    }

    default: {
      // Decimal escape \ddd (1–3 digits)
      if (next >= '0' && next <= '9') {
        let end = backslashPos + 1;
        let count = 0;
        while (end < text.length && count < 3 && text[end] >= '0' && text[end] <= '9') {
          end++; count++;
        }
        return end - backslashPos;
      }
      // Unknown escape — consume backslash + next char
      return 2;
    }
  }
}

// ---------------------------------------------------------------------------
// Number lexer
// ---------------------------------------------------------------------------

/**
 * Lexes a number literal starting at `startPos`.
 * Handles: decimal int, decimal float, scientific notation, hex, binary,
 * hex float, and underscore separators throughout.
 * Returns the position AFTER the last consumed character.
 */
function lexNumber(text: string, startPos: number, tokens: Token[]): number {
  let pos = startPos;
  const len = text.length;

  // ── Leading-dot float: .5 .5e3 ───────────────────────────────────────────
  if (text[pos] === '.') {
    pos++; // consume '.'
    pos = consumeDecDigits(text, pos);
    pos = consumeExponent(text, pos, false);
    pushToken(tokens, startPos, pos - startPos, TokenClass.Number);
    return pos;
  }

  // ── 0x / 0b prefix ────────────────────────────────────────────────────────
  if (text[pos] === '0' && pos + 1 < len) {
    const second = text[pos + 1];

    if (second === 'x' || second === 'X') {
      pos += 2;
      pos = consumeHexDigits(text, pos);
      // Hex float: optional fractional part '.' hexdigits [pP…]
      if (pos < len && text[pos] === '.') {
        pos++;
        pos = consumeHexDigits(text, pos);
      }
      // Hex float exponent [pP][+-]?decdigits
      if (pos < len && (text[pos] === 'p' || text[pos] === 'P')) {
        pos++;
        if (pos < len && (text[pos] === '+' || text[pos] === '-')) pos++;
        pos = consumeDecDigits(text, pos);
      }
      pushToken(tokens, startPos, pos - startPos, TokenClass.Number);
      return pos;
    }

    if (second === 'b' || second === 'B') {
      pos += 2;
      pos = consumeBinDigits(text, pos);
      pushToken(tokens, startPos, pos - startPos, TokenClass.Number);
      return pos;
    }
  }

  // ── Decimal integer / float ────────────────────────────────────────────────
  pos = consumeDecDigits(text, pos);

  // Fractional part — but beware '..' (concat) and '...' (vararg)
  if (pos < len && text[pos] === '.') {
    const afterDot = pos + 1;
    const nextIsAnotherDot = afterDot < len && text[afterDot] === '.';
    if (!nextIsAnotherDot) {
      pos++; // consume '.'
      pos = consumeDecDigits(text, pos);
    }
    // If nextIsAnotherDot we stop here; '..' / '...' will be lexed as operators.
  }

  pos = consumeExponent(text, pos, false);
  pushToken(tokens, startPos, pos - startPos, TokenClass.Number);
  return pos;
}

function consumeDecDigits(text: string, pos: number): number {
  while (pos < text.length && (isDigit(text[pos]) || text[pos] === '_')) pos++;
  return pos;
}

function consumeHexDigits(text: string, pos: number): number {
  while (pos < text.length && (isHexDigit(text[pos]) || text[pos] === '_')) pos++;
  return pos;
}

function consumeBinDigits(text: string, pos: number): number {
  while (pos < text.length &&
         (text[pos] === '0' || text[pos] === '1' || text[pos] === '_')) pos++;
  return pos;
}

/**
 * Tries to consume a decimal exponent [eE][+-]?[0-9_]+.
 * `allowHex` is reserved for future hex-float exponent handling (currently
 * hex floats use [pP] which is handled inline in lexNumber).
 */
function consumeExponent(text: string, pos: number, _allowHex: boolean): number {
  if (pos < text.length && (text[pos] === 'e' || text[pos] === 'E')) {
    const next = pos + 1 < text.length ? text[pos + 1] : '';
    if (next === '+' || next === '-' || isDigit(next)) {
      pos++;
      if (text[pos] === '+' || text[pos] === '-') pos++;
      pos = consumeDecDigits(text, pos);
    }
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Interpolated string lexer (LOCK-2: strictly intra-line)
// ---------------------------------------------------------------------------

/**
 * Lexes an interpolated string starting at `backtickPos` (text[backtickPos]
 * === '`').  The entire expression is consumed within the current line.
 *
 * An unterminated backtick at EOL emits the partial content and returns
 * DEFAULT_STATE — it NEVER propagates to the next line (LOCK-2).
 *
 * Returns the position after the last consumed char.
 */
function lexInterpString(
  text:         string,
  backtickPos:  number,
  tokens:       Token[],
): number {
  const len = text.length;
  let pos = backtickPos;

  // Emit opening backtick as InterpDelimiter
  pushToken(tokens, pos, 1, TokenClass.InterpDelimiter);
  pos++;

  while (pos < len) {
    const segStart = pos;

    // ── Scan literal portion (text before next { or ` or \) ─────────────────
    while (pos < len && text[pos] !== '{' && text[pos] !== '`' && text[pos] !== '\\') {
      pos++;
    }

    // Emit accumulated literal text as InterpString
    if (pos > segStart) {
      pushToken(tokens, segStart, pos - segStart, TokenClass.InterpString);
    }

    if (pos >= len) {
      // Unterminated — LOCK-2: do NOT propagate, just stop
      // (the opening backtick was already emitted; nothing more to do)
      return pos;
    }

    const ch = text[pos];

    // ── Closing backtick ─────────────────────────────────────────────────────
    if (ch === '`') {
      pushToken(tokens, pos, 1, TokenClass.InterpDelimiter);
      return pos + 1;
    }

    // ── Escape sequence inside interpolated literal ──────────────────────────
    if (ch === '\\') {
      if (pos + 1 >= len) {
        // Trailing backslash — LOCK-2: treat as invalid, stop
        pushToken(tokens, pos, 1, TokenClass.Invalid);
        return pos + 1;
      }
      const escLen = measureEscapeSequence(text, pos);
      pushToken(tokens, pos, escLen, TokenClass.StringEscape);
      pos += escLen;
      continue;
    }

    // ── Interpolation hole: { expr } ─────────────────────────────────────────
    if (ch === '{') {
      pushToken(tokens, pos, 1, TokenClass.InterpDelimiter);
      pos++;
      pos = lexInterpExpr(text, pos, tokens);
      // After lexInterpExpr, pos is either after '}' or at end-of-line.
      continue;
    }
  }

  // EOL without closing backtick — LOCK-2 compliant; return Default state implicitly
  return pos;
}

/**
 * Lexes the expression portion of an interpolation hole  { … }
 * starting at `pos` (immediately after the opening '{').
 *
 * Tracks brace depth so nested tables / function calls are handled correctly.
 * Strings inside the expression are consumed fully so their braces don't
 * accidentally close the hole.
 *
 * Returns position after the closing '}' InterpDelimiter, or text.length if
 * the line ends without closing the hole.
 */
function lexInterpExpr(
  text:   string,
  pos:    number,
  tokens: Token[],
): number {
  const len = text.length;
  let depth = 1;  // we consumed the opening '{' before calling

  while (pos < len && depth > 0) {
    const ch = text[pos];

    // ── Comments inside expression (consume to EOL) ──────────────────────────
    if (ch === '-' && pos + 1 < len && text[pos + 1] === '-') {
      // A comment ends the expression for this line (LOCK-2 in spirit)
      const start = pos;
      pos = len;
      pushToken(tokens, start, len - start, TokenClass.Comment);
      return pos;
    }

    // ── Opening brace (nested table / block) ─────────────────────────────────
    if (ch === '{') {
      pushToken(tokens, pos, 1, TokenClass.Bracket);
      depth++;
      pos++;
      continue;
    }

    // ── Closing brace ─────────────────────────────────────────────────────────
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        pushToken(tokens, pos, 1, TokenClass.InterpDelimiter);  // hole-close
        return pos + 1;
      }
      pushToken(tokens, pos, 1, TokenClass.Bracket);
      pos++;
      continue;
    }

    // ── String literals inside expression ────────────────────────────────────
    // Must be fully consumed so their braces don't affect depth.
    if (ch === '"' || ch === "'") {
      const quote = ch as '"' | "'";
      pos++;  // skip opening quote (include it in segment origin)
      const r = scanStringBody(text, pos, pos - 1, quote, tokens);
      pos = r.nextPos;
      // If string is unterminated / continuation, we just continue lexing
      // (the hole will be unterminated too; acceptable error recovery).
      continue;
    }

    // ── Long string inside expression ────────────────────────────────────────
    if (ch === '[') {
      const level = scanLongBracketOpen(text, pos + 1);
      if (level >= 0) {
        const bodyStart = pos + 2 + level; // pos + '[' + level×'=' + '['
        const r = consumeLongContent(text, pos, bodyStart, level, TokenClass.LongString, tokens);
        pos = r.nextPos;
        continue;
      }
    }

    // ── Whitespace ───────────────────────────────────────────────────────────
    if (isWhitespace(ch)) {
      const start = pos;
      while (pos < len && isWhitespace(text[pos])) pos++;
      pushToken(tokens, start, pos - start, TokenClass.Whitespace);
      continue;
    }

    // ── Identifiers / keywords ────────────────────────────────────────────────
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < len && isIdentContinue(text[pos])) pos++;
      const word = text.substring(start, pos);
      const cls  = classifyIdentifier(text, start, pos, false);
      pushToken(tokens, start, pos - start, cls);
      void word; // used indirectly via classifyIdentifier
      continue;
    }

    // ── Numbers ───────────────────────────────────────────────────────────────
    if (isDigit(ch) || (ch === '.' && pos + 1 < len && isDigit(text[pos + 1]))) {
      pos = lexNumber(text, pos, tokens);
      continue;
    }

    // ── Everything else (operators, punctuation, etc.) ────────────────────────
    // Emit as a single-char token (Operator or Delimiter or Bracket as appropriate)
    // We don't need full operator precision inside expressions; Operator covers it.
    pushToken(tokens, pos, 1, TokenClass.Operator);
    pos++;
  }

  return pos;
}

// ---------------------------------------------------------------------------
// Identifier classification (LOCK-3: same-line context only)
// ---------------------------------------------------------------------------

/**
 * Classifies an identifier token.
 *
 * Priority order:
 *   1. Hard keywords (always win, regardless of member access)
 *   2. Type-context soft-keywords (always win)
 *   3. Member-access guard: if preceded by '.' or ':' → Identifier (no table lookup)
 *   4. ROBLOX_TYPES table
 *   5. ROBLOX_GLOBALS table
 *   6. FunctionName lookahead: if immediately followed by '(' → FunctionName
 *   7. Identifier
 *
 * `endPos` is the position AFTER the last identifier character.
 * `memberAccess` is true if the previous meaningful token was '.' or ':'.
 */
function classifyIdentifier(
  text:         string,
  startPos:     number,
  endPos:       number,
  memberAccess: boolean,
): TokenClass {
  const word = text.substring(startPos, endPos);

  // 1 & 2. Keywords always take priority (LOCK-3: no cross-line needed here)
  if (KEYWORDS.has(word))      return TokenClass.Keyword;
  if (TYPE_KEYWORDS.has(word)) return TokenClass.KeywordType;

  // 3. Member-access guard: '.identifier' or ':identifier' → plain Identifier
  if (memberAccess) {
    // Still check FunctionName via lookahead even for member identifiers
    // (e.g. workspace:GetService("x") — GetService should be FunctionName)
    const nextNS = skipSpaces(text, endPos);
    if (nextNS < text.length && text[nextNS] === '(') return TokenClass.FunctionName;
    return TokenClass.Identifier;
  }

  // 4. Roblox types table
  if (ROBLOX_TYPES.has(word))   return TokenClass.RobloxType;

  // 5. Roblox globals table
  if (ROBLOX_GLOBALS.has(word)) return TokenClass.RobloxGlobal;

  // 6. FunctionName lookahead (call sites and definitions)
  //    e.g. `foo(` → FunctionName;  `function bar(` → bar is FunctionName
  const nextNS = skipSpaces(text, endPos);
  if (nextNS < text.length && text[nextNS] === '(') return TokenClass.FunctionName;

  // 7. Plain identifier
  return TokenClass.Identifier;
}

// ---------------------------------------------------------------------------
// Token push helper
// ---------------------------------------------------------------------------

function pushToken(tokens: Token[], start: number, length: number, cls: TokenClass): void {
  if (length > 0) tokens.push({ start, length, class: cls });
}

// ---------------------------------------------------------------------------
// Public API — lex()
// ---------------------------------------------------------------------------

/**
 * Tokenises a single line of Luau source text given the tokenizer state at
 * the start of that line.
 *
 * @param lineText   The text of the line, WITHOUT any trailing newline character.
 * @param startState The TokenizerState from the end of the previous line (or
 *                   DEFAULT_STATE for the first line).
 * @returns A LexResult containing the token array and the endState to pass as
 *          startState for the next line.
 */
export function lex(lineText: string, startState: TokenizerState): LexResult {
  const tokens: Token[] = [];
  let pos = 0;
  const len = lineText.length;

  // ══════════════════════════════════════════════════════════════════════════
  // Phase A — Handle non-Default start states
  // ══════════════════════════════════════════════════════════════════════════

  if (startState.kind === 'LongString') {
    // We are inside a long string from a previous line.
    // Scan this line for the closing ]=^level]; if not found the whole line
    // is LongString and we propagate the state.
    const r = consumeLongContent(
      lineText, 0, 0, startState.level, TokenClass.LongString, tokens,
    );
    if (!r.closed) return { tokens, endState: startState };
    pos = r.nextPos;
    // Fall through to Phase B with pos after the close delimiter.
  }

  else if (startState.kind === 'LongComment') {
    const r = consumeLongContent(
      lineText, 0, 0, startState.level, TokenClass.LongComment, tokens,
    );
    if (!r.closed) return { tokens, endState: startState };
    pos = r.nextPos;
  }

  else if (startState.kind === 'StringContinued') {
    // The whole-line content continues the string from the previous line.
    // There is no opening-quote char on this line.
    const r = scanStringBody(lineText, 0, 0, startState.quote, tokens);
    if (r.isContinuation) {
      // Another trailing backslash — still continuing
      return { tokens, endState: startState };
    }
    if (!r.closed) {
      // Unterminated (no closing quote, no backslash) — error recovery
      return { tokens, endState: DEFAULT_STATE };
    }
    pos = r.nextPos;
    // Fall through to Phase B for any remaining code after the closing quote.
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Phase B — Main Default-mode lexing loop
  //
  // Within-line context (LOCK-3: no cross-line lookback):
  //   lastMemberAccess — true if the last meaningful token was '.' or ':' (single)
  //                       used to suppress Roblox-table lookup on member names
  // ══════════════════════════════════════════════════════════════════════════

  let lastMemberAccess = false;

  while (pos < len) {
    const ch = lineText[pos];

    // ── 1. Whitespace ────────────────────────────────────────────────────────
    if (isWhitespace(ch)) {
      const start = pos;
      while (pos < len && isWhitespace(lineText[pos])) pos++;
      pushToken(tokens, start, pos - start, TokenClass.Whitespace);
      // Whitespace does NOT reset lastMemberAccess
      continue;
    }

    // ── 2. '-' — comment, '->', or subtraction ───────────────────────────────
    if (ch === '-') {
      // a) Comment: '--'
      if (pos + 1 < len && lineText[pos + 1] === '-') {
        const commentStart = pos;
        pos += 2; // skip '--'

        // LOCK-8: long comment ONLY if '--' is immediately followed by '[=*['
        if (pos < len && lineText[pos] === '[') {
          const level = scanLongBracketOpen(lineText, pos + 1);
          if (level >= 0) {
            const bodyStart = pos + 2 + level; // after '[=*['
            const r = consumeLongContent(
              lineText, commentStart, bodyStart, level,
              TokenClass.LongComment, tokens,
            );
            if (!r.closed) return { tokens, endState: makeLongCommentState(level) };
            pos = r.nextPos;
            lastMemberAccess = false;
            continue;
          }
        }

        // Regular line comment — consumes to EOL
        pushToken(tokens, commentStart, len - commentStart, TokenClass.Comment);
        break; // nothing can follow a line comment
      }

      // b) Arrow operator: '->'
      if (pos + 1 < len && lineText[pos + 1] === '>') {
        pushToken(tokens, pos, 2, TokenClass.Operator);
        pos += 2;
        lastMemberAccess = false;
        continue;
      }

      // c) Subtraction operator
      pushToken(tokens, pos, 1, TokenClass.Operator);
      pos++;
      lastMemberAccess = false;
      continue;
    }

    // ── 3. '[' — long string opening or table-index bracket ─────────────────
    if (ch === '[') {
      const level = scanLongBracketOpen(lineText, pos + 1);
      if (level >= 0) {
        const bodyStart = pos + 2 + level;
        const r = consumeLongContent(
          lineText, pos, bodyStart, level, TokenClass.LongString, tokens,
        );
        if (!r.closed) return { tokens, endState: makeLongStringState(level) };
        pos = r.nextPos;
        lastMemberAccess = false;
        continue;
      }
      // Plain opening bracket
      pushToken(tokens, pos, 1, TokenClass.Bracket);
      pos++;
      lastMemberAccess = false;
      continue;
    }

    // ── 4. String literals (' or ") ─────────────────────────────────────────
    if (ch === '"' || ch === "'") {
      const quote = ch as '"' | "'";
      // scanStringBody is called with segOrigin = pos (includes opening quote
      // in the first String span) and contentStart = pos+1.
      const r = scanStringBody(lineText, pos + 1, pos, quote, tokens);
      if (r.isContinuation) {
        return { tokens, endState: makeStringContinuedState(quote) };
      }
      if (!r.closed) {
        // Unterminated — error recovery, endState = Default
        return { tokens, endState: DEFAULT_STATE };
      }
      pos = r.nextPos;
      lastMemberAccess = false;
      continue;
    }

    // ── 5. Interpolated string (LOCK-2: strictly intra-line) ─────────────────
    if (ch === '`') {
      pos = lexInterpString(lineText, pos, tokens);
      lastMemberAccess = false;
      continue;
    }

    // ── 6a. Number starting with a digit ────────────────────────────────────
    if (isDigit(ch)) {
      pos = lexNumber(lineText, pos, tokens);
      lastMemberAccess = false;
      continue;
    }

    // ── 6b. Leading-dot float: .5  .5e3 ─────────────────────────────────────
    if (ch === '.' && pos + 1 < len && isDigit(lineText[pos + 1])) {
      pos = lexNumber(lineText, pos, tokens);
      lastMemberAccess = false;
      continue;
    }

    // ── 7. Identifier / keyword / roblox ────────────────────────────────────
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < len && isIdentContinue(lineText[pos])) pos++;
      const cls = classifyIdentifier(lineText, start, pos, lastMemberAccess);
      pushToken(tokens, start, pos - start, cls);
      lastMemberAccess = false;
      continue;
    }

    // ── 8. Attribute: @name ──────────────────────────────────────────────────
    if (ch === '@') {
      if (pos + 1 < len && isIdentStart(lineText[pos + 1])) {
        const start = pos;
        pos++;
        while (pos < len && isIdentContinue(lineText[pos])) pos++;
        pushToken(tokens, start, pos - start, TokenClass.Attribute);
      } else {
        pushToken(tokens, pos, 1, TokenClass.Invalid);
        pos++;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 9. '.' — '...', '..', or field-access delimiter ─────────────────────
    if (ch === '.') {
      if (pos + 2 < len && lineText[pos + 1] === '.' && lineText[pos + 2] === '.') {
        pushToken(tokens, pos, 3, TokenClass.Operator); // ...
        pos += 3;
      } else if (pos + 1 < len && lineText[pos + 1] === '.') {
        pushToken(tokens, pos, 2, TokenClass.Operator); // ..
        pos += 2;
      } else {
        pushToken(tokens, pos, 1, TokenClass.Delimiter); // field access '.'
        pos++;
        lastMemberAccess = true;  // '.' guards next identifier from table lookup
        continue;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 10. '=' — '==' or assignment '=' ────────────────────────────────────
    if (ch === '=') {
      if (pos + 1 < len && lineText[pos + 1] === '=') {
        pushToken(tokens, pos, 2, TokenClass.Operator);
        pos += 2;
      } else {
        pushToken(tokens, pos, 1, TokenClass.Operator);
        pos++;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 11. '~' — '~=' or Invalid ───────────────────────────────────────────
    if (ch === '~') {
      if (pos + 1 < len && lineText[pos + 1] === '=') {
        pushToken(tokens, pos, 2, TokenClass.Operator);
        pos += 2;
      } else {
        pushToken(tokens, pos, 1, TokenClass.Invalid); // '~' alone is invalid Luau
        pos++;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 12. '<' — '<=' or '<' ───────────────────────────────────────────────
    if (ch === '<') {
      if (pos + 1 < len && lineText[pos + 1] === '=') {
        pushToken(tokens, pos, 2, TokenClass.Operator);
        pos += 2;
      } else {
        pushToken(tokens, pos, 1, TokenClass.Operator);
        pos++;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 13. '>' — '>=' or '>' ───────────────────────────────────────────────
    if (ch === '>') {
      if (pos + 1 < len && lineText[pos + 1] === '=') {
        pushToken(tokens, pos, 2, TokenClass.Operator);
        pos += 2;
      } else {
        pushToken(tokens, pos, 1, TokenClass.Operator);
        pos++;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 14. '/' — '//' floor-div or '/' ─────────────────────────────────────
    if (ch === '/') {
      if (pos + 1 < len && lineText[pos + 1] === '/') {
        pushToken(tokens, pos, 2, TokenClass.Operator);
        pos += 2;
      } else {
        pushToken(tokens, pos, 1, TokenClass.Operator);
        pos++;
      }
      lastMemberAccess = false;
      continue;
    }

    // ── 15. ':' — '::' type-cast or ':' method-call ─────────────────────────
    if (ch === ':') {
      if (pos + 1 < len && lineText[pos + 1] === ':') {
        pushToken(tokens, pos, 2, TokenClass.Operator); // :: (type cast / annotation)
        pos += 2;
        lastMemberAccess = false; // '::' does NOT guard the next ident as a member
      } else {
        pushToken(tokens, pos, 1, TokenClass.Operator); // ':' method call
        pos++;
        lastMemberAccess = true;  // ':' guards next identifier from table lookup
      }
      continue;
    }

    // ── 16. Single-character operators ──────────────────────────────────────
    if (ch === '+' || ch === '*' || ch === '%' ||
        ch === '^' || ch === '#' || ch === '&' ||
        ch === '|' || ch === '?') {
      pushToken(tokens, pos, 1, TokenClass.Operator);
      pos++;
      lastMemberAccess = false;
      continue;
    }

    // ── 17. Brackets ────────────────────────────────────────────────────────
    if (ch === '(' || ch === ')' || ch === '{' || ch === '}' || ch === ']') {
      pushToken(tokens, pos, 1, TokenClass.Bracket);
      pos++;
      lastMemberAccess = false;
      continue;
    }

    // ── 18. Delimiters ───────────────────────────────────────────────────────
    if (ch === ',' || ch === ';') {
      pushToken(tokens, pos, 1, TokenClass.Delimiter);
      pos++;
      lastMemberAccess = false;
      continue;
    }

    // ── 19. Invalid ──────────────────────────────────────────────────────────
    // Accumulate consecutive unrecognised characters into one Invalid span.
    {
      const start = pos;
      while (
        pos < len &&
        !isWhitespace(lineText[pos]) &&
        !isIdentStart(lineText[pos]) &&
        !isDigit(lineText[pos]) &&
        lineText[pos] !== '-' &&
        lineText[pos] !== '[' &&
        lineText[pos] !== '"' &&
        lineText[pos] !== "'" &&
        lineText[pos] !== '`' &&
        lineText[pos] !== '.' &&
        lineText[pos] !== '=' &&
        lineText[pos] !== '~' &&
        lineText[pos] !== '<' &&
        lineText[pos] !== '>' &&
        lineText[pos] !== '/' &&
        lineText[pos] !== ':' &&
        lineText[pos] !== '+' &&
        lineText[pos] !== '*' &&
        lineText[pos] !== '%' &&
        lineText[pos] !== '^' &&
        lineText[pos] !== '#' &&
        lineText[pos] !== '&' &&
        lineText[pos] !== '|' &&
        lineText[pos] !== '?' &&
        lineText[pos] !== '(' &&
        lineText[pos] !== ')' &&
        lineText[pos] !== '{' &&
        lineText[pos] !== '}' &&
        lineText[pos] !== ']' &&
        lineText[pos] !== ',' &&
        lineText[pos] !== ';' &&
        lineText[pos] !== '@'
      ) {
        pos++;
      }
      if (pos === start) {
        // Safety: consume at least one char to prevent infinite loop
        pos++;
      }
      pushToken(tokens, start, pos - start, TokenClass.Invalid);
      lastMemberAccess = false;
      continue;
    }
  }

  return { tokens, endState: DEFAULT_STATE };
}
