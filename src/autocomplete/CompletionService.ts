/**
 * APDS Autocomplete — CompletionService
 *
 * CompletionService is the orchestrator.  It:
 *   1. Subscribes to Document events (content + selection) — no polling.
 *   2. Manages a pool of CompletionProviders.
 *   3. Opens / updates / dismisses a CompletionSession.
 *   4. Notifies host listeners when the session changes.
 *
 * Integration contract
 * ────────────────────
 * • Instantiate with a Document reference.
 * • Three built-in providers (keywords, globals, types) are registered
 *   automatically by the factory function `createDefaultService()`.
 * • Host UI subscribes to `onDidChangeSession` to redraw the popup.
 * • Host UI calls `acceptActive()` to commit the selected item.
 * • Host UI calls `dismiss()` to close the popup (e.g. Escape key).
 * • Call `dispose()` when the editor is torn down — unsubscribes from Document.
 *
 * Event-driven architecture
 * ─────────────────────────
 * LOCK-29 guarantees ContentChangeEvent fires synchronously.
 * We therefore update autocomplete state inside the same call stack as the
 * mutation, consistent with how Renderer updates its cache.
 *
 * Trigger rules
 * ─────────────
 * A session opens when BOTH conditions hold after a content or cursor change:
 *   a) The cursor is in a "triggerable" position (not inside string/comment).
 *   b) The current prefix is non-empty OR trigger kind is 'invoked'.
 *
 * A session is updated (not re-opened) when it is already active and the
 * cursor stays on the same line at a compatible prefix position.
 *
 * A session is dismissed when:
 *   • Prefix becomes empty after the session was opened, OR
 *   • Cursor moves to a different line, OR
 *   • No providers return any matching items.
 */

import type { Document }              from '../editor/Document.js';
import type {
  ContentChangeEvent,
  SelectionChangeEvent,
} from '../editor/Document.js';
import {
  buildContext,
  type CompletionContext,
  type TriggerKind,
} from './CompletionContext.js';
import type { CompletionItem }        from './CompletionItem.js';
import { resolveInsertText }          from './CompletionItem.js';
import type { CompletionProvider }    from './CompletionProvider.js';
import {
  KeywordProvider,
  GlobalProvider,
  RobloxTypeProvider,
} from './CompletionProvider.js';
import { CompletionSession }          from './CompletionSession.js';

// ---------------------------------------------------------------------------
// SessionChangeEvent
// ---------------------------------------------------------------------------

/**
 * Fired whenever the active session (or absence of one) changes.
 * Host UI should redraw the popup in response.
 */
export interface SessionChangeEvent {
  /** The new active session, or null if autocomplete is dismissed. */
  readonly session: CompletionSession | null;
}

// ---------------------------------------------------------------------------
// CompletionService
// ---------------------------------------------------------------------------

export class CompletionService {
  private readonly _doc: Document;
  private readonly _providers: Map<string, CompletionProvider> = new Map();
  private _session: CompletionSession | null = null;
  private readonly _sessionListeners: Set<(e: SessionChangeEvent) => void> = new Set();

  // Unsubscribe functions returned by Document.onDidChange*
  private readonly _unsubContent:   () => void;
  private readonly _unsubSelection: () => void;

  constructor(doc: Document) {
    this._doc = doc;

    this._unsubContent   = doc.onDidChangeContent(e   => this._onContentChange(e));
    this._unsubSelection = doc.onDidChangeSelection(e => this._onSelectionChange(e));
  }

  // ── Provider registration ────────────────────────────────────────────────

  registerProvider(provider: CompletionProvider): void {
    if (this._providers.has(provider.id)) {
      throw new Error(
        `CompletionService: provider id "${provider.id}" is already registered.`,
      );
    }
    this._providers.set(provider.id, provider);
  }

  unregisterProvider(id: string): boolean {
    return this._providers.delete(id);
  }

  get providerCount(): number { return this._providers.size; }

  // ── Session access ───────────────────────────────────────────────────────

  /** The currently active session, or null if autocomplete is closed. */
  get session(): CompletionSession | null { return this._session; }

  get isSessionActive(): boolean {
    return this._session !== null && this._session.isActive;
  }

  // ── Host event subscription ──────────────────────────────────────────────

  /**
   * Subscribe to session lifecycle changes.
   * Returns an unsubscribe function.
   */
  onDidChangeSession(handler: (e: SessionChangeEvent) => void): () => void {
    this._sessionListeners.add(handler);
    return () => { this._sessionListeners.delete(handler); };
  }

  // ── Host actions ─────────────────────────────────────────────────────────

