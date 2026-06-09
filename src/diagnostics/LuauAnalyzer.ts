/**
 * APDS Diagnostics — Luau Analyzer
 *
 * Lightweight, O(n) diagnostic rules for Luau/Lua code.
 * No full parser. No LSP. No AI. No tokenizer calls (LOCK-13).
 *
 * Rules implemented:
 *   ERROR   — Unmatched brackets: (, [, {  (and their closing counterparts)
 *   WARNING — Unused local variables  (local x = ... where x never appears again)
 *   INFO    — TODO / FIXME / NOTE comment markers
 *
 * Design notes:
 *   - All rules operate on string[] (line array) only.
 *   - Comment-stripping is approximate but sufficient for a lint-quality check.
 *   - Long strings  [[ ... ]] and interpolated strings `{...}` are NOT tracked
 *     in depth; bracket scanning simply stops at `--` comments.
 *   - Scales to large files: each rule is a single linear pass.
 */

import { Diagnostic, DiagnosticSeverity } from './DiagnosticTypes.js';

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

const OPEN_BRACKETS  = new Set(['(', '[', '{']);
const CLOSE_BRACKETS = new Set([')', ']', '}']);
const BRACKET_PAIR: Readonly<Record<string, string>> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

/**
 * Scan one line and return bracket positions.
 * Skips content inside "..." and '...' strings, and skips after -- comments.
 * Does NOT handle long-string brackets [[ ]] (treated as non-matching context).
 */
export function scanLineBrackets(
  line: string,
): Array<{ char: string; col: number }> {
  const result: Array<{ char: string; col: number }> = [];
  let inString: '"' | "'" | null = null;
  let i = 0;

  while (i < line.length) {
    // charAt() always returns a string ('' when out of bounds, never undefined)
    const ch = line.charAt(i);

    if (inString) {
      if (ch === '\\') { i += 2; continue; }   // skip escape sequence
      if (ch === inString) { inString = null; }
      i++;
      continue;
    }

    // Single-line comment — stop processing this line
    if (ch === '-' && line.charAt(i + 1) === '-') break;

    if (ch === '"' || ch === "'") { inString = ch; i++; continue; }

    if (OPEN_BRACKETS.has(ch) || CLOSE_BRACKETS.has(ch)) {
      result.push({ char: ch, col: i });
    }
    i++;
  }

  return result;
}

// ── Rule: Unmatched Brackets (ERROR) ─────────────────────────────────────────

export function analyzeBrackets(lines: string[]): Diagnostic[] {
  const stack: Array<{ char: string; line: number; col: number }> = [];
  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    for (const { char, col } of scanLineBrackets(lines[lineIdx] ?? '')) {
      if (OPEN_BRACKETS.has(char)) {
        stack.push({ char, line: lineIdx, col });
      } else {
        // Closing bracket — check for matching open
        const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
        if (top && top.char === BRACKET_PAIR[char]) {
          stack.pop();
        } else {
          // Spurious close with no matching open
          diagnostics.push({
            line:     lineIdx,
            column:   col,
            length:   1,
            severity: DiagnosticSeverity.Error,
            message:  `Unmatched '${char}'`,
          });
        }
      }
    }
  }

  // Anything still on the stack is an unclosed open bracket
  for (const open of stack) {
    diagnostics.push({
      line:     open.line,
      column:   open.col,
      length:   1,
      severity: DiagnosticSeverity.Error,
      message:  `Unmatched '${open.char}'`,
    });
  }

  return diagnostics;
}

// ── Rule: Unused Local Variables (WARNING) ───────────────────────────────────

const WORD_RE      = /\b[a-zA-Z_]\w*\b/g;
const LOCAL_DECL_RE = /^\s*local\s+(?:function\s+)?([a-zA-Z_]\w*)/;

/**
 * Build a frequency map for all identifiers across all lines.
 * Comment content (-- ...) is excluded to reduce false-positive suppression.
 */
export function buildWordFrequency(lines: string[]): Map<string, number> {
  const freq = new Map<string, number>();

  for (const line of lines) {
    const src = line ?? '';
    const commentIdx = src.indexOf('--');
    const text = commentIdx >= 0 ? src.slice(0, commentIdx) : src;
    WORD_RE.lastIndex = 0;
    for (const m of text.matchAll(WORD_RE)) {
      const w = m[0] ?? '';
      if (w) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }

  return freq;
}

export function analyzeUnusedLocals(lines: string[]): Diagnostic[] {
  const freq = buildWordFrequency(lines);
  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';
    const m = LOCAL_DECL_RE.exec(line);
    if (!m) continue;

    const name = m[1] ?? '';
    if (!name || name === '_') continue; // conventional "intentionally unused"
    if (name === 'function') continue;   // grammar edge-guard

    // count <= 1 means the name appears only in the declaration itself
    if ((freq.get(name) ?? 0) <= 1) {
      const localIdx = line.indexOf('local');
      const col = localIdx >= 0 ? line.indexOf(name, localIdx) : 0;
      diagnostics.push({
        line:     lineIdx,
        column:   col < 0 ? 0 : col,
        length:   name.length,
        severity: DiagnosticSeverity.Warning,
        message:  `Unused local '${name}'`,
      });
    }
  }

  return diagnostics;
}

// ── Rule: Comment Markers — TODO / FIXME / NOTE (INFO) ───────────────────────

const MARKER_RE = /--[ \t]*(TODO|FIXME|NOTE)\b/gi;

export function analyzeCommentMarkers(lines: string[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';
    MARKER_RE.lastIndex = 0;
    for (const m of line.matchAll(MARKER_RE)) {
      const keyword = (m[1] ?? '').toUpperCase();
      const full    = m[0] ?? '';
      diagnostics.push({
        line:     lineIdx,
        column:   m.index ?? 0,
        length:   full.length,
        severity: DiagnosticSeverity.Info,
        message:  `${keyword} comment`,
      });
    }
  }

  return diagnostics;
}

// ── Combined entry point ──────────────────────────────────────────────────────

/**
 * Run all diagnostic rules and return the combined result.
 * Order: errors first, then warnings, then info.
 */
export function analyze(lines: string[]): Diagnostic[] {
  return [
    ...analyzeBrackets(lines),
    ...analyzeUnusedLocals(lines),
    ...analyzeCommentMarkers(lines),
  ];
}
