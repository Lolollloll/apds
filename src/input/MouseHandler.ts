/**
 * APDS Input — MouseHandler
 *
 * Translates pointer events into cursor/selection operations on Document.
 *
 * Coordinate conversion uses a Viewport supplier function (C6 approval).
 * The host passes `() => renderer.viewport` — MouseHandler never depends
 * on the Renderer type, keeping the dependency graph clean:
 *
 *   Input → Document   (text and cursor mutations)
 *   Input → Viewport   (coordinate math only)
 *
 * Word selection on double-click reuses wordBoundaryLeft/Right from
 * EditorActions (LOCK-25: pure functions, no document state).
 *
 * LOCK-21: All mutations go through Document's public API.
 * LOCK-22: EditorPointerEvent is a plain value type — no DOM dependency.
 */

import type { Document }           from '../editor/Document';
import type { Viewport }           from '../render/Viewport';
import type { EditorPointerEvent } from './EditorPointerEvent';
import { wordBoundaryLeft, wordBoundaryRight } from './EditorActions';

export class MouseHandler {
  private readonly _doc:         Document;
  private readonly _getViewport: () => Viewport;

  /**
   * @param doc         The document to manipulate.
   * @param getViewport Supplier for the current Viewport
   *                    (e.g. `() => renderer.viewport`).
   */
  constructor(doc: Document, getViewport: () => Viewport) {
    this._doc         = doc;
    this._getViewport = getViewport;
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  /**
   * Primary button press: move cursor to click position (or extend selection
   * if Shift is held). Call on mousedown / pointerdown.
   */
  handlePointerDown(event: EditorPointerEvent): void {
    if (event.button !== 0) return;
    const { line, column } = this._hitTest(event.x, event.y);
    const cursor = this._doc.createCursor(line, column);
    if (event.shift) {
      this._doc.extendSelection(cursor);
    } else {
      this._doc.moveCursor(cursor);
    }
  }

  /**
   * Pointer moved while primary button is held: extend selection.
   * Call on mousemove / pointermove.
   * @param isDown Whether the primary button is currently held.
   */
  handlePointerMove(event: EditorPointerEvent, isDown: boolean): void {
    if (!isDown || event.button !== 0) return;
    const { line, column } = this._hitTest(event.x, event.y);
    const cursor = this._doc.createCursor(line, column);
    this._doc.extendSelection(cursor);
  }

  /**
   * Primary button released. No-op — state is already up-to-date from
   * handlePointerMove. Provided for API symmetry.
   */
  handlePointerUp(_event: EditorPointerEvent): void {}

  /**
   * Double-click: select the word under the pointer.
   * Uses the same wordBoundaryLeft/Right as EditorActions (LOCK-25).
   */
  handleDoubleClick(event: EditorPointerEvent): void {
    const { line, column } = this._hitTest(event.x, event.y);
    const lineText   = this._doc.getLine(line);
    // For double-click, we treat the clicked column as "inside" the word
    // by looking at charaters on both sides of the click point.
    const wordStart  = wordBoundaryLeft(lineText, Math.min(column + 1, lineText.length));
    const wordEnd    = wordBoundaryRight(lineText, column);
    const anchor     = this._doc.createCursor(line, wordStart);
    const active     = this._doc.createCursor(line, wordEnd);
    this._doc.moveCursor(anchor);
    this._doc.extendSelection(active);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Convert pixel coordinates (relative to the editor content area, already
   * scroll-adjusted by the Viewport) to a clamped document position.
   *
   * The Viewport's pixelToLine / pixelToColumn methods handle the scroll
   * offset internally, so callers pass coordinates relative to the content
   * area top-left (not the screen).
   */
  private _hitTest(x: number, y: number): { line: number; column: number } {
    const vp       = this._getViewport();
    const rawLine  = vp.pixelToLine(y);
    const line     = Math.max(0, Math.min(rawLine, this._doc.lineCount - 1));
    const lineLen  = this._doc.getLine(line).length;
    const rawCol   = vp.pixelToColumn(x);
    const column   = Math.max(0, Math.min(rawCol, lineLen));
    return { line, column };
  }
}
