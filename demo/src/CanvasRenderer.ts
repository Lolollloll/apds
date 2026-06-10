/**
 * APDS Demo — Canvas Renderer
 *
 * Translates Renderer.render() output (RenderResult) into actual pixels
 * on an HTML5 canvas.  This is the browser host's drawing layer — it
 * never calls lex(), accesses TokenizerEngine, or bypasses Document.
 *
 * Rendering pipeline per frame:
 *   1. Fill background
 *   2. Draw each visible line:
 *      a. Current-line highlight (behind everything, cursor line only)
 *      b. Decoration rects below text (find matches, bracket matches)
 *      c. Selection highlight rect
 *      d. Indentation guides
 *      e. Text spans (applying color / italic / bold from cssText)
 *      f. Decoration rects above text (reserved for future squiggles)
 *      g. Cursor (if isCursorLine && cursor visible)
 *   3. Gutter (drawn on top so it covers any leftward text)
 *
 * Decoration layer (E) is consumed here from DecorationLayer.
 */

import type { RenderResult, RenderedLine } from '../../src/render/Renderer.js';
import type { Theme } from '../../src/render/Theme.js';
import { parseCSSText } from './cssParser.js';
import type { DecorationLayer, DecorationRange } from './DecorationLayer.js';

// ── Constants ──────────────────────────────────────────────────────────────

export const FONT_SIZE        = 14;
/**
 * GUTTER_WIDTH is no longer a hard constant for layout purposes.
 * This value is kept as the *minimum* gutter width (covers 1–999 lines).
 * Call computeGutterWidth(lineCount) to get the correct value at runtime.
 */
export const GUTTER_WIDTH     = 52;   // px  (minimum / 3-digit fallback)
export const GUTTER_PAD_RIGHT = 12;   // px  gap between number and code
export const CONTENT_PAD_LEFT = 6;    // px  gap left of first char

/**
 * Compute the gutter pixel width required for `lineCount` lines.
 *
 * Formula: measure the rendered width of the widest line-number string
 * (all '9's of the appropriate digit count) plus padding.
 *
 * Results are memoised by digit-count to avoid repeated canvas measurement.
 */
const _gutterWidthCache = new Map<number, number>();

export function computeGutterWidth(lineCount: number, ctx: CanvasRenderingContext2D, font: string): number {
  const digits = String(Math.max(lineCount, 1)).length;

  if (_gutterWidthCache.has(digits)) {
    return _gutterWidthCache.get(digits)!;
  }

  // Measure the widest number string of this digit count (all 9s)
  const sample = '9'.repeat(digits);
  const prevFont = ctx.font;
  ctx.font = font;
  const textWidth = ctx.measureText(sample).width;
  ctx.font = prevFont;

  // width = text + right-padding + left-padding-mirror (4px) + 1px separator
  const width = Math.ceil(textWidth) + GUTTER_PAD_RIGHT + 4 + 1;
  // Minimum width to avoid jarring layout for very small docs
  const result = Math.max(width, 44);

  _gutterWidthCache.set(digits, result);
  return result;
}

/** Full horizontal offset from canvas left to column 0 of code.
 *
 * This is now DYNAMIC. Use getCodeOriginX(lineCount, ctx) at draw time.
 * The exported constant is kept for backward compatibility
 * that imports it (EditorHost uses it for mouse coordinate math).
 * EditorHost._draw() must call updateCodeOriginX() to keep it fresh.
 */
export let CODE_ORIGIN_X = GUTTER_WIDTH + CONTENT_PAD_LEFT;

/**
 * Recompute the live CODE_ORIGIN_X from current line count.
 * Called by EditorHost._draw() before rendering.
 */
export function updateCodeOriginX(lineCount: number, ctx: CanvasRenderingContext2D, font: string): number {
  const gw = computeGutterWidth(lineCount, ctx, font);
  CODE_ORIGIN_X = gw + CONTENT_PAD_LEFT;
  return CODE_ORIGIN_X;
}

/** Indent guide config */
const INDENT_GUIDE_WIDTH  = 1;   // px
const INDENT_GUIDE_MARGIN = 0;   // px from top/bottom — 0 = continuous lines (no gaps between lines)

// ── Font helpers ─────────────────────────────────────────────────────────────

function makeFont(size: number, italic: boolean, bold: boolean): string {
  const style  = italic ? 'italic ' : '';
  const weight = bold   ? 'bold '   : '';
  return `${style}${weight}${size}px Menlo, Monaco, Consolas, 'Courier New', monospace`;
}

