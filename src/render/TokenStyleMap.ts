/**
 * APDS Renderer — TokenStyleMap
 *
 * Converts a Theme's tokenStyles into a fixed-size lookup table indexed
 * by TokenClass integer for O(1) per-token access.
 *
 * CSS strings are pre-baked at construction time so the per-token render
 * path never performs string concatenation or interpolation at runtime.
 *
 * LOCK-16: TokenStyleMap is a fixed-size array indexed by TokenClass
 * integer. toCSSText() is O(1). No string interpolation in the hot path.
 * LOCK-17: rebuildFrom() is the only way to update the map after a theme
 * change. It is called exclusively by Renderer.setTheme().
 */

import { TokenClass } from '../tokenizer/tokenTypes';
import type { Theme, TokenStyle } from './Theme';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Highest TokenClass value emitted by the Phase 1 lexer.
 * _SemanticStart = 100 is never emitted; we only need slots 0..LEXER_MAX.
 */
const LEXER_MAX_CLASS = 20; // TokenClass.Invalid

/**
 * Pre-bake a TokenStyle into a minimal inline CSS string.
 * Only emits properties that differ from their defaults so the DOM
 * doesn't inherit unwanted styles.
 *
 * Output examples:
 *   "color:#569cd6"
 *   "color:#6a9955;font-style:italic"
 *   "color:#dcdcaa;font-weight:bold"
 */
function buildCSSText(style: TokenStyle): string {
  let css = `color:${style.color}`;
  if (style.fontStyle === 'italic')  css += ';font-style:italic';
  if (style.fontWeight === 'bold')   css += ';font-weight:bold';
  return css;
}

// ---------------------------------------------------------------------------
// TokenStyleMap
// ---------------------------------------------------------------------------

export class TokenStyleMap {
  /**
   * Indexed by TokenClass integer.
   * Slots 0..LEXER_MAX_CLASS are always populated.
   * Slots above LEXER_MAX_CLASS are populated if the theme supplies them;
   * otherwise the fallback is used.
   */
  private readonly _styles:   TokenStyle[];
  private readonly _cssTexts: string[];
  private _fallbackStyle:     TokenStyle;
  private _fallbackCSS:       string;

  constructor(theme: Theme) {
    this._fallbackStyle = theme.fallbackStyle;
    this._fallbackCSS   = buildCSSText(theme.fallbackStyle);
    this._styles        = new Array(LEXER_MAX_CLASS + 1);
    this._cssTexts      = new Array(LEXER_MAX_CLASS + 1);
    this._populate(theme);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** O(1) — returns the resolved TokenStyle for a given class. */
  getStyle(cls: TokenClass): TokenStyle {
    const s = this._styles[cls];
    return s !== undefined ? s : this._fallbackStyle;
  }

  /**
   * O(1) — returns the pre-baked inline CSS string for a given class.
   * Use this in the hot render path.
   */
  toCSSText(cls: TokenClass): string {
    const c = this._cssTexts[cls];
    return c !== undefined ? c : this._fallbackCSS;
  }

  /**
   * Rebuild all entries from a new theme.
   * Called exclusively by Renderer.setTheme() (LOCK-17).
   */
  rebuildFrom(theme: Theme): void {
    this._fallbackStyle = theme.fallbackStyle;
    this._fallbackCSS   = buildCSSText(theme.fallbackStyle);
    this._populate(theme);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _populate(theme: Theme): void {
    for (let cls = 0; cls <= LEXER_MAX_CLASS; cls++) {
      const style = (theme.tokenStyles as Record<number, TokenStyle | undefined>)[cls]
        ?? theme.fallbackStyle;
      this._styles[cls]   = style;
      this._cssTexts[cls] = buildCSSText(style);
    }
  }
}
