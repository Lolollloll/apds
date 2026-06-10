/**
 * APDS Demo — EditorHost
 *
 * The browser host that wires all APDS subsystems together.
 *
 * Owns:
 *   Document          — text + token engine
 *   Renderer          — line layout + cache (APDS render layer)
 *   EditorActions     — all named commands
 *   KeyboardHandler   — key → action dispatch
 *   MouseHandler      — pointer → cursor/selection
 *   CompletionService — autocomplete session management
 *
 * Feature additions (all additive, no existing systems replaced):
 *   G — Current line highlight: CanvasRenderer draws it; ThemeColorKey added.
 *   F — Indentation guides: CanvasRenderer draws from line.text whitespace.
 *   E — DecorationStore: owns "bracket" and "find"/"find-active" sets.
 *   A — BracketMatcher: updates on every cursor change.
 *   C — SmartIndent: insertNewline replaces bare \n with smart indent.
 *   H — AutocompletePopup: improved UI (prefix highlight, icons, doc panel).
 *   D — FindReplaceEngine + Widget: Ctrl+F / Ctrl+H triggers.
 *
 * Also owns the DOM:
 *   <div.apds-outer>        — scroll container (overflow:auto)
 *     <div.apds-sizer>      — sized to totalWidth × totalHeight (scrollbar)
 *     <canvas.apds-canvas>  — sticky 100% viewport, draws visible lines
 *     <textarea.apds-focus> — 1×1 hidden input, receives keyboard focus
 *   </div>
 *   <div.apds-ac-layer>     — autocomplete popup mount (absolute)
 *   <div.apds-find-layer>   — find/replace widget mount (absolute)
 *
 * Coordinate contract:
 *   EditorPointerEvent.x/y are relative to the canvas top-left.
 *   Gutter adjustment: subtract CODE_ORIGIN_X before passing x.
 *
 * Rendering loop:
 *   - Dirty flag + requestAnimationFrame coalescing.
 *   - Cursor blink fires independently via CanvasRenderer's setInterval.
 *   - Resize observed via ResizeObserver.
 */

import { Document }              from '../../src/editor/Document.js';
import { Renderer }              from '../../src/render/Renderer.js';
import { DARK_THEME, LIGHT_THEME } from '../../src/render/Theme.js';
import { Viewport }              from '../../src/render/Viewport.js';
import { EditorActions, MemoryClipboard, type ClipboardAdapter } from '../../src/input/EditorActions.js';
import { InputMap }              from '../../src/input/InputMap.js';
import { KeyboardHandler }       from '../../src/input/KeyboardHandler.js';
import { MouseHandler }          from '../../src/input/MouseHandler.js';
import { createDefaultService }  from '../../src/autocomplete/CompletionService.js';
import type { KeyEvent }         from '../../src/input/KeyEvent.js';
import type { Theme }            from '../../src/render/Theme.js';
import type { EditorPointerEvent } from '../../src/input/EditorPointerEvent.js';

import { CanvasRenderer, measureCharWidth, FONT_SIZE, CODE_ORIGIN_X, updateCodeOriginX, NORMAL_FONT } from './CanvasRenderer.js';
import { AutocompletePopup }     from './AutocompletePopup.js';
import { DecorationStore }       from './DecorationLayer.js';
import { BracketMatcher }        from './BracketMatcher.js';
import { computeSmartIndent }    from './SmartIndent.js';
import { FindReplaceEngine }     from './FindReplace.js';
import { FindReplaceWidget }     from './FindReplaceWidget.js';
import { handleAutoClose }       from './AutoClosePairs.js';
import { GoToLineWidget }        from './GoToLine.js';
import { Minimap }               from './Minimap.js';
import { DiagnosticsOverlay }    from './DiagnosticsOverlay.js';
import { DiagnosticEngine }      from './DiagnosticEngine.js';
// ── Constants ──────────────────────────────────────────────────────────────

const LINE_HEIGHT  = Math.round(FONT_SIZE * 1.6);   // 22px at 14px font
const OVERSCAN     = 3;
const CACHE_CAP    = 600;
const TAB_SIZE     = 4;   // 4-space tabs — matches Monaco/VS Code default

// Decoration layer names
const DEC_BRACKET      = 'bracket';
const DEC_FIND         = 'find';
const DEC_FIND_ACTIVE  = 'find-active';
const DEC_DIAGNOSTICS  = 'diagnostics';
// ── EditorHost ─────────────────────────────────────────────────────────────

export class EditorHost {
  // ─ APDS subsystems ───────────────────────────────────────────────────────
  private readonly _doc:         Document;
  private readonly _renderer:    Renderer;
  private readonly _actions:     EditorActions;
  private readonly _keyboard:    KeyboardHandler;
  private readonly _mouse:       MouseHandler;
  private readonly _completion:  ReturnType<typeof createDefaultService>;
  private readonly _clipboard:   MemoryClipboard;

