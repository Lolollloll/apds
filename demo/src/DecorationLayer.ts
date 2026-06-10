/**
 * APDS Demo — Decoration Layer
 *
 * A renderer-side-only system for overlaying colored ranges on top of
 * the canvas without touching any core APDS data structures.
 *
 * ARCHITECTURAL GUARANTEE:
 *   Decorations NEVER enter:
 *     - TokenizerEngine   (no lex() calls)
 *     - LineContent       (no span modifications)
 *     - RenderCache       (no cache keys or invalidations)
 *     - Document          (no text mutations)
 *
 *   They are consumed exclusively by CanvasRenderer.draw().
 *
 * Use cases:
 *   - Search result highlights (Feature D)
 *   - Bracket match highlights (Feature A)
 *   - Future: diagnostic squiggles, semantic overlays
 *
 * Design:
 *   - DecorationRange: a single colored column range on a single line.
 *   - DecorationLayer: a named, versioned set of ranges indexed by line.
 *     Multiple named layers coexist (e.g. "find", "bracket").
 *   - DecorationStore: owns all layers; CanvasRenderer receives the merged
 *     view via getForLine().
 *
 * All operations are synchronous and O(decorations on line).
 */

// ─────────────────────────────────────────────────────────────────────────────
// DecorationRange
// ─────────────────────────────────────────────────────────────────────────────

/** A single colored highlight range on a document line. */
export interface DecorationRange {
  readonly startColumn: number;   // inclusive
  readonly endColumn:   number;   // exclusive
  readonly color:       string;   // CSS color string
  readonly inset:       boolean;  // if true, draw with 2px vertical inset
  /** if true, render as a wavy underline (squiggle) instead of a fill rect. */
  readonly squiggle?:   boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DecorationSet — one named layer
// ─────────────────────────────────────────────────────────────────────────────

/** A keyed set of decoration ranges, indexed by line number. */
export class DecorationSet {
  readonly name:    string;
  private _ranges:  Map<number, DecorationRange[]> = new Map();
  private _version: number = 0;

  constructor(name: string) {
    this.name = name;
  }

  get version(): number { return this._version; }

  /** Replace all decorations in this set with the provided map. */
  setRanges(ranges: ReadonlyMap<number, DecorationRange[]>): void {
    this._ranges = new Map(ranges);
    this._version++;
  }

  /** Set decorations for exactly one line (replaces previous for that line). */
  setLine(lineIndex: number, ranges: DecorationRange[]): void {
    if (ranges.length === 0) {
      this._ranges.delete(lineIndex);
    } else {
      this._ranges.set(lineIndex, ranges);
    }
    this._version++;
  }

  /** Clear all decorations in this set. */
  clear(): void {
    if (this._ranges.size === 0) return;
    this._ranges.clear();
    this._version++;
  }

  /** Get all decoration ranges for a given line. Returns empty array if none. */
  getRanges(lineIndex: number): DecorationRange[] {
    return this._ranges.get(lineIndex) ?? [];
  }

  /** True if this set has any decorations at all. */
  get isEmpty(): boolean { return this._ranges.size === 0; }

  /**
   * Iterate all line indices that have decorations in this set.
   * Used by EditorHost to build minimap search marker line sets.
   * Zero-cost when set is empty (Map.keys() returns empty iterator).
   */
  lineIndices(): IterableIterator<number> {
    return this._ranges.keys();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DecorationLayer — merged view consumed by CanvasRenderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read-only view of merged decoration ranges across all registered sets.
 * Passed to CanvasRenderer.draw() each frame.
 */
export class DecorationLayer {
  private readonly _sets: DecorationSet[];

  constructor(sets: DecorationSet[]) {
    this._sets = sets;
  }

  /**
   * Get all decoration ranges for a given line across all sets.
   * Ranges from different sets are concatenated (painters' order: first set
   * is drawn first, last set is drawn on top).
   */
  getForLine(lineIndex: number): DecorationRange[] {
    const out: DecorationRange[] = [];
    for (const set of this._sets) {
      const ranges = set.getRanges(lineIndex);
      if (ranges.length > 0) {
        for (const r of ranges) out.push(r);
      }
    }
    return out;
  }

  /** True if all sets are empty (fast-path skip in CanvasRenderer). */
  get isEmpty(): boolean {
    return this._sets.every(s => s.isEmpty);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DecorationStore — owns and manages all named layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Central store for all decoration sets in the editor.
 * EditorHost owns one DecorationStore and passes DecorationLayer to CanvasRenderer.
 */
export class DecorationStore {
  private readonly _sets: Map<string, DecorationSet> = new Map();

  /** Get or create a named DecorationSet. */
  getOrCreate(name: string): DecorationSet {
    let set = this._sets.get(name);
    if (!set) {
      set = new DecorationSet(name);
      this._sets.set(name, set);
    }
    return set;
  }

  /** Get a named DecorationSet. Returns undefined if it doesn't exist. */
  get(name: string): DecorationSet | undefined {
    return this._sets.get(name);
  }

  /**
   * Build a merged DecorationLayer for all registered sets.
   * Call once per frame before passing to CanvasRenderer.draw().
   * Pass `names` to restrict to specific layers (order matters for z-order).
   */
  buildLayer(names?: string[]): DecorationLayer {
    const sets: DecorationSet[] = [];
    if (names) {
      for (const n of names) {
        const s = this._sets.get(n);
        if (s) sets.push(s);
      }
    } else {
      for (const s of this._sets.values()) sets.push(s);
    }
    return new DecorationLayer(sets);
  }

  /** Clear all decorations across all sets. */
  clearAll(): void {
    for (const s of this._sets.values()) s.clear();
  }
}
