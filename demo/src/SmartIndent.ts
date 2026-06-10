/**
 * APDS Demo — Smart Indentation
 *
 * All functions are pure — no side effects, no Document reads.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Block-opening patterns (line ends with these after stripping trailing comment)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip a trailing single-line comment from a line.
 * We use a simple heuristic: find `--` outside of string literals.
 * For the purposes of indent detection, this is good enough.
 */
function stripTrailingComment(line: string): string {
  let inStr  = false;
  let strCh  = '';
  let i      = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === strCh) inStr = false;
    } else {
      if (ch === '"' || ch === "'") { inStr = true; strCh = ch; }
      else if (ch === '-' && line[i+1] === '-') return line.slice(0, i).trimEnd();
    }
    i++;
  }
  return line;
}

// Patterns that trigger indent on the next line.
// Each is tested against the stripped, trimmed text-before-cursor.
const INDENT_PATTERNS: RegExp[] = [
  /\bthen\s*$/,                          // if/elseif ... then
  /\bdo\s*$/,                            // for/while/do
  /\brepeat\s*$/,                        // repeat
  /\belse\s*$/,                          // else
  /\bfunction\b.*\)\s*$/,               // function foo() or function()
  /\bfunction\s*\(\s*\)\s*$/,           // function()
  /\bfunction\b[^(]*\([^)]*\)\s*:?\s*$/, // function with args
  /\bfunction\b\s*$/,                    // bare "function" keyword (rare)
  /\{\s*$/,                              // opening brace
];

/**
 * Returns true if `textBefore` (text from line start to cursor) ends with
 * a block-opening pattern.
 */
function isBlockOpener(textBefore: string): boolean {
  const stripped = stripTrailingComment(textBefore).trimEnd();
  return INDENT_PATTERNS.some(p => p.test(stripped));
}

// ─────────────────────────────────────────────────────────────────────────────
// De-indent patterns (line's first non-whitespace is one of these)
// ─────────────────────────────────────────────────────────────────────────────

const DEDENT_PATTERN = /^\s*(end|else|elseif\b|until\b|\})/;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

/** Extract leading whitespace from a line. */
export function getLeadingWhitespace(line: string): string {
  const m = /^(\s*)/.exec(line);
  return m ? m[1]! : '';
}

/** Count leading spaces, treating tabs as `tabSize` spaces. */
export function leadingSpaceCount(line: string, tabSize: number): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === ' ')  { count++; continue; }
    if (ch === '\t') { count += tabSize - (count % tabSize); continue; }
    break;
  }
  return count;
}

/** Build an indent string of `count` spaces. */
export function buildIndent(count: number): string {
  return ' '.repeat(Math.max(0, count));
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Indent — pure function
// ─────────────────────────────────────────────────────────────────────────────

export interface SmartIndentResult {
  /** Text to insert at cursor position (replaces any selection). */
  readonly insertText: string;
}

/**
 * Compute the text to insert when the user presses Enter.
 *
 * @param currentLine  Full text of the line the cursor is on.
 * @param cursorCol    Column of the cursor within currentLine.
 * @param tabSize      Spaces per indentation level.
 */
export function computeSmartIndent(
  currentLine: string,
  cursorCol:   number,
  tabSize:     number,
): SmartIndentResult {
  const textBefore = currentLine.slice(0, cursorCol);
  const baseIndent = leadingSpaceCount(currentLine, tabSize);

  const shouldIndent = isBlockOpener(textBefore);

  const newIndent = shouldIndent
    ? buildIndent(baseIndent + tabSize)
    : buildIndent(baseIndent);

  return { insertText: '\n' + newIndent };
}

/**
 * Compute the indent correction for the current line when the user types
 * a closing keyword/symbol.
 *
 * Returns the number of spaces to REMOVE from the front of the line,
 * or 0 if no correction is needed. Pure function.
 *
 * @param lineText     Current full text of the line (including the new char).
 * @param tabSize      Spaces per indentation level.
 * @param prevLineText Text of the previous line (used for context).
 */
export function computeClosingDedent(
  lineText:     string,
  tabSize:      number,
  prevLineText: string,
): number {
  if (!DEDENT_PATTERN.test(lineText)) return 0;
  const currentIndent = leadingSpaceCount(lineText, tabSize);
  if (currentIndent < tabSize) return 0;
  return tabSize; // de-indent by one level
}
