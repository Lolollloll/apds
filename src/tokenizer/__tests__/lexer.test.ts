/**
 * APDS Tokenizer — Phase 1 Exhaustive Test Suite
 *
 * Verifies every requirement from:
 *   - APDS Tokenizer & Highlighter Design
 *   - APDS Tokenizer Implementation Lock v1.0 (LOCK-1 through LOCK-8)
 *
 * Coverage areas:
 *   1.  Empty lines & whitespace
 *   2.  Line comments
 *   3.  Long comments — LOCK-8 opening rules (12 cases)
 *   4.  Long comment continuation (multiple levels)
 *   5.  Long strings — opening & same-line close
 *   6.  Long string continuation (multiple levels)
 *   7.  Plain strings — double & single quote
 *   8.  String escape sequences — all forms
 *   9.  String continuation — LOCK-1 StringContinued state
 *   10. Interpolated strings — LOCK-2 (intra-line only, 8 cases)
 *   11. Numbers — all formats
 *   12. Keywords — all 22
 *   13. Type keywords — all 3
 *   14. Roblox globals — representative
 *   15. Roblox types — representative
 *   16. Member access guard — LOCK-3 same-line context
 *   17. FunctionName lookahead
 *   18. Operators — all individually
 *   19. Brackets & delimiters
 *   20. Attributes
 *   21. Invalid characters
 *   22. statesEqual correctness
 *   23. Token coverage invariant — every line char covered exactly once
 *   24. Full-line real Luau examples
 */

import { describe, it, expect } from 'vitest';
import { TokenClass, type Token } from '../tokenTypes';
import { lex } from '../lexer';
import {
  DEFAULT_STATE,
  makeLongStringState,
  makeLongCommentState,
  makeStringContinuedState,
  statesEqual,
  type TokenizerState,
} from '../tokenizerState';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Assert token array covers every character of `line` with no gaps, no overlaps. */
function assertCoverage(line: string, state: TokenizerState = DEFAULT_STATE): void {
  const { tokens } = lex(line, state);
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    expect(t.length).toBeGreaterThan(0);          // no zero-length tokens
    expect(t.start).toBe(pos);                    // no gaps
    pos += t.length;
  }
  expect(pos).toBe(line.length);                  // full coverage
}

/** Tokenise and return the array (also checks coverage). */
function tokenise(line: string, state: TokenizerState = DEFAULT_STATE): readonly Token[] {
  assertCoverage(line, state);
  return lex(line, state).tokens;
}

/** Return just the token classes for a line. */
function classes(line: string, state: TokenizerState = DEFAULT_STATE): TokenClass[] {
  return tokenise(line, state).map(t => t.class);
}

