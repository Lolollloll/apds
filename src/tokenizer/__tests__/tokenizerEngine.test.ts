/**
 * APDS Tokenizer — Phase 2 Incremental Engine Test Suite
 * Runs against the real Phase 1 lexer.
 * Verifies LOCK-4, LOCK-5, LOCK-6, LOCK-7 + edit/insert/delete correctness.
 */
import { describe, it, expect } from 'vitest';
import { lex } from '../lexer';
import { DEFAULT_STATE, type TokenizerState } from '../tokenizerState';
import { TokenizerEngine, type BufferChangeEvent } from '../tokenizerEngine';
import type { Token } from '../tokenTypes';

// ── Oracle ────────────────────────────────────────────────────────────────

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

function tokensEqual(a: readonly Token[], b: readonly Token[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].length !== b[i].length || a[i].class !== b[i].class) return false;
  }
  return true;
}

function expectMatchesOracle(e: TokenizerEngine, lines: string[]): void {
  const o = oracleTokens(lines);
  for (let i = 0; i < lines.length; i++) {
    expect(tokensEqual(e.getLineTokens(i).tokens, o[i])).toBe(true);
  }
}

const replaceLine = (l: number, t: string): BufferChangeEvent =>
  ({ startLine: l, removedLineCount: 1, insertedLines: [t] });
const insertLines = (l: number, ts: string[]): BufferChangeEvent =>
  ({ startLine: l, removedLineCount: 0, insertedLines: ts });
const deleteLines = (l: number, n: number): BufferChangeEvent =>
  ({ startLine: l, removedLineCount: n, insertedLines: [] });

// ── Construction & basic tokenization ────────────────────────────────────

describe('construction & basic tokenization', () => {
  it('single-line document', () => {
    const L = ['local x = 5'];
    expectMatchesOracle(new TokenizerEngine(L), L);
  });
  it('multi-line document tokenized on demand', () => {
    const L = ['local a = 1', 'local b = 2', 'print(a + b)'];
    expectMatchesOracle(new TokenizerEngine(L), L);
  });
  it('empty document', () => {
    const e = new TokenizerEngine([]);
    expect(e.lineCount).toBe(1);
    expect(e.getLineTokens(0).tokens.length).toBe(0);
  });
  it('long-string state propagated across lines', () => {
    const L = ['local s = [[', 'still inside string', 'end here]] local y = 1'];
    expectMatchesOracle(new TokenizerEngine(L), L);
  });
  it('long-comment state propagated across lines', () => {
    const L = ['--[==[ start', 'inside comment', 'done ]==] local z = 2'];
    expectMatchesOracle(new TokenizerEngine(L), L);
  });
  it('string-continued state (trailing backslash)', () => {
    const L = ['local s = "hello \\', 'world"'];
    expectMatchesOracle(new TokenizerEngine(L), L);
  });
});

// ── LOCK-7: trust boundary ────────────────────────────────────────────────

describe('LOCK-7 — trust boundary', () => {
  it('reads at/after dirty boundary trigger tokenizeUpTo', () => {
    const e = new TokenizerEngine(['local a = 1', 'local b = 2', 'local c = 3']);
    e.getLineTokens(2);
    expect(e.getDirtyFromLine()).toBe(3);
    e.onBufferChange(replaceLine(1, 'local b = 99'));
    expect(e.getDirtyFromLine()).toBe(1);
    expect(e.getLineTokens(2)).toBeDefined();
    expectMatchesOracle(e, ['local a = 1', 'local b = 99', 'local c = 3']);
  });
  it('lines below dirty boundary are not retokenized', () => {
    const e = new TokenizerEngine(['local a = 1', 'local b = 2', 'local c = 3']);
    e.getLineTokens(2);
    const rev0 = e.getLineTokens(0).revision;
    e.onBufferChange(replaceLine(2, 'local c = 333'));
    expect(e.getDirtyFromLine()).toBe(2);
    expect(e.getLineTokens(0).revision).toBe(rev0);
  });
});

// ── LOCK-4: revision system ───────────────────────────────────────────────

describe('LOCK-4 — revision system', () => {
  it('revision is stable when token output is identical', () => {
    const e = new TokenizerEngine(['local a = 1', 'local b = 2']);
    const r0 = e.getLineTokens(0).revision;
    e.invalidateFrom(0);
    expect(e.getLineTokens(0).revision).toBe(r0);
  });
  it('revision bumps when tokens change', () => {
    const e = new TokenizerEngine(['local a = 1', 'local b = 2']);
    const r0 = e.getLineTokens(0).revision;
    e.onBufferChange(replaceLine(0, 'local a = 12345'));
    expect(e.getLineTokens(0).revision).toBe(r0 + 1);
  });
  it('following line revision is stable when its tokens do not change', () => {
    const e = new TokenizerEngine(['local a = 1', 'b = 2']);
    const r1 = e.getLineTokens(1).revision;
    e.onBufferChange(replaceLine(0, 'local a = 7'));
    e.tokenizeUpTo(1);
    expect(e.getLineTokens(1).revision).toBe(r1);
  });
  it('following line revision bumps when entering state changes its tokens', () => {
    const e = new TokenizerEngine(['local a = 1', 'b = 2']);
    const r1 = e.getLineTokens(1).revision;
    e.onBufferChange(replaceLine(0, 'local a = [['));
    e.tokenizeUpTo(1);
    expect(e.getLineTokens(1).revision).toBe(r1 + 1);
    expectMatchesOracle(e, ['local a = [[', 'b = 2']);
  });
});

