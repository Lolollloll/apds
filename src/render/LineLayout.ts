/**
 * APDS Renderer — LineLayout
 *
 * Converts one line's tokenization data into a RenderedLine value that the
 * host (DOM adapter, canvas driver, test) can consume directly.
 *
 * LOCK-18: buildLine() is a pure function with no side effects. It reads
 * only from its arguments and writes nothing to any cache or document state.
 *
 * LOCK-15: RenderedLine does NOT include pixelY. pixelY is injected by
 * Renderer.render() from Viewport.lineToPixelY() at render time so that
 * scroll changes never invalidate the token-content cache.
 *
 * Design notes:
 *  - Span text is extracted via String.slice(token.start, token.start + length).
 *    This matches Phase 1's UTF-16 code-unit positions (LOCK-12).
 *  - Selection ranges are computed in document order from Selection.ordered().
 *  - selectionStart / selectionEnd are -1 when there is no selection visible
 *    on this line (collapsed selection, or selection on other lines).
 *  - hasSelection is true only when selectionStart !== selectionEnd (i.e.
 *    there is a non-empty highlighted region on this line).
 */

import { TokenClass } from '../tokenizer/tokenTypes';
import type { LineTokens } from '../tokenizer/tokenizerEngine';
import type { Selection } from '../editor/Selection';
import type { Cursor } from '../editor/Cursor';
import type { TokenStyleMap } from './TokenStyleMap';

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

/** A single styled text run within one rendered line. */
export interface RenderedSpan {
  readonly text:       string;
  readonly cssText:    string;       // pre-baked inline style from TokenStyleMap
  readonly tokenClass: TokenClass;
}

/**
 * Everything needed to display one line.
 * pixelY is intentionally absent — it is added by Renderer.render().
 * Use LineContent when working with the cache layer.
 */
export interface LineContent {
  readonly lineIndex:      number;
  readonly text:           string;
  readonly spans:          RenderedSpan[];
  readonly revision:       number;
  readonly hasSelection:   boolean;
  readonly selectionStart: number;   // inclusive column; -1 = none
  readonly selectionEnd:   number;   // exclusive column; -1 = none
  readonly isCursorLine:   boolean;
  readonly cursorColumn:   number;   // -1 if not the cursor line
}

/**
 * The full rendered line returned by Renderer.render().
 * Extends LineContent with the viewport-relative pixelY offset.
 */
export interface RenderedLine extends LineContent {
  readonly pixelY: number;
}

// ---------------------------------------------------------------------------
// LineLayout (pure, stateless)
// ---------------------------------------------------------------------------

export class LineLayout {
  /**
   * Build a LineContent (sans pixelY) for one document line.
   *
   * Pure function — no side effects, no external state reads.
   * All inputs are passed explicitly.
   */
  static buildLine(
    lineIndex:  number,
    lineText:   string,
    lineTokens: LineTokens,
    styleMap:   TokenStyleMap,
    selection:  Selection,
    cursor:     Cursor,
  ): LineContent {
    // ── Build spans ─────────────────────────────────────────────────────────
    const spans: RenderedSpan[] = lineTokens.tokens.map(token => ({
      text:       lineText.slice(token.start, token.start + token.length),
      cssText:    styleMap.toCSSText(token.class),
      tokenClass: token.class,
    }));

    // ── Selection range for this line ────────────────────────────────────────
    let selectionStart = -1;
    let selectionEnd   = -1;

    if (!selection.isCollapsed) {
      const { start, end } = selection.ordered();

      // Determine whether this line falls inside the selection range.
      if (lineIndex >= start.line && lineIndex <= end.line) {
        if (start.line === end.line) {
          // Entire selection on this line.
          selectionStart = start.column;
          selectionEnd   = end.column;
        } else if (lineIndex === start.line) {
          // Selection starts on this line; extends to line end.
          selectionStart = start.column;
          selectionEnd   = lineText.length;
        } else if (lineIndex === end.line) {
          // Selection ends on this line; covers from line start.
          selectionStart = 0;
          selectionEnd   = end.column;
        } else {
          // Middle line of a multi-line selection — fully covered.
          selectionStart = 0;
          selectionEnd   = lineText.length;
        }
      }
    }

    const hasSelection = selectionStart !== -1 && selectionStart !== selectionEnd;

    // ── Cursor ────────────────────────────────────────────────────────────────
    const isCursorLine = cursor.line === lineIndex;
    const cursorColumn = isCursorLine ? cursor.column : -1;

    return {
      lineIndex,
      text:   lineText,
      spans,
      revision:   lineTokens.revision,
      hasSelection,
      selectionStart,
      selectionEnd,
      isCursorLine,
      cursorColumn,
    };
  }
}
