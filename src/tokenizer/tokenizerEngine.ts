/**
 * APDS Tokenizer — Incremental Tokenizer Engine
 *
 * Built AROUND the locked Phase 1 lexer. Depends only on:
 *   lex(lineText: string, startState: TokenizerState): LexResult
 *
 * Out of scope: rendering, DOM, diagnostics, autocomplete, async workers,
 * time slicing, state-only fast scans.
 *
 * LOCK-4  revision bumps ONLY when token OUTPUT (tokens array) changes.
 * LOCK-5  early-stop: BEFORE lexing line i, if the state ENTERING line i equals
 *         line i's CAPTURED pre-edit start state, and i > lastChanged, and that
 *         state is VALID, then line i and everything after is unchanged -> clean.
 *         Inserted slots start INVALID. Comparison never uses a freshly-written
 *         state (lineStates[i] is read before it is overwritten in that pass).
 * LOCK-6  steady-state lexing is O(visible lines): never LEX past target.
 *         One integer compare beyond target is allowed to detect reconvergence.
 * LOCK-7  cache for line >= dirtyFromLine is UNTRUSTED; getLineTokens must
 *         call tokenizeUpTo(line) whenever line >= dirtyFromLine.
 */
import type { Token } from './tokenTypes';
import { lex } from './lexer';
import { StateInterner, INVALID_STATE_ID, type StateId } from './stateId';

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/**
 * Cached tokenization result for one line.
 *  tokens     — token array for the renderer.
 *  startState — interned StateId entering the line.
 *  endState   — interned StateId leaving the line (== start of next line).
 *  revision   — LOCK-4 monotonic counter; bumped only when tokens changes.
 */
export interface LineTokens {
  readonly tokens: Token[];
  readonly startState: StateId;
  readonly endState: StateId;
  readonly revision: number;
}

/**
 * A buffer edit expressed as a line-range splice.
 *  startLine        — first affected line index (0-based).
 *  removedLineCount — lines removed at startLine.
 *  insertedLines    — replacement texts (may be empty for pure deletion).
 */
export interface BufferChangeEvent {
  readonly startLine: number;
  readonly removedLineCount: number;
  readonly insertedLines: readonly string[];
}

// ---------------------------------------------------------------------------
// Token equality (basis of LOCK-4)
// ---------------------------------------------------------------------------

