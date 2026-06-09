/**
 * APDS Renderer — Viewport
 *
 * Viewport is an immutable value object. Every scroll or resize event
 * produces a new Viewport instance. The renderer detects changes with a
 * single reference comparison.
 *
 * All pixel arithmetic assumes a monospace font where every character
 * occupies exactly `charWidth` pixels and every line occupies exactly
 * `lineHeight` pixels. Both values are injected by the host after
 * measuring the DOM glyph cell; they do not change at runtime.
 *
 * LOCK-15: pixelY for rendered lines is always computed via
 * lineToPixelY() at render time. It is never stored in RenderCache.
 * Scroll changes do NOT invalidate the token-content cache.
 */

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export class Viewport {
  readonly scrollTop:      number;
  readonly scrollLeft:     number;
  readonly viewportWidth:  number;
  readonly viewportHeight: number;
  readonly lineHeight:     number;
  readonly charWidth:      number;

  constructor(
    scrollTop:      number,
    scrollLeft:     number,
    viewportWidth:  number,
    viewportHeight: number,
    lineHeight:     number,
    charWidth:      number,
  ) {
    this.scrollTop      = Math.max(0, scrollTop);
    this.scrollLeft     = Math.max(0, scrollLeft);
    this.viewportWidth  = Math.max(0, viewportWidth);
    this.viewportHeight = Math.max(0, viewportHeight);
    this.lineHeight     = Math.max(1, lineHeight);   // guard against zero
    this.charWidth      = Math.max(1, charWidth);    // guard against zero
  }

  // ── Visible line range ────────────────────────────────────────────────────

  /**
   * Index of the first line whose top edge is at or below scrollTop.
   * Always >= 0.
   */
  get firstVisibleLine(): number {
    return Math.floor(this.scrollTop / this.lineHeight);
  }

  /**
   * Index of the last line whose top edge is above scrollTop + viewportHeight.
   * May exceed doc.lineCount — callers must clamp.
   */
  get lastVisibleLine(): number {
    return Math.ceil((this.scrollTop + this.viewportHeight) / this.lineHeight) - 1;
  }

  /** Number of lines that are at least partially visible. */
  get visibleLineCount(): number {
    return Math.max(0, this.lastVisibleLine - this.firstVisibleLine + 1);
  }

  // ── Coordinate conversion ─────────────────────────────────────────────────

  /**
   * Pixel Y offset of the top edge of `line` relative to the viewport top.
   * Negative when the line is above the viewport.
   */
  lineToPixelY(line: number): number {
    return line * this.lineHeight - this.scrollTop;
  }

  /**
   * Pixel X offset of the left edge of `column` relative to the viewport left.
   * Negative when the column is to the left of the viewport.
   */
  columnToPixelX(column: number): number {
    return column * this.charWidth - this.scrollLeft;
  }

  /**
   * Document line index for a pixel Y coordinate relative to the viewport top.
   * Result may be out of document bounds — callers must clamp.
   */
  pixelToLine(y: number): number {
    return Math.floor((y + this.scrollTop) / this.lineHeight);
  }

  /**
   * Document column for a pixel X coordinate relative to the viewport left.
   * Rounds to nearest column. Result may be out of line bounds — callers clamp.
   */
  pixelToColumn(x: number): number {
    return Math.round((x + this.scrollLeft) / this.charWidth);
  }

  // ── Immutable updaters ────────────────────────────────────────────────────

  /** Return a new Viewport scrolled so that `line` is the first visible line. */
  scrollToLine(line: number): Viewport {
    return new Viewport(
      Math.max(0, line) * this.lineHeight,
      this.scrollLeft,
      this.viewportWidth,
      this.viewportHeight,
      this.lineHeight,
      this.charWidth,
    );
  }

  /** Return a new Viewport scrolled to the given pixel offsets. */
  scrollToPixel(top: number, left: number): Viewport {
    return new Viewport(
      Math.max(0, top),
      Math.max(0, left),
      this.viewportWidth,
      this.viewportHeight,
      this.lineHeight,
      this.charWidth,
    );
  }

  /** Return a new Viewport with updated dimensions. */
  withSize(width: number, height: number): Viewport {
    return new Viewport(
      this.scrollTop,
      this.scrollLeft,
      width,
      height,
      this.lineHeight,
      this.charWidth,
    );
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /** Construct a viewport at scroll origin (0, 0). */
  static create(
    viewportWidth:  number,
    viewportHeight: number,
    lineHeight:     number,
    charWidth:      number,
  ): Viewport {
    return new Viewport(0, 0, viewportWidth, lineHeight, lineHeight, charWidth);
  }
}
