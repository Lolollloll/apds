/**
 * APDS Renderer — Theme
 *
 * A Theme is a plain data object — no methods, no class instances.
 * Switching themes = swapping the Theme reference on the Renderer.
 * No retokenisation is ever required (TokenClass integers are stable;
 * only the CSS rendering changes).
 *
 * LOCK-17: Themes are data-only. Switching themes calls
 * Renderer.setTheme(), which rebuilds TokenStyleMap and clears
 * RenderCache. No other code path clears the cache on theme change.
 */

import { TokenClass } from '../tokenizer/tokenTypes';

// ---------------------------------------------------------------------------
// TokenStyle
// ---------------------------------------------------------------------------

/**
 * Visual style for one token class.
 * All fields are optional except `color`.
 */
export interface TokenStyle {
  readonly color:       string;
  readonly fontStyle?:  'normal' | 'italic';
  readonly fontWeight?: 'normal' | 'bold';
}

// ---------------------------------------------------------------------------
// ThemeColorKey  — named slots for non-token UI colors
// ---------------------------------------------------------------------------

export enum ThemeColorKey {
  Background       = 'background',
  Foreground       = 'foreground',
  SelectionBg      = 'selectionBg',
  CursorColor      = 'cursorColor',
  GutterBg         = 'gutterBg',
  GutterFg         = 'gutterFg',
  /** Background tint drawn behind the cursor's line — behind selection and text. */
  CurrentLineBg    = 'currentLineBg',
  /** Indentation guide line color. */
  IndentGuideColor = 'indentGuideColor',
  /** Active (cursor-bearing) indentation guide line color. */
  IndentGuideActiveColor = 'indentGuideActiveColor',
  /** Decoration color for bracket match highlights. */
  BracketMatchBg   = 'bracketMatchBg',
  /** Decoration color for Find results. */
  FindMatchBg      = 'findMatchBg',
  /** Decoration color for the current (focused) Find result. */
  FindMatchActiveBg = 'findMatchActiveBg',
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface Theme {
  readonly name:         string;
  /** UI color palette (background, selection, cursor, …). */
  readonly colors:       Readonly<Record<ThemeColorKey, string>>;
  /**
   * Per-TokenClass overrides. Missing entries fall through to
   * `fallbackStyle`. Partial so themes only need to specify what they
   * want to customise.
   */
  readonly tokenStyles:  Partial<Readonly<Record<TokenClass, TokenStyle>>>;
  /** Catch-all style for any TokenClass not in `tokenStyles`. */
  readonly fallbackStyle: TokenStyle;
}

// ---------------------------------------------------------------------------
// Built-in: Dark theme  (VS Code Dark+-inspired palette)
// ---------------------------------------------------------------------------

export const DARK_THEME: Theme = Object.freeze({
  name: 'APDS Dark',

  colors: Object.freeze({
    [ThemeColorKey.Background]:            '#1e1e1e',
    [ThemeColorKey.Foreground]:            '#d4d4d4',
    [ThemeColorKey.SelectionBg]:           '#264f78',
    [ThemeColorKey.CursorColor]:           '#aeafad',
    [ThemeColorKey.GutterBg]:              '#1e1e1e',
    [ThemeColorKey.GutterFg]:              '#858585',
    [ThemeColorKey.CurrentLineBg]:         '#2a2d2e',
    [ThemeColorKey.IndentGuideColor]:      '#404040',
    [ThemeColorKey.IndentGuideActiveColor]:'#606060',
    [ThemeColorKey.BracketMatchBg]:        '#3b5a6e',
    [ThemeColorKey.FindMatchBg]:           '#613315',
    [ThemeColorKey.FindMatchActiveBg]:     '#9e6a03',
  }),

  // Visual improvements: Monaco Dark+ exact palette — professional, not over-brightened.
  // Reverting from the Phase 9 "improvement" which was too bright/washed-out.
  //
  // BEFORE → AFTER (Monaco Dark+ faithful)
  //   Default/Foreground:  #e0e0e0 → #d4d4d4  (Monaco's exact value)
  //   Keyword:             #4fc1ff → #569cd6  (Monaco's medium blue — not neon)
  //   KeywordType:         #56d9bc → #4ec9b0  (Monaco's teal)
  //   RobloxGlobal:        #e8d98c → #dcdcaa  (Monaco's yellow)
  //   RobloxType:          #56d9bc → #4ec9b0  (Monaco's teal)
  //   FunctionName:        #e8d98c → #dcdcaa  (Monaco's yellow)
  //   Number:              #b8d4a8 → #b5cea8  (Monaco's sage green)
  //   String:              #e0987a → #ce9178  (Monaco's muted orange-brown)
  //   LongString:          #e0987a → #ce9178
  //   StringEscape:        #f0cc80 → #d7ba7d  (Monaco's warm gold)
  //   InterpString:        #e0987a → #ce9178
  //   InterpDelimiter:     #4fc1ff → #569cd6
  //   Comment:             #73ad5a → #6a9955  (Monaco's muted green)
  //   LongComment:         #73ad5a → #6a9955
  //   Operator/Delimiter:  #e0e0e0 → #d4d4d4
  //   Invalid:             #f55050 → #f44747
  tokenStyles: Object.freeze({
    [TokenClass.Default]:         { color: '#d4d4d4' },
    [TokenClass.Whitespace]:      { color: 'transparent' },
    [TokenClass.Keyword]:         { color: '#569cd6' },
    [TokenClass.KeywordType]:     { color: '#4ec9b0' },
    [TokenClass.Identifier]:      { color: '#9cdcfe' },
    [TokenClass.RobloxGlobal]:    { color: '#dcdcaa' },
    [TokenClass.RobloxType]:      { color: '#4ec9b0' },
    [TokenClass.FunctionName]:    { color: '#dcdcaa' },
    [TokenClass.Number]:          { color: '#b5cea8' },
    [TokenClass.String]:          { color: '#ce9178' },
    [TokenClass.LongString]:      { color: '#ce9178' },
    [TokenClass.StringEscape]:    { color: '#d7ba7d' },
    [TokenClass.InterpString]:    { color: '#ce9178' },
    [TokenClass.InterpDelimiter]: { color: '#569cd6' },
    [TokenClass.Comment]:         { color: '#6a9955', fontStyle: 'italic' },
    [TokenClass.LongComment]:     { color: '#6a9955', fontStyle: 'italic' },
    [TokenClass.Operator]:        { color: '#d4d4d4' },
    [TokenClass.Delimiter]:       { color: '#d4d4d4' },
    [TokenClass.Bracket]:         { color: '#ffd700' },
    [TokenClass.Attribute]:       { color: '#9cdcfe' },
    [TokenClass.Invalid]:         { color: '#f44747' },
  } as Partial<Record<TokenClass, TokenStyle>>),

  fallbackStyle: { color: '#d4d4d4' },
});

// ---------------------------------------------------------------------------
// Built-in: Light theme
// ---------------------------------------------------------------------------

export const LIGHT_THEME: Theme = Object.freeze({
  name: 'APDS Light',

  colors: Object.freeze({
    [ThemeColorKey.Background]:            '#ffffff',
    [ThemeColorKey.Foreground]:            '#000000',
    [ThemeColorKey.SelectionBg]:           '#add6ff',
    [ThemeColorKey.CursorColor]:           '#000000',
    [ThemeColorKey.GutterBg]:              '#f3f3f3',
    [ThemeColorKey.GutterFg]:              '#6e7681',
    [ThemeColorKey.CurrentLineBg]:         '#f0f0f0',
    [ThemeColorKey.IndentGuideColor]:      '#d0d0d0',
    [ThemeColorKey.IndentGuideActiveColor]:'#a0a0a0',
    [ThemeColorKey.BracketMatchBg]:        '#c8e1f0',
    [ThemeColorKey.FindMatchBg]:           '#f5c842',
    [ThemeColorKey.FindMatchActiveBg]:     '#f09a1a',
  }),

  tokenStyles: Object.freeze({
    [TokenClass.Default]:         { color: '#000000' },
    [TokenClass.Whitespace]:      { color: 'transparent' },
    [TokenClass.Keyword]:         { color: '#0000ff' },
    [TokenClass.KeywordType]:     { color: '#267f99' },
    [TokenClass.Identifier]:      { color: '#001080' },
    [TokenClass.RobloxGlobal]:    { color: '#795e26' },
    [TokenClass.RobloxType]:      { color: '#267f99' },
    [TokenClass.FunctionName]:    { color: '#795e26' },
    [TokenClass.Number]:          { color: '#098658' },
    [TokenClass.String]:          { color: '#a31515' },
    [TokenClass.LongString]:      { color: '#a31515' },
    [TokenClass.StringEscape]:    { color: '#ee0000' },
    [TokenClass.InterpString]:    { color: '#a31515' },
    [TokenClass.InterpDelimiter]: { color: '#0000ff' },
    [TokenClass.Comment]:         { color: '#008000', fontStyle: 'italic' },
    [TokenClass.LongComment]:     { color: '#008000', fontStyle: 'italic' },
    [TokenClass.Operator]:        { color: '#000000' },
    [TokenClass.Delimiter]:       { color: '#000000' },
    [TokenClass.Bracket]:         { color: '#0431fa' },
    [TokenClass.Attribute]:       { color: '#001080' },
    [TokenClass.Invalid]:         { color: '#cd3131' },
  } as Partial<Record<TokenClass, TokenStyle>>),

  fallbackStyle: { color: '#000000' },
});
