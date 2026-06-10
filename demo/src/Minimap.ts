/**
 * APDS Demo — Minimap
 *
 * A read-only scaled overview of the document rendered on a separate canvas.
 *
 * Design principles:
 *   - Rendered on its own <canvas> element; zero impact on editor pipeline.
 *   - V2: Syntax-colored rendering — each line is drawn as proportionally
 *     sized colored segments that match the actual token colors.
 *     This matches Monaco's minimap appearance exactly.
 *   - Search result markers — highlighted lines with distinct active marker.
 *   - Quality improvements — better density scaling, cleaner rendering.
 *   - Viewport indicator: a translucent rect shows the currently visible region.
 *   - Click / drag scrolls the editor viewport.
 *   - Redraws only when dirty.
 *
 * Architectural guarantees:
 *   - Never calls lex() or modifies Document.
 *   - Token color data provided via LineSpanGetter callback (set by EditorHost).
 *   - Falls back to single-color bars when span data is unavailable.
 *   - Reads only doc.lineCount, doc.getLine() for sizing.
 *   - Search markers provided via setSearchMarkers() — zero-copy line-set.
 */

import { parseCSSText } from './cssParser.js';
import type { Document } from '../../src/editor/Document.js';
import type { Theme }    from '../../src/render/Theme.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** Minimal span data needed by the minimap (subset of RenderedSpan). */
export interface MiniSpan {
  readonly text:    string;
  readonly cssText: string;
}

/**
 * Callback provided by EditorHost to supply token color data for one line.
 * Returns null if data is not yet cached (minimap will draw plain bar).
 */
export type LineSpanGetter = (lineIndex: number) => MiniSpan[] | null;

/**
 * Search marker data for the minimap.
 * matchLines  — set of line indices that have at least one search match.
 * activeLine  — the currently focused match line (-1 if none).
 */
export interface MinimapSearchMarkers {
  readonly matchLines:  ReadonlySet<number>;
  readonly activeLine:  number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** 2px line height keeps good density on large docs */
const MINIMAP_LINE_H          = 2;
/** Characters that fill the full bar width at scale 1 */
const MINIMAP_FULL_WIDTH_CHARS = 80;
/** Alpha for token color bars */
const BAR_ALPHA               = 0.85;
const VIEWPORT_FILL_ALPHA     = 0.15;
const VIEWPORT_BORDER_ALPHA   = 0.5;
const PADDING                 = 4;    // horizontal padding in px

// Search marker colors / geometry
const MARKER_WIDTH            = 3;   // px wide strip on right edge
const MATCH_MARKER_COLOR      = 'rgba(209, 154, 102, 0.85)';   // warm amber
const ACTIVE_MARKER_COLOR     = 'rgba(255, 215, 0, 1.0)';      // bright gold

// ──────────────────────────────────────────────────────────────────────────────
// Minimap
// ──────────────────────────────────────────────────────────────────────────────

export class Minimap {
  private readonly _doc:     Document;
  private readonly _canvas:  HTMLCanvasElement;
  private readonly _ctx:     CanvasRenderingContext2D;
  private _theme:             Theme;
  private _dirty:             boolean = true;
  private _lineSpanGetter:    LineSpanGetter | null = null;

  // Viewport state
  private _scrollTop:        number = 0;
  private _viewportHeight:   number = 0;
  private _totalDocHeight:   number = 0;
  private _editorLineHeight: number = 22;

  // Search markers
  private _searchMarkers:    MinimapSearchMarkers | null = null;

  // Click/drag callback
  private _onScrollCallback: ((scrollTop: number) => void) | null = null;
  private _isDragging = false;