  private readonly _decorations: DecorationStore;
  private readonly _bracketMatcher: BracketMatcher;
  private readonly _findEngine:  FindReplaceEngine;
  private readonly _findWidget:  FindReplaceWidget;

  private _goToLineWidget: GoToLineWidget | null = null;
  private _minimap:        Minimap | null = null;
  private _minimapCanvas:  HTMLCanvasElement | null = null;
  // Diagnostics overlay (Ctrl+Shift+P)
  private _diagnostics:    DiagnosticsOverlay | null = null;
  // last-frame metrics
  private _lastDrawCalls:  number = 0;
  private _lastCacheHits:  number = 0;
  private _lastCacheMisses: number = 0;
  // Code diagnostic engine
  private readonly _diagEngine: DiagnosticEngine = new DiagnosticEngine();

  // ─ DOM ───────────────────────────────────────────────────────────────────
  private readonly _outer:       HTMLDivElement;
  private readonly _sizer:       HTMLDivElement;
  private readonly _canvas:      HTMLCanvasElement;
  private readonly _textarea:    HTMLTextAreaElement;
  private readonly _acLayer:     HTMLDivElement;
  private readonly _findLayer:   HTMLDivElement;
  private readonly _popup:       AutocompletePopup;
  private readonly _canvasDraw:  CanvasRenderer;

  // ─ State ─────────────────────────────────────────────────────────────────
  private _charWidth:       number;
  private _vpWidth:         number = 0;
  private _vpHeight:        number = 0;
  private _dirty:           boolean = false;
  private _rafHandle:       number | null = null;
  private _hasFocus:        boolean = false;
  private _mouseDown:       boolean = false;
  private _theme:           Theme = DARK_THEME;
  private _themeName:       'dark' | 'light' = 'dark';
  private _resizeObs:       ResizeObserver;
  private _unsubContent:    () => void;
  private _unsubSelection:  () => void;
  private _unsubSession:    () => void;
  private _unsubFindState:  () => void;

  // ─ Status bar refs ────────────────────────────────────────────────────────
  private _statusPos:     HTMLElement | null;
  private _statusLines:   HTMLElement | null;
  private _statusVersion: HTMLElement | null;
  private _tabEl:         HTMLElement | null;

