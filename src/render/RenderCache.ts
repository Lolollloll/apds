/**
 * APDS Renderer — RenderCache
 *
 * Stores LineContent objects (RenderedLine minus pixelY) keyed by
 * 0-based line index. pixelY is NEVER stored here (LOCK-15).
 *
 * Revision-based staleness:
 *   An entry is stale if it does not exist, or if entry.revision differs
 *   from the current LineTokens.revision for that line (LOCK-14).
 *
 * Key-shifting on buffer splices:
 *   When lines are inserted/removed, cache keys are shifted to stay
 *   consistent with the new line numbering. This mirrors the key-shift
 *   logic in TokenizerEngine.onBufferChange() (LOCK-19).
 *
 * Capacity / eviction:
 *   Uses insertion-order eviction (oldest entry dropped when capacity is
 *   exceeded). This is appropriate for a renderer that accesses lines
 *   sequentially — recently rendered lines are the most likely to be
 *   reused on the next render call.
 */

import type { LineContent } from './LineLayout';

// ---------------------------------------------------------------------------
// RenderCacheEntry
// ---------------------------------------------------------------------------

export interface RenderCacheEntry {
  readonly lineIndex: number;
  readonly revision:  number;
  readonly content:   LineContent;  // pixelY-free
}

// ---------------------------------------------------------------------------
// RenderCache
// ---------------------------------------------------------------------------

export class RenderCache {
  private _cache:    Map<number, RenderCacheEntry>;
  private readonly _capacity: number;

  constructor(capacity = 500) {
    this._capacity = Math.max(1, capacity);
    this._cache    = new Map();
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  get(lineIndex: number): RenderCacheEntry | undefined {
    return this._cache.get(lineIndex);
  }

  /**
   * Returns true if there is no cache entry for `lineIndex`, or if the
   * stored entry's revision differs from `currentRevision` (LOCK-14).
   */
  isStale(lineIndex: number, currentRevision: number): boolean {
    const entry = this._cache.get(lineIndex);
    return entry === undefined || entry.revision !== currentRevision;
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  set(lineIndex: number, entry: RenderCacheEntry): void {
    // Re-insert to refresh insertion order (LRU-adjacent behaviour).
    if (this._cache.has(lineIndex)) {
      this._cache.delete(lineIndex);
    }
    this._cache.set(lineIndex, entry);

    // Evict oldest entry when over capacity.
    if (this._cache.size > this._capacity) {
      const oldestKey = this._cache.keys().next().value as number;
      this._cache.delete(oldestKey);
    }
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  /** Remove the entry for a single line. */
  invalidateLine(lineIndex: number): void {
    this._cache.delete(lineIndex);
  }

  /**
   * Remove all entries at or after `startLine`.
   * Used when a local edit could affect an unbounded suffix of lines.
   */
  invalidateFrom(startLine: number): void {
    for (const key of Array.from(this._cache.keys())) {
      if (key >= startLine) this._cache.delete(key);
    }
  }

  /** Remove all entries. Called by Renderer.setTheme() (LOCK-17). */
  clear(): void {
    this._cache.clear();
  }

  // ── Buffer splice (LOCK-19) ───────────────────────────────────────────────

  /**
   * Shift cache keys to match a line-range splice.
   *
   * Mirrors TokenizerEngine.onBufferChange() key-shift logic so the
   * cache stays structurally consistent with the engine's view of the
   * document after every edit:
   *
   *   key < startLine                           → keep as-is
   *   key in [startLine, startLine+removed)     → drop (content replaced)
   *   key >= startLine + removedCount           → shift by delta
   *
   * Must be called from Renderer.notifyEdit() before the next render()
   * (LOCK-19).
   */
  onBufferSplice(
    startLine:     number,
    removedCount:  number,
    insertedCount: number,
  ): void {
    const delta = insertedCount - removedCount;
    if (delta === 0 && removedCount === 0) return; // no-op insert of 0 lines

    const next = new Map<number, RenderCacheEntry>();

    for (const [key, entry] of this._cache) {
      if (key < startLine) {
        // Before the splice — unchanged.
        next.set(key, entry);
      } else if (key < startLine + removedCount) {
        // Inside the replaced range — drop.
        // (No "keep as previous revision" needed here; that is the engine's
        // responsibility. The renderer simply regenerates stale lines.)
      } else {
        // After the splice — shift key.
        const newKey = key + delta;
        if (newKey >= 0) next.set(newKey, entry);
      }
    }

    this._cache = next;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  get size(): number { return this._cache.size; }
}
