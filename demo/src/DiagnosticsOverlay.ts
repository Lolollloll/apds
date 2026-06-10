/**
 * APDS Demo — Performance Diagnostics Overlay
 *
 * An optional developer overlay toggled by Ctrl+Shift+P.
 *
 * Design goals:
 *   - Near-zero overhead when hidden (single boolean check in draw path).
 *   - Stateless DOM: the overlay is a single <div> injected into the
 *     mount point; no canvas operations when hidden.
 *   - All metrics are provided by the caller (EditorHost._draw()) — the
 *     overlay never reaches into the engine directly.
 *
 * Displayed metrics:
 *   Visible lines   — lines currently in the rendered viewport
 *   Total lines     — total document line count
 *   Render time     — last _draw() wall-clock duration (ms)
 *   Draw calls      — canvas fillRect/fillText call estimate for last frame
 *   Cache hit rate  — RenderCache hits vs total line renders (rolling)
 *   Frame timing    — rolling average of the last 60 frame durations
 *
 * Architecture:
 *   - No dependencies on APDS internals — pure data receiver.
 *   - update() is called once per frame when visible; no-ops when hidden.
 *   - Rolling stats (cache hit rate, frame timing) use a small ring buffer
 *     maintained entirely inside this class.
 */

export interface DiagnosticsStats {
  /** Lines included in the last render() call (after overscan + clamping). */
  readonly visibleLines:  number;
  /** Total document line count. */
  readonly totalLines:    number;
  /** Wall-clock time of the last full _draw() call in milliseconds. */
  readonly renderTimeMs:  number;
  /** Estimated canvas draw calls (fillRect + fillText) for the last frame. */
  readonly drawCalls:     number;
  /** Number of cache hits in the last render() call. */
  readonly cacheHits:     number;
  /** Number of cache misses (line rebuilds) in the last render() call. */
  readonly cacheMisses:   number;
  /** Error-severity diagnostic count (unmatched brackets, etc.). */
  readonly errorCount?:   number;
  /** Warning-severity diagnostic count (unused locals, etc.). */
  readonly warningCount?: number;
  /** Info-severity diagnostic count (TODO/FIXME markers, etc.). */
  readonly infoCount?:    number;
}

// ── Ring buffer for rolling averages ─────────────────────────────────────────

class RingBuffer {
  private _buf:  Float64Array;
  private _pos:  number = 0;
  private _full: boolean = false;

  constructor(private readonly _cap: number) {
    this._buf = new Float64Array(_cap);
  }

  push(value: number): void {
    this._buf[this._pos] = value;
    this._pos = (this._pos + 1) % this._cap;
    if (this._pos === 0) this._full = true;
  }

  average(): number {
    const count = this._full ? this._cap : this._pos;
    if (count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this._buf[i] ?? 0;
    return sum / count;
  }

  /** Count of valid entries. */
  get size(): number { return this._full ? this._cap : this._pos; }
}

// ── DiagnosticsOverlay ────────────────────────────────────────────────────────

export class DiagnosticsOverlay {
  private readonly _el:         HTMLDivElement;
  private _visible:             boolean = false;

  // Rolling stats
  private readonly _frameRing:  RingBuffer = new RingBuffer(60);
  private readonly _hitRing:    RingBuffer = new RingBuffer(60);  // hit/(hit+miss) ratio

  constructor(mountPoint: HTMLElement) {
    this._el = document.createElement('div');
    this._el.className = 'apds-diag-overlay';
    this._el.style.display = 'none';
    mountPoint.appendChild(this._el);
  }

  get isVisible(): boolean { return this._visible; }

  /** Toggle the overlay on/off. Returns new visibility state. */
  toggle(): boolean {
    this._visible = !this._visible;
    this._el.style.display = this._visible ? 'block' : 'none';
    return this._visible;
  }

  /** Show the overlay. */
  show(): void {
    this._visible = true;
    this._el.style.display = 'block';
  }

  /** Hide the overlay. */
  hide(): void {
    this._visible = false;
    this._el.style.display = 'none';
  }

  /**
   * Update displayed metrics.
   *
   * No-op when hidden (caller should gate on isVisible for zero overhead).
   * Updating rolling stats even when hidden is intentional — it keeps averages
   * from appearing "stale" on first show.
   */
  update(stats: DiagnosticsStats): void {
    // Always update rolling ring buffers (cheap)
    this._frameRing.push(stats.renderTimeMs);
    const total = stats.cacheHits + stats.cacheMisses;
    if (total > 0) {
      this._hitRing.push(stats.cacheHits / total);
    }

    // Only update DOM when visible
    if (!this._visible) return;

    const avgFrame = this._frameRing.average();
    const hitRate  = this._hitRing.size > 0 ? this._hitRing.average() * 100 : 100;

    // Code diagnostic counts (only shown when provided)
    const hasCodeDiag = stats.errorCount !== undefined
      || stats.warningCount !== undefined
      || stats.infoCount    !== undefined;

    const errorRow   = hasCodeDiag
      ? `<div class="apds-diag-row apds-diag-error"><span class="apds-diag-key">&#x2715; Errors</span><span class="apds-diag-val">${stats.errorCount ?? 0}</span></div>`
      : '';
    const warnRow    = hasCodeDiag
      ? `<div class="apds-diag-row apds-diag-warn"><span class="apds-diag-key">&#x26A0; Warnings</span><span class="apds-diag-val">${stats.warningCount ?? 0}</span></div>`
      : '';
    const infoRow    = hasCodeDiag
      ? `<div class="apds-diag-row apds-diag-info"><span class="apds-diag-key">&#x2139; Info</span><span class="apds-diag-val">${stats.infoCount ?? 0}</span></div>`
      : '';
    const divider    = hasCodeDiag
      ? `<div class="apds-diag-sep"></div>`
      : '';

    this._el.innerHTML = [
      `<div class="apds-diag-title">APDS Diagnostics</div>`,
      errorRow,
      warnRow,
      infoRow,
      divider,
      `<div class="apds-diag-row"><span class="apds-diag-key">Visible lines</span><span class="apds-diag-val">${stats.visibleLines}</span></div>`,
      `<div class="apds-diag-row"><span class="apds-diag-key">Total lines</span><span class="apds-diag-val">${stats.totalLines.toLocaleString()}</span></div>`,
      `<div class="apds-diag-row"><span class="apds-diag-key">Render time</span><span class="apds-diag-val">${stats.renderTimeMs.toFixed(2)} ms</span></div>`,
      `<div class="apds-diag-row"><span class="apds-diag-key">Draw calls</span><span class="apds-diag-val">${stats.drawCalls.toLocaleString()}</span></div>`,
      `<div class="apds-diag-row"><span class="apds-diag-key">Cache hit rate</span><span class="apds-diag-val">${hitRate.toFixed(1)}%</span></div>`,
      `<div class="apds-diag-row"><span class="apds-diag-key">Avg frame</span><span class="apds-diag-val">${avgFrame.toFixed(2)} ms</span></div>`,
      `<div class="apds-diag-hint">Ctrl+Shift+P to hide</div>`,
    ].join('');
  }

  dispose(): void {
    this._el.remove();
  }
}