  constructor(mountPoint: HTMLElement, initialText = '') {
    // ── Measure font ────────────────────────────────────────────────────────
    this._charWidth = measureCharWidth();

    // ── Create APDS Document ─────────────────────────────────────────────
    this._doc = new Document(initialText);

    // ── Create APDS Renderer ────────────────────────────────────────────
    this._renderer = new Renderer(this._doc, DARK_THEME, {
      lineHeight:    LINE_HEIGHT,
      charWidth:     this._charWidth,
      overscanLines: OVERSCAN,
      cacheCapacity: CACHE_CAP,
    });

    // ── Input system ────────────────────────────────────────────────────
    this._clipboard = BrowserClipboard.isAvailable()
      ? new BrowserClipboard()
      : new MemoryClipboard();
    this._actions  = new EditorActions(this._doc, this._clipboard, TAB_SIZE);
    const inputMap = new InputMap('other');
    this._keyboard = new KeyboardHandler(this._actions, inputMap);
    this._mouse    = new MouseHandler(this._doc, () => this._currentViewport());

    // ── Autocomplete ─────────────────────────────────────────────────────
    this._completion = createDefaultService(this._doc);

    // ── Decoration store ──────────────────────────────────────────────────────
    this._decorations = new DecorationStore();
    this._decorations.getOrCreate(DEC_BRACKET);
    this._decorations.getOrCreate(DEC_FIND);
    this._decorations.getOrCreate(DEC_FIND_ACTIVE);
    // Diagnostic squiggles
    this._decorations.getOrCreate(DEC_DIAGNOSTICS);

    // ── Bracket matcher ───────────────────────────────────────────────────────
    this._bracketMatcher = new BracketMatcher(
      this._doc,
      this._decorations.getOrCreate(DEC_BRACKET),
    );

    // ── Build DOM ────────────────────────────────────────────────────────
    const outer = document.createElement('div');
    outer.className = 'apds-outer';
    this._outer = outer;

    const sizer = document.createElement('div');
    sizer.className = 'apds-sizer';
    this._sizer = sizer;

    const canvas = document.createElement('canvas');
    canvas.className = 'apds-canvas';
    this._canvas = canvas;

    const textarea = document.createElement('textarea');
    textarea.className = 'apds-focus';
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('spellcheck', 'false');
    textarea.setAttribute('tabindex', '0');
    this._textarea = textarea;

    outer.appendChild(sizer);
    outer.appendChild(canvas);
    outer.appendChild(textarea);
    mountPoint.appendChild(outer);

    // AC popup
    const acLayer = document.createElement('div');
    acLayer.className = 'apds-ac-layer';
    outer.appendChild(acLayer);
    this._acLayer = acLayer;
    this._popup   = new AutocompletePopup(acLayer);

    // Find/Replace widget layer
    const findLayer = document.createElement('div');
    findLayer.className = 'apds-find-layer';
    outer.appendChild(findLayer);
    this._findLayer = findLayer;

    // ── Find engine + widget ─────────────────────────────────────────────────
    this._findEngine = new FindReplaceEngine(
      this._doc,
      this._decorations.getOrCreate(DEC_FIND),
      this._decorations.getOrCreate(DEC_FIND_ACTIVE),
    );
    this._findEngine.setColors(
      DARK_THEME.colors['findMatchBg'],
      DARK_THEME.colors['findMatchActiveBg'],
    );
    this._findWidget = new FindReplaceWidget(findLayer, this._findEngine);

    // Canvas draw layer
    this._canvasDraw = new CanvasRenderer(
      canvas,
      DARK_THEME,
      this._charWidth,
      LINE_HEIGHT,
      TAB_SIZE,
    );
    this._canvasDraw.onCursorBlink(() => this._scheduleDraw());

    // ── Minimap ──────────────────────────────────────────────────────────────
    this._buildMinimap(outer);

    // ── Diagnostics overlay ──────────────────────────────────────────────────
    // Mount on the editor-mount's parent (same level as minimap canvas)
    const diagMount = outer.parentElement ?? outer;
    this._diagnostics = new DiagnosticsOverlay(diagMount);

    // ── Status bar refs ──────────────────────────────────────────────────
    this._statusPos     = document.getElementById('status-pos');
    this._statusLines   = document.getElementById('status-lines');
    this._statusVersion = document.getElementById('status-version');
    this._tabEl         = document.getElementById('main-tab');

    // ── Subscribe to APDS events ────────────────────────────────────────
    this._unsubContent = this._doc.onDidChangeContent(_e => {
      this._dirty = true;
      this._scheduleDraw();
      this._updateStatusBar();
      this._markTabDirty(true);
      // Notify find engine of document change
      this._findEngine.onDocumentChanged();
      // Minimap: mark dirty on content change
      this._minimap?.markDirty();
      // Re-run diagnostics on every content change
      this._runDiagnostics();
      this._scheduleDraw();
    });

    this._unsubSelection = this._doc.onDidChangeSelection(_e => {
      this._dirty = true;
      this._canvasDraw.resetBlink();
      this._scheduleDraw();
      this._updateStatusBar();
      this._updateACPopupPosition();
      this._scrollToCursor();
      // Update bracket highlights on every cursor move
      this._updateBracketHighlights();
    });

    this._unsubSession = this._completion.onDidChangeSession(e => {
      this._updateACPopup(e.session);
    });

    // Find engine state change → repaint
    this._unsubFindState = this._findEngine.onDidChangeState(state => {
      // Update minimap search markers whenever find state changes
      if (this._minimap) {
        if (state.isOpen && state.matchCount > 0) {
          // Build set of unique match lines from the current matches array.
          // We use the internal _matches via state's matchCount + decoration approach:
          // The DecorationSet for 'find' has the match lines baked in.
          // Pull line set from decoration store directly (zero extra work).
          const findSet = this._decorations.getOrCreate(DEC_FIND);
          const activeSet = this._decorations.getOrCreate(DEC_FIND_ACTIVE);
          const matchLines = new Set<number>(findSet.lineIndices());
          // Active line: pick from find-active set (first entry) or -1
          let activeLine = -1;
          for (const li of activeSet.lineIndices()) { activeLine = li; break; }
          this._minimap.setSearchMarkers({ matchLines, activeLine });
        } else {
          this._minimap.setSearchMarkers(null);
        }
      }
      this._scheduleDraw();
    });

    // ── Wire DOM events ──────────────────────────────────────────────────
    this._wireKeyboard();
    this._wireMouse();
    this._wireScroll();
    this._wirePaste();

    // ── ResizeObserver ───────────────────────────────────────────────────
    this._resizeObs = new ResizeObserver(() => this._onResize());
    this._resizeObs.observe(outer);

    // ── Initial layout ───────────────────────────────────────────────────
    this._onResize();
    // Run diagnostics on initial content
    this._runDiagnostics();
    this._scheduleDraw();
  }

  // ── Public control API ──────────────────────────────────────────────────

