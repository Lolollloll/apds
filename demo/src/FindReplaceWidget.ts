/**
 * APDS Demo — Find and Replace Widget
 *
 * DOM widget rendered absolutely over the editor canvas.
 * Communicates exclusively with FindReplaceEngine — never touches
 * Document, Renderer, or RenderCache directly.
 */

import type { FindReplaceEngine, FindReplaceState, FindMode } from './FindReplace.js';

export class FindReplaceWidget {
  private readonly _engine:    FindReplaceEngine;
  private readonly _container: HTMLDivElement;
  private _unsub:              () => void;

  // Input elements
  private _queryInput:        HTMLInputElement;
  private _replaceInput:      HTMLInputElement;
  private _matchCount:        HTMLSpanElement;
  private _replaceRow:        HTMLDivElement;
  private _caseSensBtn:       HTMLButtonElement;
  private _regexBtn:          HTMLButtonElement;
  private _wordBtn:           HTMLButtonElement;

  constructor(mountPoint: HTMLElement, engine: FindReplaceEngine) {
    this._engine = engine;

    // Build DOM
    this._container = document.createElement('div');
    this._container.className = 'apds-find-widget';
    this._container.setAttribute('role', 'search');
    this._container.style.display = 'none';

    // ── Find row ──────────────────────────────────────────────────────────
    const findRow = document.createElement('div');
    findRow.className = 'apds-find-row';

    this._queryInput = document.createElement('input');
    this._queryInput.type = 'text';
    this._queryInput.className = 'apds-find-input';
    this._queryInput.placeholder = 'Find';
    this._queryInput.setAttribute('aria-label', 'Find');
    this._queryInput.spellcheck = false;
    this._queryInput.autocomplete = 'off';

    this._matchCount = document.createElement('span');
    this._matchCount.className = 'apds-find-count';
    this._matchCount.textContent = '';

    // Option toggle buttons
    this._caseSensBtn = this._makeOptionBtn('Aa', 'Match case');
    this._regexBtn    = this._makeOptionBtn('.*', 'Use regular expression');
    this._wordBtn     = this._makeOptionBtn('W',  'Match whole word');

    const prevBtn = this._makeActionBtn('↑', 'Previous match', () => engine.findPrev());
    const nextBtn = this._makeActionBtn('↓', 'Next match',     () => engine.findNext());
    const closeBtn = this._makeActionBtn('✕', 'Close',          () => engine.close());
    closeBtn.className += ' apds-find-close';

    findRow.appendChild(this._queryInput);
    findRow.appendChild(this._matchCount);
    findRow.appendChild(this._caseSensBtn);
    findRow.appendChild(this._regexBtn);
    findRow.appendChild(this._wordBtn);
    findRow.appendChild(prevBtn);
    findRow.appendChild(nextBtn);
    findRow.appendChild(closeBtn);

    // ── Replace row ───────────────────────────────────────────────────────
    this._replaceRow = document.createElement('div');
    this._replaceRow.className = 'apds-find-row apds-replace-row';
    this._replaceRow.style.display = 'none';

    this._replaceInput = document.createElement('input');
    this._replaceInput.type = 'text';
    this._replaceInput.className = 'apds-find-input';
    this._replaceInput.placeholder = 'Replace';
    this._replaceInput.setAttribute('aria-label', 'Replace');
    this._replaceInput.spellcheck = false;
    this._replaceInput.autocomplete = 'off';

    const replaceOneBtn = this._makeActionBtn('Replace', 'Replace current', () => engine.replace());
    const replaceAllBtn = this._makeActionBtn('Replace All', 'Replace all',  () => engine.replaceAll());
    replaceOneBtn.className += ' apds-find-replace-btn';
    replaceAllBtn.className += ' apds-find-replace-btn';

    this._replaceRow.appendChild(this._replaceInput);
    this._replaceRow.appendChild(replaceOneBtn);
    this._replaceRow.appendChild(replaceAllBtn);

    this._container.appendChild(findRow);
    this._container.appendChild(this._replaceRow);
    mountPoint.appendChild(this._container);

    // ── Event wiring ──────────────────────────────────────────────────────
    this._queryInput.addEventListener('input', () => {
      engine.setQuery(this._queryInput.value);
    });

    this._queryInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) engine.findPrev();
        else            engine.findNext();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        engine.close();
      }
    });

    this._replaceInput.addEventListener('input', () => {
      engine.setReplacement(this._replaceInput.value);
    });

    this._replaceInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        engine.close();
      }
    });

    this._caseSensBtn.addEventListener('click', () => {
      engine.setOptions({ caseSensitive: !engine.state.options.caseSensitive });
    });

    this._regexBtn.addEventListener('click', () => {
      engine.setOptions({ useRegex: !engine.state.options.useRegex });
    });

    this._wordBtn.addEventListener('click', () => {
      engine.setOptions({ wholeWord: !engine.state.options.wholeWord });
    });

    // ── Subscribe to engine state ─────────────────────────────────────────
    this._unsub = engine.onDidChangeState(state => this._sync(state));

    // Prevent editor events from propagating through the widget
    this._container.addEventListener('mousedown', e => e.stopPropagation());
    this._container.addEventListener('keydown',   e => e.stopPropagation());
  }

  dispose(): void {
    this._unsub();
    this._container.remove();
  }

  /** Focus the query input (called when Ctrl+F opens the widget). */
  focus(): void {
    this._queryInput.focus();
    this._queryInput.select();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private _sync(state: FindReplaceState): void {
    this._container.style.display = state.isOpen ? 'block' : 'none';

    if (!state.isOpen) return;

    // Replace row visibility
    this._replaceRow.style.display = state.mode === 'replace' ? 'flex' : 'none';

    // Query input (don't overwrite if user is typing)
    if (this._queryInput.value !== state.query) {
      this._queryInput.value = state.query;
    }

    // Match count
    if (state.query.length === 0) {
      this._matchCount.textContent = '';
    } else if (state.matchCount === 0) {
      this._matchCount.textContent = 'No results';
      this._matchCount.classList.add('no-results');
    } else {
      const cur = state.currentMatch >= 0 ? state.currentMatch + 1 : '?';
      this._matchCount.textContent = `${cur} of ${state.matchCount}`;
      this._matchCount.classList.remove('no-results');
    }

    // Option button states
    this._toggleActive(this._caseSensBtn, state.options.caseSensitive);
    this._toggleActive(this._regexBtn,    state.options.useRegex);
    this._toggleActive(this._wordBtn,     state.options.wholeWord);
  }

  private _toggleActive(btn: HTMLButtonElement, active: boolean): void {
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }

  private _makeOptionBtn(text: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'apds-find-opt-btn';
    btn.textContent = text;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    btn.type = 'button';
    return btn;
  }

  private _makeActionBtn(text: string, label: string, action: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'apds-find-btn';
    btn.textContent = text;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.type = 'button';
    btn.addEventListener('click', action);
    return btn;
  }
}
