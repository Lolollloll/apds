/**
 * APDS Tokenizer — Roblox Datatype / Class Name Table
 *
 * Curated set of Roblox datatype constructor names and commonly used class
 * names that appear as identifier-style tokens in Luau source code.
 *
 * Recognition is LEXICAL ONLY (name-table lookup + member-access guard).
 * This table does NOT perform:
 *   - Type checking
 *   - Member validation
 *   - Scope resolution
 *   - API correctness checks
 *
 * Member-access guard: `foo.Vector3` will NOT classify `Vector3` as
 * RobloxType; only standalone occurrences (not preceded by `.` or `:`) are
 * upgraded.  The guard is enforced in lexer.ts.
 *
 * Update policy: add entries as Roblox ships new datatype constructors.
 * This table is shared with the future V3 autocomplete / diagnostics seed.
 */

const TYPES: ReadonlyArray<string> = [
  // ── Core geometry ─────────────────────────────────────────────────────────
  'Vector2',
  'Vector2int16',
  'Vector3',
  'Vector3int16',
  'CFrame',

  // ── UI layout ─────────────────────────────────────────────────────────────
  'UDim',
  'UDim2',

  // ── Colour ────────────────────────────────────────────────────────────────
  'Color3',
  'BrickColor',
  'ColorSequence',
  'ColorSequenceKeypoint',

  // ── Animation / tween ─────────────────────────────────────────────────────
  'NumberSequence',
  'NumberSequenceKeypoint',
  'NumberRange',
  'TweenInfo',
  'FloatCurveKey',
  'RotationCurveKey',

  // ── Spatial / physics ─────────────────────────────────────────────────────
  'Ray',
  'RaycastParams',
  'RaycastResult',
  'OverlapParams',
  'Region3',
  'Region3int16',
  'Rect',
  'PhysicalProperties',

  // ── Misc ──────────────────────────────────────────────────────────────────
  'Axes',
  'Faces',
  'Random',
  'PathWaypoint',
  'CatalogSearchParams',

  // ── Base class (used as constructor and type guard) ───────────────────────
  'Instance',
];

export const ROBLOX_TYPES: ReadonlySet<string> = new Set(TYPES);