  setTheme(name: 'dark' | 'light'): void {
    this._themeName = name;
    this._theme     = name === 'dark' ? DARK_THEME : LIGHT_THEME;
    this._renderer.setTheme(this._theme);
    this._canvasDraw.setTheme(this._theme);
    this._minimap?.setTheme(this._theme);
    this._outer.style.background = this._theme.colors['background'];
    this._findEngine.setColors(
      this._theme.colors['findMatchBg'],
      this._theme.colors['findMatchActiveBg'],
    );
    // Force re-search with new colors
    this._findEngine.onDocumentChanged();
    this._scheduleDraw();

    document.getElementById('btn-dark')?.classList.toggle('active',  name === 'dark');
    document.getElementById('btn-light')?.classList.toggle('active', name === 'light');
  }

  loadText(text: string): void {
    this._actions.selectAll();
    this._doc.insertText(text, false);
    this._markTabDirty(false);
    this._scheduleDraw();
  }

  loadEmpty(): void {
    this.loadText('');
  }

  loadStressTest(): void {
    this.loadText(STRESS_TEST_CODE);
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  private _scheduleDraw(): void {
    if (this._rafHandle !== null) return;
    this._rafHandle = requestAnimationFrame(() => {
      this._rafHandle = null;
      this._draw();
    });
  }

  private _draw(): void {
    this._dirty = false;

    // Measure draw time
    const drawStart = performance.now();

    const vp = this._currentViewport();
    this._renderer.setViewport(vp);
    const result = this._renderer.render();

    // Update dynamic CODE_ORIGIN_X from live line count.
    // This keeps the mouse coordinate system in sync with the dynamic gutter.
    const ctx = this._canvas.getContext('2d')!;
    updateCodeOriginX(this._doc.lineCount, ctx, NORMAL_FONT);

    // Update sizer (use dynamic CODE_ORIGIN_X)
    const totalW = CODE_ORIGIN_X + result.totalWidth + 40;
    const totalH = result.totalHeight;
    this._sizer.style.width  = `${totalW}px`;
    this._sizer.style.height = `${totalH}px`;

    // Build merged decoration layer
    const decorLayer = this._decorations.buildLayer([
      DEC_FIND,
      DEC_FIND_ACTIVE,
      DEC_BRACKET,
      DEC_DIAGNOSTICS,
    ]);

    this._canvasDraw.draw(
      result,
      this._outer.scrollTop,
      this._hasFocus,
      decorLayer.isEmpty ? null : decorLayer,
      this._doc.cursor.line,
      this._doc.lineCount,              // dynamic gutter
      (i) => this._doc.getLine(i),      // off-screen line lookup for indent guides
    );

    const drawTimeMs = performance.now() - drawStart;

    // Estimate draw calls (spans + cursor + gutter lines + decorations)
    const visibleCount = result.lastRenderedLine - result.firstRenderedLine + 1;
    // Per line: avg ~4 spans + 1 cursor (sometimes) + 1 selection + indent guides
    // Gutter: visibleCount line numbers
    this._lastDrawCalls = visibleCount * 6 + visibleCount + 3;  // rough estimate

    // Update diagnostics overlay (perf + code diagnostic counts)
    if (this._diagnostics) {
      this._diagnostics.update({
        visibleLines:  visibleCount,
        totalLines:    this._doc.lineCount,
        renderTimeMs:  drawTimeMs,
        drawCalls:     this._lastDrawCalls,
        cacheHits:     this._lastCacheHits,
        cacheMisses:   this._lastCacheMisses,
        errorCount:    this._diagEngine.errorCount,
        warningCount:  this._diagEngine.warningCount,
        infoCount:     this._diagEngine.infoCount,
      });
    }

    // Minimap update
    if (this._minimap) {
      this._minimap.updateViewport(
        this._outer.scrollTop,
        this._vpHeight,
        result.totalHeight,
      );
      this._minimap.draw();
    }
  }

  // ── Viewport ──────────────────────────────────────────────────────────

  private _currentViewport(): Viewport {
    return new Viewport(
      this._outer.scrollTop,
      Math.max(0, this._outer.scrollLeft - CODE_ORIGIN_X),
      this._vpWidth,
      this._vpHeight,
      LINE_HEIGHT,
      this._charWidth,
    );
  }

  private _onResize(): void {
    const rect = this._outer.getBoundingClientRect();
    this._vpWidth  = rect.width;
    this._vpHeight = rect.height;

    const dpr = window.devicePixelRatio || 1;
    this._canvas.width  = Math.round(rect.width  * dpr);
    this._canvas.height = Math.round(rect.height * dpr);
    this._canvas.style.width  = `${rect.width}px`;
    this._canvas.style.height = `${rect.height}px`;

    const ctx = this._canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Resize minimap canvas to match editor height (DPR-aware)
    if (this._minimapCanvas) {
      const dpr = window.devicePixelRatio || 1;
      // CSS dimensions are controlled by position:absolute in style.css;
      // we only need to update the pixel buffer size for crisp rendering.
      this._minimapCanvas.width  = Math.round(100 * dpr);
      this._minimapCanvas.height = Math.round(rect.height * dpr);
      this._minimap?.markDirty();
    }

    this._scheduleDraw();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────

  private _wireKeyboard(): void {
    this._textarea.addEventListener('keydown', e => this._onKeyDown(e));
    this._textarea.addEventListener('focus', () => {
      this._hasFocus = true;
      this._canvasDraw.resetBlink();
      this._scheduleDraw();
    });
    this._textarea.addEventListener('blur', () => {
      this._hasFocus = false;
      this._popup.hide();
      this._scheduleDraw();
    });

    this._outer.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.apds-ac-popup')) return;
      if ((e.target as HTMLElement).closest('.apds-find-widget')) return;
      e.preventDefault();
      this._textarea.focus();
    });

    requestAnimationFrame(() => {
      this._textarea.focus();
    });
  }

