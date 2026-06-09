/**
 * APDS Tokenizer — State Interning (StateId)
 *
 * Phase 1 (tokenizerState.ts) promised "Phase 2 will add integer interning
 * behind the same interface." This module fulfils that promise.
 *
 * A StateId is a small non-negative integer that uniquely identifies one
 * TokenizerState value. Two StateIds are === iff the underlying states are
 * statesEqual(). This lets the engine compare cross-line states with a single
 * integer comparison (LOCK-5 early-stop) instead of structural walks, and
 * lets LineTokens store compact integer state references.
 *
 * INVALID_STATE_ID is a reserved sentinel that is NOT a real interned state.
 * It marks line-state slots that have been inserted or invalidated and whose
 * correct value has not yet been recomputed (LOCK-5: "Inserted line-state
 * slots start INVALID"). It never compares equal to any real interned id.
 *
 * DEFAULT_STATE is always interned to id 0 by construction.
 */
import {
  DEFAULT_STATE, makeLongStringState, makeLongCommentState,
  makeStringContinuedState, type TokenizerState,
} from './tokenizerState';

export type StateId = number;

/** Sentinel: a slot that needs (re)computation. Never a real state. */
export const INVALID_STATE_ID: StateId = -1;

function stateKey(s: TokenizerState): string {
  switch (s.kind) {
    case 'Default':         return 'D';
    case 'LongString':      return 'LS:' + s.level;
    case 'LongComment':     return 'LC:' + s.level;
    case 'StringContinued': return 'SC:' + s.quote;
  }
}

/**
 * Bidirectional StateId <-> TokenizerState map.
 * intern()  — state  -> id   (assigns a fresh id on first sight)
 * resolve() — id     -> state (throws on INVALID / unknown ids)
 * Ids are assigned densely from 0. DEFAULT_STATE is pre-interned to 0.
 */
export class StateInterner {
  private readonly idToState: TokenizerState[] = [];
  private readonly keyToId = new Map<string, StateId>();

  constructor() { this.intern(DEFAULT_STATE); }

  get defaultId(): StateId { return 0; }

  intern(state: TokenizerState): StateId {
    const key = stateKey(state);
    const existing = this.keyToId.get(key);
    if (existing !== undefined) return existing;
    const id = this.idToState.length;
    this.idToState.push(state);
    this.keyToId.set(key, id);
    return id;
  }

  resolve(id: StateId): TokenizerState {
    if (id === INVALID_STATE_ID) throw new Error('StateInterner.resolve: INVALID_STATE_ID is not a real state');
    const s = this.idToState[id];
    if (s === undefined) throw new Error(`StateInterner.resolve: unknown StateId ${id}`);
    return s;
  }

  get size(): number { return this.idToState.length; }
}

export { DEFAULT_STATE, makeLongStringState, makeLongCommentState, makeStringContinuedState };
