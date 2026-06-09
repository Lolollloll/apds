/**
 * APDS Renderer — Renderer
 *
 * Central coordinator for the rendering pipeline.
 *
 * Responsibilities:
 *  - Maintain a Viewport (scroll position + visible dimensions).
 *  - Maintain a TokenStyleMap built from the active Theme.
 *  - Maintain a RenderCache of LineContent objects.
 *  - On render(): produce a RenderResult containing RenderedLine[] for
 *    the visible viewport range (including overscan), totalHeight, and
 *    totalWidth.
 *
 * Hard constraints (all checked in code and tests):
 *
 * LOCK-13: render() never calls lex(). It reads only Document APIs:
 *   doc.getLineTokens(), doc.getLine(), doc.lineCount, doc.selection,
 *   doc.cursor. TextBuffer and TokenizerEngine are never accessed.
 *
 * LOCK-14: A cache entry is reused iff entry.revision === current
 *   LineTokens.revision. No other staleness criterion.
 *
 * LOCK-15: pixelY is computed from Viewport.lineToPixelY() at render
 *   time and never stored in RenderCache. Scrolling does NOT flush the
 *   content cache.
 *
 * LOCK-16: Token style lookups are O(1) via TokenStyleMap.toCSSText().
 *
 * LOCK-17: setTheme() rebuilds TokenStyleMap and clears RenderCache.
 *
 * LOCK-18: LineLayout.buildLine() is called as a pure function; results
 *   are stored in cache; no other stateful calls are made inside buildLine.
 *
 * LOCK-19: notifyEdit() calls RenderCache.onBufferSplice() before the
 *   next render(). Callers MUST call notifyEdit() after every Document
 *   mutation.
 *
 * LOCK-20: Renderer never maintains an independent text model. All text
 *   comes from Document on demand.
 */

import type { Document } from '../editor/Document';
import { TokenStyleMap } from './TokenStyleMap';
import { RenderCache }   from './RenderCache';
import { LineLayout, type LineContent, type RenderedLine } from './LineLayout';
import { Viewport }      from './Viewport';
import type { Theme }    from './Theme';
import { DARK_THEME }    from './Theme';

// ---------------------------------------------------------------------------
// Public configuration & results
// ---------------------------------------------------------------------------

export interface RendererConfig {
  /** Pixels per line (monospace line-height). */
  readonly lineHeight:    number;
  /** Pixels per character cell (monospace char width). */
  readonly charWidth:     number;
  /**
   * Extra lines to render above and below the visible range.
   * Reduces blank flashes during fast scrolling. Default: 2.
   */
  readonly overscanLines?: number;
  /** Maximum entries in RenderCache. Default: 500. */
  readonly cacheCapacity?: number;
}

