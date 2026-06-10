/**
 * APDS Autocomplete — Phase 6 Test Suite
 *
 * Coverage areas:
 *   1.  CompletionItem — resolveInsertText
 *   2.  CompletionContext — extractPrefix
 *   3.  CompletionContext — buildContext
 *   4.  KeywordProvider — basic provision
 *   5.  KeywordProvider — suppression inside strings/comments
 *   6.  GlobalProvider — basic provision
 *   7.  RobloxTypeProvider — basic provision
 *   8.  Provider suppression — isCursorInStringOrComment
 *   9.  CompletionSession — construction and filtering
 *   10. CompletionSession — selectNext / selectPrev / setActiveIndex
 *   11. CompletionSession — update (prefix narrowing)
 *   12. CompletionSession — dismiss on line change
 *   13. CompletionSession — dismiss on no matches
 *   14. CompletionSession — empty prefix shows all
 *   15. CompletionService — provider registration
 *   16. CompletionService — duplicate provider throws
 *   17. CompletionService — unregister provider
 *   18. CompletionService — trigger() opens session
 *   19. CompletionService — session updates on content change
 *   20. CompletionService — dismiss() closes session
 *   21. CompletionService — acceptActive() inserts text
 *   22. CompletionService — dispose() unsubscribes from Document
 *   23. CompletionService — createDefaultService() registers 3 providers
 *   24. CompletionService — no session when cursor in comment
 *   25. CompletionService — no session when prefix is empty (non-invoked)
 *   26. CompletionService — onDidChangeSession fires on open
 *   27. CompletionService — onDidChangeSession fires on dismiss
 *   28. CompletionSession — sortText ordering preserved
 *   29. CompletionSession — case-insensitive prefix filter
 *   30. CompletionService — cursor line change dismisses session
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CompletionKind, resolveInsertText, type CompletionItem } from '../CompletionItem.js';
import { extractPrefix, buildContext } from '../CompletionContext.js';
import {
  KeywordProvider,
  GlobalProvider,
  RobloxTypeProvider,
  type CompletionProvider,
} from '../CompletionProvider.js';
import { CompletionSession } from '../CompletionSession.js';
import { CompletionService, createDefaultService, type SessionChangeEvent } from '../CompletionService.js';
import { Document } from '../../editor/Document.js';
import { TokenClass } from '../../tokenizer/tokenTypes.js';
import { DEFAULT_STATE } from '../../tokenizer/tokenizerState.js';
import { lex } from '../../tokenizer/lexer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(text = ''): Document {
  return new Document(text);
}

/** Build a context for a given line/column in a fresh single-line document. */
function ctxFor(lineText: string, column: number) {
  const tokens = lex(lineText, DEFAULT_STATE).tokens;
  return buildContext(0, column, lineText, tokens, 1, 'character');
}

