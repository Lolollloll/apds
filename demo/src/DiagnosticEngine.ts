/**
 * APDS Demo — Diagnostic Engine
 *
 * Bridges the LuauAnalyzer (src layer) with the DecorationLayer (demo layer).
 *
 * Architecture:
 *   Document → (string[] lines) → LuauAnalyzer → Diagnostic[]
 *                                              → DiagnosticEngine
 *                                              → DecorationSet (squiggle=true)
 *                                              → CanvasRenderer
 *
 * LOCK guarantees:
 *   LOCK-13: Never calls lex() or accesses TokenizerEngine.
 *   LOCK-21: Never mutates Document internals.
 *   LOCK-14/17: Never touches RenderCache or invalidation logic.
 *   LOCK-18: Never calls buildLine().
 */

import { DiagnosticSeverity, severityColor, type Diagnostic } from '../../src/diagnostics/DiagnosticTypes.js';
import { analyze } from '../../src/diagnostics/LuauAnalyzer.js';
import type { DecorationSet, DecorationRange } from './DecorationLayer.js';

// ── Conversion helper (exported for tests) ────────────────────────────────────

/**
 * Convert a single Diagnostic to a DecorationRange with squiggle=true.
 * Pure function — no side effects.
 */
export function diagnosticToRange(diag: Diagnostic): DecorationRange {
  return {
    startColumn: diag.column,
    endColumn:   diag.column + Math.max(1, diag.length),
    color:       severityColor(diag.severity),
    inset:       false,
    squiggle:    true,
  };
}

// ── DiagnosticEngine ──────────────────────────────────────────────────────────

export class DiagnosticEngine {
  private _diagnostics: Diagnostic[] = [];

  /** Run all analyzers against the given document lines. O(n) in total lines. */
  analyze(lines: string[]): void {
    this._diagnostics = analyze(lines);
  }

  /** Number of Error-severity diagnostics in the last analysis. */
  get errorCount(): number {
    let n = 0;
    for (const d of this._diagnostics) {
      if (d.severity === DiagnosticSeverity.Error) n++;
    }
    return n;
  }

  /** Number of Warning-severity diagnostics in the last analysis. */
  get warningCount(): number {
    let n = 0;
    for (const d of this._diagnostics) {
      if (d.severity === DiagnosticSeverity.Warning) n++;
    }
    return n;
  }

  /** Number of Info-severity diagnostics in the last analysis. */
  get infoCount(): number {
    let n = 0;
    for (const d of this._diagnostics) {
      if (d.severity === DiagnosticSeverity.Info) n++;
    }
    return n;
  }

  /** Read-only view of the current diagnostic list. */
  get diagnostics(): readonly Diagnostic[] {
    return this._diagnostics;
  }

  /**
   * Write all current diagnostics as squiggle decorations into the given set.
   * Replaces all previous content of the set.
   */
  applyToSet(set: DecorationSet): void {
    const byLine = new Map<number, DecorationRange[]>();

    for (const diag of this._diagnostics) {
      const range = diagnosticToRange(diag);
      const arr = byLine.get(diag.line);
      if (arr) {
        arr.push(range);
      } else {
        byLine.set(diag.line, [range]);
      }
    }

    set.setRanges(byLine);
  }
}