  private _onKeyDown(e: KeyboardEvent): void {
    // ── Ctrl+Shift+P — Toggle diagnostics overlay ───────────────────────────────────
    if ((e.key === 'p' || e.key === 'P') && e.ctrlKey && e.shiftKey && !e.altKey) {
      e.preventDefault();
      this._diagnostics?.toggle();
      return;
    }

    // ── Ctrl+G — Go To Line ──────────────────────────────────────────────────
    if (e.key === 'g' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      this._openGoToLine();
      return;
    }

    // ── Auto-close pairs (printable characters only) ─────────────────────────
    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
      const autoclosePairs = ['(', '[', '{', '"', "'", ')', ']', '}'];
      if (autoclosePairs.includes(e.key)) {
        e.preventDefault();
        handleAutoClose(e.key, this._doc);
        return;
      }
    }

    // ── Popup navigation ───────────────────────────────────────────────────
    if (this._popup.isVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._completion.session?.selectNext();
        this._updateACPopup(this._completion.session);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._completion.session?.selectPrev();
        this._updateACPopup(this._completion.session);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        this._completion.acceptActive();
        this._popup.hide();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this._completion.dismiss();
        this._popup.hide();
        return;
      }
    }

    // ── Ctrl+Space: explicit autocomplete trigger ──────────────────────────
    if (e.key === ' ' && e.ctrlKey) {
      e.preventDefault();
      this._completion.trigger();
      return;
    }

    // ── Ctrl+F — open Find ───────────────────────────────────────────────────
    if (e.key === 'f' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      // Pre-fill with selection if any
      const query = this._getSelectionText();
      this._findEngine.open('find', query || undefined);
      this._findWidget.focus();
      return;
    }

    // ── Ctrl+H — open Replace ────────────────────────────────────────────────
    if (e.key === 'h' && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const query = this._getSelectionText();
      this._findEngine.open('replace', query || undefined);
      this._findWidget.focus();
      return;
    }

    // ── Escape — close find if open ──────────────────────────────────────────
    if (e.key === 'Escape' && this._findEngine.isOpen) {
      e.preventDefault();
      this._findEngine.close();
      this._textarea.focus();
      return;
    }

    // ── F3 / Shift+F3 — find next/prev ───────────────────────────────────────
    if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) this._findEngine.findPrev();
      else            this._findEngine.findNext();
      return;
    }

    // ── Smart newline ────────────────────────────────────────────────────────
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this._doSmartNewline();
      return;
    }

    // ── Forward to APDS KeyboardHandler ───────────────────────────────────
    const kev: KeyEvent = {
      key:   e.key,
      ctrl:  e.ctrlKey,
      shift: e.shiftKey,
      alt:   e.altKey,
      meta:  e.metaKey,
    };

    const handled = this._keyboard.handleKey(kev);
    if (handled) {
      e.preventDefault();
    }
  }

  // ── Smart Indentation ────────────────────────────────────────────────────

  private _doSmartNewline(): void {
    const cursor      = this._doc.cursor;
    const currentLine = this._doc.getLine(cursor.line);
    const result      = computeSmartIndent(currentLine, cursor.column, TAB_SIZE);
    this._doc.insertText(result.insertText, false);
  }

  // ── Go To Line ───────────────────────────────────────────────

  private _openGoToLine(): void {
    if (this._goToLineWidget) return; // already open

    this._goToLineWidget = new GoToLineWidget(
      this._outer,
      this._doc.lineCount,
      this._doc.cursor.line,
      (lineIndex) => {
        // Jump cursor to line start, then center in viewport
        const clampedLine = Math.max(0, Math.min(lineIndex, this._doc.lineCount - 1));
        this._doc.moveCursor(this._doc.createCursor(clampedLine, 0));
        this._centerOnCursor();
        this._textarea.focus();
      },
      () => {
        this._goToLineWidget?.dispose();
        this._goToLineWidget = null;
        this._textarea.focus();
      },
    );
  }

  /** Center the viewport on the current cursor line. */
  private _centerOnCursor(): void {
    const cursor   = this._doc.cursor;
    const lineTop  = cursor.line * LINE_HEIGHT;
    const centeredScrollTop = lineTop - (this._vpHeight / 2) + (LINE_HEIGHT / 2);
    this._outer.scrollTop = Math.max(0, centeredScrollTop);
    this._scheduleDraw();
  }

  // ── Minimap ──────────────────────────────────────────────────

  /** Build and attach the minimap canvas without touching the editor's layout.
   *
   * SCROLLING BUG FIX: The previous implementation called
   *   parent.style.display = 'flex'
   *   parent.style.overflow = 'hidden'
   * on the editor mount element. Setting overflow:hidden on the parent of a
   * position:sticky canvas BREAKS sticky positioning entirely — the canvas
   * would no longer follow the scroll, causing the rendering to appear frozen
   * or offset. Setting display:flex also disrupted the outer div's width
   * measurement, causing the viewport to be sized incorrectly.
   *
   * Fix: the minimap is now positioned absolutely within the editor mount
   * (which already has position:relative in the page CSS). The editor layout
   * is completely untouched.
   */
  private _buildMinimap(outer: HTMLDivElement): void {
    const mapCanvas = document.createElement('canvas');
    mapCanvas.className = 'apds-minimap';
    mapCanvas.width  = 100;
    mapCanvas.height = 600;

    const parent = outer.parentElement;
    if (parent) {
      parent.appendChild(mapCanvas);
    }

    this._minimapCanvas = mapCanvas;
    this._minimap = new Minimap(mapCanvas, this._doc, this._theme, LINE_HEIGHT);

    // Wire syntax-colored rendering: provide span data via Renderer.renderLine().
    // renderLine() reads from and populates the renderer's cache, so calls for
    // lines the main editor has already rendered are essentially free (O(1) cache hit).
    this._minimap.setLineSpanGetter((li) => {
      if (li < 0 || li >= this._doc.lineCount) return null;
      try {
        const rl = this._renderer.renderLine(li);
        return rl.spans;   // RenderedSpan[] is compatible with MiniSpan[]
      } catch {
        return null;
      }
    });

    this._minimap.onScroll(scrollTop => {
      this._outer.scrollTop = scrollTop;
      this._scheduleDraw();
    });
  }

  // ── Mouse ─────────────────────────────────────────────────────────────

  private _wireMouse(): void {
    this._canvas.addEventListener('mousedown',   e => this._onPointerDown(e));
    this._canvas.addEventListener('mousemove',   e => this._onPointerMove(e));
    this._canvas.addEventListener('mouseup',     e => this._onPointerUp(e));
    this._canvas.addEventListener('dblclick',    e => this._onDoubleClick(e));
    this._canvas.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('mouseup', () => { this._mouseDown = false; });
  }

  private _canvasToEditorEvent(e: MouseEvent): EditorPointerEvent {
    const rect = this._canvas.getBoundingClientRect();
    const x    = (e.clientX - rect.left) - CODE_ORIGIN_X;
    const y    = (e.clientY - rect.top);
    return {
      x,
      y,
      button: e.button as 0 | 1 | 2,
      shift:  e.shiftKey,
      ctrl:   e.ctrlKey,
      alt:    e.altKey,
      meta:   e.metaKey,
    };
  }

  private _onPointerDown(e: MouseEvent): void {
    this._mouseDown = e.button === 0;
    if (e.button !== 0) return;
    const pe = this._canvasToEditorEvent(e);
    this._mouse.handlePointerDown(pe);
    this._popup.hide();
    this._completion.dismiss();
  }

  private _onPointerMove(e: MouseEvent): void {
    if (!this._mouseDown) return;
    const pe = this._canvasToEditorEvent(e);
    this._mouse.handlePointerMove(pe, this._mouseDown);
  }

  private _onPointerUp(e: MouseEvent): void {
    this._mouseDown = false;
    const pe = this._canvasToEditorEvent(e);
    this._mouse.handlePointerUp(pe);
  }

  private _onDoubleClick(e: MouseEvent): void {
    const pe = this._canvasToEditorEvent(e);
    this._mouse.handleDoubleClick(pe);
  }

  // ── Scroll ────────────────────────────────────────────────────────────

  private _wireScroll(): void {
    this._outer.addEventListener('scroll', () => {
      this._scheduleDraw();
      this._updateACPopupPosition();
    }, { passive: true });
  }

  // ── Native paste ──────────────────────────────────────────────────────

  private _wirePaste(): void {
    this._textarea.addEventListener('paste', async e => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text) {
        this._doc.insertText(text, false);
        this._scheduleDraw();
      }
    });

    this._textarea.addEventListener('copy', async e => {
      e.preventDefault();
      if (!this._doc.selection.isCollapsed) {
        const { start, end } = this._doc.selection.ordered();
        let text = '';
        for (let i = start.line; i <= end.line; i++) {
          const line = this._doc.getLine(i);
          if (i === start.line && i === end.line) {
            text = line.slice(start.column, end.column);
          } else if (i === start.line) {
            text += line.slice(start.column) + '\n';
          } else if (i === end.line) {
            text += line.slice(0, end.column);
          } else {
            text += line + '\n';
          }
        }
        e.clipboardData?.setData('text/plain', text);
        await this._clipboard.write(text);
      }
    });

    this._textarea.addEventListener('cut', async e => {
      e.preventDefault();
      if (!this._doc.selection.isCollapsed) {
        await this._actions.cut();
        const text = await this._clipboard.read();
        e.clipboardData?.setData('text/plain', text);
      }
    });
  }

  // ── Bracket matching (Feature A) ──────────────────────────────────────

  private _updateBracketHighlights(): void {
    this._bracketMatcher.update(this._theme.colors['bracketMatchBg']);
    this._scheduleDraw();
  }

  // ── Autocomplete popup ────────────────────────────────────────────────

  private _updateACPopup(session: typeof this._completion.session): void {
    if (!session || !session.isActive) {
      this._popup.hide();
      return;
    }
    const { left, top } = this._cursorPixelPos();
    this._popup.update(session, left, top + LINE_HEIGHT);
  }

  private _updateACPopupPosition(): void {
    if (!this._popup.isVisible) return;
    const session = this._completion.session;
    this._updateACPopup(session);
  }

  private _cursorPixelPos(): { left: number; top: number } {
    const cursor     = this._doc.cursor;
    const scrollTop  = this._outer.scrollTop;
    const scrollLeft = this._outer.scrollLeft;
    const left = CODE_ORIGIN_X + cursor.column * this._charWidth - scrollLeft;
    const top  = cursor.line   * LINE_HEIGHT               - scrollTop;
    return { left, top };
  }

  // ── Find/Replace helpers ──────────────────────────────────────────────

  private _getSelectionText(): string {
    if (this._doc.selection.isCollapsed) return '';
    const { start, end } = this._doc.selection.ordered();
    // Only use single-line selections as pre-fill
    if (start.line !== end.line) return '';
    return this._doc.getLine(start.line).slice(start.column, end.column);
  }

  // ── Status bar ────────────────────────────────────────────────────────

  private _updateStatusBar(): void {
    const cur = this._doc.cursor;
    if (this._statusPos) {
      this._statusPos.textContent = `Ln ${cur.line + 1}, Col ${cur.column + 1}`;
    }
    if (this._statusLines) {
      this._statusLines.textContent = `${this._doc.lineCount} lines`;
    }
    if (this._statusVersion) {
      this._statusVersion.textContent = `v${this._doc.version}`;
    }
  }

  private _markTabDirty(dirty: boolean): void {
    this._tabEl?.classList.toggle('dirty', dirty);
  }

  // ── Scroll-follow ─────────────────────────────────────────────────────

  private _scrollToCursor(): void {
    const cursor  = this._doc.cursor;
    const marginV = Math.floor(LINE_HEIGHT / 2);
    const marginH = Math.floor(this._charWidth * 4);

    const cursorTop   = cursor.line   * LINE_HEIGHT;
    const cursorBot   = cursorTop + LINE_HEIGHT;
    const cursorLeft  = CODE_ORIGIN_X + cursor.column * this._charWidth;
    const cursorRight = cursorLeft + this._charWidth;

    let { scrollTop, scrollLeft } = this._outer;
    const viewH = this._vpHeight;
    const viewW = this._vpWidth;

    if (cursorTop - marginV < scrollTop) {
      scrollTop = Math.max(0, cursorTop - marginV);
    } else if (cursorBot + marginV > scrollTop + viewH) {
      scrollTop = cursorBot + marginV - viewH;
    }

    if (cursorLeft - marginH < scrollLeft + CODE_ORIGIN_X) {
      scrollLeft = Math.max(0, cursorLeft - marginH - CODE_ORIGIN_X);
    } else if (cursorRight + marginH > scrollLeft + viewW) {
      scrollLeft = cursorRight + marginH - viewW;
    }

    if (scrollTop !== this._outer.scrollTop || scrollLeft !== this._outer.scrollLeft) {
      this._outer.scrollTop  = scrollTop;
      this._outer.scrollLeft = scrollLeft;
    }
  }

  // ── Code Diagnostics ────────────────────────────────────────────────────

  /**
   * Run the LuauAnalyzer over the current document and push the resulting
   * squiggle decorations into the DEC_DIAGNOSTICS set.
   *
   * Called on every content change (synchronous, O(n) in document size).
   * LOCK-13: never calls lex(). LOCK-21: never mutates Document.
   */
  private _runDiagnostics(): void {
    const lines: string[] = [];
    for (let i = 0; i < this._doc.lineCount; i++) {
      lines.push(this._doc.getLine(i));
    }
    this._diagEngine.analyze(lines);
    this._diagEngine.applyToSet(this._decorations.getOrCreate(DEC_DIAGNOSTICS));
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  dispose(): void {
    this._unsubContent();
    this._unsubSelection();
    this._unsubSession();
    this._unsubFindState();
    this._renderer.dispose();
    this._completion.dispose();
    this._canvasDraw.dispose();
    this._popup.dispose();
    this._findWidget.dispose();
    this._goToLineWidget?.dispose();
    this._diagnostics?.dispose();
    this._minimapCanvas?.remove();
    this._resizeObs.disconnect();
    this._outer.remove();
  }
}