function makeItem(label: string, kind = CompletionKind.Keyword, sortText?: string): CompletionItem {
  return { label, kind, sortText };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CompletionItem
// ═══════════════════════════════════════════════════════════════════════════

describe('1. CompletionItem — resolveInsertText', () => {
  it('returns label when insertText is absent', () => {
    expect(resolveInsertText({ label: 'print', kind: CompletionKind.Global })).toBe('print');
  });

  it('returns insertText when present', () => {
    expect(
      resolveInsertText({ label: 'print', kind: CompletionKind.Global, insertText: 'print()' }),
    ).toBe('print()');
  });

  it('returns empty insertText when explicitly set to empty', () => {
    expect(
      resolveInsertText({ label: 'print', kind: CompletionKind.Global, insertText: '' }),
    ).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CompletionContext — extractPrefix
// ═══════════════════════════════════════════════════════════════════════════

describe('2. CompletionContext — extractPrefix', () => {
  it('extracts a simple word', () => {
    const { prefix, prefixStart } = extractPrefix('local x = pri', 13);
    expect(prefix).toBe('pri');
    expect(prefixStart).toBe(10);
  });

  it('empty prefix at column 0', () => {
    const { prefix, prefixStart } = extractPrefix('', 0);
    expect(prefix).toBe('');
    expect(prefixStart).toBe(0);
  });

  it('empty prefix when cursor is after a space', () => {
    const { prefix, prefixStart } = extractPrefix('local ', 6);
    expect(prefix).toBe('');
    expect(prefixStart).toBe(6);
  });

  it('full word when cursor is at end of word', () => {
    const { prefix, prefixStart } = extractPrefix('Vector3', 7);
    expect(prefix).toBe('Vector3');
    expect(prefixStart).toBe(0);
  });

  it('stops at operator', () => {
    const { prefix, prefixStart } = extractPrefix('x+y', 3);
    expect(prefix).toBe('y');
    expect(prefixStart).toBe(2);
  });

  it('stops at dot (member access)', () => {
    const { prefix, prefixStart } = extractPrefix('game.GetService', 15);
    expect(prefix).toBe('GetService');
    expect(prefixStart).toBe(5);
  });

  it('includes underscores', () => {
    const { prefix, prefixStart } = extractPrefix('_G', 2);
    expect(prefix).toBe('_G');
    expect(prefixStart).toBe(0);
  });

  it('includes digits mid-word', () => {
    const { prefix, prefixStart } = extractPrefix('Vector3', 5);
    expect(prefix).toBe('Vecto');
    expect(prefixStart).toBe(0);
  });

  it('column at start of word returns empty', () => {
    const { prefix, prefixStart } = extractPrefix('local Vector3', 6);
    expect(prefix).toBe('');
    expect(prefixStart).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CompletionContext — buildContext
// ═══════════════════════════════════════════════════════════════════════════

describe('3. CompletionContext — buildContext', () => {
  it('builds a context with correct prefix', () => {
    const ctx = ctxFor('local pri', 9);
    expect(ctx.prefix).toBe('pri');
    expect(ctx.prefixStart).toBe(6);
    expect(ctx.line).toBe(0);
    expect(ctx.column).toBe(9);
    expect(ctx.lineText).toBe('local pri');
  });

  it('triggerKind is preserved', () => {
    const tokens = lex('print', DEFAULT_STATE).tokens;
    const ctx = buildContext(0, 5, 'print', tokens, 42, 'invoked');
    expect(ctx.triggerKind).toBe('invoked');
    expect(ctx.documentVersion).toBe(42);
  });

  it('lineTokens are included', () => {
    const ctx = ctxFor('local x', 5);
    expect(ctx.lineTokens.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. KeywordProvider — basic provision
// ═══════════════════════════════════════════════════════════════════════════

describe('4. KeywordProvider — basic provision', () => {
  const provider = new KeywordProvider();

  it('has id builtin.keywords', () => {
    expect(provider.id).toBe('builtin.keywords');
  });

  it('returns items including "local"', () => {
    const ctx = ctxFor('l', 1);
    const items = provider.provideCompletions(ctx);
    const labels = items.map(i => i.label);
    expect(labels).toContain('local');
  });

  it('returns items including "function"', () => {
    const ctx = ctxFor('', 0);
    const items = provider.provideCompletions(ctx);
    expect(items.map(i => i.label)).toContain('function');
  });

  it('returns items including type soft-keywords', () => {
    const ctx = ctxFor('', 0);
    const items = provider.provideCompletions(ctx);
    const labels = items.map(i => i.label);
    expect(labels).toContain('type');
    expect(labels).toContain('typeof');
    expect(labels).toContain('export');
  });

  it('all items have kind Keyword', () => {
    const ctx = ctxFor('', 0);
    const items = provider.provideCompletions(ctx);
    for (const item of items) {
      expect(item.kind).toBe(CompletionKind.Keyword);
    }
  });

  it('returns 25 items (22 keywords + 3 type-keywords)', () => {
    const ctx = ctxFor('', 0);
    const items = provider.provideCompletions(ctx);
    expect(items.length).toBe(25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. KeywordProvider — suppression inside strings/comments
// ═══════════════════════════════════════════════════════════════════════════

describe('5. KeywordProvider — suppression inside strings/comments', () => {
  const provider = new KeywordProvider();

  it('returns [] when cursor is inside a string', () => {
    // "local" — cursor at column 3 (inside the string literal)
    const ctx = ctxFor('"local"', 3);
    // Verify the token at col 3 is a String token
    expect(ctx.lineTokens.some(t => t.class === TokenClass.String)).toBe(true);
    const items = provider.provideCompletions(ctx);
    expect(items).toHaveLength(0);
  });

  it('returns [] when cursor is inside a line comment', () => {
    const ctx = ctxFor('-- local', 5);
    expect(ctx.lineTokens.some(t => t.class === TokenClass.Comment)).toBe(true);
    const items = provider.provideCompletions(ctx);
    expect(items).toHaveLength(0);
  });

  it('returns items when cursor is AFTER a string (not inside)', () => {
    // "x" local — cursor at end, past the string
    const ctx = ctxFor('"x" loc', 7);
    const items = provider.provideCompletions(ctx);
    expect(items.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. GlobalProvider — basic provision
// ═══════════════════════════════════════════════════════════════════════════

describe('6. GlobalProvider — basic provision', () => {
  const provider = new GlobalProvider();

  it('has id builtin.globals', () => {
    expect(provider.id).toBe('builtin.globals');
  });

  it('includes "print"', () => {
    const ctx = ctxFor('', 0);
    expect(provider.provideCompletions(ctx).map(i => i.label)).toContain('print');
  });

  it('includes "game"', () => {
    const ctx = ctxFor('', 0);
    expect(provider.provideCompletions(ctx).map(i => i.label)).toContain('game');
  });

  it('includes "task"', () => {
    const ctx = ctxFor('', 0);
    expect(provider.provideCompletions(ctx).map(i => i.label)).toContain('task');
  });

  it('all items have kind Global', () => {
    const ctx = ctxFor('', 0);
    for (const item of provider.provideCompletions(ctx)) {
      expect(item.kind).toBe(CompletionKind.Global);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. RobloxTypeProvider — basic provision
// ═══════════════════════════════════════════════════════════════════════════

describe('7. RobloxTypeProvider — basic provision', () => {
  const provider = new RobloxTypeProvider();

  it('has id builtin.robloxTypes', () => {
    expect(provider.id).toBe('builtin.robloxTypes');
  });

  it('includes "Vector3"', () => {
    const ctx = ctxFor('', 0);
    expect(provider.provideCompletions(ctx).map(i => i.label)).toContain('Vector3');
  });

  it('includes "CFrame"', () => {
    const ctx = ctxFor('', 0);
    expect(provider.provideCompletions(ctx).map(i => i.label)).toContain('CFrame');
  });

  it('includes "Color3"', () => {
    const ctx = ctxFor('', 0);
    expect(provider.provideCompletions(ctx).map(i => i.label)).toContain('Color3');
  });

  it('all items have kind Type', () => {
    const ctx = ctxFor('', 0);
    for (const item of provider.provideCompletions(ctx)) {
      expect(item.kind).toBe(CompletionKind.Type);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Provider suppression — isCursorInStringOrComment (via all providers)
// ═══════════════════════════════════════════════════════════════════════════

describe('8. Provider suppression edge cases', () => {
  const kp = new KeywordProvider();
  const gp = new GlobalProvider();
  const tp = new RobloxTypeProvider();

  it('all providers suppress inside a double-quoted string', () => {
    const ctx = ctxFor('"hello world"', 5);
    expect(kp.provideCompletions(ctx)).toHaveLength(0);
    expect(gp.provideCompletions(ctx)).toHaveLength(0);
    expect(tp.provideCompletions(ctx)).toHaveLength(0);
  });

  it('all providers suppress inside a single-quoted string', () => {
    const ctx = ctxFor("'print'", 3);
    expect(kp.provideCompletions(ctx)).toHaveLength(0);
    expect(gp.provideCompletions(ctx)).toHaveLength(0);
    expect(tp.provideCompletions(ctx)).toHaveLength(0);
  });

  it('all providers provide items on normal identifier line', () => {
    const ctx = ctxFor('local x = pri', 13);
    expect(kp.provideCompletions(ctx).length).toBeGreaterThan(0);
    expect(gp.provideCompletions(ctx).length).toBeGreaterThan(0);
    expect(tp.provideCompletions(ctx).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. CompletionSession — construction and filtering
// ═══════════════════════════════════════════════════════════════════════════

describe('9. CompletionSession — construction and filtering', () => {
  const items: CompletionItem[] = [
    makeItem('print', CompletionKind.Global),
    makeItem('pairs', CompletionKind.Global),
    makeItem('pcall', CompletionKind.Global),
    makeItem('local', CompletionKind.Keyword),
  ];

  it('filters to prefix "p"', () => {
    const ctx = ctxFor('p', 1);
    const session = new CompletionSession(ctx, items);
    expect(session.filteredItems.map(i => i.label)).toContain('print');
    expect(session.filteredItems.map(i => i.label)).toContain('pairs');
    expect(session.filteredItems.map(i => i.label)).toContain('pcall');
    expect(session.filteredItems.map(i => i.label)).not.toContain('local');
  });

  it('filters to prefix "pr"', () => {
    const ctx = ctxFor('pr', 2);
    const session = new CompletionSession(ctx, items);
    expect(session.filteredItems.map(i => i.label)).toEqual(['print']);
  });

  it('empty prefix shows all items', () => {
    const ctx = ctxFor('', 0);
    const session = new CompletionSession(ctx, items);
    expect(session.filteredItems).toHaveLength(4);
  });

  it('starts active', () => {
    const ctx = ctxFor('p', 1);
    const session = new CompletionSession(ctx, items);
    expect(session.isActive).toBe(true);
    expect(session.state).toBe('active');
  });

  it('activeIndex starts at 0', () => {
    const ctx = ctxFor('p', 1);
    const session = new CompletionSession(ctx, items);
    expect(session.activeIndex).toBe(0);
  });

  it('activeItem is the first filtered item', () => {
    const ctx = ctxFor('pr', 2);
    const session = new CompletionSession(ctx, items);
    expect(session.activeItem?.label).toBe('print');
  });

  it('hasItems is false when no items pass filter', () => {
    const ctx = ctxFor('zzz', 3);
    const session = new CompletionSession(ctx, items);
    expect(session.hasItems).toBe(false);
    expect(session.activeItem).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. CompletionSession — navigation
// ═══════════════════════════════════════════════════════════════════════════

describe('10. CompletionSession — selectNext / selectPrev / setActiveIndex', () => {
  const items: CompletionItem[] = [
    makeItem('aaa', CompletionKind.Keyword, '0_aaa'),
    makeItem('bbb', CompletionKind.Keyword, '0_bbb'),
    makeItem('ccc', CompletionKind.Keyword, '0_ccc'),
  ];

  function makeSession() {
    return new CompletionSession(ctxFor('', 0), items);
  }

  it('selectNext advances index', () => {
    const s = makeSession();
    s.selectNext();
    expect(s.activeIndex).toBe(1);
  });

  it('selectNext wraps at end', () => {
    const s = makeSession();
    s.selectNext(); s.selectNext(); s.selectNext();
    expect(s.activeIndex).toBe(0);
  });

  it('selectPrev wraps at start', () => {
    const s = makeSession();
    s.selectPrev();
    expect(s.activeIndex).toBe(2);
  });

  it('setActiveIndex clamps to valid range', () => {
    const s = makeSession();
    s.setActiveIndex(100);
    expect(s.activeIndex).toBe(2);
    s.setActiveIndex(-5);
    expect(s.activeIndex).toBe(0);
  });

  it('selectNext is no-op when no items', () => {
    const s = new CompletionSession(ctxFor('zzz', 3), items);
    expect(s.hasItems).toBe(false);
    s.selectNext();
    expect(s.activeIndex).toBe(0); // stays 0
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. CompletionSession — update (prefix narrowing)
// ═══════════════════════════════════════════════════════════════════════════

describe('11. CompletionSession — update prefix narrowing', () => {
  const items: CompletionItem[] = [
    makeItem('print', CompletionKind.Global),
    makeItem('pairs', CompletionKind.Global),
    makeItem('pcall', CompletionKind.Global),
  ];

  it('update with narrower prefix re-filters', () => {
    const s = new CompletionSession(ctxFor('p', 1), items);
    expect(s.filteredItems).toHaveLength(3);

    const alive = s.update(ctxFor('pr', 2));
    expect(alive).toBe(true);
    expect(s.filteredItems.map(i => i.label)).toEqual(['print']);
  });

  it('update returns false when prefix no longer matches anything', () => {
    const s = new CompletionSession(ctxFor('p', 1), items);
    const alive = s.update(ctxFor('zzz', 3));
    expect(alive).toBe(false);
    expect(s.state).toBe('dismissed');
  });

  it('update returns true as long as items remain', () => {
    const s = new CompletionSession(ctxFor('p', 1), items);
    expect(s.update(ctxFor('pa', 2))).toBe(true);
    expect(s.filteredItems.map(i => i.label)).toEqual(['pairs']);
  });

  it('update on dismissed session returns false immediately', () => {
    const s = new CompletionSession(ctxFor('p', 1), items);
    s.dismiss();
    expect(s.update(ctxFor('pr', 2))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. CompletionSession — dismiss on line change
// ═══════════════════════════════════════════════════════════════════════════

describe('12. CompletionSession — dismiss on line change', () => {
  it('update on different line dismisses session', () => {
    const items = [makeItem('print', CompletionKind.Global)];
    const s = new CompletionSession(ctxFor('p', 1), items);

    // Simulate cursor moving to line 1
    const tokens = lex('print', DEFAULT_STATE).tokens;
    const newCtx = buildContext(1, 5, 'print', tokens, 2, 'character');
    const alive = s.update(newCtx);
    expect(alive).toBe(false);
    expect(s.state).toBe('dismissed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. CompletionSession — explicit dismiss
// ═══════════════════════════════════════════════════════════════════════════

describe('13. CompletionSession — explicit dismiss', () => {
  it('dismiss() sets state to dismissed', () => {
    const s = new CompletionSession(
      ctxFor('p', 1),
      [makeItem('print', CompletionKind.Global)],
    );
    s.dismiss();
    expect(s.state).toBe('dismissed');
    expect(s.isActive).toBe(false);
  });

  it('dismiss() is idempotent', () => {
    const s = new CompletionSession(
      ctxFor('p', 1),
      [makeItem('print', CompletionKind.Global)],
    );
    s.dismiss();
    s.dismiss();
    expect(s.state).toBe('dismissed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. CompletionSession — empty prefix
// ═══════════════════════════════════════════════════════════════════════════

describe('14. CompletionSession — empty prefix shows all', () => {
  it('all items shown when prefix is empty', () => {
    const items = [
      makeItem('aaa', CompletionKind.Keyword),
      makeItem('bbb', CompletionKind.Keyword),
      makeItem('ccc', CompletionKind.Keyword),
    ];
    const s = new CompletionSession(ctxFor('', 0), items);
    expect(s.filteredItems).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15-17. CompletionService — provider management
// ═══════════════════════════════════════════════════════════════════════════

describe('15. CompletionService — provider registration', () => {
  it('providerCount is 0 initially', () => {
    const svc = new CompletionService(makeDoc());
    expect(svc.providerCount).toBe(0);
    svc.dispose();
  });

  it('registering a provider increments count', () => {
    const svc = new CompletionService(makeDoc());
    svc.registerProvider(new KeywordProvider());
    expect(svc.providerCount).toBe(1);
    svc.dispose();
  });
});

describe('16. CompletionService — duplicate provider throws', () => {
  it('throws on duplicate id', () => {
    const svc = new CompletionService(makeDoc());
    svc.registerProvider(new KeywordProvider());
    expect(() => svc.registerProvider(new KeywordProvider())).toThrow(/already registered/);
    svc.dispose();
  });
});

describe('17. CompletionService — unregister provider', () => {
  it('unregister returns true and decrements count', () => {
    const svc = new CompletionService(makeDoc());
    svc.registerProvider(new KeywordProvider());
    expect(svc.unregisterProvider('builtin.keywords')).toBe(true);
    expect(svc.providerCount).toBe(0);
    svc.dispose();
  });

  it('unregister returns false for unknown id', () => {
    const svc = new CompletionService(makeDoc());
    expect(svc.unregisterProvider('no.such.provider')).toBe(false);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. CompletionService — trigger() opens session
// ═══════════════════════════════════════════════════════════════════════════

describe('18. CompletionService — trigger() opens session', () => {
  it('trigger() with prefix opens a session', () => {
    const doc = makeDoc('local x = pri');
    // Position cursor at end of line (column 13)
    doc.moveCursor(doc.createCursor(0, 13));

    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();

    expect(svc.isSessionActive).toBe(true);
    expect(svc.session?.filteredItems.some(i => i.label === 'print')).toBe(true);
    svc.dispose();
  });

  it('trigger() with empty prefix shows all items', () => {
    const doc = makeDoc('');
    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();

    expect(svc.isSessionActive).toBe(true);
    expect(svc.session!.filteredItems.length).toBeGreaterThan(0);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. CompletionService — session updates on content change
// ═══════════════════════════════════════════════════════════════════════════

describe('19. CompletionService — session updates on content change', () => {
  it('typing narrows the session prefix', () => {
    const doc = makeDoc('p');
    doc.moveCursor(doc.createCursor(0, 1));

    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();

    expect(svc.isSessionActive).toBe(true);
    const beforeCount = svc.session!.filteredItems.length;

    // Type 'r' → cursor at col 2, prefix 'pr'
    doc.insertText('r');

    // Session should still be active with narrower filter
    expect(svc.isSessionActive).toBe(true);
    const afterCount = svc.session!.filteredItems.length;
    expect(afterCount).toBeLessThanOrEqual(beforeCount);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. CompletionService — dismiss()
// ═══════════════════════════════════════════════════════════════════════════

describe('20. CompletionService — dismiss() closes session', () => {
  it('dismiss() after trigger sets session to null', () => {
    const doc = makeDoc('pri');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();
    expect(svc.isSessionActive).toBe(true);
    svc.dismiss();
    expect(svc.isSessionActive).toBe(false);
    expect(svc.session).toBeNull();
    svc.dispose();
  });

  it('dismiss() is no-op when no session', () => {
    const svc = new CompletionService(makeDoc());
    expect(() => svc.dismiss()).not.toThrow();
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. CompletionService — acceptActive()
// ═══════════════════════════════════════════════════════════════════════════

describe('21. CompletionService — acceptActive() inserts text', () => {
  it('acceptActive() replaces the prefix with the selected item', () => {
    const doc = makeDoc('pri');
    doc.moveCursor(doc.createCursor(0, 3));

    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();

    expect(svc.isSessionActive).toBe(true);
    // Force-select 'print' if not already active
    const idx = svc.session!.filteredItems.findIndex(i => i.label === 'print');
    if (idx >= 0) svc.session!.setActiveIndex(idx);

    const accepted = svc.acceptActive();
    expect(accepted).toBe(true);

    expect(doc.getText()).toBe('print');
    expect(svc.isSessionActive).toBe(false);
    svc.dispose();
  });

  it('acceptActive() returns false when no session', () => {
    const svc = new CompletionService(makeDoc());
    expect(svc.acceptActive()).toBe(false);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. CompletionService — dispose()
// ═══════════════════════════════════════════════════════════════════════════

describe('22. CompletionService — dispose() unsubscribes from Document', () => {
  it('after dispose, content changes do not affect session', () => {
    const doc = makeDoc('pr');
    doc.moveCursor(doc.createCursor(0, 2));

    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();
    expect(svc.isSessionActive).toBe(true);

    svc.dispose();
    // Typing after dispose should not throw or affect service state
    expect(() => doc.insertText('i')).not.toThrow();
    // Service is disposed — session is gone
    expect(svc.session).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. CompletionService — createDefaultService
// ═══════════════════════════════════════════════════════════════════════════

describe('23. CompletionService — createDefaultService registers 3 providers', () => {
  it('registers keyword, global, and type providers', () => {
    const svc = createDefaultService(makeDoc());
    expect(svc.providerCount).toBe(3);
    svc.dispose();
  });

  it('trigger() with default service finds keywords', () => {
    const doc = makeDoc('loc');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = createDefaultService(doc);
    svc.trigger();

    expect(svc.isSessionActive).toBe(true);
    const labels = svc.session!.filteredItems.map(i => i.label);
    expect(labels).toContain('local');
    svc.dispose();
  });

  it('trigger() with default service finds Roblox globals', () => {
    const doc = makeDoc('gam');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = createDefaultService(doc);
    svc.trigger();

    const labels = svc.session!.filteredItems.map(i => i.label);
    expect(labels).toContain('game');
    svc.dispose();
  });

  it('trigger() with default service finds Roblox types', () => {
    const doc = makeDoc('Vec');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = createDefaultService(doc);
    svc.trigger();

    const labels = svc.session!.filteredItems.map(i => i.label);
    expect(labels).toContain('Vector3');
    expect(labels).toContain('Vector2');
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24. CompletionService — no session in comment
// ═══════════════════════════════════════════════════════════════════════════

describe('24. CompletionService — no session when cursor in comment', () => {
  it('trigger inside comment returns no items → no session', () => {
    const doc = makeDoc('-- local x');
    doc.moveCursor(doc.createCursor(0, 6));
    const svc = createDefaultService(doc);
    svc.trigger();

    // All providers suppress inside comments — no session should open
    expect(svc.isSessionActive).toBe(false);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 25. CompletionService — no session for empty prefix (non-invoked)
// ═══════════════════════════════════════════════════════════════════════════

describe('25. CompletionService — no session for empty prefix (non-invoked)', () => {
  it('content/selection change with empty prefix dismisses any existing session', () => {
    const doc = makeDoc('p');
    doc.moveCursor(doc.createCursor(0, 1));
    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());

    // Open session manually
    svc.trigger();
    expect(svc.isSessionActive).toBe(true);

    // Delete the 'p', leaving empty line → cursor col 0, prefix ''
    doc.deleteText('backward');
    // After deleting, the service should have dismissed the session
    expect(svc.isSessionActive).toBe(false);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 26. CompletionService — onDidChangeSession fires on open
// ═══════════════════════════════════════════════════════════════════════════

describe('26. CompletionService — onDidChangeSession fires on open', () => {
  it('listener is called when session opens', () => {
    const doc = makeDoc('pri');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());

    const events: SessionChangeEvent[] = [];
    svc.onDidChangeSession(e => events.push(e));

    svc.trigger();

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.session).not.toBeNull();
    svc.dispose();
  });

  it('unsubscribe function stops future events', () => {
    const doc = makeDoc('pri');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());

    const events: SessionChangeEvent[] = [];
    const unsub = svc.onDidChangeSession(e => events.push(e));
    unsub();

    svc.trigger();
    expect(events).toHaveLength(0);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 27. CompletionService — onDidChangeSession fires on dismiss
// ═══════════════════════════════════════════════════════════════════════════

describe('27. CompletionService — onDidChangeSession fires on dismiss', () => {
  it('listener receives null session when dismissed', () => {
    const doc = makeDoc('pri');
    doc.moveCursor(doc.createCursor(0, 3));
    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();

    const events: SessionChangeEvent[] = [];
    svc.onDidChangeSession(e => events.push(e));
    svc.dismiss();

    const last = events[events.length - 1];
    expect(last?.session).toBeNull();
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 28. CompletionSession — sortText ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('28. CompletionSession — sortText ordering', () => {
  it('items with lower sortText appear first', () => {
    const items: CompletionItem[] = [
      makeItem('zzz', CompletionKind.Type,    '2_zzz'),
      makeItem('aaa', CompletionKind.Keyword, '0_aaa'),
      makeItem('mmm', CompletionKind.Global,  '1_mmm'),
    ];
    const s = new CompletionSession(ctxFor('', 0), items);
    expect(s.filteredItems[0]?.label).toBe('aaa');
    expect(s.filteredItems[1]?.label).toBe('mmm');
    expect(s.filteredItems[2]?.label).toBe('zzz');
  });

  it('label is tiebreaker when sortText is equal', () => {
    const items: CompletionItem[] = [
      makeItem('bbb', CompletionKind.Keyword, 'same'),
      makeItem('aaa', CompletionKind.Keyword, 'same'),
    ];
    const s = new CompletionSession(ctxFor('', 0), items);
    expect(s.filteredItems[0]?.label).toBe('aaa');
    expect(s.filteredItems[1]?.label).toBe('bbb');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 29. CompletionSession — case-insensitive prefix filter
// ═══════════════════════════════════════════════════════════════════════════

describe('29. CompletionSession — case-insensitive prefix filter', () => {
  it('uppercase prefix matches lowercase label', () => {
    const items = [makeItem('vector3', CompletionKind.Type)];
    const s = new CompletionSession(ctxFor('VEC', 3), items);
    expect(s.filteredItems).toHaveLength(1);
  });

  it('lowercase prefix matches PascalCase label', () => {
    const items = [makeItem('Vector3', CompletionKind.Type)];
    const s = new CompletionSession(ctxFor('vec', 3), items);
    expect(s.filteredItems).toHaveLength(1);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// 30b. CompletionService — undo that removes lines must not crash (regression)
//
// BUG: ContentChangeEvent fires synchronously inside Document.undo() BEFORE
// the cursor is repositioned to cursorBefore.  cursor.line could exceed
// doc.lineCount - 1 and cause getLine() to throw RangeError.
// ═══════════════════════════════════════════════════════════════════════════

describe('30b. CompletionService — undo removing lines does not crash', () => {
  it('undo that collapses two lines into one must not throw', () => {
    const doc = makeDoc('hello');
    doc.moveCursor(doc.createCursor(0, 5));
    const svc = createDefaultService(doc);

    // Insert a newline + text so there are 2 lines
    doc.insertText('\nworld');
    expect(doc.lineCount).toBe(2);

    // Undo: removes "\nworld" — cursor temporarily at line 1 while doc has 1 line
    expect(() => doc.undo()).not.toThrow();
    expect(doc.lineCount).toBe(1);
    expect(doc.getText()).toBe('hello');
    svc.dispose();
  });

  it('undo after multi-line paste with autocomplete attached does not throw', () => {
    const doc = makeDoc('');
    const svc = createDefaultService(doc);

    doc.insertText('a\nb\nc\nd\ne');
    expect(doc.lineCount).toBe(5);

    expect(() => doc.undo()).not.toThrow();
    expect(doc.lineCount).toBe(1);
    svc.dispose();
  });

  it('redo that adds lines back does not crash', () => {
    const doc = makeDoc('');
    const svc = createDefaultService(doc);

    doc.insertText('line1\nline2\nline3');
    doc.undo();
    expect(doc.lineCount).toBe(1);

    expect(() => doc.redo()).not.toThrow();
    expect(doc.lineCount).toBe(3);
    svc.dispose();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 30. CompletionService — cursor line change dismisses session
// ═══════════════════════════════════════════════════════════════════════════

describe('30. CompletionService — cursor line change dismisses session', () => {
  it('inserting a newline dismisses the active session', () => {
    const doc = makeDoc('print');
    doc.moveCursor(doc.createCursor(0, 5));

    const svc = new CompletionService(doc);
    svc.registerProvider(new GlobalProvider());
    svc.trigger();
    expect(svc.isSessionActive).toBe(true);

    // Insert newline — cursor moves to line 1
    doc.insertText('\n');
    expect(svc.isSessionActive).toBe(false);
    svc.dispose();
  });
});