function tokensEqual(a: readonly Token[], b: readonly Token[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.start !== y.start || x.length !== y.length || x.class !== y.class) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// TokenizerEngine
// ---------------------------------------------------------------------------

export class TokenizerEngine {
  private lines: string[];
  private readonly interner = new StateInterner();

  /**
   * lineStates[i] = StateId entering line i (its START state).
   * INVALID_STATE_ID marks inserted/invalidated slots that need recompute.
   * Surviving lines keep their old StateId — this is the "captured pre-edit
   * state" LOCK-5 compares against. lineStates[i] is overwritten with the
   * fresh start id only AFTER it has been read for comparison in the same pass.
   */
  private lineStates: StateId[];

  /** Per-line token cache, keyed by 0-based line index. */
  private tokenCache: Map<number, LineTokens> = new Map();

  /** LOCK-7 trust boundary: lines >= dirtyFromLine have untrusted cache. */
  private dirtyFromLine: number;

  /** Count of leading lines whose start state is valid and consistent. */
  private validStateUpTo: number;

  /**
   * Highest directly-edited line since last clean point (-1 = none).
   * LOCK-5 forbids early-stop while i <= lastChanged.
   */
  private lastChanged: number;

  constructor(initialLines: string[] = ['']) {
    this.lines = initialLines.length > 0 ? initialLines.slice() : [''];
    this.lineStates = new Array(this.lines.length).fill(INVALID_STATE_ID);
    this.lineStates[0] = this.interner.defaultId;
    this.dirtyFromLine = 0;
    this.validStateUpTo = 0;
    this.lastChanged = this.lines.length - 1;
  }

  get lineCount(): number { return this.lines.length; }
  getDirtyFromLine(): number { return this.dirtyFromLine; }
  getValidStateUpTo(): number { return this.validStateUpTo; }
  getLineText(line: number): string { return this.lines[line]; }
  getLineStartStateId(line: number): StateId { return this.lineStates[line]; }

  // ── LOCK-7: getLineTokens ──────────────────────────────────────────────

  getLineTokens(line: number): LineTokens {
    if (line < 0 || line >= this.lines.length) {
      throw new RangeError(`getLineTokens: line ${line} out of range [0, ${this.lines.length})`);
    }
    if (line >= this.dirtyFromLine) this.tokenizeUpTo(line); // LOCK-7
    const lt = this.tokenCache.get(line);
    if (lt === undefined) throw new Error(`getLineTokens: missing cache for line ${line}`);
    return lt;
  }

  // ── invalidateFrom ────────────────────────────────────────────────────

  /** Mark line.. dirty without changing text. Preserves captured pre-edit states. */
  invalidateFrom(line: number): void {
    const l = Math.max(0, Math.min(line, this.lines.length - 1));
    this.dirtyFromLine = Math.min(this.dirtyFromLine, l);
    this.validStateUpTo = Math.min(this.validStateUpTo, l);
    this.lastChanged = Math.max(this.lastChanged, l);
  }

  // ── onBufferChange ────────────────────────────────────────────────────

  /**
   * Apply a line-range splice and update incremental state.
   *
   * LOCK-5 splice rules:
   *  - lines and lineStates are spliced identically so surviving lines keep
   *    their captured pre-edit start states for comparison.
   *  - Inserted lineStates slots start INVALID.
   *  - lineStates[0] is NOT force-reset: its spliced value is a captured
   *    pre-edit state. tokenizeUpTo supplies the true Default start for line 0.
   *  - tokenCache keys shift; overlapping-replace entries are kept as
   *    "previous" for LOCK-4 revision comparisons; deleted indices are dropped.
   */
  onBufferChange(event: BufferChangeEvent): void {
    const { startLine, removedLineCount, insertedLines } = event;
    const insCount = insertedLines.length;
    const delta = insCount - removedLineCount;

    this.lines.splice(startLine, removedLineCount, ...insertedLines);
    if (this.lines.length === 0) this.lines = [''];

    const invalidFill = new Array<StateId>(insCount).fill(INVALID_STATE_ID);
    this.lineStates.splice(startLine, removedLineCount, ...invalidFill);
    while (this.lineStates.length < this.lines.length) this.lineStates.push(INVALID_STATE_ID);
    this.lineStates.length = this.lines.length;

    const next = new Map<number, LineTokens>();
    for (const [key, value] of this.tokenCache) {
      if (key < startLine) {
        next.set(key, value);
      } else if (key >= startLine + removedLineCount) {
        next.set(key + delta, value);
      } else {
        // overlapping replace: keep at same index as "previous" for LOCK-4
        const j = key - startLine;
        if (j < insCount) next.set(key, value);
      }
    }
    this.tokenCache = next;

    this.dirtyFromLine = Math.min(this.dirtyFromLine, startLine);
    this.validStateUpTo = Math.min(this.validStateUpTo, startLine);
    this.lastChanged = startLine + insCount - 1; // pure deletion -> startLine - 1
  }

  // ── LOCK-5 / LOCK-6: tokenizeUpTo ────────────────────────────────────

  /**
   * Ensure lines [0, targetLine] have trusted tokens.
   *
   * LOCK-5 early-stop: checked BEFORE lexing line i. If the state entering
   * line i equals line i's captured pre-edit start state (from lineStates[i]),
   * and i > lastChanged, and that captured state is VALID, then line i..
   * are provably unchanged -> mark the whole document clean and return.
   *
   * LOCK-6: never LEX past target. The early-stop test is a pure integer
   * compare (no lex); it is allowed to fire at i = target + 1.
   */
  tokenizeUpTo(targetLine: number): void {
    const target = Math.max(0, Math.min(targetLine, this.lines.length - 1));
    if (this.dirtyFromLine > target) return;

    let i = this.dirtyFromLine;
    let startId: StateId = i === 0 ? this.interner.defaultId : this.endStateOf(i - 1);

    while (i < this.lines.length) {
      // LOCK-5 early-stop test (BEFORE lexing line i): compare entering state
      // against the captured pre-edit start state of line i.
      const capturedPrev: StateId = this.lineStates[i];
      if (i > this.lastChanged && capturedPrev !== INVALID_STATE_ID && startId === capturedPrev) {
        this.markClean();
        return;
      }

      // LOCK-6: no lexing beyond the requested line.
      if (i > target) {
        this.dirtyFromLine = i;
        this.validStateUpTo = i;
        return;
      }

      // Re-lex line i.
      const result = lex(this.lines[i], this.interner.resolve(startId));
      const endId: StateId = this.interner.intern(result.endState);

      // LOCK-4: bump revision only if token output changed.
      const old = this.tokenCache.get(i);
      const revision = (old !== undefined && tokensEqual(old.tokens, result.tokens))
        ? old.revision
        : (old !== undefined ? old.revision : 0) + 1;

      this.tokenCache.set(i, {
        tokens: result.tokens as Token[],
        startState: startId,
        endState: endId,
        revision,
      });

      // lineStates[i] is overwritten NOW, after capturedPrev was already read.
      this.lineStates[i] = startId;
      this.validStateUpTo = Math.max(this.validStateUpTo, i + 1);

      if (i === this.lines.length - 1) { this.markClean(); return; }
      i++;
      startId = endId;
    }
  }

  private markClean(): void {
    this.dirtyFromLine = this.lines.length;
    this.validStateUpTo = this.lines.length;
    this.lastChanged = -1;
  }

  /** End state id of line (trusts cache; caller ensures validity). */
  private endStateOf(line: number): StateId {
    const lt = this.tokenCache.get(line);
    return lt !== undefined ? lt.endState : this.interner.defaultId;
  }
}
