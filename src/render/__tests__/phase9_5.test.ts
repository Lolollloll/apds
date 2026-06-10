/**
 * APDS Phase 9.5 — Test Suite
 *
 * Coverage:
 *   P9.5-A  Connected indent guides through blank lines
 *             - buildResolvedIndentMap: basic blank-line inheritance
 *             - Multiple consecutive blank lines
 *             - Blank lines at start / end of file
 *             - Deep indentation
 *             - Large file performance
 *
 *   P9.5-B1  Diagnostic data model
 *             - DiagnosticSeverity enum values
 *             - severityColor mapping
 *
 *   P9.5-B2  Squiggle rendering helper (diagnosticToRange)
 *             - squiggle flag set, color inherited from severity
 *
 *   P9.5-B3  Diagnostic rules
 *             - analyzeBrackets: unmatched (, [, {, ), ], }
 *             - analyzeUnusedLocals: local with no further use
 *             - analyzeCommentMarkers: TODO / FIXME / NOTE
 *             - Combined analyze() entry point
 *
 *   P9.5-B4  DiagnosticEngine counts (errorCount, warningCount, infoCount)
 */

import { describe, it, expect } from 'vitest';

import {
  DiagnosticSeverity,
  severityColor,
} from '../../diagnostics/DiagnosticTypes.js';

import {
  scanLineBrackets,
  analyzeBrackets,
  analyzeUnusedLocals,
  buildWordFrequency,
  analyzeCommentMarkers,
  analyze,
} from '../../diagnostics/LuauAnalyzer.js';

import {
  buildResolvedIndentMap,
  leadingIndentLevels,
} from '../../../demo/src/CanvasRenderer.js';

import { diagnosticToRange } from '../../../demo/src/DiagnosticEngine.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mkLines(texts: string[]): Array<{ lineIndex: number; text: string }> {
  return texts.map((text, i) => ({ lineIndex: i, text }));
}

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-A: Connected Indent Guides
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-A: leadingIndentLevels', () => {
  it('returns 0 for empty string', () => {
    expect(leadingIndentLevels('', 4)).toBe(0);
  });

  it('returns 0 for no leading whitespace', () => {
    expect(leadingIndentLevels('print("hi")', 4)).toBe(0);
  });

  it('counts 1 level for 4 spaces with tabSize=4', () => {
    expect(leadingIndentLevels('    x', 4)).toBe(1);
  });

  it('counts 2 levels for 8 spaces with tabSize=4', () => {
    expect(leadingIndentLevels('        x', 4)).toBe(2);
  });

  it('handles tab characters with tabSize=4', () => {
    expect(leadingIndentLevels('\tx', 4)).toBe(1);
    expect(leadingIndentLevels('\t\tx', 4)).toBe(2);
  });

  it('partial indent (3 spaces, tabSize=4) → 0 levels', () => {
    expect(leadingIndentLevels('   x', 4)).toBe(0);
  });

  it('handles tabSize=2', () => {
    expect(leadingIndentLevels('  x', 2)).toBe(1);
    expect(leadingIndentLevels('    x', 2)).toBe(2);
  });
});