// ── BrowserClipboard ──────────────────────────────────────────────────────

class BrowserClipboard implements ClipboardAdapter {
  static isAvailable(): boolean {
    return typeof navigator !== 'undefined' &&
           typeof navigator.clipboard !== 'undefined';
  }

  async read(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }

  async write(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // silently ignore
    }
  }
}

// ── Stress test content ────────────────────────────────────────────────────

const STRESS_TEST_CODE = `--[[
  APDS Stress Test Document
  Tests: long strings, long comments, nested tables, many keywords,
  Roblox globals/types, interpolated strings, attributes, deep nesting.
  Also exercises incremental tokenizer state propagation across line edits.
]]

-- ── Luau Type System ────────────────────────────────────────────────────────

export type PlayerId = number
export type PlayerName = string
export type Inventory = { [string]: number }

type PlayerData = {
  id:        PlayerId,
  name:      PlayerName,
  inventory: Inventory,
  position:  Vector3,
  cframe:    CFrame,
}

-- ── Attributes ──────────────────────────────────────────────────────────────

@native
local function fastAdd(a: number, b: number): number
  return a + b
end

@checked
local function safeDiv(a: number, b: number): number
  assert(b ~= 0, "Division by zero")
  return a / b
end

-- ── String types ────────────────────────────────────────────────────────────

local plain_single = 'hello world'
local plain_double = "hello world"
local escape_test  = "tab:\\there\\nnewline\\\\backslash\\x41hex\\u{1F600}emoji"

local long0 = [[
line one
line two
line three
]]

local long1 = [=[
level-one long string
]=]

-- ── Numbers ─────────────────────────────────────────────────────────────────

local dec   = 1_000_000
local float = 3.14159_26535
local sci   = 6.022e23
local hex   = 0xFF_AA_BB
local bin   = 0b1010_1010

-- ── Control flow ────────────────────────────────────────────────────────────

local function controlFlowDemo(x: number): string
  if x > 100 then
    return "large"
  elseif x > 50 then
    return "medium"
  elseif x > 0 then
    return "small"
  else
    return "non-positive"
  end
end

local function loopDemo()
  local sum = 0
  for i = 1, 100 do
    sum += i
  end

  local t = {a=1, b=2, c=3}
  for k, v in pairs(t) do
    print(k, v)
  end

  local n = 10
  while n > 0 do
    n -= 1
  end

  local x = 0
  repeat
    x += 1
  until x >= 10

  return sum
end

-- ── Roblox integration ──────────────────────────────────────────────────────

local Players      = game:GetService("Players")
local RunService   = game:GetService("RunService")
local Workspace    = workspace

local function setupPlayer(player: Player)
  local character = player.Character or player.CharacterAdded:Wait()
  local humanoid  = character:WaitForChild("Humanoid") :: Humanoid
  local rootPart  = character:WaitForChild("HumanoidRootPart") :: BasePart

  local spawnPos  = Vector3.new(0, 5, 0)
  local spawnCF   = CFrame.new(spawnPos) * CFrame.Angles(0, math.pi, 0)
  local color     = Color3.fromRGB(255, 128, 0)
  local tween     = TweenInfo.new(1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

  rootPart.CFrame = spawnCF
  humanoid.WalkSpeed = 16
  humanoid.JumpHeight = 7.2
end

Players.PlayerAdded:Connect(setupPlayer)

-- ── Long block comment ──────────────────────────────────────────────────────
--[[
  This is a very long block comment that intentionally spans many lines.
  Its purpose is to exercise the incremental tokenizer's LongComment state
  propagation across line edits.

  Try inserting a line break before the closing ]] to see state propagation.
]]

-- ── End of stress test ──────────────────────────────────────────────────────
print("Stress test document loaded successfully.")
`;