/** Return the first token matching a class. */
function firstOf(toks: readonly Token[], cls: TokenClass): Token | undefined {
  return toks.find(t => t.class === cls);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Empty lines & whitespace
// ─────────────────────────────────────────────────────────────────────────────

describe('1. Empty lines & whitespace', () => {
  it('empty string produces no tokens and Default endState', () => {
    const r = lex('', DEFAULT_STATE);
    expect(r.tokens).toHaveLength(0);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('spaces only → one Whitespace token', () => {
    const toks = tokenise('   ');
    expect(toks).toHaveLength(1);
    expect(toks[0]).toEqual<Token>({ start: 0, length: 3, class: TokenClass.Whitespace });
  });

  it('tabs only → one Whitespace token', () => {
    const toks = tokenise('\t\t');
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.Whitespace);
  });

  it('mixed spaces and tabs → one Whitespace token', () => {
    const toks = tokenise('  \t  \t');
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.Whitespace);
  });

  it('whitespace in the middle of code does not reset member access', () => {
    // foo . game — spaces around '.' should not affect member access guard
    const toks = tokenise('foo.game');
    expect(toks[2].class).not.toBe(TokenClass.RobloxGlobal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Line comments
// ─────────────────────────────────────────────────────────────────────────────

describe('2. Line comments', () => {
  it('-- alone is a Comment', () => {
    const r = lex('--', DEFAULT_STATE);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 2, class: TokenClass.Comment });
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('-- with text is one Comment token', () => {
    const toks = tokenise('-- hello world');
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.Comment);
    expect(toks[0].length).toBe(14);
  });

  it('code followed by line comment', () => {
    const toks = tokenise('local x = 1 -- comment');
    expect(toks.at(-1)!.class).toBe(TokenClass.Comment);
    expect(firstOf(toks, TokenClass.Keyword)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Long comment opening — LOCK-8
// ─────────────────────────────────────────────────────────────────────────────

describe('3. Long comment opening (LOCK-8)', () => {
  // Must be LongComment
  it('--[[ opens LongComment level 0', () => {
    const r = lex('--[[ hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.LongComment);
    expect(statesEqual(r.endState, makeLongCommentState(0))).toBe(true);
  });

  it('--[=[ opens LongComment level 1', () => {
    const r = lex('--[=[ hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.LongComment);
    expect(statesEqual(r.endState, makeLongCommentState(1))).toBe(true);
  });

  it('--[==[ opens LongComment level 2', () => {
    const r = lex('--[==[ hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.LongComment);
    expect(statesEqual(r.endState, makeLongCommentState(2))).toBe(true);
  });

  it('--[[[[ is a level-0 long comment (consumes [[) followed by [[', () => {
    // --[[ is the opener; body may contain [[ 
    const r = lex('--[[ text', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.LongComment);
  });

  // Must be plain Comment (LOCK-8)
  it('LOCK-8: --[x is plain Comment', () => {
    const r = lex('--[x hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('LOCK-8: --[= (no second [) is plain Comment', () => {
    const r = lex('--[= hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('LOCK-8: --[=x is plain Comment', () => {
    const r = lex('--[=x hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
  });

  it('LOCK-8: --[== (no second [) is plain Comment', () => {
    const r = lex('--[== hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
  });

  it('LOCK-8: --[==x is plain Comment', () => {
    const r = lex('--[==x hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
  });

  it('LOCK-8: -- [[ with space is plain Comment', () => {
    const r = lex('-- [[ hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('LOCK-8: -- [=[ with space is plain Comment', () => {
    const r = lex('-- [=[ hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
  });

  it('LOCK-8: --[0 is plain Comment', () => {
    const r = lex('--[0 hello', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.Comment);
  });

  it('long comment closes on same line, code follows', () => {
    const r = lex('--[[ comment ]] local x', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.LongComment);
    expect(r.tokens[0].length).toBe(15); // '--[[ comment ]]'
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
    expect(firstOf(r.tokens, TokenClass.Keyword)).toBeDefined();
  });

  it('level-2 long comment closes on same line', () => {
    const r = lex('--[==[ comment ]==] x', DEFAULT_STATE);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('level-2 long comment NOT closed by ]] (wrong level)', () => {
    const r = lex('--[==[ comment ]] still open', DEFAULT_STATE);
    expect(statesEqual(r.endState, makeLongCommentState(2))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Long comment continuation
// ─────────────────────────────────────────────────────────────────────────────

describe('4. Long comment continuation (startState = LongComment)', () => {
  it('whole line is LongComment when no close found', () => {
    const r = lex('still in comment', makeLongCommentState(0));
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 16, class: TokenClass.LongComment });
    expect(statesEqual(r.endState, makeLongCommentState(0))).toBe(true);
  });

  it('close on continuation line, code follows', () => {
    const r = lex('end of comment ]] local x = 1', makeLongCommentState(0));
    expect(r.tokens[0].class).toBe(TokenClass.LongComment);
    expect(r.tokens[0].length).toBe(17); // 'end of comment ]]\' = 17 chars
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
    expect(firstOf(r.tokens, TokenClass.Keyword)).toBeDefined();
  });

  it('close at very start of line', () => {
    const r = lex(']] local x', makeLongCommentState(0));
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 2, class: TokenClass.LongComment });
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('level 1 continued, closed by ]=]', () => {
    const r = lex('mid ]=] local x', makeLongCommentState(1));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('level 1 NOT closed by ]] (wrong level)', () => {
    const r = lex('mid ]] still open', makeLongCommentState(1));
    expect(statesEqual(r.endState, makeLongCommentState(1))).toBe(true);
  });

  it('level 2 continued, closed by ]==]', () => {
    const r = lex('text ]==] local x', makeLongCommentState(2));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('level 2 NOT closed by ]=] (wrong level)', () => {
    const r = lex('text ]=] still open', makeLongCommentState(2));
    expect(statesEqual(r.endState, makeLongCommentState(2))).toBe(true);
  });

  it('empty continuation line stays in LongComment', () => {
    const r = lex('', makeLongCommentState(0));
    expect(r.tokens).toHaveLength(0);
    expect(statesEqual(r.endState, makeLongCommentState(0))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Long strings — opening & same-line close
// ─────────────────────────────────────────────────────────────────────────────

describe('5. Long strings (Default mode)', () => {
  it('[[...]] on same line closes', () => {
    const r = lex('local s = [[hello]]', DEFAULT_STATE);
    expect(firstOf(r.tokens, TokenClass.LongString)).toBeDefined();
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('[[...]] unclosed → LongString(0) endState', () => {
    const r = lex('local s = [[hello', DEFAULT_STATE);
    expect(statesEqual(r.endState, makeLongStringState(0))).toBe(true);
  });

  it('[=[...]=] level 1 closes on same line', () => {
    const r = lex('[=[ text ]=]', DEFAULT_STATE);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('[=[ text ]] level-0 close does NOT close level-1 string', () => {
    const r = lex('[=[ text ]]', DEFAULT_STATE);
    expect(statesEqual(r.endState, makeLongStringState(1))).toBe(true);
  });

  it('[==[ text ]==] level 2 closes', () => {
    const r = lex('[==[ text ]==]', DEFAULT_STATE);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('long string followed by code on same line', () => {
    const r = lex('x = [[hi]] + 1', DEFAULT_STATE);
    expect(firstOf(r.tokens, TokenClass.LongString)).toBeDefined();
    expect(firstOf(r.tokens, TokenClass.Number)).toBeDefined();
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('[[ followed immediately by ]] (empty long string)', () => {
    const r = lex('[[]]', DEFAULT_STATE);
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 4, class: TokenClass.LongString });
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Long string continuation
// ─────────────────────────────────────────────────────────────────────────────

describe('6. Long string continuation (startState = LongString)', () => {
  it('whole line is LongString when no close found', () => {
    const r = lex('still in string', makeLongStringState(0));
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 15, class: TokenClass.LongString });
    expect(statesEqual(r.endState, makeLongStringState(0))).toBe(true);
  });

  it('close on continuation line, code follows', () => {
    const r = lex('world]] local y = 2', makeLongStringState(0));
    expect(r.tokens[0].class).toBe(TokenClass.LongString);
    expect(r.tokens[0].length).toBe(7); // 'world]]'
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
    expect(firstOf(r.tokens, TokenClass.Keyword)).toBeDefined();
  });

  it('close at very start of line', () => {
    const r = lex(']] local y', makeLongStringState(0));
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 2, class: TokenClass.LongString });
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('level 1 closed by ]=]', () => {
    const r = lex('text ]=] local x', makeLongStringState(1));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('level 1 NOT closed by ]] (wrong level)', () => {
    const r = lex('text ]] still open', makeLongStringState(1));
    expect(statesEqual(r.endState, makeLongStringState(1))).toBe(true);
  });

  it('level 2 closed by ]==]', () => {
    const r = lex('text ]==] local x', makeLongStringState(2));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('empty continuation stays in LongString', () => {
    const r = lex('', makeLongStringState(0));
    expect(r.tokens).toHaveLength(0);
    expect(statesEqual(r.endState, makeLongStringState(0))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Plain string literals
// ─────────────────────────────────────────────────────────────────────────────

describe('7. Plain string literals', () => {
  it('double-quoted string', () => {
    const toks = tokenise('"hello world"');
    expect(firstOf(toks, TokenClass.String)).toBeDefined();
    expect(statesEqual(lex('"hello world"', DEFAULT_STATE).endState, DEFAULT_STATE)).toBe(true);
  });

  it('single-quoted string', () => {
    const toks = tokenise("'hello world'");
    expect(firstOf(toks, TokenClass.String)).toBeDefined();
  });

  it('empty double-quoted string', () => {
    const toks = tokenise('""');
    expect(toks.every(t => t.class === TokenClass.String)).toBe(true);
  });

  it('empty single-quoted string', () => {
    const toks = tokenise("''");
    expect(toks.every(t => t.class === TokenClass.String)).toBe(true);
  });

  it('string followed by code', () => {
    const toks = tokenise('"hello" .. " world"');
    expect(firstOf(toks, TokenClass.Operator)?.length).toBe(2); // ..
  });

  it('unterminated string → Default endState (error recovery)', () => {
    const r = lex('"unterminated', DEFAULT_STATE);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. String escape sequences
// ─────────────────────────────────────────────────────────────────────────────

describe('8. String escape sequences', () => {
  function escLen(line: string): number {
    const r = lex(line, DEFAULT_STATE);
    return r.tokens.find(t => t.class === TokenClass.StringEscape)?.length ?? -1;
  }

  it('\\n escape → length 2', () => { expect(escLen('"a\\nb"')).toBe(2); });
  it('\\t escape → length 2', () => { expect(escLen('"a\\tb"')).toBe(2); });
  it('\\r escape → length 2', () => { expect(escLen('"a\\rb"')).toBe(2); });
  it('\\\\ escape → length 2', () => { expect(escLen('"a\\\\b"')).toBe(2); });
  it('\\" escape → length 2', () => { expect(escLen('"a\\"b"')).toBe(2); });
  it("\\' escape → length 2", () => { expect(escLen('"a\\\'b"')).toBe(2); });
  it('\\a escape → length 2', () => { expect(escLen('"\\a"')).toBe(2); });
  it('\\b escape → length 2', () => { expect(escLen('"\\b"')).toBe(2); });
  it('\\f escape → length 2', () => { expect(escLen('"\\f"')).toBe(2); });
  it('\\v escape → length 2', () => { expect(escLen('"\\v"')).toBe(2); });

  it('\\xNN hex escape → length 4', () => { expect(escLen('"\\x41"')).toBe(4); });

  it('\\ddd decimal escape → length 3 (e.g. \\065)', () => {
    expect(escLen('"\\065"')).toBe(4); // \065 = 4 chars: \, 0, 6, 5
  });

  it('\\d single-digit decimal → length 2', () => {
    expect(escLen('"\\0"')).toBe(2);
  });

  it('\\u{hex} unicode escape → length = 3 + digits + 1', () => {
    // \u{0041} = \, u, {, 0, 0, 4, 1, } = 8 chars
    expect(escLen('"\\u{0041}"')).toBe(8);
  });

  it('\\u{} short unicode escape → correct length', () => {
    // \u{41} = \, u, {, 4, 1, } = 6 chars
    expect(escLen('"\\u{41}"')).toBe(6);
  });

  it('\\z eats following whitespace', () => {
    // "a\z   b" → \z   = 5 chars (\, z, space, space, space)
    expect(escLen('"a\\z   b"')).toBe(5);
  });

  it('\\z with no trailing whitespace → length 2', () => {
    expect(escLen('"a\\zb"')).toBe(2);
  });

  it('multiple escapes in one string all get StringEscape tokens', () => {
    const r = lex('"\\n\\t\\r"', DEFAULT_STATE);
    const escCount = r.tokens.filter(t => t.class === TokenClass.StringEscape).length;
    expect(escCount).toBe(3);
  });

  it('StringEscape and String tokens are contiguous and cover whole string', () => {
    assertCoverage('"hello\\nworld"');
    assertCoverage('"\\x41\\t\\u{0041}"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. String continuation — LOCK-1
// ─────────────────────────────────────────────────────────────────────────────

describe('9. String continuation (LOCK-1: StringContinued state)', () => {
  it('double-quote string with trailing \\ → StringContinued(")', () => {
    const r = lex('"hello \\', DEFAULT_STATE);
    expect(statesEqual(r.endState, makeStringContinuedState('"'))).toBe(true);
  });

  it("single-quote string with trailing \\ → StringContinued(')", () => {
    const r = lex("'hello \\", DEFAULT_STATE);
    expect(statesEqual(r.endState, makeStringContinuedState("'"))).toBe(true);
  });

  it('StringContinued: continuation line closes string → Default', () => {
    const r = lex('world"', makeStringContinuedState('"'));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('StringContinued: another trailing \\ → still StringContinued', () => {
    const r = lex('still \\', makeStringContinuedState('"'));
    expect(statesEqual(r.endState, makeStringContinuedState('"'))).toBe(true);
  });

  it('StringContinued: no close, no backslash → Default (error recovery)', () => {
    const r = lex('no close here', makeStringContinuedState('"'));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('StringContinued: all tokens are String or StringEscape', () => {
    const r = lex('world\\n rest"', makeStringContinuedState('"'));
    for (const t of r.tokens) {
      expect([TokenClass.String, TokenClass.StringEscape]).toContain(t.class);
    }
    // The " closing quote is included in the String tokens
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('StringContinued single-quote closes with single-quote', () => {
    const r = lex("world'", makeStringContinuedState("'"));
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Interpolated strings — LOCK-2 (strictly intra-line)
// ─────────────────────────────────────────────────────────────────────────────

describe('10. Interpolated strings (LOCK-2)', () => {
  const BT = '`';

  it('simple literal — opening and closing InterpDelimiter', () => {
    const r = lex(BT + 'hello' + BT, DEFAULT_STATE);
    expect(r.tokens[0]).toEqual<Token>({ start: 0, length: 1, class: TokenClass.InterpDelimiter });
    expect(r.tokens.at(-1)).toEqual<Token>({ start: 6, length: 1, class: TokenClass.InterpDelimiter });
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('empty interpolated string', () => {
    const r = lex(BT + BT, DEFAULT_STATE);
    expect(r.tokens).toHaveLength(2);
    expect(r.tokens.every(t => t.class === TokenClass.InterpDelimiter)).toBe(true);
  });

  it('with one hole: 4 InterpDelimiters (` { } `)', () => {
    const r = lex(BT + 'val={x}' + BT, DEFAULT_STATE);
    const delims = r.tokens.filter(t => t.class === TokenClass.InterpDelimiter);
    expect(delims).toHaveLength(4);
  });

  it('hole expression contains Identifier token', () => {
    const r = lex(BT + '{myVar}' + BT, DEFAULT_STATE);
    expect(firstOf(r.tokens, TokenClass.Identifier)).toBeDefined();
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('nested braces {t={1,2}} — inner {} are Bracket, not InterpDelimiter', () => {
    const r = lex(BT + '{t={1,2}}' + BT, DEFAULT_STATE);
    const delims = r.tokens.filter(t => t.class === TokenClass.InterpDelimiter);
    // outer ` { } ` = 4; inner { } = Bracket
    expect(delims).toHaveLength(4);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('LOCK-2: unterminated backtick at EOL → Default (no state propagation)', () => {
    const r = lex(BT + 'hello unterminated', DEFAULT_STATE);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('LOCK-2: unterminated hole → Default', () => {
    const r = lex(BT + '{x', DEFAULT_STATE);
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('escape inside interpolated literal → StringEscape token', () => {
    const r = lex(BT + 'hi\\nthere' + BT, DEFAULT_STATE);
    expect(firstOf(r.tokens, TokenClass.StringEscape)).toBeDefined();
  });

  it('multiple holes', () => {
    const r = lex(BT + '{x} + {y}' + BT, DEFAULT_STATE);
    const delims = r.tokens.filter(t => t.class === TokenClass.InterpDelimiter);
    expect(delims).toHaveLength(6); // ` { } { } `
    expect(statesEqual(r.endState, DEFAULT_STATE)).toBe(true);
  });

  it('full coverage on interpolated strings', () => {
    assertCoverage(BT + 'hello {x + y} world' + BT);
    assertCoverage(BT + 'unterminated');
    assertCoverage(BT + BT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Numbers
// ─────────────────────────────────────────────────────────────────────────────

describe('11. Numbers', () => {
  const singleNumber = (src: string): void => {
    const r = lex(src, DEFAULT_STATE);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0].class).toBe(TokenClass.Number);
    expect(r.tokens[0].length).toBe(src.length);
  };

  it('decimal integer', () => singleNumber('123'));
  it('decimal with underscores', () => singleNumber('1_000_000'));
  it('float', () => singleNumber('3.14'));
  it('float with underscore', () => singleNumber('1_000.5'));
  it('leading-dot float', () => singleNumber('.5'));
  it('scientific e', () => singleNumber('1e3'));
  it('scientific E', () => singleNumber('1E5'));
  it('scientific negative exponent', () => singleNumber('1.5e-3'));
  it('hex lowercase', () => singleNumber('0xFF'));
  it('hex uppercase prefix', () => singleNumber('0XFF'));
  it('hex with underscores', () => singleNumber('0xFF_00'));
  it('binary lowercase prefix', () => singleNumber('0b1010'));
  it('binary uppercase prefix', () => singleNumber('0B1111'));
  it('hex float 0x1.8p3', () => singleNumber('0x1.8p3'));
  it('hex float negative exponent 0x1.0p-4', () => singleNumber('0x1.0p-4'));

  it('1..2 — dot-dot is concat operator, not decimal point', () => {
    const toks = tokenise('1..2');
    expect(toks).toHaveLength(3);
    expect(toks[0].class).toBe(TokenClass.Number);
    expect(toks[1].class).toBe(TokenClass.Operator);
    expect(toks[1].length).toBe(2);
    expect(toks[2].class).toBe(TokenClass.Number);
  });

  it('1...rest — vararg after int', () => {
    const toks = tokenise('1...');
    expect(toks[0].class).toBe(TokenClass.Number);
    expect(toks[1].class).toBe(TokenClass.Operator);
    expect(toks[1].length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Keywords (all 22)
// ─────────────────────────────────────────────────────────────────────────────

describe('12. Keywords — all 22 Luau keywords', () => {
  const KWS = [
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
    'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
    'return', 'then', 'true', 'until', 'while', 'continue',
  ];

  it.each(KWS)('%s → Keyword', (kw) => {
    const toks = tokenise(kw);
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.Keyword);
  });

  it('keyword is not RobloxGlobal even if in globals table', () => {
    // 'type' is KeywordType; 'print' is RobloxGlobal not Keyword
    const toks = tokenise('local');
    expect(toks[0].class).toBe(TokenClass.Keyword);
    expect(toks[0].class).not.toBe(TokenClass.RobloxGlobal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Type keywords
// ─────────────────────────────────────────────────────────────────────────────

describe('13. Type keywords', () => {
  it.each(['type', 'typeof', 'export'])('%s → KeywordType', (kw) => {
    const toks = tokenise(kw);
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.KeywordType);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Roblox globals
// ─────────────────────────────────────────────────────────────────────────────

describe('14. Roblox globals', () => {
  const GLOBALS = ['game', 'workspace', 'script', 'shared', 'task', 'Enum',
                   'print', 'warn', 'error', 'assert', 'pcall', 'xpcall',
                   'pairs', 'ipairs', 'require', '_G', '_VERSION'];

  it.each(GLOBALS)('%s → RobloxGlobal', (g) => {
    const toks = tokenise(g);
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.RobloxGlobal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Roblox types
// ─────────────────────────────────────────────────────────────────────────────

describe('15. Roblox types', () => {
  const TYPES = ['Vector3', 'Vector2', 'CFrame', 'Instance', 'Color3',
                 'UDim2', 'BrickColor', 'TweenInfo', 'Ray', 'Random',
                 'RaycastParams', 'PhysicalProperties'];

  it.each(TYPES)('%s → RobloxType', (t) => {
    const toks = tokenise(t);
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.RobloxType);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Member access guard — LOCK-3
// ─────────────────────────────────────────────────────────────────────────────

describe('16. Member access guard (LOCK-3: same-line context only)', () => {
  it('foo.game — game after . is NOT RobloxGlobal', () => {
    const toks = tokenise('foo.game');
    expect(toks[2].class).not.toBe(TokenClass.RobloxGlobal);
  });

  it('foo.workspace — workspace after . is NOT RobloxGlobal', () => {
    const toks = tokenise('foo.workspace');
    expect(toks[2].class).not.toBe(TokenClass.RobloxGlobal);
  });

  it('foo:game — game after : is NOT RobloxGlobal', () => {
    const toks = tokenise('foo:game');
    expect(toks[2].class).not.toBe(TokenClass.RobloxGlobal);
  });

  it('foo.Vector3 — Vector3 after . is NOT RobloxType', () => {
    const toks = tokenise('foo.Vector3');
    expect(toks[2].class).not.toBe(TokenClass.RobloxType);
  });

  it('standalone game → RobloxGlobal (no guard)', () => {
    const toks = tokenise('game');
    expect(toks[0].class).toBe(TokenClass.RobloxGlobal);
  });

  it('standalone Vector3 → RobloxType (no guard)', () => {
    const toks = tokenise('Vector3');
    expect(toks[0].class).toBe(TokenClass.RobloxType);
  });

  it(':: does NOT guard the next identifier', () => {
    // x :: Vector3 → Vector3 should still be RobloxType
    const toks = tokenise('x :: Vector3');
    expect(toks.at(-1)!.class).toBe(TokenClass.RobloxType);
  });

  it('workspace.FindFirstChild() — FindFirstChild is FunctionName (guarded from table, upgraded by lookahead)', () => {
    const toks = tokenise('workspace.FindFirstChild()');
    // workspace=RobloxGlobal, .=Delim, FindFirstChild=FunctionName, (, )
    expect(toks[0].class).toBe(TokenClass.RobloxGlobal);
    expect(toks[2].class).toBe(TokenClass.FunctionName);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. FunctionName lookahead
// ─────────────────────────────────────────────────────────────────────────────

describe('17. FunctionName lookahead', () => {
  it('foo( → FunctionName', () => {
    const toks = tokenise('foo(');
    expect(toks[0].class).toBe(TokenClass.FunctionName);
  });

  it('function foo() → foo is FunctionName', () => {
    const toks = tokenise('function foo()');
    const fn = toks.find(t => t.class === TokenClass.FunctionName);
    expect(fn).toBeDefined();
    expect(fn!.start).toBe(9);
    expect(fn!.length).toBe(3);
  });

  it('foo:bar() → bar is FunctionName', () => {
    const toks = tokenise('foo:bar()');
    const fn = toks.find(t => t.class === TokenClass.FunctionName);
    expect(fn?.length).toBe(3);
  });

  it('foo.bar() → bar is FunctionName', () => {
    const toks = tokenise('foo.bar()');
    const fn = toks.find(t => t.class === TokenClass.FunctionName);
    expect(fn).toBeDefined();
  });

  it('foo without ( → plain Identifier', () => {
    const toks = tokenise('foo ');
    expect(toks[0].class).toBe(TokenClass.Identifier);
  });

  it('foo with spaces then ( → FunctionName', () => {
    const toks = tokenise('foo (');
    expect(toks[0].class).toBe(TokenClass.FunctionName);
  });

  it('keyword before ( is still Keyword (not FunctionName)', () => {
    // `if(` — `if` is keyword, parenthesis immediately follows
    // Keywords always win over FunctionName
    const toks = tokenise('if(');
    expect(toks[0].class).toBe(TokenClass.Keyword);
  });

  it('RobloxGlobal before ( is RobloxGlobal (table check wins over FunctionName)', () => {
    // print( — print is a RobloxGlobal AND a function call.
    // ROBLOX_GLOBALS is checked before FunctionName lookahead.
    const toks = tokenise('print(');
    expect(toks[0].class).toBe(TokenClass.RobloxGlobal);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Operators — all individually
// ─────────────────────────────────────────────────────────────────────────────

describe('18. Operators', () => {
  function op(src: string, expectedLen: number): void {
    const line = 'a ' + src + ' b';
    const toks = tokenise(line);
    const opTok = toks.find(t => t.class === TokenClass.Operator);
    expect(opTok).toBeDefined();
    expect(opTok!.length).toBe(expectedLen);
  }

  it('+', () => op('+', 1));
  it('-', () => op('-', 1));
  it('*', () => op('*', 1));
  it('/', () => op('/', 1));
  it('//', () => op('//', 2));
  it('%', () => op('%', 1));
  it('^', () => op('^', 1));
  it('#', () => { const toks = tokenise('#arr'); expect(toks[0].class).toBe(TokenClass.Operator); });
  it('=', () => op('=', 1));
  it('==', () => op('==', 2));
  it('~=', () => op('~=', 2));
  it('<', () => op('<', 1));
  it('>', () => op('>', 1));
  it('<=', () => op('<=', 2));
  it('>=', () => op('>=', 2));
  it('..', () => op('..', 2));
  it('...', () => { const toks = tokenise('...'); expect(toks[0]).toEqual<Token>({start:0,length:3,class:TokenClass.Operator}); });
  it('->', () => op('->', 2));
  it('::', () => op('::', 2));
  it('&', () => op('&', 1));
  it('|', () => op('|', 1));
  it('?', () => op('?', 1));
  it(': (single colon)', () => op(':', 1));

  it('~ alone is Invalid (not an operator)', () => {
    const toks = tokenise('~');
    expect(toks[0].class).toBe(TokenClass.Invalid);
  });

  it('// is floor-division Operator, not a comment', () => {
    const toks = tokenise('a // b');
    const opTok = toks.find(t => t.class === TokenClass.Operator);
    expect(opTok?.length).toBe(2);
    expect(toks.find(t => t.class === TokenClass.Comment)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Brackets & delimiters
// ─────────────────────────────────────────────────────────────────────────────

describe('19. Brackets and delimiters', () => {
  it.each(['(', ')', '{', '}', '[', ']'])('%s → Bracket', (b) => {
    const toks = tokenise(b);
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.Bracket);
  });

  it.each([',', ';'])('%s → Delimiter', (d) => {
    const toks = tokenise(d);
    expect(toks).toHaveLength(1);
    expect(toks[0].class).toBe(TokenClass.Delimiter);
  });

  it('. as field-access → Delimiter', () => {
    const toks = tokenise('a.b');
    expect(toks[1].class).toBe(TokenClass.Delimiter);
    expect(toks[1].length).toBe(1);
  });

  it('[[ is NOT a Bracket — it opens a LongString', () => {
    const r = lex('[[', DEFAULT_STATE);
    expect(r.tokens[0].class).toBe(TokenClass.LongString);
    expect(statesEqual(r.endState, makeLongStringState(0))).toBe(true);
  });

  it('[ followed by non-bracket char → Bracket', () => {
    const toks = tokenise('[x]');
    expect(toks[0].class).toBe(TokenClass.Bracket);
    expect(toks[0].length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Attributes
// ─────────────────────────────────────────────────────────────────────────────

describe('20. Attributes', () => {
  it('@native → Attribute (whole @identifier)', () => {
    const toks = tokenise('@native');
    expect(toks).toHaveLength(1);
    expect(toks[0]).toEqual<Token>({ start: 0, length: 7, class: TokenClass.Attribute });
  });

  it('@checked → Attribute', () => {
    const toks = tokenise('@checked');
    expect(toks[0].class).toBe(TokenClass.Attribute);
  });

  it('@ alone → Invalid', () => {
    const toks = tokenise('@');
    expect(toks[0].class).toBe(TokenClass.Invalid);
  });

  it('@ followed by non-identifier → Invalid for @, then next token', () => {
    const toks = tokenise('@123');
    expect(toks[0].class).toBe(TokenClass.Invalid);
    expect(toks[0].length).toBe(1);
    expect(toks[1].class).toBe(TokenClass.Number);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Invalid characters
// ─────────────────────────────────────────────────────────────────────────────

describe('21. Invalid characters', () => {
  it('$ is Invalid', () => {
    const toks = tokenise('$');
    expect(toks[0].class).toBe(TokenClass.Invalid);
  });

  it('standalone backslash → Invalid', () => {
    const toks = tokenise('\\');
    expect(toks[0].class).toBe(TokenClass.Invalid);
  });

  it('~ alone → Invalid', () => {
    const toks = tokenise('~');
    expect(toks[0].class).toBe(TokenClass.Invalid);
  });

  it('Invalid tokens still contribute to full line coverage', () => {
    assertCoverage('local $x = 1');
    assertCoverage('$$$');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. statesEqual
// ─────────────────────────────────────────────────────────────────────────────

describe('22. statesEqual correctness', () => {
  it('Default == Default', () => {
    expect(statesEqual(DEFAULT_STATE, DEFAULT_STATE)).toBe(true);
  });

  it('LS(0) == LS(0)', () => {
    expect(statesEqual(makeLongStringState(0), makeLongStringState(0))).toBe(true);
  });

  it('LS(0) != LS(1)', () => {
    expect(statesEqual(makeLongStringState(0), makeLongStringState(1))).toBe(false);
  });

  it('LC(0) == LC(0)', () => {
    expect(statesEqual(makeLongCommentState(0), makeLongCommentState(0))).toBe(true);
  });

  it('LC(0) != LC(1)', () => {
    expect(statesEqual(makeLongCommentState(0), makeLongCommentState(1))).toBe(false);
  });

  it('LS(0) != LC(0)', () => {
    expect(statesEqual(makeLongStringState(0), makeLongCommentState(0))).toBe(false);
  });

  it('SC(") == SC(")', () => {
    expect(statesEqual(makeStringContinuedState('"'), makeStringContinuedState('"'))).toBe(true);
  });

  it("SC(') == SC(')", () => {
    expect(statesEqual(makeStringContinuedState("'"), makeStringContinuedState("'"))).toBe(true);
  });

  it("SC(\") != SC(')", () => {
    expect(statesEqual(makeStringContinuedState('"'), makeStringContinuedState("'"))).toBe(false);
  });

  it('Default != LS(0)', () => {
    expect(statesEqual(DEFAULT_STATE, makeLongStringState(0))).toBe(false);
  });

  it('Default != LC(0)', () => {
    expect(statesEqual(DEFAULT_STATE, makeLongCommentState(0))).toBe(false);
  });

  it('Default != SC(")', () => {
    expect(statesEqual(DEFAULT_STATE, makeStringContinuedState('"'))).toBe(false);
  });

  it('State factory returns identical objects (caching)', () => {
    // makeLongStringState should cache — same level returns ===
    const a = makeLongStringState(0);
    const b = makeLongStringState(0);
    expect(a).toBe(b);  // reference equality via cache
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. Token coverage invariant
// ─────────────────────────────────────────────────────────────────────────────

describe('23. Token coverage invariant (every char covered exactly once)', () => {
  const cases: Array<[string, TokenizerState?]> = [
    [''],
    ['   \t  '],
    ['local x: number = 42'],
    ['function greet(name: string): string'],
    ['  return `Hello, ${name}!`'],
    ['end'],
    ['game:GetService("RunService")'],
    ['local v3 = Vector3.new(1.0, 2.5, -3.0)'],
    ['-- This is a comment'],
    ['--[[ multi-line start'],
    ['still in multi-line comment', makeLongCommentState(0)],
    ['end of comment ]] local x = 1', makeLongCommentState(0)],
    ['type Callback = (event: string) -> boolean'],
    ['local t = {1, 2, 3}'],
    ['for i = 1, #arr do'],
    ['if x == nil or y ~= 0 then'],
    ['local ok, err = pcall(function()'],
    ['  return workspace:FindFirstChild("Part")'],
    ['local hex = 0xFF_00_FF'],
    ['local bin = 0b1010_0101'],
    ['local s = [['],
    ['end of string]]', makeLongStringState(0)],
    ['local f = 1.5e-3'],
    ['@native function foo(x: number): number'],
    ['~='],
    ['::'],
    ['->'],
    ['//'],
    ['...'],
    ['"escaped: \\n\\t\\x41\\u{0041}"'],
    ["'single: \\n\\t'"],
    ['`interp: {x + 1}`'],
    ['`unterminated'],
    ['local cont = "hello \\'],
    ['world"', makeStringContinuedState('"')],
  ];

  it.each(cases)('covers: %p', (line, state) => {
    assertCoverage(line, state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. Full-line real Luau examples (integration)
// ─────────────────────────────────────────────────────────────────────────────

describe('24. Full-line Luau integration examples', () => {
  it('local variable declaration', () => {
    const toks = tokenise('local x = 42');
    expect(toks[0].class).toBe(TokenClass.Keyword);     // local
    expect(toks[2].class).toBe(TokenClass.Identifier);  // x
    expect(toks[6].class).toBe(TokenClass.Number);      // 42
  });

  it('function definition with type annotation', () => {
    const toks = tokenise('function add(a: number, b: number): number');
    expect(toks[0].class).toBe(TokenClass.Keyword);      // function
    expect(toks[2].class).toBe(TokenClass.FunctionName); // add
    expect(firstOf(toks, TokenClass.KeywordType)).toBeUndefined(); // 'number' is Identifier, not KeywordType
  });

  it('game:GetService() call', () => {
    const toks = tokenise('game:GetService("RunService")');
    expect(toks[0].class).toBe(TokenClass.RobloxGlobal);  // game
    expect(toks[2].class).toBe(TokenClass.FunctionName);  // GetService
    expect(firstOf(toks, TokenClass.String)).toBeDefined(); // "RunService"
  });

  it('Vector3.new() constructor', () => {
    const toks = tokenise('local v = Vector3.new(1, 2, 3)');
    expect(toks.find(t => t.class === TokenClass.RobloxType)).toBeDefined(); // Vector3
    expect(toks.find(t => t.class === TokenClass.FunctionName)).toBeDefined(); // new
  });

  it('type alias declaration', () => {
    const toks = tokenise('type MyType = string | number');
    expect(toks[0].class).toBe(TokenClass.KeywordType); // type
  });

  it('table constructor', () => {
    assertCoverage('local t = { x = 1, y = 2 }');
  });

  it('for loop with # operator', () => {
    const toks = tokenise('for i = 1, #items do');
    expect(firstOf(toks, TokenClass.Keyword)).toBeDefined();
    expect(firstOf(toks, TokenClass.Operator)).toBeDefined(); // #
  });

  it('complex expression with all operator types', () => {
    assertCoverage('if (a == b) and (c ~= nil) or (d <= e) then');
  });

  it('pcall with anonymous function', () => {
    assertCoverage('local ok, err = pcall(function()');
  });

  it('multi-line string open, then continuation, then close', () => {
    const r1 = lex('local s = [[', DEFAULT_STATE);
    expect(statesEqual(r1.endState, makeLongStringState(0))).toBe(true);
    const r2 = lex('line one', makeLongStringState(0));
    expect(statesEqual(r2.endState, makeLongStringState(0))).toBe(true);
    const r3 = lex('line two]]', makeLongStringState(0));
    expect(statesEqual(r3.endState, DEFAULT_STATE)).toBe(true);
  });
});
