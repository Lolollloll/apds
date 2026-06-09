/**
 * APDS Input — KeyEvent
 *
 * A platform-agnostic keyboard event value object. No DOM dependency.
 * The host adapter converts a native KeyboardEvent to this interface.
 *
 * LOCK-22: KeyEvent is a plain value type with no DOM dependency.
 * LOCK-27: A key is "printable" iff event.key.length === 1 && !ctrl && !meta.
 *          This is the ONLY valid printable-character test in KeyboardHandler.
 */

// ---------------------------------------------------------------------------
// KeyEvent
// ---------------------------------------------------------------------------

export interface KeyEvent {
  /** DOM-style key name: 'a', 'A', 'Enter', 'ArrowLeft', 'Backspace', … */
  readonly key:   string;
  readonly ctrl:  boolean;
  readonly shift: boolean;
  readonly alt:   boolean;
  readonly meta:  boolean;
}

// ---------------------------------------------------------------------------
// Keystroke serialization
// ---------------------------------------------------------------------------

/**
 * Normalize a key string for binding lookup.
 * Single letter keys are lowercased so that 'Ctrl+a' binds regardless of
 * whether the user pressed Ctrl+A or Ctrl+a (the shift flag is separate).
 */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Produce a canonical string for a KeyEvent suitable for InputMap lookup.
 * Modifiers are always in the order: Ctrl, Alt, Shift, Meta.
 *
 * Examples:
 *   { key:'z', ctrl:true }                    → 'Ctrl+z'
 *   { key:'ArrowLeft', shift:true }            → 'Shift+ArrowLeft'
 *   { key:'z', meta:true, shift:true }         → 'Shift+Meta+z'
 *   { key:'Delete', ctrl:true, shift:true }    → 'Ctrl+Shift+Delete'
 */
export function serializeKeyStroke(event: KeyEvent): string {
  const parts: string[] = [];
  if (event.ctrl)  parts.push('Ctrl');
  if (event.alt)   parts.push('Alt');
  if (event.shift) parts.push('Shift');
  if (event.meta)  parts.push('Meta');
  parts.push(normalizeKey(event.key));
  return parts.join('+');
}

/**
 * Returns true if the key event should fall through to insertText (LOCK-27).
 * A key is printable iff event.key is a single character AND neither Ctrl nor
 * Meta is held. Alt is allowed (produces special characters on macOS).
 */
export function isPrintable(event: KeyEvent): boolean {
  return event.key.length === 1 && !event.ctrl && !event.meta;
}