  /**
   * Programmatically open/refresh autocomplete at the current cursor.
   * Equivalent to the user pressing the explicit invoke shortcut.
   */
  trigger(): void {
    this._openOrUpdate('invoked');
  }

  /**
   * Dismiss the active session.
   * No-op if there is no active session.
   */
  dismiss(): void {
    if (this._session !== null) {
      this._session.dismiss();
      this._setSession(null);
    }
  }

  /**
   * Commit the active item: insert its text into the document at the
   * current prefix range, then dismiss the session.
   *
   * Returns true if an item was committed, false if there was nothing active.
   */
  acceptActive(): boolean {
    const session = this._session;
    if (session === null || !session.isActive) return false;

    const item = session.activeItem;
    if (item === undefined) return false;

    const ctx        = session.context;
    const insertText = resolveInsertText(item);
    const start      = { line: ctx.line, column: ctx.prefixStart };
    const end        = { line: ctx.line, column: ctx.column };

    // replaceRange is a public Document API (defined in Phase 3)
    this._doc.replaceRange(start, end, insertText);
    this.dismiss();
    return true;
  }

  // ── Disposal ─────────────────────────────────────────────────────────────

  /**
   * Tear down: unsubscribe from Document events.
   * Call when the editor widget is destroyed.
   */
  dispose(): void {
    this._unsubContent();
    this._unsubSelection();
    this._session?.dismiss();
    this._session = null;
    this._sessionListeners.clear();
  }

  // ── Document event handlers ──────────────────────────────────────────────

  private _onContentChange(_e: ContentChangeEvent): void {
    // Content changed — re-evaluate from current cursor position
    this._openOrUpdate('contentChange');
  }

  private _onSelectionChange(_e: SelectionChangeEvent): void {
    // Cursor moved — update existing session or open/close
    this._openOrUpdate('character');
  }

  // ── Core logic ───────────────────────────────────────────────────────────

  private _openOrUpdate(triggerKind: TriggerKind): void {
    const ctx = this._buildCurrentContext(triggerKind);

    // Nothing to do if no prefix and this wasn't an explicit invocation
    if (ctx.prefix.length === 0 && triggerKind !== 'invoked') {
      this.dismiss();
      return;
    }

    // If a session is already active, try to update it
    if (this._session !== null && this._session.isActive) {
      const alive = this._session.update(ctx);
      if (!alive) {
        this._setSession(null);
      } else {
        this._notifyListeners();
      }
      return;
    }

    // Open a new session
    const items = this._collectItems(ctx);
    if (items.length === 0) {
      return; // Nothing to show — don't open
    }

    const session = new CompletionSession(ctx, items);
    if (!session.hasItems) {
      return;
    }
    this._setSession(session);
  }

  private _buildCurrentContext(triggerKind: TriggerKind): CompletionContext {
    const cursor = this._doc.cursor;

    // SAFETY: ContentChangeEvent fires synchronously inside Document.undo() /
    // Document.redo() BEFORE the cursor is repositioned to cursorBefore/After.
    // At that point cursor.line can exceed the now-smaller document.
    // Clamp to valid document bounds so getLine() never throws.
    const line     = Math.min(cursor.line, this._doc.lineCount - 1);
    const lineText = this._doc.getLine(line);
    const column   = Math.min(cursor.column, lineText.length);

    const lineTokens = this._doc.getLineTokens(line).tokens;
    const version    = this._doc.version;
    return buildContext(line, column, lineText, lineTokens, version, triggerKind);
  }

  private _collectItems(ctx: CompletionContext): CompletionItem[] {
    const items: CompletionItem[] = [];
    for (const provider of this._providers.values()) {
      const got = provider.provideCompletions(ctx);
      for (const item of got) items.push(item);
    }
    return items;
  }

  private _setSession(session: CompletionSession | null): void {
    this._session = session;
    this._notifyListeners();
  }

  private _notifyListeners(): void {
    const event: SessionChangeEvent = { session: this._session };
    for (const handler of this._sessionListeners) {
      handler(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a CompletionService pre-registered with all three built-in providers:
 *   • KeywordProvider  — Luau keywords + type-keywords
 *   • GlobalProvider   — ROBLOX_GLOBALS
 *   • RobloxTypeProvider — ROBLOX_TYPES
 */
export function createDefaultService(doc: Document): CompletionService {
  const service = new CompletionService(doc);
  service.registerProvider(new KeywordProvider());
  service.registerProvider(new GlobalProvider());
  service.registerProvider(new RobloxTypeProvider());
  return service;
}
