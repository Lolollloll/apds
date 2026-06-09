/**
 * APDS Tokenizer — Token Types
 *
 * Foundational value types for the lexer layer.
 * These are line-relative, immutable value objects.
 * The `class` field is a stable integer enum — theme switching
 * never requires re-tokenisation; only CSS variables change.
 */

// ---------------------------------------------------------------------------
// TokenClass
// ---------------------------------------------------------------------------

/**
 * A closed, versioned integer enum.
 * Adding a class is additive (new CSS variable + lexer rule).
 * Existing values NEVER renumber within a release (cache compatibility).
 *
 * Semantic-upgrade slots (20-29) are reserved for V3 diagnostics /
 * autocomplete overlay passes; they are never emitted by the pure lexer.
 */
export enum TokenClass {
  // ── General ──────────────────────────────────────────────────────────────
  Default         = 0,  // unclassified / plain (should not appear in practice)
  Whitespace      = 1,

  // ── Language keywords ────────────────────────────────────────────────────
  Keyword         = 2,  // reserved Luau keywords (local, function, if, …)
  KeywordType     = 3,  // type-context soft-keywords (type, typeof, export)

  // ── Identifiers ──────────────────────────────────────────────────────────
  Identifier      = 4,
  RobloxGlobal    = 5,  // recognised Roblox/Luau runtime globals (game, task, …)
  RobloxType      = 6,  // recognised Roblox datatype constructors (Vector3, CFrame, …)
  FunctionName    = 7,  // identifier immediately followed by '(' (lexical heuristic)

  // ── Literals ─────────────────────────────────────────────────────────────
  Number          = 8,  // dec, float, hex, binary, hex-float, with _ separators
  String          = 9,  // '…' and "…" (opening/body/closing quote chars)
  LongString      = 10, // [[ … ]] and [=*[ … ]=*] (whole token incl. delimiters)
  StringEscape    = 11, // \n \t \xNN \u{…} etc. within a String
  InterpString    = 12, // literal-text portion of a `…` interpolated string
  InterpDelimiter = 13, // the ` backtick and the { } hole delimiters

  // ── Comments ─────────────────────────────────────────────────────────────
  Comment         = 14, // -- … (to end of line)
  LongComment     = 15, // --[[ … ]] and --[=*[ … ]=*]

  // ── Punctuation ──────────────────────────────────────────────────────────
  Operator        = 16, // + - * / // % ^ # == ~= < > <= >= = .. ... -> : :: & | ?
  Delimiter       = 17, // , ; .  (field-access dot; NOT .. or ...)
  Bracket         = 18, // ( ) { } [ ]  — used by BracketMatcher

  // ── Other ────────────────────────────────────────────────────────────────
  Attribute       = 19, // @native, @checked Luau attributes (whole @identifier)
  Invalid         = 20, // lexically invalid character run

  // ── Reserved for V3 semantic-overlay passes (never emitted by lexer) ─────
  _SemanticStart  = 100,
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/**
 * A typed span within a *single* line.
 * - Positions are 0-based UTF-16 code-unit column offsets within the line.
 * - Tokens are contiguous and cover the entire line (no gaps).
 * - Tokens never cross line boundaries.
 * - Zero-length tokens are never emitted.
 */
export interface Token {
  readonly start:  number;      // column of first code unit (inclusive)
  readonly length: number;      // span length in UTF-16 code units (> 0)
  readonly class:  TokenClass;  // classification (note: 'class' is valid TS property key)
}
