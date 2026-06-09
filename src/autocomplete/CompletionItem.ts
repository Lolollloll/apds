/**
 * APDS Autocomplete — CompletionItem
 *
 * A single candidate offered to the user by an autocomplete provider.
 *
 * Design notes
 * ────────────
 * • Immutable value object (readonly throughout).
 * • `kind` drives icon selection in the host UI.
 * • `detail` is optional free-text shown alongside the label (e.g. type sig).
 * • `insertText` defaults to `label` when absent — providers only need to
 *   override it for snippet-style insertions or when the displayed text
 *   differs from what is actually inserted.
 * • `sortText` is a stable sort key for deterministic ordering when a
 *   provider wants to override lexicographic label ordering.
 *   If absent, CompletionSession sorts by label.
 * • `score` is set by CompletionSession during prefix-filtering; providers
 *   never write it.
 */

// ---------------------------------------------------------------------------
// CompletionKind
// ---------------------------------------------------------------------------

/**
 * Category of a completion candidate.
 * Used by the host UI for icon selection and group ordering.
 */
export enum CompletionKind {
  Keyword     = 'keyword',      // language reserved words
  Global      = 'global',       // Roblox/Lua runtime globals
  Type        = 'type',         // Roblox datatype constructors
  Variable    = 'variable',     // user-defined locals/upvalues (future)
  Function    = 'function',     // function names (future)
  Property    = 'property',     // table field / member (future)
  Snippet     = 'snippet',      // multi-token insertion templates (future)
}

// ---------------------------------------------------------------------------
// CompletionItem
// ---------------------------------------------------------------------------

export interface CompletionItem {
  /** The string shown in the dropdown and used for prefix matching. */
  readonly label: string;

  /** Category — drives icon and ordering. */
  readonly kind: CompletionKind;

  /**
   * Actual text inserted at the cursor position.
   * Defaults to `label` when absent.
   */
  readonly insertText?: string;

  /**
   * Optional secondary description (e.g. "(global)", "Vector3 constructor").
   * Displayed alongside the label in the UI.
   */
  readonly detail?: string;

  /**
   * Sort key for deterministic ordering within a provider result.
   * If absent, CompletionSession falls back to label.
   */
  readonly sortText?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the actual text to insert for a given item. */
export function resolveInsertText(item: CompletionItem): string {
  return item.insertText ?? item.label;
}
