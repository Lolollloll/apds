/**
 * APDS Demo — CSS Text Parser
 *
 * TokenStyleMap pre-bakes inline CSS strings like:
 *   "color:#569cd6"
 *   "color:#6a9955;font-style:italic"
 *   "color:#dcdcaa;font-weight:bold"
 *
 * This module parses those strings into canvas-draw properties.
 * Results are cached so parsing only happens once per unique cssText value.
 */

export interface ParsedStyle {
  color:       string;
  italic:      boolean;
  bold:        boolean;
}

const _cache = new Map<string, ParsedStyle>();

export function parseCSSText(cssText: string): ParsedStyle {
  const cached = _cache.get(cssText);
  if (cached) return cached;

  let color  = '#d4d4d4';
  let italic = false;
  let bold   = false;

  for (const part of cssText.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim();
    const val  = part.slice(colon + 1).trim();
    if (prop === 'color')       color  = val;
    if (prop === 'font-style')  italic = (val === 'italic');
    if (prop === 'font-weight') bold   = (val === 'bold');
  }

  const result: ParsedStyle = { color, italic, bold };
  _cache.set(cssText, result);
  return result;
}