export const NORMAL_FONT = makeFont(FONT_SIZE, false, false);
export const ITALIC_FONT = makeFont(FONT_SIZE, true,  false);
export const BOLD_FONT   = makeFont(FONT_SIZE, false, true);
export const BOLD_ITALIC = makeFont(FONT_SIZE, true,  true);

function fontFor(italic: boolean, bold: boolean): string {
  if (italic && bold)  return BOLD_ITALIC;
  if (italic)          return ITALIC_FONT;
  if (bold)            return BOLD_FONT;
  return NORMAL_FONT;
}

// ── Measure charWidth ────────────────────────────────────────────────────────

/**
 * Measure the pixel width of one monospace character at FONT_SIZE.
 * Uses an offscreen canvas so this can be called before any visible
 * canvas is available.
 */
export function measureCharWidth(): number {
  const offscreen = document.createElement('canvas');
  const ctx = offscreen.getContext('2d')!;
  ctx.font = NORMAL_FONT;
  return ctx.measureText('M').width;
}

// ── Indentation guide helpers ─────────────────────────────────────────────────

/**
 * Count leading spaces in `text`, respecting `tabSize` for tab chars.
 * Returns the number of space-equivalent indent levels (each `tabSize` wide).
 */
export function leadingIndentLevels(text: string, tabSize: number): number {
  let spaces = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ')  { spaces++; continue; }
    if (ch === '\t') { spaces += tabSize - (spaces % tabSize); continue; }
    break;
  }
  return Math.floor(spaces / tabSize);
}

/**
 * Build a resolved indent-level map for all visible lines.
 *
 * For non-blank lines the level is computed from leading whitespace.
 * For blank / whitespace-only lines the level is inherited from the
 * nearest non-blank neighbours (above and below), using min(above, below).
 * This matches VS Code's "connected guides through blank lines" behaviour.
 *
 * `getLine` is optional; when provided it is used to look up lines that
 * fall outside the visible `lines` array (e.g. blank lines at the top
 * or bottom of the viewport).
 */
export function buildResolvedIndentMap(
  lines:          ReadonlyArray<{ lineIndex: number; text: string }>,
  tabSize:        number,
  totalLineCount: number,
  getLine?:       (index: number) => string,
): Map<number, number> {
  const n = lines.length;
  if (n === 0) return new Map();

  // Bounds are guaranteed for every array access below (loops stay within [0, n)).
  // Non-null assertions (!) are used where noUncheckedIndexedAccess would
  // otherwise widen to T|undefined; the bounds invariant is upheld by the loops.

  // --- Pass 0: compute own indent level for every visible line.
  //     -1 = blank / whitespace-only. O(n).
  const ownLevel  = new Array<number>(n).fill(0);
  const aboveArr  = new Array<number>(n).fill(-1);
  const belowArr  = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const entry = lines[i]!;
    ownLevel[i] = entry.text.trim().length > 0
      ? leadingIndentLevels(entry.text, tabSize)
      : -1;
  }

  // --- Pass 1 (forward): nearest non-blank level from above. O(n).
  let running = -1;
  for (let i = 0; i < n; i++) {
    const own = ownLevel[i]!;
    if (own >= 0) running = own;
    aboveArr[i] = running;
  }

  // --- Pass 2 (backward): nearest non-blank level from below. O(n).
  running = -1;
  for (let i = n - 1; i >= 0; i--) {
    const own = ownLevel[i]!;
    if (own >= 0) running = own;
    belowArr[i] = running;
  }

  // --- Off-screen boundary extension via getLine callback.
  //     Only needed when the visible batch starts/ends with blank lines
  //     that have no non-blank neighbour within the visible range.
  if (getLine) {
    // Top boundary
    if ((aboveArr[0] ?? -1) < 0) {
      const firstIdx = lines[0]!.lineIndex;
      for (let i = firstIdx - 1; i >= 0; i--) {
        const text = getLine(i);
        if (text.trim().length > 0) {
          const level = leadingIndentLevels(text, tabSize);
          for (let j = 0; j < n && (aboveArr[j] ?? -1) < 0; j++) aboveArr[j] = level;
          break;
        }
      }
    }

    // Bottom boundary
    if ((belowArr[n - 1] ?? -1) < 0) {
      const lastIdx = lines[n - 1]!.lineIndex;
      for (let i = lastIdx + 1; i < totalLineCount; i++) {
        const text = getLine(i);
        if (text.trim().length > 0) {
          const level = leadingIndentLevels(text, tabSize);
          for (let j = n - 1; j >= 0 && (belowArr[j] ?? -1) < 0; j--) belowArr[j] = level;
          break;
        }
      }
    }
  }

  // --- Build result map. O(n).
  const map = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const entry  = lines[i]!;
    const own    = ownLevel[i]!;
    const above  = aboveArr[i]!;
    const below  = belowArr[i]!;

    if (own >= 0) {
      map.set(entry.lineIndex, own);
    } else {
      let resolved = 0;
      if (above >= 0 && below >= 0) resolved = Math.min(above, below);
      else if (above >= 0)          resolved = above;
      else if (below >= 0)          resolved = below;
      map.set(entry.lineIndex, resolved);
    }
  }

  return map;
}