  constructor(
    canvas:          HTMLCanvasElement,
    doc:             Document,
    theme:           Theme,
    editorLineHeight: number,
  ) {
    this._doc              = doc;
    this._canvas           = canvas;
    this._ctx              = canvas.getContext('2d')!;
    this._theme            = theme;
    this._editorLineHeight = editorLineHeight;
    this._wireMouse();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  setTheme(theme: Theme): void {
    this._theme = theme;
    this._dirty  = true;
  }

  /**
   * Provide a callback that supplies rendered span data for any line.
   * When set, the minimap draws syntax-colored segments instead of plain bars.
   * Called once per minimap-visible line, per redraw cycle.
   */
  setLineSpanGetter(getter: LineSpanGetter): void {
    this._lineSpanGetter = getter;
  }

  /**
   * Provide search result markers for the minimap.
   * Pass null to clear all markers (when find is closed).
   * Calling this automatically marks the minimap dirty.
   */
  setSearchMarkers(markers: MinimapSearchMarkers | null): void {
    this._searchMarkers = markers;
    this._dirty = true;
  }

  updateViewport(scrollTop: number, viewportHeight: number, totalDocHeight: number): void {
    this._scrollTop      = scrollTop;
    this._viewportHeight = viewportHeight;
    this._totalDocHeight = totalDocHeight;
    this._dirty           = true;
  }

  markDirty(): void {
    this._dirty = true;
  }

  draw(): void {
    if (!this._dirty) return;
    this._dirty = false;
    this._render();
  }

  onScroll(cb: (scrollTop: number) => void): void {
    this._onScrollCallback = cb;
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  private _render(): void {
    const ctx       = this._ctx;
    const W         = this._canvas.width;
    const H         = this._canvas.height;
    const lineCount = this._doc.lineCount;
    const colors    = this._theme.colors;
    const fgColor   = colors['foreground'];
    const bgColor   = colors['background'];

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    if (lineCount === 0) return;

    // ── Compute scroll offset ──────────────────────────────────────────────────
    const maxVisibleLines = Math.floor(H / MINIMAP_LINE_H);
    let startLine = 0;
    if (lineCount > maxVisibleLines) {
      const docRatio = this._scrollTop / Math.max(1, this._totalDocHeight);
      startLine = Math.floor(docRatio * lineCount);
      startLine = Math.max(0, Math.min(startLine, lineCount - maxVisibleLines));
    }

    const barMaxW = Math.max(1, W - PADDING * 2 - MARKER_WIDTH - 2);
    const endLine = Math.min(lineCount, startLine + maxVisibleLines + 1);

    // ── Draw lines ────────────────────────────────────────────────────────────
    for (let li = startLine; li < endLine; li++) {
      const y = (li - startLine) * MINIMAP_LINE_H;

      // Try colored rendering first
      if (this._lineSpanGetter) {
        const spans = this._lineSpanGetter(li);
        if (spans && spans.length > 0) {
          this._drawColoredLine(ctx, spans, y, barMaxW);
          continue;
        }
      }

      // Fallback: single-color bar proportional to line length
      const text = this._doc.getLine(li);
      const barW = Math.max(1, Math.min(barMaxW, (text.length / MINIMAP_FULL_WIDTH_CHARS) * barMaxW));
      ctx.globalAlpha = BAR_ALPHA;
      ctx.fillStyle   = fgColor;
      ctx.fillRect(PADDING, y, barW, MINIMAP_LINE_H);
      ctx.globalAlpha = 1;
    }

    // ── Search markers (right-edge strips) ──────────────────────────────────────
    if (this._searchMarkers && this._searchMarkers.matchLines.size > 0) {
      this._drawSearchMarkers(ctx, lineCount, startLine, endLine, W, H);
    }

    // ── Viewport indicator ────────────────────────────────────────────────────
    this._drawViewportIndicator(ctx, lineCount, startLine, W, H);
  }

  /**
   * Draw one line's token spans as proportional colored segments.
   *
   * Each character in a span maps to `barMaxW / MINIMAP_FULL_WIDTH_CHARS` pixels.
   * Colors come from the span's cssText (already baked by TokenStyleMap).
   * Whitespace tokens (transparent color) are skipped — they contribute to
   * the x-offset but don't draw anything, creating natural-looking gaps.
   */
  private _drawColoredLine(
    ctx:     CanvasRenderingContext2D,
    spans:   MiniSpan[],
    y:       number,
    barMaxW: number,
  ): void {
    const charPx = barMaxW / MINIMAP_FULL_WIDTH_CHARS;  // px per minimap char
    let x = PADDING;

    ctx.globalAlpha = BAR_ALPHA;

    for (const span of spans) {
      if (span.text.length === 0) continue;

      const segW = span.text.length * charPx;
      const right = x + segW;

      // Clip to bar width
      if (x >= PADDING + barMaxW) break;

      const style = parseCSSText(span.cssText);

      // Skip transparent (whitespace tokens — they are blank space)
      if (style.color !== 'transparent' && style.color !== '') {
        const drawW = Math.min(segW, PADDING + barMaxW - x);
        if (drawW >= 0.5) {
          ctx.fillStyle = style.color;
          ctx.fillRect(x, y, drawW, MINIMAP_LINE_H);
        }
      }

      x = right;
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw search result markers as thin colored strips on the right edge.
   *
   * Each match line gets a 3px-wide strip. The active (focused) match line
   * gets a distinct bright gold strip drawn on top.
   *
   * Markers are positioned relative to the FULL document height (not just the
   * visible portion), so they appear at the correct absolute position even
   * when the minimap is scrolled. This mirrors Monaco's behaviour.
   */
  private _drawSearchMarkers(
    ctx:       CanvasRenderingContext2D,
    lineCount: number,
    startLine: number,
    endLine:   number,
    W:         number,
    H:         number,
  ): void {
    if (!this._searchMarkers) return;
    const { matchLines, activeLine } = this._searchMarkers;

    const totalMinimapH = lineCount * MINIMAP_LINE_H;
    const markerX = W - MARKER_WIDTH;

    // Draw all non-active markers first
    ctx.fillStyle = MATCH_MARKER_COLOR;
    for (const line of matchLines) {
      if (line === activeLine) continue;

      // Map line index to minimap Y — use doc-proportional position
      const y = Math.round((line / lineCount) * H);
      ctx.fillRect(markerX, y, MARKER_WIDTH, Math.max(2, MINIMAP_LINE_H));
    }

    // Draw active marker on top (brighter, slightly taller)
    if (activeLine >= 0 && matchLines.has(activeLine)) {
      ctx.fillStyle = ACTIVE_MARKER_COLOR;
      const y = Math.round((activeLine / lineCount) * H);
      ctx.fillRect(markerX, Math.max(0, y - 1), MARKER_WIDTH, Math.max(3, MINIMAP_LINE_H + 1));
    }
  }

  private _drawViewportIndicator(
    ctx:       CanvasRenderingContext2D,
    lineCount: number,
    startLine: number,
    W:         number,
    H:         number,
  ): void {
    if (this._totalDocHeight <= 0 || this._viewportHeight <= 0) return;

    const totalH = lineCount * MINIMAP_LINE_H;
    const scrollRatio   = this._scrollTop / Math.max(1, this._totalDocHeight);
    const viewportRatio = this._viewportHeight / Math.max(1, this._totalDocHeight);

    let vpY = scrollRatio * totalH;
    let vpH = Math.max(4, viewportRatio * totalH);

    vpY = Math.max(0, Math.min(vpY, H - vpH));

    ctx.fillStyle = `rgba(255,255,255,${VIEWPORT_FILL_ALPHA})`;
    ctx.fillRect(0, vpY, W, vpH);

    ctx.strokeStyle = `rgba(255,255,255,${VIEWPORT_BORDER_ALPHA})`;
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, vpY + 0.5, W - 1, vpH - 1);
  }

  // ── Mouse click/drag → scroll ──────────────────────────────────────────────

  private _wireMouse(): void {
    this._canvas.addEventListener('mousedown', e => {
      this._isDragging = true;
      this._handleMouseY(e.offsetY);
      e.preventDefault();
    });
    this._canvas.addEventListener('mousemove', e => {
      if (!this._isDragging) return;
      this._handleMouseY(e.offsetY);
    });
    window.addEventListener('mouseup', () => { this._isDragging = false; });
  }

  private _handleMouseY(mouseY: number): void {
    const H         = this._canvas.height;
    const lineCount = this._doc.lineCount;
    if (H === 0 || lineCount === 0 || this._totalDocHeight === 0) return;
    const ratio    = mouseY / H;
    const scrollTo = ratio * this._totalDocHeight - this._viewportHeight / 2;
    this._onScrollCallback?.(Math.max(0, scrollTo));
  }
}
