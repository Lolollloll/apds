/**
 * APDS Demo — Autocomplete Popup
 *
 * Architecture: presentation only. No mutation of CompletionSession.
 */

import type { CompletionSession } from '../../src/autocomplete/CompletionSession.js';
import type { CompletionItem }    from '../../src/autocomplete/CompletionItem.js';
import { CompletionKind }         from '../../src/autocomplete/CompletionItem.js';

const MAX_VISIBLE = 10;

// ── Kind configuration ─────────────────────────────────────────────────────

interface KindConfig {
  icon:  string;
  color: string;
  label: string;
}

const KIND_CONFIG: Record<CompletionKind, KindConfig> = {
  [CompletionKind.Keyword]:  { icon: 'k',  color: '#569cd6', label: 'keyword'  },
  [CompletionKind.Global]:   { icon: 'g',  color: '#dcdcaa', label: 'global'   },
  [CompletionKind.Type]:     { icon: 'T',  color: '#4ec9b0', label: 'type'     },
  [CompletionKind.Function]: { icon: 'fn', color: '#dcdcaa', label: 'function' },
  [CompletionKind.Variable]: { icon: 'v',  color: '#9cdcfe', label: 'variable' },
  [CompletionKind.Property]: { icon: 'p',  color: '#9cdcfe', label: 'property' },
  [CompletionKind.Snippet]:  { icon: '⋯',  color: '#c586c0', label: 'snippet'  },
};

function getKindConfig(kind: CompletionKind): KindConfig {
  return KIND_CONFIG[kind] ?? { icon: '·', color: '#858585', label: 'item' };
}

// ── Prefix highlighting ────────────────────────────────────────────────────

/**
 * Build a DOM fragment for the label with the prefix portion highlighted.
 * The match is case-insensitive and covers the leading characters.
 */
function buildLabelNode(label: string, prefix: string): HTMLSpanElement {
  const outer = document.createElement('span');
  outer.className = 'apds-ac-label';

  if (prefix.length === 0 || !label.toLowerCase().startsWith(prefix.toLowerCase())) {
    outer.textContent = label;
    return outer;
  }

  // Bold the matching prefix
  const matchSpan = document.createElement('span');
  matchSpan.className = 'apds-ac-label-match';
  matchSpan.textContent = label.slice(0, prefix.length);

  const restSpan = document.createElement('span');
  restSpan.textContent = label.slice(prefix.length);

  outer.appendChild(matchSpan);
  outer.appendChild(restSpan);
  return outer;
}

// ── AutocompletePopup ──────────────────────────────────────────────────────

export class AutocompletePopup {
  private readonly _el:         HTMLDivElement;
  private readonly _list:       HTMLUListElement;
  private readonly _docPanel:   HTMLDivElement;
  private _session:             CompletionSession | null = null;
  private _scrollOffset:        number = 0;

  constructor(mountPoint: HTMLElement) {
    this._el = document.createElement('div');
    this._el.className = 'apds-ac-popup';
    this._el.setAttribute('role', 'listbox');
    this._el.setAttribute('aria-label', 'Completions');

    this._list = document.createElement('ul');
    this._el.appendChild(this._list);

    // Documentation panel (placeholder — shown for items with .detail)
    this._docPanel = document.createElement('div');
    this._docPanel.className = 'apds-ac-doc-panel';
    this._el.appendChild(this._docPanel);

    mountPoint.appendChild(this._el);
    this.hide();
  }

  // ── Public API ───────────────────────────────────────────────────────

  update(session: CompletionSession | null, left: number, top: number): void {
    this._session = session;
    if (!session || !session.isActive || !session.hasItems) {
      this.hide();
      return;
    }
    this._render(session, left, top);
    this._el.style.display = 'block';
  }

  hide(): void {
    this._el.style.display = 'none';
    this._session = null;
  }

  get isVisible(): boolean {
    return this._el.style.display !== 'none';
  }

  dispose(): void {
    this._el.remove();
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private _render(session: CompletionSession, left: number, top: number): void {
    const items     = session.filteredItems;
    const activeIdx = session.activeIndex;
    const prefix    = (session as unknown as { prefix?: string }).prefix ?? '';

    // Ensure active item is in scroll window
    if (activeIdx < this._scrollOffset) {
      this._scrollOffset = activeIdx;
    } else if (activeIdx >= this._scrollOffset + MAX_VISIBLE) {
      this._scrollOffset = activeIdx - MAX_VISIBLE + 1;
    }
    this._scrollOffset = Math.max(0, Math.min(
      this._scrollOffset,
      Math.max(0, items.length - MAX_VISIBLE),
    ));

    this._list.innerHTML = '';

    const end = Math.min(this._scrollOffset + MAX_VISIBLE, items.length);
    for (let i = this._scrollOffset; i < end; i++) {
      const item     = items[i]!;
      const isActive = i === activeIdx;
      this._list.appendChild(this._makeRow(item, isActive, prefix));
    }

    // Scroll indicator
    const existingIndicator = this._el.querySelector('.apds-ac-scroll-hint');
    if (existingIndicator) existingIndicator.remove();

    if (items.length > MAX_VISIBLE) {
      const hint = document.createElement('div');
      hint.className = 'apds-ac-scroll-hint';
      const shown = end - this._scrollOffset;
      hint.textContent = `${shown} of ${items.length}`;
      this._el.insertBefore(hint, this._docPanel);
    }

    // Documentation panel for active item
    const activeItem = items[activeIdx];
    if (activeItem?.detail) {
      this._docPanel.style.display = 'block';
      this._docPanel.textContent = activeItem.detail;
    } else {
      this._docPanel.style.display = 'none';
    }

    // Position
    const itemHeight = 22;
    const scrollHintH = items.length > MAX_VISIBLE ? 18 : 0;
    const docPanelH = activeItem?.detail ? 36 : 0;
    const popupH = Math.min(items.length, MAX_VISIBLE) * itemHeight + 4
      + scrollHintH + docPanelH;

    const winH      = window.innerHeight;
    const parent    = this._el.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { top: 0 };

    const absTop = parentRect.top + top;
    const flipUp = absTop + popupH + 4 > winH - 20;

    this._el.style.left = `${Math.max(0, left)}px`;
    if (flipUp) {
      this._el.style.top    = '';
      this._el.style.bottom = `${(parent?.offsetHeight ?? 0) - top}px`;
    } else {
      this._el.style.bottom = '';
      this._el.style.top    = `${top + 2}px`;
    }
  }

  private _makeRow(
    item:     CompletionItem,
    active:   boolean,
    prefix:   string,
  ): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'apds-ac-item' + (active ? ' active' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(active));

    const cfg = getKindConfig(item.kind);

    // Kind badge — colored pill
    const badge = document.createElement('span');
    badge.className = 'apds-ac-badge';
    badge.textContent = cfg.icon;
    badge.style.color = cfg.color;
    badge.title = cfg.label;
    li.appendChild(badge);

    // Label with prefix highlighting
    li.appendChild(buildLabelNode(item.label, prefix));

    // Type / detail annotation
    if (item.detail) {
      const detail = document.createElement('span');
      detail.className = 'apds-ac-detail';
      detail.textContent = item.detail;
      li.appendChild(detail);
    }

    return li;
  }
}
