/**
 * APDS Autocomplete — CompletionSession
 *
 * A CompletionSession represents one "open autocomplete popup" lifecycle:
 *   1. Created by CompletionService when a trigger fires.
 *   2. Populated with raw items from all registered providers.
 *   3. Filtered + ranked by prefix on each update.
 *   4. Dismissed when the cursor moves off the trigger line, the selection
 *      becomes non-collapsed, or the prefix no longer matches any item.
 *
 * Session lifecycle
 * ─────────────────
 *   CompletionService.open()  →  new CompletionSession(ctx, items)
 *   CompletionService.update()  →  session.update(newCtx)
 *   CompletionService.close()   →  session.dismiss()
 *
 * Filtering algorithm
 * ───────────────────
 * A candidate item passes if:
 *   item.label.toLowerCase().startsWith(prefix.toLowerCase())
 *
 * This is intentionally simple and fast.  Fuzzy matching can be layered in
 * a later phase by replacing `scoreItem()`.
 *
 * Result ordering
 * ───────────────
 * Sorted by sortText (ascending), then label (ascending) as tiebreaker.
 * `sortText` is set by providers to control group ordering
 * (keywords < globals < types).
 *
 * Active item
 * ───────────
 * The first item in `filteredItems` is selected by default.
 * `activeIndex` is clamped to [0, filteredItems.length - 1].
 * UI hosts read `activeItem` to highlight the current row.
 */

import type { CompletionContext } from './CompletionContext.js';
import type { CompletionItem }    from './CompletionItem.js';

// ---------------------------------------------------------------------------
// SessionState
// ---------------------------------------------------------------------------

export type SessionState = 'active' | 'dismissed';

// ---------------------------------------------------------------------------
// CompletionSession
// ---------------------------------------------------------------------------

export class CompletionSession {
  private _state: SessionState = 'active';
  private _ctx:   CompletionContext;
  private _items: readonly CompletionItem[];
  private _filtered: CompletionItem[] = [];
  private _activeIndex = 0;

  constructor(ctx: CompletionContext, items: readonly CompletionItem[]) {
    this._ctx   = ctx;
    this._items = items;
    this._applyFilter(ctx.prefix);
  }

  // ── State ───────────────────────────────────────────────────────────────

  get state(): SessionState { return this._state; }
  get isActive(): boolean   { return this._state === 'active'; }

  /** The context this session was last updated with. */
  get context(): CompletionContext { return this._ctx; }

  // ── Results ─────────────────────────────────────────────────────────────

  /** Filtered, ranked candidates. Empty when no items pass the prefix filter. */
  get filteredItems(): readonly CompletionItem[] { return this._filtered; }

  /** Whether there are any candidates to display. */
  get hasItems(): boolean { return this._filtered.length > 0; }

  // ── Active item ─────────────────────────────────────────────────────────

  get activeIndex(): number { return this._activeIndex; }

  get activeItem(): CompletionItem | undefined {
    return this._filtered[this._activeIndex];
  }

  /** Move active selection down (wraps). */
  selectNext(): void {
    if (this._filtered.length === 0) return;
    this._activeIndex = (this._activeIndex + 1) % this._filtered.length;
  }

  /** Move active selection up (wraps). */
  selectPrev(): void {
    if (this._filtered.length === 0) return;
    this._activeIndex =
      (this._activeIndex - 1 + this._filtered.length) % this._filtered.length;
  }

  /** Explicitly set the active index; clamped to valid range. */
  setActiveIndex(index: number): void {
    if (this._filtered.length === 0) return;
    this._activeIndex = Math.max(0, Math.min(index, this._filtered.length - 1));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Update the session with a new context (cursor moved within the same
   * trigger scope).  Re-filters the candidate list.
   *
   * Returns false and auto-dismisses when:
   *  • The cursor moved to a different line, OR
   *  • The prefix no longer starts with the original trigger prefix
   *    (user deleted past the trigger point), OR
   *  • After filtering, no candidates remain.
   */
  update(ctx: CompletionContext): boolean {
    if (this._state === 'dismissed') return false;

    // Dismiss if cursor jumped to a different line
    if (ctx.line !== this._ctx.line) {
      this.dismiss();
      return false;
    }

    // Dismiss if prefix shrank behind the original trigger start
    if (ctx.prefixStart > this._ctx.prefixStart) {
      this.dismiss();
      return false;
    }

    this._ctx = ctx;
    this._applyFilter(ctx.prefix);

    if (!this.hasItems) {
      this.dismiss();
      return false;
    }

    return true;
  }

  /** Explicitly close the session. Idempotent. */
  dismiss(): void {
    this._state = 'dismissed';
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _applyFilter(prefix: string): void {
    const lower = prefix.toLowerCase();
    const filtered = prefix.length === 0
      ? this._items.slice()
      : this._items.filter(item => item.label.toLowerCase().startsWith(lower));

    filtered.sort(compareItems);
    this._filtered = filtered;

    // Clamp active index
    if (this._activeIndex >= this._filtered.length) {
      this._activeIndex = Math.max(0, this._filtered.length - 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Sorting comparator
// ---------------------------------------------------------------------------

function compareItems(a: CompletionItem, b: CompletionItem): number {
  const sa = a.sortText ?? a.label;
  const sb = b.sortText ?? b.label;
  if (sa < sb) return -1;
  if (sa > sb) return  1;
  if (a.label < b.label) return -1;
  if (a.label > b.label) return  1;
  return 0;
}