describe('P9.5-A: buildResolvedIndentMap — basic blank-line inheritance', () => {
  const tabSize = 4;

  it('non-blank lines get their own level', () => {
    const lines = mkLines([
      'function test()',
      '    print("A")',
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 2);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(1);
  });

  it('single blank line between two indented lines inherits min(above, below)', () => {
    // line 0: level 0 (function test())
    // line 1: level 1 (    if true then)
    // line 2: blank
    // line 3: level 1 (    print("B"))
    // line 4: level 0 (end)
    const lines = mkLines([
      'function test()',
      '    if true then',
      '',
      '    print("B")',
      'end',
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 5);
    expect(map.get(2)).toBe(1);  // inherits min(1, 1) = 1
  });

  it('blank line between level 2 above and level 1 below inherits 1', () => {
    const lines = mkLines([
      '        deep()',   // level 2
      '',
      '    mid()',        // level 1
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 3);
    expect(map.get(1)).toBe(1);  // min(2, 1) = 1
  });

  it('multiple consecutive blank lines all get same inherited level', () => {
    const lines = mkLines([
      '    a()',   // level 1
      '',
      '',
      '',
      '    b()',   // level 1
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 5);
    expect(map.get(1)).toBe(1);
    expect(map.get(2)).toBe(1);
    expect(map.get(3)).toBe(1);
  });

  it('blank line at the start of file (no above) inherits from below', () => {
    const lines = mkLines([
      '',
      '    x()',   // level 1
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 2);
    expect(map.get(0)).toBe(1);
  });

  it('blank line at the end of file (no below) inherits from above', () => {
    const lines = mkLines([
      '    x()',   // level 1
      '',
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 2);
    expect(map.get(1)).toBe(1);
  });

  it('all blank lines → all get level 0', () => {
    const lines = mkLines(['', '', '']);
    const map = buildResolvedIndentMap(lines, tabSize, 3);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(0);
    expect(map.get(2)).toBe(0);
  });

  it('deep indentation (level 5) passes through blank line', () => {
    const lines = mkLines([
      '                    deep()',  // 20 spaces = level 5 @tabSize=4
      '',
      '                    also()',  // level 5
    ]);
    const map = buildResolvedIndentMap(lines, tabSize, 3);
    expect(map.get(1)).toBe(5);
  });

  it('uses getLine callback for off-screen context', () => {
    // Visible: only line 5 (blank). Off-screen lines 4 and 6 provided via getLine.
    const visible = [{ lineIndex: 5, text: '' }];
    const offScreen: Record<number, string> = {
      4: '    indented()',   // level 1
      6: '    also()',       // level 1
    };
    const map = buildResolvedIndentMap(visible, tabSize, 10, (i) => offScreen[i] ?? '');
    expect(map.get(5)).toBe(1);
  });
});

describe('P9.5-A: buildResolvedIndentMap — large file performance', () => {
  it('handles 10 000-line file with many blank runs in < 100ms', () => {
    const texts: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      if (i % 10 === 0) texts.push('    code()');  // level 1 every 10 lines
      else               texts.push('');
    }
    const lines = mkLines(texts);
    const start = Date.now();
    buildResolvedIndentMap(lines, 4, 10_000);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B1: DiagnosticTypes
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B1: DiagnosticSeverity', () => {
  it('Error value is "error"', () => {
    expect(DiagnosticSeverity.Error).toBe('error');
  });
  it('Warning value is "warning"', () => {
    expect(DiagnosticSeverity.Warning).toBe('warning');
  });
  it('Info value is "info"', () => {
    expect(DiagnosticSeverity.Info).toBe('info');
  });
});

describe('P9.5-B1: severityColor', () => {
  it('Error → red', () => {
    expect(severityColor(DiagnosticSeverity.Error)).toBe('#ff4444');
  });
  it('Warning → yellow', () => {
    expect(severityColor(DiagnosticSeverity.Warning)).toBe('#ffcc00');
  });
  it('Info → blue', () => {
    expect(severityColor(DiagnosticSeverity.Info)).toBe('#4499ff');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B2: Squiggle rendering helper
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B2: diagnosticToRange', () => {
  it('sets squiggle=true', () => {
    const range = diagnosticToRange({
      line: 0, column: 0, length: 1,
      severity: DiagnosticSeverity.Error,
      message: 'test',
    });
    expect(range.squiggle).toBe(true);
  });

  it('color matches severity', () => {
    const err  = diagnosticToRange({ line:0, column:0, length:1, severity: DiagnosticSeverity.Error,   message:'' });
    const warn = diagnosticToRange({ line:0, column:0, length:1, severity: DiagnosticSeverity.Warning, message:'' });
    const info = diagnosticToRange({ line:0, column:0, length:1, severity: DiagnosticSeverity.Info,    message:'' });
    expect(err.color).toBe('#ff4444');
    expect(warn.color).toBe('#ffcc00');
    expect(info.color).toBe('#4499ff');
  });

  it('startColumn and endColumn are set from diagnostic', () => {
    const range = diagnosticToRange({
      line: 2, column: 5, length: 3,
      severity: DiagnosticSeverity.Warning,
      message: '',
    });
    expect(range.startColumn).toBe(5);
    expect(range.endColumn).toBe(8);
  });

  it('minimum length of 1 even for zero-length diagnostics', () => {
    const range = diagnosticToRange({
      line: 0, column: 0, length: 0,
      severity: DiagnosticSeverity.Info,
      message: '',
    });
    expect(range.endColumn - range.startColumn).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B3: scanLineBrackets
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B3: scanLineBrackets', () => {
  it('finds open and close brackets', () => {
    const result = scanLineBrackets('func(a, b)');
    expect(result).toContainEqual({ char: '(', col: 4 });
    expect(result).toContainEqual({ char: ')', col: 9 });
  });

  it('skips brackets inside double-quoted strings', () => {
    const result = scanLineBrackets('local x = "func()"');
    expect(result).toHaveLength(0);
  });

  it('skips brackets inside single-quoted strings', () => {
    const result = scanLineBrackets("local x = 'func()'");
    expect(result).toHaveLength(0);
  });

  it('stops scanning at -- comment', () => {
    const result = scanLineBrackets('x() -- this (has) brackets');
    expect(result.map(r => r.char)).toEqual(['(', ')']);
  });

  it('handles escape sequences in strings', () => {
    const result = scanLineBrackets('"\\""()');
    expect(result).toHaveLength(2);
    expect(result[0].char).toBe('(');
  });

  it('empty line returns empty array', () => {
    expect(scanLineBrackets('')).toHaveLength(0);
  });

  it('handles all bracket types', () => {
    const result = scanLineBrackets('({[]})');
    expect(result.map(r => r.char)).toEqual(['(', '{', '[', ']', '}', ')']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B3: analyzeBrackets
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B3: analyzeBrackets — unmatched bracket detection', () => {
  it('returns empty for balanced code', () => {
    expect(analyzeBrackets(['local x = func(a, b)'])).toHaveLength(0);
  });

  it('detects unclosed open paren', () => {
    const diags = analyzeBrackets(['function test(']);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toMatch(/Unmatched '[(]/);
  });

  it('detects unclosed open brace', () => {
    const diags = analyzeBrackets(['if true then {']);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/Unmatched '[{]/);
  });

  it('detects spurious close bracket', () => {
    const diags = analyzeBrackets(['local x = )']);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/Unmatched '[)]/);
  });

  it('detects mismatched brackets ({])', () => {
    const diags = analyzeBrackets(['({])']);
    // ']' does not match '{', spurious ']'
    expect(diags.length).toBeGreaterThan(0);
  });

  it('handles multi-line balanced code', () => {
    const lines = [
      'function test()',
      '  if true then',
      '    print("A")',
      '  end',
      'end',
    ];
    expect(analyzeBrackets(lines)).toHaveLength(0);
  });

  it('handles multi-line unmatched bracket across lines', () => {
    const lines = [
      'local t = {',
      '  a = 1,',
      '  b = 2,',
      // missing closing }
    ];
    const diags = analyzeBrackets(lines);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('does not flag brackets in comments', () => {
    const diags = analyzeBrackets(['-- function test(']);
    expect(diags).toHaveLength(0);
  });

  it('does not flag brackets in strings', () => {
    const diags = analyzeBrackets(['local s = "func("']);
    expect(diags).toHaveLength(0);
  });

  it('line number is correct for multi-line errors', () => {
    const lines = ['a()', 'b(', 'c()'];
    const diags = analyzeBrackets(lines);
    expect(diags[0].line).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B3: analyzeUnusedLocals
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B3: buildWordFrequency', () => {
  it('counts words across lines', () => {
    const freq = buildWordFrequency(['local x = 1', 'print(x)']);
    expect(freq.get('x')).toBe(2);
    expect(freq.get('local')).toBe(1);
  });

  it('excludes comment content', () => {
    const freq = buildWordFrequency(['-- local unused = 5']);
    expect(freq.get('unused')).toBeUndefined();
  });
});

describe('P9.5-B3: analyzeUnusedLocals', () => {
  it('returns empty for used locals', () => {
    const lines = ['local x = 5', 'print(x)'];
    expect(analyzeUnusedLocals(lines)).toHaveLength(0);
  });

  it('detects unused local variable', () => {
    const lines = ['local unused = 5'];
    const diags = analyzeUnusedLocals(lines);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].message).toContain('unused');
  });

  it('does not flag _ variable', () => {
    const lines = ['local _ = something()'];
    expect(analyzeUnusedLocals(lines)).toHaveLength(0);
  });

  it('detects unused local function', () => {
    const lines = ['local function helper()', 'end'];
    const diags = analyzeUnusedLocals(lines);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('helper');
  });

  it('does not flag used local function', () => {
    const lines = ['local function helper()', 'end', 'helper()'];
    expect(analyzeUnusedLocals(lines)).toHaveLength(0);
  });

  it('correct line and column', () => {
    const lines = ['local foo = 99'];
    const diags = analyzeUnusedLocals(lines);
    expect(diags[0].line).toBe(0);
    expect(diags[0].column).toBe(6);   // 'foo' starts after 'local '
    expect(diags[0].length).toBe(3);   // length of 'foo'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B3: analyzeCommentMarkers
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B3: analyzeCommentMarkers', () => {
  it('detects TODO comment', () => {
    const diags = analyzeCommentMarkers(['-- TODO: fix this']);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Info);
    expect(diags[0].message).toBe('TODO comment');
  });

  it('detects FIXME comment', () => {
    const diags = analyzeCommentMarkers(['-- FIXME broken']);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('FIXME comment');
  });

  it('detects NOTE comment', () => {
    const diags = analyzeCommentMarkers(['-- NOTE: important']);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('NOTE comment');
  });

  it('is case-insensitive', () => {
    const diags = analyzeCommentMarkers(['-- todo fix', '-- Fixme please', '-- Note here']);
    expect(diags).toHaveLength(3);
  });

  it('detects marker at end of code line (inline comment)', () => {
    const diags = analyzeCommentMarkers(['local x = 5 -- TODO refactor']);
    expect(diags).toHaveLength(1);
  });

  it('does not flag non-comment occurrences', () => {
    // "TODO" inside a string isn't a comment
    const diags = analyzeCommentMarkers(['local s = "TODO: do something"']);
    expect(diags).toHaveLength(0);
  });

  it('column points to start of -- marker', () => {
    const line  = '  local x = 1 -- TODO later';
    const diags = analyzeCommentMarkers([line]);
    expect(diags[0].column).toBe(line.indexOf('--'));
  });

  it('multiple markers on the same line each get their own diagnostic', () => {
    // One marker per match
    const diags = analyzeCommentMarkers(['-- TODO something -- FIXME too']);
    expect(diags).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B3: Combined analyze()
// ─────────────────────────────────────────────────────────────────────────────

describe('P9.5-B3: combined analyze()', () => {
  it('combines errors, warnings, and info', () => {
    const lines = [
      'local unused = 1',      // warning
      'func(',                  // error (unmatched)
      '-- TODO: fix',           // info
    ];
    const diags = analyze(lines);
    const severities = diags.map(d => d.severity);
    expect(severities).toContain(DiagnosticSeverity.Error);
    expect(severities).toContain(DiagnosticSeverity.Warning);
    expect(severities).toContain(DiagnosticSeverity.Info);
  });

  it('returns empty for clean code', () => {
    const lines = [
      'local x = 5',
      'print(x)',
    ];
    expect(analyze(lines)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P9.5-B4: DiagnosticEngine counts
// ─────────────────────────────────────────────────────────────────────────────

import { DiagnosticEngine } from '../../../demo/src/DiagnosticEngine.js';
import { DecorationSet } from '../../../demo/src/DecorationLayer.js';

describe('P9.5-B4: DiagnosticEngine', () => {
  it('starts with zero counts', () => {
    const engine = new DiagnosticEngine();
    expect(engine.errorCount).toBe(0);
    expect(engine.warningCount).toBe(0);
    expect(engine.infoCount).toBe(0);
  });

  it('counts errors after analyze()', () => {
    const engine = new DiagnosticEngine();
    engine.analyze(['func(']);  // unmatched
    expect(engine.errorCount).toBeGreaterThan(0);
  });

  it('counts warnings after analyze()', () => {
    const engine = new DiagnosticEngine();
    engine.analyze(['local orphan = 99']);
    expect(engine.warningCount).toBeGreaterThan(0);
  });

  it('counts info after analyze()', () => {
    const engine = new DiagnosticEngine();
    engine.analyze(['-- TODO: do something']);
    expect(engine.infoCount).toBeGreaterThan(0);
  });

  it('resets counts on re-analyze', () => {
    const engine = new DiagnosticEngine();
    engine.analyze(['func(']);
    expect(engine.errorCount).toBeGreaterThan(0);
    engine.analyze(['local x = 1', 'print(x)']);  // clean code
    expect(engine.errorCount).toBe(0);
    expect(engine.warningCount).toBe(0);
  });

  it('applyToSet writes squiggle decorations into the set', () => {
    const engine = new DiagnosticEngine();
    engine.analyze(['func(']);  // error on line 0
    const set = new DecorationSet('test');
    engine.applyToSet(set);
    expect(set.isEmpty).toBe(false);
    const ranges = set.getRanges(0);
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[0].squiggle).toBe(true);
  });

  it('applyToSet clears previous decorations on re-apply', () => {
    const engine = new DiagnosticEngine();
    const set = new DecorationSet('test');
    engine.analyze(['func(']);
    engine.applyToSet(set);
    const countBefore = set.getRanges(0).length;

    engine.analyze(['local x = 1', 'print(x)']);  // clean
    engine.applyToSet(set);
    expect(set.isEmpty).toBe(true);
    expect(set.getRanges(0).length).toBe(0);
    // sanity: we did have something before
    expect(countBefore).toBeGreaterThan(0);
  });

  it('diagnostics are accessible via .diagnostics getter', () => {
    const engine = new DiagnosticEngine();
    engine.analyze(['-- FIXME']);
    expect(engine.diagnostics.length).toBeGreaterThan(0);
  });
});
