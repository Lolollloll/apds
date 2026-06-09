/**
 * APDS Autocomplete — CompletionProvider
 *
 * Provider interface + three built-in providers that seed the completion
 * list from the existing lexer data tables.
 *
 * Architecture rules
 * ──────────────────
 * • Providers are PURE: they receive a CompletionContext and return items.
 * • Providers NEVER call Document APIs, touch TextBuffer, or re-lex.
 * • Providers NEVER import from lexer.ts directly.
 *   They use the re-exported sets from this module which are built once
 *   from ROBLOX_GLOBALS and ROBLOX_TYPES at module load time.
 * • The three keyword arrays are declared here (not re-exported from lexer)
 *   because KEYWORDS / TYPE_KEYWORDS are private constants in lexer.ts.
 *   The source-of-truth contract: if the lexer keyword sets change, update
 *   the arrays below and the TokenClass classification stays aligned.
 *
 * Filtering
 * ─────────
 * Providers return ALL their candidates.  CompletionSession is responsible
 * for prefix-filtering and ranking.  This keeps providers stateless and
 * trivially testable.
 *
 * Extensibility
 * ─────────────
 * Third-party providers implement CompletionProvider and register via
 * CompletionService.registerProvider().  The built-in providers are
 * registered by default.
 */

import {
  CompletionKind,
  type CompletionItem,
} from './CompletionItem.js';
import type { CompletionContext } from './CompletionContext.js';
import { ROBLOX_GLOBALS }  from '../tokenizer/robloxGlobals.js';
import { ROBLOX_TYPES }    from '../tokenizer/robloxTypes.js';
import { TokenClass }      from '../tokenizer/tokenTypes.js';

// ---------------------------------------------------------------------------
// CompletionProvider interface
// ---------------------------------------------------------------------------

/**
 * A completion provider returns zero or more items for the given context.
 *
 * Providers are synchronous in Phase 6.  An async variant can be added in
 * a later phase without changing the interface (overloaded return type).
 */
export interface CompletionProvider {
  /**
   * Stable identifier used for debugging and deregistration.
   * Must be unique across all registered providers.
   */
  readonly id: string;

  /**
   * Return completion candidates for `ctx`.
   * Return an empty array to contribute nothing for this context.
   *
   * Providers should NOT filter by prefix — CompletionSession handles that.
   * Exception: a provider MAY return [] early if the context makes its
   * candidates completely irrelevant (e.g. cursor is inside a string token).
   */
  provideCompletions(ctx: CompletionContext): CompletionItem[];
}

// ---------------------------------------------------------------------------
// Keyword data (mirrors lexer.ts private constants — keep in sync)
// ---------------------------------------------------------------------------

/**
 * Hard reserved Luau keywords (cannot be used as identifiers).
 * Source: lexer.ts KEYWORDS set.
 */
const KEYWORD_LIST: readonly string[] = [
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
  'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
  'return', 'then', 'true', 'until', 'while',
  'continue',  // Luau extension
];

/**
 * Luau type-context soft-keywords.
 * Source: lexer.ts TYPE_KEYWORDS set.
 */
const TYPE_KEYWORD_LIST: readonly string[] = [
  'type',
  'typeof',
  'export',
];

// ---------------------------------------------------------------------------
// Pre-built item arrays (built once at module load)
// ---------------------------------------------------------------------------

const KEYWORD_ITEMS: readonly CompletionItem[] = KEYWORD_LIST.map(kw => ({
  label:      kw,
  kind:       CompletionKind.Keyword,
  detail:     'keyword',
  sortText:   `0_${kw}`,  // keywords sort before globals and types
}));

const TYPE_KEYWORD_ITEMS: readonly CompletionItem[] = TYPE_KEYWORD_LIST.map(kw => ({
  label:      kw,
  kind:       CompletionKind.Keyword,
  detail:     'type keyword',
  sortText:   `0_${kw}`,
}));

const GLOBAL_ITEMS: readonly CompletionItem[] = [...ROBLOX_GLOBALS].sort().map(name => ({
  label:      name,
  kind:       CompletionKind.Global,
  detail:     '(global)',
  sortText:   `1_${name}`,
}));

const TYPE_ITEMS: readonly CompletionItem[] = [...ROBLOX_TYPES].sort().map(name => ({
  label:      name,
  kind:       CompletionKind.Type,
  detail:     '(Roblox type)',
  sortText:   `2_${name}`,
}));

// ---------------------------------------------------------------------------
// Built-in providers
// ---------------------------------------------------------------------------

/**
 * Provides Luau keywords (hard reserved + type soft-keywords).
 *
 * Suppression: if the cursor is inside a string or comment token, return [].
 */
export class KeywordProvider implements CompletionProvider {
  readonly id = 'builtin.keywords';

  provideCompletions(ctx: CompletionContext): CompletionItem[] {
    if (isCursorInStringOrComment(ctx)) return [];
    return [...KEYWORD_ITEMS, ...TYPE_KEYWORD_ITEMS];
  }
}

/**
 * Provides Roblox/Lua runtime globals (ROBLOX_GLOBALS).
 */
export class GlobalProvider implements CompletionProvider {
  readonly id = 'builtin.globals';

  provideCompletions(ctx: CompletionContext): CompletionItem[] {
    if (isCursorInStringOrComment(ctx)) return [];
    return [...GLOBAL_ITEMS];
  }
}

/**
 * Provides Roblox datatype constructor names (ROBLOX_TYPES).
 */
export class RobloxTypeProvider implements CompletionProvider {
  readonly id = 'builtin.robloxTypes';

  provideCompletions(ctx: CompletionContext): CompletionItem[] {
    if (isCursorInStringOrComment(ctx)) return [];
    return [...TYPE_ITEMS];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the cursor column sits inside a String, LongString,
 * InterpString, Comment, or LongComment token on the current line.
 *
 * Uses the pre-computed token array from the context — no re-lexing.
 */
function isCursorInStringOrComment(ctx: CompletionContext): boolean {
  const col = ctx.column;
  for (const tok of ctx.lineTokens) {
    if (tok.start <= col && col <= tok.start + tok.length) {
      switch (tok.class) {
        case TokenClass.String:
        case TokenClass.LongString:
        case TokenClass.InterpString:
        case TokenClass.Comment:
        case TokenClass.LongComment:
          return true;
        default:
          break;
      }
    }
  }
  return false;
}
