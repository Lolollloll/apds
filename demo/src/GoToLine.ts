/**
 * APDS Demo — Go To Line
 *
 * Lightweight popup triggered by Ctrl+G that jumps the cursor to a
 * user-specified line and centers the viewport on it.
 *
 * Architecture:
 *   - Self-contained DOM widget created on demand and destroyed on close.
 *   - Communicates with EditorHost via a simple callback: onJump(lineIndex).
 *   - Does NOT touch the Document or Renderer directly.
 *   - The onJump callback in EditorHost performs the cursor move and scroll.
 */

export class GoToLineWidget {
  private readonly _overlay:   HTMLDivElement;
  private readonly _input:     HTMLInputElement;
  private readonly _label:     HTMLSpanElement;
  private readonly _lineCount: number;
  private readonly _onJump:    (lineIndex: number) => void;
  private readonly _onClose:   () => void;

  constructor(
    mountPoint: HTMLElement,
    lineCount:  number,
    currentLine: number,
    onJump:     (lineIndex: number) => void,
    onClose:    () => void,
  ) {
    this._lineCount = lineCount;
    this._onJump    = onJump;
    this._onClose   = onClose;

    // Build overlay
    this._overlay = document.createElement('div');
    this._overlay.className = 'apds-gotoline-overlay';

    const box = document.createElement('div');
    box.className = 'apds-gotoline-box';

    this._label = document.createElement('span');
    this._label.className = 'apds-gotoline-label';
    this._label.textContent = `Go to line (1 – ${lineCount}):`;

    this._input = document.createElement('input');
    this._input.type = 'text';
    this._input.className = 'apds-gotoline-input';
    this._input.value = String(currentLine + 1);
    this._input.setAttribute('aria-label', 'Go to line number');
    this._input.autocomplete = 'off';
    this._input.spellcheck   = false;
    this._input.inputMode    = 'numeric';

    box.appendChild(this._label);
    box.appendChild(this._input);
    this._overlay.appendChild(box);
    mountPoint.appendChild(this._overlay);

    // Wire events
    this._input.addEventListener('keydown', e => this._onKey(e));
    this._input.addEventListener('input',   () => this._validate());
    this._overlay.addEventListener('mousedown', e => {
      if (e.target === this._overlay) this._close();
    });

    // Select all text and focus
    requestAnimationFrame(() => {
      this._input.select();
      this._input.focus();
    });
  }

  dispose(): void {
    this._overlay.remove();
  }

  private _onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      this._commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._close();
    }
  }

  private _validate(): void {
    const n = parseInt(this._input.value, 10);
    const valid = !isNaN(n) && n >= 1 && n <= this._lineCount;
    this._input.classList.toggle('invalid', !valid);
  }

  private _commit(): void {
    const n = parseInt(this._input.value, 10);
    if (isNaN(n) || n < 1 || n > this._lineCount) {
      this._input.classList.add('invalid');
      return;
    }
    this._onJump(n - 1); // convert 1-based UI to 0-based index
    this._close();
  }

  private _close(): void {
    this._onClose();
  }
}
