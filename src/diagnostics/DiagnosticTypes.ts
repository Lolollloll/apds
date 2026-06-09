/**
 * APDS Diagnostics — Type Definitions
 *
 * Core diagnostic data model. Fully independent of rendering and tokenization.
 *
 * Architecture position:
 *   Document → Analyzer → [Diagnostic[]] → DiagnosticEngine → Decoration Layer
 *
 * LOCK-13 / LOCK-18 / LOCK-21: These types never touch the render cache,
 * lexer, tokenizer, or Document internals.
 */

// ── DiagnosticSeverity ────────────────────────────────────────────────────────

export enum DiagnosticSeverity {
  Error   = 'error',
  Warning = 'warning',
  Info    = 'info',
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

export interface Diagnostic {
  /** Zero-based line index in the document. */
  readonly line:     number;
  /** Zero-based column of the diagnostic start. */
  readonly column:   number;
  /** Number of characters the diagnostic spans (minimum 1). */
  readonly length:   number;
  readonly severity: DiagnosticSeverity;
  readonly message:  string;
}

// ── Severity metadata helpers ─────────────────────────────────────────────────

/** CSS color for a squiggle underline of a given severity. */
export function severityColor(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Error:   return '#ff4444';
    case DiagnosticSeverity.Warning: return '#ffcc00';
    case DiagnosticSeverity.Info:    return '#4499ff';
  }
}
