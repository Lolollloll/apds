/**
 * APDS Tokenizer — Roblox Global Name Table
 *
 * Curated, versioned set of identifiers that are globally available in the
 * Roblox Luau runtime environment.  Recognition is LEXICAL ONLY — no scope
 * analysis, no type inference, no API resolution.
 *
 * Shadowing: if user code writes `local game = 5`, `game` will still be
 * highlighted as RobloxGlobal everywhere on that line and subsequent lines.
 * This is an intentional, documented limitation of lexical highlighting.
 *
 * Member-access guard: identifiers immediately preceded by `.` or `:` (on the
 * same line) are classified as Identifier regardless of this table.  The guard
 * is enforced in lexer.ts and prevents mis-highlighting method/field names.
 *
 * Update policy: add entries here when Roblox ships new top-level globals.
 * Never remove entries (removal breaks existing highlighting of older code).
 * This table is shared with the future V3 autocomplete seed dataset.
 */

const GLOBALS: ReadonlyArray<string> = [
  // ── Roblox top-level singletons ──────────────────────────────────────────
  'game',
  'workspace',
  'script',
  'shared',
  'plugin',         // available only in Plugin context; lexer highlights everywhere

  // ── Roblox task library (replaces deprecated spawn/delay/wait) ───────────
  'task',

  // ── Roblox-specific globals ───────────────────────────────────────────────
  'Enum',           // Enum.Material, Enum.KeyCode, etc.

  // ── Standard Luau / Lua 5.1 base library (always available in Roblox) ───
  'print',
  'warn',
  'error',
  'assert',
  'pcall',
  'xpcall',
  'pairs',
  'ipairs',
  'next',
  'select',
  'rawget',
  'rawset',
  'rawequal',
  'rawlen',
  'setmetatable',
  'getmetatable',
  'tostring',
  'tonumber',
  'require',
  'collectgarbage',
  'dofile',
  'load',
  'loadstring',
  'unpack',
  'type',           // Lua type() function (separate from the 'type' soft-keyword)

  // ── Standard libraries ────────────────────────────────────────────────────
  'coroutine',
  'table',
  'string',
  'math',
  'os',
  'io',
  'utf8',
  'bit32',          // Roblox bit32 library

  // ── Legacy Roblox globals (deprecated but widely present in existing code) ─
  'wait',           // deprecated — use task.wait
  'delay',          // deprecated — use task.delay
  'spawn',          // deprecated — use task.spawn
  'tick',           // deprecated — use os.clock / os.time
  'time',           // deprecated — use workspace:GetServerTimeNow

  // ── Lua special globals ───────────────────────────────────────────────────
  '_G',
  '_VERSION',
  '_ENV',
];

export const ROBLOX_GLOBALS: ReadonlySet<string> = new Set(GLOBALS);