// ── LOCK-5: early-stop ────────────────────────────────────────────────────

describe('LOCK-5 — early-stop', () => {
  it('state reconvergence marks the whole document clean', () => {
    const L = ['local a = 1', 'local b = 2', 'local c = 3', 'local d = 4'];
    const e = new TokenizerEngine(L);
    e.getLineTokens(3);
    e.onBufferChange(replaceLine(1, 'local b = 22'));
    e.tokenizeUpTo(1);
    expect(e.getDirtyFromLine()).toBe(L.length);
    expectMatchesOracle(e, ['local a = 1', 'local b = 22', 'local c = 3', 'local d = 4']);
  });
  it('does not early-stop while INVALID inserted slots remain', () => {
    const e = new TokenizerEngine(['local a = 1', 'local d = 4']);
    e.getLineTokens(1);
    e.onBufferChange(insertLines(1, ['local b = 2', 'local c = 3']));
    e.tokenizeUpTo(0);
    expect(e.getDirtyFromLine()).toBeLessThanOrEqual(1);
    expectMatchesOracle(e, ['local a = 1', 'local b = 2', 'local c = 3', 'local d = 4']);
  });
  it('propagates state to end when no reconvergence occurs', () => {
    const e = new TokenizerEngine(['x = 1', 'y = 2', 'z = 3']);
    e.getLineTokens(2);
    e.onBufferChange(replaceLine(0, 's = [['));
    e.tokenizeUpTo(2);
    expectMatchesOracle(e, ['s = [[', 'y = 2', 'z = 3']);
  });
  it('closing a multi-line string reconverges to Default state', () => {
    const e = new TokenizerEngine(['s = [[', 'body', 'tail', 'after = 1']);
    e.getLineTokens(3);
    e.onBufferChange(replaceLine(1, 'body]]'));
    e.tokenizeUpTo(3);
    expectMatchesOracle(e, ['s = [[', 'body]]', 'tail', 'after = 1']);
  });
});

// ── Insert / delete operations ────────────────────────────────────────────

describe('insert and delete operations', () => {
  it('inserts lines correctly', () => {
    const e = new TokenizerEngine(['local a = 1', 'local c = 3']);
    e.getLineTokens(1);
    e.onBufferChange(insertLines(1, ['local b = 2']));
    expect(e.lineCount).toBe(3);
    expectMatchesOracle(e, ['local a = 1', 'local b = 2', 'local c = 3']);
  });
  it('deletes lines correctly', () => {
    const e = new TokenizerEngine(['local a = 1', 'local b = 2', 'local c = 3']);
    e.getLineTokens(2);
    e.onBufferChange(deleteLines(1, 1));
    expect(e.lineCount).toBe(2);
    expectMatchesOracle(e, ['local a = 1', 'local c = 3']);
  });
  it('deletes the line that opened a multi-line string', () => {
    const e = new TokenizerEngine(['s = [[', 'body', 'tail]] x = 1']);
    e.getLineTokens(2);
    e.onBufferChange(deleteLines(0, 1));
    expectMatchesOracle(e, ['body', 'tail]] x = 1']);
  });
  it('survives a sequence of mixed edits and matches oracle each time', () => {
    const e = new TokenizerEngine(['local a = 1', 'local b = 2', 'local c = 3']);
    e.getLineTokens(2);
    e.onBufferChange(replaceLine(1, 'local b = [['));
    expectMatchesOracle(e, ['local a = 1', 'local b = [[', 'local c = 3']);
    e.onBufferChange(insertLines(2, ['still string']));
    expectMatchesOracle(e, ['local a = 1', 'local b = [[', 'still string', 'local c = 3']);
    e.onBufferChange(replaceLine(3, 'close]] local c = 3'));
    expectMatchesOracle(e, ['local a = 1', 'local b = [[', 'still string', 'close]] local c = 3']);
    e.onBufferChange(deleteLines(1, 1));
    expectMatchesOracle(e, ['local a = 1', 'still string', 'close]] local c = 3']);
  });
});

// ── LOCK-6: bounded work ──────────────────────────────────────────────────

describe('LOCK-6 — work bounded by visible range', () => {
  it('tokenizeUpTo does not lex past target without reconvergence', () => {
    const n = 200;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) lines.push(`v${i} = ${i}`);
    const e = new TokenizerEngine(lines);
    e.getLineTokens(n - 1);
    e.onBufferChange(replaceLine(0, 's = [['));
    e.tokenizeUpTo(5);
    expect(e.getValidStateUpTo()).toBeLessThanOrEqual(6);
    expect(e.getDirtyFromLine()).toBeLessThanOrEqual(6);
    const full = ['s = [[', ...Array.from({ length: n - 1 }, (_, k) => `v${k + 1} = ${k + 1}`)];
    for (let i = 0; i <= 5; i++) {
      const oracle = oracleTokens(full.slice(0, i + 1)).pop()!;
      expect(tokensEqual(e.getLineTokens(i).tokens, oracle)).toBe(true);
    }
  });
});