// ── CanvasRenderer ───────────────────────────────────────────────────────────

export class CanvasRenderer {
  private readonly _canvas:     HTMLCanvasElement;
  private readonly _ctx:        CanvasRenderingContext2D;
  private _theme:                Theme;
  private _charWidth:            number;
  private _lineHeight:           number;
  private _tabSize:              number;
  private _showIndentGuides:     boolean = true;
  private _cursorVisible:        boolean = true;
  private _cursorBlinkHandle:    ReturnType<typeof setInterval> | null = null;
  private _onCursorBlink:        (() => void) | null = null;

  constructor(
    canvas:     HTMLCanvasElement,
    theme:      Theme,
    charWidth:  number,
    lineHeight: number,
    tabSize:    number = 2,
  ) {
    this._canvas     = canvas;
    this._ctx        = canvas.getContext('2d')!;
    this._theme      = theme;
    this._charWidth  = charWidth;
    this._lineHeight = lineHeight;
    this._tabSize    = tabSize;
    this._startCursorBlink();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  setTheme(theme: Theme): void {
    this._theme = theme;
  }

  setTabSize(tabSize: number): void {
    this._tabSize = tabSize;
  }

  setShowIndentGuides(show: boolean): void {
    this._showIndentGuides = show;
  }

  /** Register a callback that fires on every cursor blink tick (triggers repaint). */
  onCursorBlink(cb: () => void): void {
    this._onCursorBlink = cb;
  }

  /** Reset cursor blink phase (call whenever cursor moves). */
  resetBlink(): void {
    this._cursorVisible = true;
    if (this._cursorBlinkHandle !== null) {
      clearInterval(this._cursorBlinkHandle);
    }
    this._startCursorBlink();
  }

  dispose(): void {
    if (this._cursorBlinkHandle !== null) {
      clearInterval(this._cursorBlinkHandle);
      this._cursorBlinkHandle = null;
    }
  }

  /**
   * Draw a complete frame to the canvas.
   *
   * @param result        Output of Renderer.render()
   * @param scrollTop     Current scroll position (for viewport offset)
   * @param hasFocus      Whether the editor has keyboard focus
   * @param decorations   Optional decoration layer (find, bracket, diagnostic highlights)
   * @param cursorLine    Current cursor line index (for active indent guide)
   * @param totalLines    Total document line count
   * @param getLine       Optional callback to fetch text for off-screen lines,
   *                      used to resolve indent guides through blank lines at viewport edges.
   */
  draw(
    result:      RenderResult,
    scrollTop:   number,
    hasFocus:    boolean,
    decorations: DecorationLayer | null = null,
    cursorLine:  number = -1,
    totalLines:  number = 1,
    getLine?:    (index: number) => string,
  ): void {
    const ctx        = this._ctx;
    const w          = this._canvas.width;
    const h          = this._canvas.height;
    const lh         = this._lineHeight;
    const cw         = this._charWidth;
    const colors     = this._theme.colors;

    // Compute dynamic gutter width for this frame.
    const gutterWidth = computeGutterWidth(totalLines, ctx, NORMAL_FONT);
    const codeOriginX = gutterWidth + CONTENT_PAD_LEFT;

    // Pre-compute resolved indent levels for all visible lines.
    // Blank lines inherit their indent depth from the nearest non-blank
    // neighbours (above and below), exactly like VS Code's connected guides.
    const resolvedIndentMap = this._showIndentGuides
      ? buildResolvedIndentMap(result.lines, this._tabSize, totalLines, getLine)
      : null;

    // 1. Background fill
    ctx.fillStyle = colors['background'];
    ctx.fillRect(0, 0, w, h);

    // 2. Draw each visible line
    for (const line of result.lines) {
      const y = line.pixelY;

      // Skip if completely outside canvas
      if (y + lh < 0 || y > h) continue;

      // ── 2a. Current-line highlight (Feature G) ─────────────────────────────
      // Drawn first — behind everything including selection.
      if (line.isCursorLine) {
        ctx.fillStyle = colors['currentLineBg'];
        ctx.fillRect(0, y, w, lh);
      }

      // ── 2b. Decoration fill-rects below text (find matches, bracket matches).
      //        Squiggle decorations are skipped here — drawn after text in 2f.
      if (decorations) {
        this._drawDecorations(ctx, line, decorations, cw, lh, y, codeOriginX);
      }

      // ── 2c. Selection highlight ─────────────────────────────────────────────
      if (line.hasSelection) {
        const selX = codeOriginX + line.selectionStart * cw;
        const selW = (line.selectionEnd - line.selectionStart) * cw;
        ctx.fillStyle = colors['selectionBg'];
        ctx.fillRect(selX, y, selW, lh);
      }

      // ── 2d. Indentation guides (connected through blank lines) ──────────────
      if (resolvedIndentMap) {
        const resolvedLevels = resolvedIndentMap.get(line.lineIndex) ?? 0;
        this._drawIndentGuides(
          ctx, line, cw, lh, y, cursorLine, colors, codeOriginX, resolvedLevels,
        );
      }

      // ── 2e. Text spans ──────────────────────────────────────────────────────
      let spanX = codeOriginX;
      ctx.textBaseline = 'alphabetic';
      const textY = y + lh - Math.floor(lh * 0.25);  // baseline within line

      for (const span of line.spans) {
        if (span.text.length === 0) continue;
        const style = parseCSSText(span.cssText);
        ctx.font      = fontFor(style.italic, style.bold);
        ctx.fillStyle = style.color;
        ctx.fillText(span.text, spanX, textY);
        spanX += span.text.length * cw;
      }

      // ── 2f. Squiggle underlines for diagnostics ──────────────────────────────
      //        Drawn after text so glyphs are never obscured.
      if (decorations) {
        this._drawSquiggles(ctx, line, decorations, cw, lh, y, codeOriginX, textY);
      }

      // ── 2g. Cursor ──────────────────────────────────────────────────────────
      if (line.isCursorLine && this._cursorVisible && hasFocus) {
        const curX = codeOriginX + line.cursorColumn * cw;
        ctx.fillStyle = colors['cursorColor'];
        ctx.fillRect(curX, y + 1, 2, lh - 2);
      }
    }

    // 3. Gutter (drawn on top so it covers any leftward text)
    this._drawGutter(result, scrollTop, hasFocus, gutterWidth, codeOriginX);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Draw indentation guide lines.
   *
   * Draws GUIDE_WIDTH=1px vertical lines at each tab-stop column boundary.
   * `resolvedLevels` is the pre-computed indent depth for this line — for
   * blank lines it has been inherited from the nearest non-blank neighbours
   * (see buildResolvedIndentMap), so guides continue through blank regions.
   *
   * Active guide = guide at the cursor's indentation depth on the cursor line,
   * highlighted with a brighter color.
   *
   * LOCK-13: No lexer calls. LOCK-18: Pure rendering; no document mutations.
   */
  private _drawIndentGuides(
    ctx:            CanvasRenderingContext2D,
    line:           RenderedLine,
    cw:             number,
    lh:             number,
    y:              number,
    cursorLine:     number,
    colors:         Record<string, string>,
    codeOriginX:    number,
    resolvedLevels: number,   // pre-computed (includes blank-line inheritance)
  ): void {
    if (resolvedLevels === 0) return;

    // Active level: which guide to highlight (cursor line only).
    // For blank lines leadingIndentLevels returns 0, so no guide is active —
    // that is acceptable; the highlight simply does not appear on blank lines.
    const isCursorLine = line.lineIndex === cursorLine;
    const cursorLevel  = isCursorLine
      ? leadingIndentLevels(line.text, this._tabSize)
      : -1;

    const guideColor       = colors['indentGuideColor'];
    const activeGuideColor = colors['indentGuideActiveColor'];

    for (let level = 1; level <= resolvedLevels; level++) {
      // Center the guide within each indent-level block.
      //
      // Formula: (level-1)*tabSize + ceil(tabSize/2)
      //   level=1, tabSize=2 → col=1  (middle of first 2-char block)
      //   level=2, tabSize=2 → col=3  (middle of second 2-char block)
      //   level=1, tabSize=4 → col=2  (middle of first 4-char block)
      //
      const col = (level - 1) * this._tabSize + Math.ceil(this._tabSize / 2);
      const gx  = codeOriginX + col * cw - Math.floor(INDENT_GUIDE_WIDTH / 2);
      const gy  = y + INDENT_GUIDE_MARGIN;
      const gh  = lh - INDENT_GUIDE_MARGIN * 2;

      ctx.fillStyle = (level === cursorLevel) ? activeGuideColor : guideColor;
      ctx.fillRect(gx, gy, INDENT_GUIDE_WIDTH, gh);
    }
  }

  private _drawDecorations(
    ctx:         CanvasRenderingContext2D,
    line:        RenderedLine,
    decorations: DecorationLayer,
    cw:          number,
    lh:          number,
    y:           number,
    codeOriginX: number,
  ): void {
    const ranges = decorations.getForLine(line.lineIndex);
    if (!ranges) return;

    for (const range of ranges) {
      // Squiggle decorations are rendered after text — skip here.
      if (range.squiggle) continue;

      const x = codeOriginX + range.startColumn * cw;
      const w = (range.endColumn - range.startColumn) * cw;
      if (w <= 0) continue;
      ctx.fillStyle = range.color;
      // Slight vertical inset for find matches; full-height for brackets
      if (range.inset) {
        ctx.fillRect(x, y + 2, w, lh - 4);
      } else {
        ctx.fillRect(x, y, w, lh);
      }
    }
  }

  /**
   * Draw wavy squiggle underlines for diagnostic decorations.
   *
   * Called after text spans so glyphs are never obscured.
   * Each squiggle is a sine-wave path drawn just below the text baseline.
   *
   * Colors:   Error → red (#ff4444)   Warning → yellow (#ffcc00)   Info → blue (#4499ff)
   * Position: textY + 2px (below baseline)
   * Amplitude: 1.5px   Period: 4px per full cycle
   */
  private _drawSquiggles(
    ctx:         CanvasRenderingContext2D,
    line:        RenderedLine,
    decorations: DecorationLayer,
    cw:          number,
    _lh:         number,
    _y:          number,
    codeOriginX: number,
    textY:       number,
  ): void {
    const ranges = decorations.getForLine(line.lineIndex);
    if (!ranges) return;

    const squiggleY = textY + 2;   // just below text baseline
    const amplitude = 1.5;
    const period    = 4;           // pixels per full wave cycle

    for (const range of ranges) {
      if (!range.squiggle) continue;

      const startX = codeOriginX + range.startColumn * cw;
      const endX   = codeOriginX + range.endColumn   * cw;
      if (endX <= startX) continue;

      ctx.strokeStyle = range.color;
      ctx.lineWidth   = 1;
      ctx.beginPath();

      // Walk pixel-by-pixel across the underline span, drawing a sine wave.
      let firstPoint = true;
      for (let px = startX; px <= endX; px++) {
        const sy = squiggleY + Math.sin((px / period) * Math.PI * 2) * amplitude;
        if (firstPoint) {
          ctx.moveTo(px, sy);
          firstPoint = false;
        } else {
          ctx.lineTo(px, sy);
        }
      }

      ctx.stroke();
    }
  }

  private _drawGutter(
    result:       RenderResult,
    scrollTop:    number,
    _hasFocus:    boolean,
    gutterWidth:  number,
    codeOriginX:  number,
  ): void {
    const ctx    = this._ctx;
    const h      = this._canvas.height;
    const lh     = this._lineHeight;
    const colors = this._theme.colors;

    // Gutter background
    ctx.fillStyle = colors['gutterBg'];
    ctx.fillRect(0, 0, gutterWidth, h);

    // Current-line highlight extends into gutter
    for (const line of result.lines) {
      if (!line.isCursorLine) continue;
      const y = line.pixelY;
      if (y + lh < 0 || y > h) continue;
      ctx.fillStyle = colors['currentLineBg'];
      ctx.fillRect(0, y, gutterWidth - 1, lh);
      break;
    }

    // Gutter separator
    ctx.fillStyle = this._theme.colors['background'] === '#1e1e1e'
      ? '#3c3c3c' : '#d0d0d0';
    ctx.fillRect(gutterWidth - 1, 0, 1, h);

    // Line numbers
    ctx.font         = NORMAL_FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign    = 'right';
    ctx.fillStyle    = colors['gutterFg'];

    for (const line of result.lines) {
      const y = line.pixelY;
      if (y + lh < 0 || y > h) continue;
      const textY = y + lh - Math.floor(lh * 0.25);
      // Highlight current line number
      if (line.isCursorLine) {
        ctx.fillStyle = colors['foreground'];
      } else {
        ctx.fillStyle = colors['gutterFg'];
      }
      ctx.fillText(
        String(line.lineIndex + 1),
        gutterWidth - GUTTER_PAD_RIGHT,
        textY,
      );
    }

    // Reset alignment for next frame
    ctx.textAlign = 'left';
  }

  private _startCursorBlink(): void {
    this._cursorBlinkHandle = setInterval(() => {
      this._cursorVisible = !this._cursorVisible;
      this._onCursorBlink?.();
    }, 530);
  }
}
