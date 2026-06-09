/**
 * APDS Input — EditorPointerEvent
 *
 * A platform-agnostic pointer event value object. No DOM dependency.
 * The host adapter converts native MouseEvent/PointerEvent to this interface.
 *
 * Pixel coordinates (x, y) are relative to the editor's content area top-left
 * corner, NOT the viewport. The Viewport handles the scroll offset internally
 * via pixelToLine() and pixelToColumn().
 *
 * LOCK-22: EditorPointerEvent is a plain value type with no DOM dependency.
 */

export interface EditorPointerEvent {
  /** Pixel X relative to the editor content area left edge (scroll-adjusted). */
  readonly x:      number;
  /** Pixel Y relative to the editor content area top edge (scroll-adjusted). */
  readonly y:      number;
  /** 0 = primary, 1 = middle, 2 = secondary */
  readonly button: 0 | 1 | 2;
  readonly shift:  boolean;
  readonly ctrl:   boolean;
  readonly alt:    boolean;
  readonly meta:   boolean;
}