export interface RenderResult {
  /** Rendered lines for [firstRenderedLine, lastRenderedLine]. */
  readonly lines:             RenderedLine[];
  /** Total document height in pixels (doc.lineCount * lineHeight). */
  readonly totalHeight:       number;
  /**
   * Total document width in pixels (maxLineLength * charWidth).
   * Used for horizontal scrollbar sizing (LOCK-20 / approval decision).
   */
  readonly totalWidth:        number;
  /** First line index included in `lines` (after overscan + clamping). */
  readonly firstRenderedLine: number;
  /** Last line index included in `lines` (after overscan + clamping). */
  readonly lastRenderedLine:  number;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Renderer {
  private readonly _doc:       Document;
  private readonly _config:    Required<RendererConfig>;
  private _styleMap:           TokenStyleMap;
  private readonly _cache:     RenderCache;
  private _viewport:           Viewport;

  // Cached max line length — recomputed lazily after each content change.
  private _maxLineLength:      number   = 0;
  private _maxLineLengthDirty: boolean  = true;
  private _unsubscribeContent: () => void = () => {};

  constructor(doc: Document, theme: Theme = DARK_THEME, config: RendererConfig) {
    this._doc = doc;
    this._config = {
      lineHeight:    config.lineHeight,
      charWidth:     config.charWidth,
      overscanLines: config.overscanLines ?? 2,
      cacheCapacity: config.cacheCapacity ?? 500,
    };
    this._styleMap = new TokenStyleMap(theme);
    this._cache    = new RenderCache(this._config.cacheCapacity);
    // Default viewport: scrolled to top, zero size (host must call setViewport).
    this._viewport = new Viewport(
      0, 0, 0, 0,
      this._config.lineHeight,
      this._config.charWidth,
    );
    // Auto-subscribe to document content changes (LOCK-33).
    // RenderCache is kept consistent without external notifyEdit() coordination.
    this._unsubscribeContent = doc.onDidChangeContent(e => {
      this._cache.onBufferSplice(
        e.mutation.startLine,
        e.mutation.removedLineCount,
        e.mutation.insertedLines.length,
      );
      this._maxLineLengthDirty = true;
    });
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * The current Viewport — read-only accessor for MouseHandler (C2 approval).
   * Call setViewport() to update it.
   */
  get viewport(): Viewport { return this._viewport; }

  /** Release the Document event subscription. Call when the renderer is destroyed. */
  dispose(): void { this._unsubscribeContent(); }

  /** Update the visible region (called on scroll or resize). */
  setViewport(viewport: Viewport): void {
    this._viewport = viewport;
    // Scroll does NOT invalidate the content cache (LOCK-15).
  }

  /**
   * Switch the active theme.
   * Rebuilds TokenStyleMap and clears RenderCache (LOCK-17).
   */
  setTheme(theme: Theme): void {
    this._styleMap.rebuildFrom(theme);
    this._cache.clear();
  }

  /**
   * Manually notify the renderer about a buffer splice.
   *
   * @deprecated The Renderer now auto-subscribes to Document.onDidChangeContent
   * (LOCK-33). Manual calls are no longer required. This method is retained
   * only for backward compatibility with legacy tests. Do not call in new code.
   */
  notifyEdit(startLine: number, removedCount: number, insertedCount: number): void {
    this._cache.onBufferSplice(startLine, removedCount, insertedCount);
    this._maxLineLengthDirty = true;
  }

  // ── Core render ───────────────────────────────────────────────────────────

  /**
   * Produce a RenderResult for the current viewport.
   *
   * Steps:
   *  1. Compute [firstLine, lastLine] from viewport + overscan, clamped
   *     to [0, doc.lineCount - 1].
   *  2. For each line in that range:
   *     a. doc.getLineTokens(line) → get current revision (LOCK-13).
   *     b. If cache is stale: call LineLayout.buildLine() + store (LOCK-14/18).
   *     c. Add pixelY from Viewport (LOCK-15).
   *  3. Compute totalHeight and totalWidth.
   *  4. Return RenderResult.
   *
   * Complexity: O(visible lines) in steady state (cache hits). O(n) only
   * on the first render or after invalidation.
   */
  render(): RenderResult {
    const { lineHeight, charWidth, overscanLines } = this._config;
    const doc      = this._doc;
    const vp       = this._viewport;
    const lineCount = doc.lineCount;

    // Clamp to document bounds.
    const firstLine = Math.max(0, vp.firstVisibleLine - overscanLines);
    const lastLine  = Math.min(lineCount - 1, vp.lastVisibleLine + overscanLines);

    const lines: RenderedLine[] = [];

    for (let i = firstLine; i <= lastLine; i++) {
      const lt = doc.getLineTokens(i);   // LOCK-13: only Document APIs

      let content: LineContent;

      if (this._cache.isStale(i, lt.revision)) {
        // Build and cache — LOCK-18 (buildLine is pure).
        const lineText = doc.getLine(i);
        content = LineLayout.buildLine(
          i,
          lineText,
          lt,
          this._styleMap,
          doc.selection,
          doc.cursor,
        );
        this._cache.set(i, { lineIndex: i, revision: lt.revision, content });
      } else {
        content = this._cache.get(i)!.content;

        // Selection and cursor are viewport-frame state — they can change
        // without a token revision bump (e.g. just moving the cursor).
        // Rebuild the selection/cursor annotations from the live Document,
        // keeping the expensive span list from cache.
        content = this._refreshSelectionAndCursor(i, content, doc.getLine(i), lt);
      }

      // Inject pixelY at render time (LOCK-15).
      const pixelY = vp.lineToPixelY(i);
      lines.push({ ...content, pixelY });
    }

    // totalHeight: full document height for scrollbar.
    const totalHeight = lineCount * lineHeight;

    // totalWidth: max line length across all lines * charWidth.
    // (Per approval decision — gives correct horizontal scrollbar size.)
    const totalWidth = this._getMaxLineLength() * charWidth;

    return {
      lines,
      totalHeight,
      totalWidth,
      firstRenderedLine: firstLine,
      lastRenderedLine:  lastLine,
    };
  }

  /** Force-render a single line, bypassing cache. */
  renderLine(lineIndex: number): RenderedLine {
    const doc   = this._doc;
    const lt    = doc.getLineTokens(lineIndex);
    const text  = doc.getLine(lineIndex);
    const content = LineLayout.buildLine(
      lineIndex, text, lt, this._styleMap, doc.selection, doc.cursor,
    );
    this._cache.set(lineIndex, { lineIndex, revision: lt.revision, content });
    const pixelY = this._viewport.lineToPixelY(lineIndex);
    return { ...content, pixelY };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Refresh selection, cursor, AND lineIndex annotations on a cached
   * LineContent without rebuilding the spans array. Called on cache hits.
   *
   * BUG-001 FIX: After a line deletion, RenderCache.onBufferSplice() shifts
   * cache keys (e.g. key 4 → key 0) but does NOT update content.lineIndex
   * inside the shifted entry. Without this fix, the gutter would display the
   * old stale line number (e.g. "5") instead of the correct one ("1").
   *
   * Fix: always override lineIndex with the current render-time index.
   * The quick-exit check includes lineIndex so a stale lineIndex never
   * short-circuits the refresh and re-enters the cache incorrectly.
   *
   * The cached `content.spans` array is reused directly (readonly, never
   * mutated). Only the per-frame mutable fields are recalculated.
   */
  private _refreshSelectionAndCursor(
    lineIndex: number,
    cached:    LineContent,
    lineText:  string,
    lt:        import('../tokenizer/tokenizerEngine').LineTokens,
  ): LineContent {
    const doc        = this._doc;
    const sel        = doc.selection;
    const cur        = doc.cursor;
    const isCursorLine = cur.line === lineIndex;
    const cursorColumn = isCursorLine ? cur.column : -1;

    let selectionStart = -1;
    let selectionEnd   = -1;

    if (!sel.isCollapsed) {
      const { start, end } = sel.ordered();
      if (lineIndex >= start.line && lineIndex <= end.line) {
        if (start.line === end.line) {
          selectionStart = start.column;
          selectionEnd   = end.column;
        } else if (lineIndex === start.line) {
          selectionStart = start.column;
          selectionEnd   = lineText.length;
        } else if (lineIndex === end.line) {
          selectionStart = 0;
          selectionEnd   = end.column;
        } else {
          selectionStart = 0;
          selectionEnd   = lineText.length;
        }
      }
    }

    const hasSelection = selectionStart !== -1 && selectionStart !== selectionEnd;

    // Quick exit: if NOTHING has changed (including lineIndex), return same
    // reference to avoid object churn.
    // NOTE: lineIndex MUST be in this check — failing to include it was the
    // root cause of Bug #001.
    if (
      cached.lineIndex      === lineIndex      &&   // BUG-001 guard
      cached.hasSelection   === hasSelection   &&
      cached.selectionStart === selectionStart &&
      cached.selectionEnd   === selectionEnd   &&
      cached.isCursorLine   === isCursorLine   &&
      cached.cursorColumn   === cursorColumn
    ) {
      return cached;
    }

    return {
      ...cached,
      lineIndex,           // BUG-001 FIX: always correct the render-time index
      hasSelection,
      selectionStart,
      selectionEnd,
      isCursorLine,
      cursorColumn,
    };
  }

  /**
   * Return the maximum line length across all document lines.
   * Result is cached and recomputed lazily after notifyEdit().
   */
  private _getMaxLineLength(): number {
    if (!this._maxLineLengthDirty) return this._maxLineLength;
    let max = 0;
    for (let i = 0; i < this._doc.lineCount; i++) {
      const len = this._doc.getLine(i).length;
      if (len > max) max = len;
    }
    this._maxLineLength      = max;
    this._maxLineLengthDirty = false;
    return max;
  }
}
