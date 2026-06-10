/**
 * APDS Input — Phase 5 Test Suite
 *
 * Covers (in order):
 *   A. Document event system  — ContentChangeEvent, SelectionChangeEvent,
 *                               version counter, source tracking
 *   B. KeyEvent               — serializeKeyStroke, isPrintable
 *   C. InputMap               — lookup, bind/unbind, platform defaults
 *   D. EditorActions          — all actions against a real Document
 *   E. KeyboardHandler        — dispatch, printable fallthrough, return values
 *   F. MouseHandler           — click, shift-click, drag, double-click
 *
 * All tests are DOM-free. Clipboard is stubbed with MemoryClipboard.
 * Word boundary tests use pure functions directly (LOCK-25).
 */

import { describe, it, expect } from 'vitest';

import { Document }        from '../../editor/Document';
import { Cursor }          from '../../editor/Cursor';
import { Selection }       from '../../editor/Selection';
import type { ContentChangeEvent, SelectionChangeEvent } from '../../editor/Document';

import { serializeKeyStroke, isPrintable, type KeyEvent } from '../KeyEvent';
import { InputMap, buildDefaultInputMap }                 from '../InputMap';
import {
  EditorActions, MemoryClipboard,
  wordBoundaryLeft, wordBoundaryRight,
} from '../EditorActions';
import { KeyboardHandler }  from '../KeyboardHandler';
import { MouseHandler }     from '../MouseHandler';
import { Viewport }         from '../../render/Viewport';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function key(
  k: string,
  opts: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }> = {},
): KeyEvent {
  return { key: k, ctrl: false, shift: false, alt: false, meta: false, ...opts };
}

function makeDoc(text = ''): Document {
  return new Document(text);
}

function makeActions(doc: Document, clipboard?: MemoryClipboard): EditorActions {
  return new EditorActions(doc, clipboard ?? new MemoryClipboard());
}

/** Place cursor at (line, col) using Document's public API. */
function placeCursor(doc: Document, line: number, col: number): void {
  doc.moveCursor(doc.createCursor(line, col));
}

/** Build a Viewport suitable for hit-testing: 20px line height, 8px char width. */
function makeViewport(scrollTop = 0, scrollLeft = 0): Viewport {
  return new Viewport(scrollTop, scrollLeft, 640, 400, 20, 8);
}

// ═══════════════════════════════════════════════════════════════════════════
// A. Document event system
// ═══════════════════════════════════════════════════════════════════════════

describe('Document — ContentChangeEvent', () => {
  it('fires on insertText', () => {
    const doc = makeDoc('hello');
    const events: ContentChangeEvent[] = [];
    doc.onDidChangeContent(e => events.push(e));
    placeCursor(doc, 0, 5);
    doc.insertText('!');
    expect(events).toHaveLength(1);
    expect(doc.getText()).toBe('hello!');
  });

  it('mutation field matches the splice', () => {
    const doc = makeDoc('abc');
    let evt!: ContentChangeEvent;
    doc.onDidChangeContent(e => { evt = e; });
    placeCursor(doc, 0, 1);
    doc.insertText('X');
    expect(evt.mutation.startLine).toBe(0);
    expect(evt.mutation.removedLineCount).toBe(1);
    expect(evt.mutation.insertedLines[0]).toBe('aXbc');
  });

  it('range reflects insertion point for pure insert', () => {
    const doc = makeDoc('hello');
    let evt!: ContentChangeEvent;
    doc.onDidChangeContent(e => { evt = e; });
    placeCursor(doc, 0, 3);
    doc.insertText('X');
    expect(evt.range).toEqual({ startLine: 0, startColumn: 3, endLine: 0, endColumn: 3 });
    expect(evt.replacedLength).toBe(0);
  });

  it('range reflects deleted span for deleteText backward', () => {
    const doc = makeDoc('hello');
    let evt!: ContentChangeEvent;
    doc.onDidChangeContent(e => { evt = e; });
    placeCursor(doc, 0, 3);
    doc.deleteText('backward');
    expect(evt.range.startColumn).toBe(2);
    expect(evt.range.endColumn).toBe(3);
    expect(evt.replacedLength).toBe(1);
  });

  it('range and replacedLength correct for replaceRange', () => {
    const doc = makeDoc('hello world');
    let evt!: ContentChangeEvent;
    doc.onDidChangeContent(e => { evt = e; });
    doc.replaceRange({ line: 0, column: 6 }, { line: 0, column: 11 }, 'Luau');
    expect(evt.range).toEqual({ startLine: 0, startColumn: 6, endLine: 0, endColumn: 11 });
    expect(evt.replacedLength).toBe(5); // 'world' = 5 chars
    expect(doc.getText()).toBe('hello Luau');
  });

  it('version increments on each content change (LOCK-31)', () => {
    const doc = makeDoc('');
    expect(doc.version).toBe(0);
    doc.onDidChangeContent(() => {});
    placeCursor(doc, 0, 0);
    doc.insertText('a');
    expect(doc.version).toBe(1);
    doc.insertText('b');
    expect(doc.version).toBe(2);
    doc.deleteText('backward');
    expect(doc.version).toBe(3);
  });

  it('version in event matches doc.version at fire time', () => {
    const doc = makeDoc('hello');
    const versions: number[] = [];
    doc.onDidChangeContent(e => versions.push(e.version));
    placeCursor(doc, 0, 5);
    doc.insertText('!');
    doc.insertText('!');
    expect(versions).toEqual([1, 2]);
  });

  it("source is 'user' for insertText", () => {
    const doc = makeDoc('');
    let evt!: ContentChangeEvent;
    doc.onDidChangeContent(e => { evt = e; });
    placeCursor(doc, 0, 0);
    doc.insertText('x');
    expect(evt.source).toBe('user');
  });

  it("source is 'api' for replaceRange", () => {
    const doc = makeDoc('hello');
    let evt!: ContentChangeEvent;
    doc.onDidChangeContent(e => { evt = e; });
    doc.replaceRange({ line: 0, column: 0 }, { line: 0, column: 5 }, 'world');
    expect(evt.source).toBe('api');
  });

  it("source is 'undo' for undo()", () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    doc.insertText('x');
    const events: ContentChangeEvent[] = [];
    doc.onDidChangeContent(e => events.push(e));
    doc.undo();
    expect(events[0].source).toBe('undo');
  });

  it("source is 'redo' for redo()", () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    doc.insertText('x');
    doc.undo();
    const events: ContentChangeEvent[] = [];
    doc.onDidChangeContent(e => events.push(e));
    doc.redo();
    expect(events[0].source).toBe('redo');
  });

  it('undo and redo both increment version (LOCK-31)', () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    doc.insertText('x');        // version 1
    doc.undo();                  // version 2
    expect(doc.version).toBe(2);
    doc.redo();                  // version 3
    expect(doc.version).toBe(3);
  });

  it('unsubscribe stops receiving events', () => {
    const doc = makeDoc('');
    const events: ContentChangeEvent[] = [];
    const unsub = doc.onDidChangeContent(e => events.push(e));
    placeCursor(doc, 0, 0);
    doc.insertText('a');
    unsub();
    doc.insertText('b');
    expect(events).toHaveLength(1);
  });

  it('multiple subscribers both receive the event', () => {
    const doc = makeDoc('');
    let count1 = 0, count2 = 0;
    doc.onDidChangeContent(() => count1++);
    doc.onDidChangeContent(() => count2++);
    placeCursor(doc, 0, 0);
    doc.insertText('x');
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it('event fires synchronously before insertText returns (LOCK-29)', () => {
    const doc = makeDoc('');
    let firedDuring = false;
    let textAtFire = '';
    doc.onDidChangeContent(() => {
      firedDuring = true;
      textAtFire = doc.getText();
    });
    placeCursor(doc, 0, 0);
    doc.insertText('hello');
    expect(firedDuring).toBe(true);
    expect(textAtFire).toBe('hello'); // already applied at fire time
  });
});

describe('Document — SelectionChangeEvent', () => {
  it('fires on moveCursor', () => {
    const doc = makeDoc('hello world');
    const events: SelectionChangeEvent[] = [];
    doc.onDidChangeSelection(e => events.push(e));
    placeCursor(doc, 0, 5);
    expect(events).toHaveLength(1);
    expect(events[0].cursorAfter).toEqual({ line: 0, column: 5 });
  });

  it('fires on extendSelection', () => {
    const doc = makeDoc('hello');
    const events: SelectionChangeEvent[] = [];
    doc.onDidChangeSelection(e => events.push(e));
    doc.extendSelection(doc.createCursor(0, 5));
    expect(events).toHaveLength(1);
    expect(events[0].cursorAfter.column).toBe(5);
  });

  it('fires after content mutation (cursor moves too)', () => {
    const doc = makeDoc('hello');
    const selEvents: SelectionChangeEvent[] = [];
    const contentEvents: ContentChangeEvent[] = [];
    doc.onDidChangeContent(e => contentEvents.push(e));
    doc.onDidChangeSelection(e => selEvents.push(e));
    placeCursor(doc, 0, 5);
    selEvents.length = 0; // clear the initial moveCursor event
    doc.insertText('!');
    expect(contentEvents).toHaveLength(1);
    expect(selEvents).toHaveLength(1);
    expect(selEvents[0].cursorAfter.column).toBe(6);
  });

  it("source is 'user' for moveCursor", () => {
    const doc = makeDoc('hi');
    let evt!: SelectionChangeEvent;
    doc.onDidChangeSelection(e => { evt = e; });
    placeCursor(doc, 0, 2);
    expect(evt.source).toBe('user');
  });

  it("source is 'undo' for selection change after undo", () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    doc.insertText('abc');
    const events: SelectionChangeEvent[] = [];
    doc.onDidChangeSelection(e => events.push(e));
    doc.undo();
    expect(events.some(e => e.source === 'undo')).toBe(true);
  });

  it('cursorBefore reflects position before the change', () => {
    const doc = makeDoc('hello');
    let evt!: SelectionChangeEvent;
    doc.onDidChangeSelection(e => { evt = e; });
    placeCursor(doc, 0, 3);
    expect(evt.cursorBefore.column).toBe(0); // started at 0
    expect(evt.cursorAfter.column).toBe(3);
  });

  it('no-op moveCursor does NOT fire event', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 3);
    let count = 0;
    doc.onDidChangeSelection(() => count++);
    placeCursor(doc, 0, 3); // same position
    expect(count).toBe(0);
  });

  it('unsubscribe stops selection events', () => {
    const doc = makeDoc('hello');
    let count = 0;
    const unsub = doc.onDidChangeSelection(() => count++);
    placeCursor(doc, 0, 2);
    unsub();
    placeCursor(doc, 0, 4);
    expect(count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. KeyEvent
// ═══════════════════════════════════════════════════════════════════════════

describe('serializeKeyStroke', () => {
  it('plain key', () => {
    expect(serializeKeyStroke(key('a'))).toBe('a');
  });

  it('uppercase letter normalised to lowercase', () => {
    expect(serializeKeyStroke(key('A'))).toBe('a');
    expect(serializeKeyStroke(key('Z'))).toBe('z');
  });

  it('non-letter keys preserved as-is', () => {
    expect(serializeKeyStroke(key('Enter'))).toBe('Enter');
    expect(serializeKeyStroke(key('ArrowLeft'))).toBe('ArrowLeft');
    expect(serializeKeyStroke(key('Backspace'))).toBe('Backspace');
    expect(serializeKeyStroke(key('F5'))).toBe('F5');
  });

  it('Ctrl modifier', () => {
    expect(serializeKeyStroke(key('z', { ctrl: true }))).toBe('Ctrl+z');
  });

  it('Shift modifier', () => {
    expect(serializeKeyStroke(key('ArrowLeft', { shift: true }))).toBe('Shift+ArrowLeft');
  });

  it('Ctrl+Shift combination', () => {
    expect(serializeKeyStroke(key('z', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+z');
  });

  it('Meta modifier', () => {
    expect(serializeKeyStroke(key('z', { meta: true }))).toBe('Meta+z');
  });

  it('modifier order is always Ctrl, Alt, Shift, Meta', () => {
    const e = key('a', { ctrl: true, alt: true, shift: true, meta: true });
    expect(serializeKeyStroke(e)).toBe('Ctrl+Alt+Shift+Meta+a');
  });
});

describe('isPrintable (LOCK-27)', () => {
  it('single letter is printable', () => {
    expect(isPrintable(key('a'))).toBe(true);
    expect(isPrintable(key('Z'))).toBe(true);
  });

  it('multi-char keys are not printable', () => {
    expect(isPrintable(key('Enter'))).toBe(false);
    expect(isPrintable(key('Backspace'))).toBe(false);
    expect(isPrintable(key('ArrowLeft'))).toBe(false);
  });

  it('Ctrl+key is not printable', () => {
    expect(isPrintable(key('a', { ctrl: true }))).toBe(false);
  });

  it('Meta+key is not printable', () => {
    expect(isPrintable(key('a', { meta: true }))).toBe(false);
  });

  it('Alt+key IS printable (macOS special chars)', () => {
    expect(isPrintable(key('a', { alt: true }))).toBe(true);
  });

  it('Shift+key is printable (produces uppercase)', () => {
    expect(isPrintable(key('A', { shift: true }))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. InputMap
// ═══════════════════════════════════════════════════════════════════════════

describe('InputMap — lookup and mutation', () => {
  it('lookup returns action for known binding', () => {
    const map = new InputMap('other');
    expect(map.lookup(key('ArrowLeft'))).toBe('moveLeft');
    expect(map.lookup(key('ArrowRight'))).toBe('moveRight');
    expect(map.lookup(key('Backspace'))).toBe('deleteBackward');
  });

  it('lookup returns undefined for unknown key', () => {
    const map = new InputMap('other');
    expect(map.lookup(key('F12'))).toBeUndefined();
  });

  it('bind and lookup round-trip', () => {
    const map = new InputMap('other');
    map.bind(key('F5'), 'undo');
    expect(map.lookup(key('F5'))).toBe('undo');
  });

  it('unbind removes a binding', () => {
    const map = new InputMap('other');
    map.unbind(key('ArrowLeft'));
    expect(map.lookup(key('ArrowLeft'))).toBeUndefined();
  });

  it('clone produces independent copy', () => {
    const original = new InputMap('other');
    const copy = original.clone();
    copy.bind(key('F9'), 'redo');
    expect(original.lookup(key('F9'))).toBeUndefined();
    expect(copy.lookup(key('F9'))).toBe('redo');
  });
});

describe('InputMap — platform defaults', () => {
  it("'other' platform uses Ctrl+z for undo", () => {
    const map = new InputMap('other');
    expect(map.lookup(key('z', { ctrl: true }))).toBe('undo');
  });

  it("'other' platform uses Ctrl+a for selectAll", () => {
    const map = new InputMap('other');
    expect(map.lookup(key('a', { ctrl: true }))).toBe('selectAll');
  });

  it("'other' platform uses Ctrl+ArrowLeft for moveWordLeft", () => {
    const map = new InputMap('other');
    expect(map.lookup(key('ArrowLeft', { ctrl: true }))).toBe('moveWordLeft');
  });

  it("'mac' platform uses Meta+z for undo", () => {
    const map = new InputMap('mac');
    expect(map.lookup(key('z', { meta: true }))).toBe('undo');
  });

  it("'mac' platform uses Meta+a for selectAll", () => {
    const map = new InputMap('mac');
    expect(map.lookup(key('a', { meta: true }))).toBe('selectAll');
  });

  it("'mac' platform uses Alt+ArrowLeft for moveWordLeft", () => {
    const map = new InputMap('mac');
    expect(map.lookup(key('ArrowLeft', { alt: true }))).toBe('moveWordLeft');
  });

  it('both platforms bind Shift+Tab to dedent', () => {
    expect(new InputMap('other').lookup(key('Tab', { shift: true }))).toBe('dedent');
    expect(new InputMap('mac').lookup(key('Tab', { shift: true }))).toBe('dedent');
  });

  it('buildDefaultInputMap returns correct platform map', () => {
    expect(buildDefaultInputMap('other').lookup(key('z', { ctrl: true }))).toBe('undo');
    expect(buildDefaultInputMap('mac').lookup(key('z', { meta: true }))).toBe('undo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. EditorActions
// ═══════════════════════════════════════════════════════════════════════════

describe('wordBoundaryLeft (LOCK-25)', () => {
  it('moves to previous word start from middle of word', () => {
    expect(wordBoundaryLeft('hello world', 9)).toBe(6); // "wor|ld" → start of "world"
  });

  it('skips whitespace before word', () => {
    expect(wordBoundaryLeft('foo   bar', 9)).toBe(6); // end of "bar" → start of "bar"
  });

  it('returns 0 at start of line', () => {
    expect(wordBoundaryLeft('hello', 0)).toBe(0);
    expect(wordBoundaryLeft('hello', 1)).toBe(0);
  });

  it('handles operator run', () => {
    expect(wordBoundaryLeft('x + y', 4)).toBe(2); // "+" is operator word
  });
});

describe('wordBoundaryRight (LOCK-25)', () => {
  it('moves to end of current word', () => {
    expect(wordBoundaryRight('hello world', 0)).toBe(5); // start of "hello" → end
  });

  it('skips whitespace and lands at end of next word', () => {
    expect(wordBoundaryRight('hello world', 5)).toBe(11); // past "world"
  });

  it('returns line length at end of line', () => {
    expect(wordBoundaryRight('hello', 5)).toBe(5);
  });

  it('handles operator word', () => {
    expect(wordBoundaryRight('x + y', 2)).toBe(3); // "+" → past "+"
  });
});

describe('EditorActions — text insertion', () => {
  it('insertText inserts at cursor', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 5);
    makeActions(doc).insertText('!');
    expect(doc.getText()).toBe('hello!');
    expect(doc.cursor.column).toBe(6);
  });

  it('insertText replaces non-collapsed selection', () => {
    const doc = makeDoc('hello world');
    // Select "world"
    doc.moveCursor(doc.createCursor(0, 6));
    doc.extendSelection(doc.createCursor(0, 11));
    makeActions(doc).insertText('Luau');
    expect(doc.getText()).toBe('hello Luau');
  });

  it('insertNewline splits line', () => {
    const doc = makeDoc('helloworld');
    placeCursor(doc, 0, 5);
    makeActions(doc).insertNewline();
    expect(doc.lineCount).toBe(2);
    expect(doc.getLine(0)).toBe('hello');
    expect(doc.getLine(1)).toBe('world');
  });

  it('insertTab inserts 2 spaces by default', () => {
    const doc = makeDoc('code');
    placeCursor(doc, 0, 0);
    makeActions(doc).insertTab();
    expect(doc.getLine(0)).toBe('  code');
  });
});

describe('EditorActions — deletion', () => {
  it('deleteBackward removes char before cursor', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 5);
    makeActions(doc).deleteBackward();
    expect(doc.getText()).toBe('hell');
    expect(doc.cursor.column).toBe(4);
  });

  it('deleteForward removes char after cursor', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 0);
    makeActions(doc).deleteForward();
    expect(doc.getText()).toBe('ello');
    expect(doc.cursor.column).toBe(0);
  });

  it('deleteBackward at line start merges lines', () => {
    const doc = makeDoc('hello\nworld');
    placeCursor(doc, 1, 0);
    makeActions(doc).deleteBackward();
    expect(doc.getText()).toBe('helloworld');
    expect(doc.lineCount).toBe(1);
  });

  it('deleteWordBackward removes previous word', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 11); // end of "world"
    makeActions(doc).deleteWordBackward();
    expect(doc.getText()).toBe('hello ');
  });

  it('deleteWordForward removes next word', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 6); // start of "world"
    makeActions(doc).deleteWordForward();
    expect(doc.getText()).toBe('hello ');
  });

  it('deleteWordBackward deletes selection if non-collapsed', () => {
    const doc = makeDoc('hello world');
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(0, 5));
    makeActions(doc).deleteWordBackward();
    expect(doc.getText()).toBe(' world');
  });

  it('deleteToLineStart removes from cursor to line beginning', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 5);
    makeActions(doc).deleteToLineStart();
    expect(doc.getText()).toBe(' world');
  });

  it('deleteToLineEnd removes from cursor to line end', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 5);
    makeActions(doc).deleteToLineEnd();
    expect(doc.getText()).toBe('hello');
  });
});

describe('EditorActions — cursor movement (LOCK-26)', () => {
  it('moveLeft moves cursor one step left', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 3);
    makeActions(doc).moveLeft();
    expect(doc.cursor.column).toBe(2);
  });

  it('moveLeft with selection collapses to start (LOCK-26)', () => {
    const doc = makeDoc('hello world');
    doc.moveCursor(doc.createCursor(0, 3));
    doc.extendSelection(doc.createCursor(0, 8));
    makeActions(doc).moveLeft();
    expect(doc.selection.isCollapsed).toBe(true);
    expect(doc.cursor.column).toBe(3); // collapsed to selection start
  });

  it('moveRight with selection collapses to end (LOCK-26)', () => {
    const doc = makeDoc('hello world');
    doc.moveCursor(doc.createCursor(0, 3));
    doc.extendSelection(doc.createCursor(0, 8));
    makeActions(doc).moveRight();
    expect(doc.selection.isCollapsed).toBe(true);
    expect(doc.cursor.column).toBe(8); // collapsed to selection end
  });

  it('moveToLineStart moves cursor to column 0', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 4);
    makeActions(doc).moveToLineStart();
    expect(doc.cursor.column).toBe(0);
  });

  it('moveToLineEnd moves cursor to end of line', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 0);
    makeActions(doc).moveToLineEnd();
    expect(doc.cursor.column).toBe(5);
  });

  it('moveToDocStart moves cursor to (0,0)', () => {
    const doc = makeDoc('line0\nline1\nline2');
    placeCursor(doc, 2, 5);
    makeActions(doc).moveToDocStart();
    expect(doc.cursor.line).toBe(0);
    expect(doc.cursor.column).toBe(0);
  });

  it('moveToDocEnd moves cursor to last line end', () => {
    const doc = makeDoc('line0\nline1\nend');
    placeCursor(doc, 0, 0);
    makeActions(doc).moveToDocEnd();
    expect(doc.cursor.line).toBe(2);
    expect(doc.cursor.column).toBe(3);
  });

  it('moveWordLeft jumps to previous word start', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 11);
    makeActions(doc).moveWordLeft();
    expect(doc.cursor.column).toBe(6);
  });

  it('moveWordRight jumps to next word end', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 0);
    makeActions(doc).moveWordRight();
    expect(doc.cursor.column).toBe(5);
  });

  it('moveWordLeft at column 0 jumps to end of previous line', () => {
    const doc = makeDoc('hello\nworld');
    placeCursor(doc, 1, 0);
    makeActions(doc).moveWordLeft();
    expect(doc.cursor.line).toBe(0);
    expect(doc.cursor.column).toBe(5);
  });
});

describe('EditorActions — selection extension (LOCK-26)', () => {
  it('selectLeft extends selection leftward', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 3);
    makeActions(doc).selectLeft();
    expect(doc.selection.isCollapsed).toBe(false);
    const { start, end } = doc.selection.ordered();
    expect(start.column).toBe(2);
    expect(end.column).toBe(3);
  });

  it('selectRight extends selection rightward', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 0);
    makeActions(doc).selectRight();
    expect(doc.selection.isCollapsed).toBe(false);
    const { start, end } = doc.selection.ordered();
    expect(start.column).toBe(0);
    expect(end.column).toBe(1);
  });

  it('selectAll selects entire document', () => {
    const doc = makeDoc('line0\nline1\nline2');
    makeActions(doc).selectAll();
    const { start, end } = doc.selection.ordered();
    expect(start).toEqual({ line: 0, column: 0 });
    expect(end).toEqual({ line: 2, column: 5 });
  });

  it('selectWordLeft extends to previous word boundary', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 11);
    makeActions(doc).selectWordLeft();
    const { start, end } = doc.selection.ordered();
    expect(start.column).toBe(6);
    expect(end.column).toBe(11);
  });

  it('selectToLineEnd extends to end of line', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 0);
    makeActions(doc).selectToLineEnd();
    const { end } = doc.selection.ordered();
    expect(end.column).toBe(11);
  });
});

describe('EditorActions — undo/redo', () => {
  it('undo reverses insertText', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 5);
    const actions = makeActions(doc);
    actions.insertText('!');
    expect(doc.getText()).toBe('hello!');
    actions.undo();
    expect(doc.getText()).toBe('hello');
  });

  it('redo re-applies after undo', () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    const actions = makeActions(doc);
    actions.insertText('x');
    actions.undo();
    actions.redo();
    expect(doc.getText()).toBe('x');
  });
});

describe('EditorActions — clipboard (LOCK-28)', () => {
  it('copy writes selected text to clipboard', async () => {
    const doc  = makeDoc('hello world');
    const cb   = new MemoryClipboard();
    doc.moveCursor(doc.createCursor(0, 6));
    doc.extendSelection(doc.createCursor(0, 11));
    await makeActions(doc, cb).copy();
    expect(cb.contents).toBe('world');
  });

  it('copy is a no-op when selection is collapsed', async () => {
    const doc = makeDoc('hello');
    const cb  = new MemoryClipboard();
    placeCursor(doc, 0, 3);
    await makeActions(doc, cb).copy();
    expect(cb.contents).toBe('');
  });

  it('cut removes selection and writes to clipboard', async () => {
    const doc = makeDoc('hello world');
    const cb  = new MemoryClipboard();
    doc.moveCursor(doc.createCursor(0, 6));
    doc.extendSelection(doc.createCursor(0, 11));
    await makeActions(doc, cb).cut();
    expect(cb.contents).toBe('world');
    expect(doc.getText()).toBe('hello ');
  });

  it('paste inserts text at cursor', () => {
    const doc = makeDoc('hello ');
    placeCursor(doc, 0, 6);
    makeActions(doc).paste('world');
    expect(doc.getText()).toBe('hello world');
  });

  it('pasteFromClipboard reads and inserts clipboard text', async () => {
    const doc = makeDoc('');
    const cb  = new MemoryClipboard();
    await cb.write('pasted');
    placeCursor(doc, 0, 0);
    await makeActions(doc, cb).pasteFromClipboard();
    expect(doc.getText()).toBe('pasted');
  });
});

describe('EditorActions — indent / dedent', () => {
  it('dedent removes up to tabSize leading spaces', () => {
    const doc = makeDoc('  hello');
    placeCursor(doc, 0, 0);
    makeActions(doc).dedent();
    expect(doc.getLine(0)).toBe('hello');
  });

  it('dedent removes fewer spaces when fewer exist', () => {
    const doc = makeDoc(' hello');
    placeCursor(doc, 0, 0);
    makeActions(doc).dedent();
    expect(doc.getLine(0)).toBe('hello');
  });

  it('dedent is a no-op when no leading spaces', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 0);
    makeActions(doc).dedent();
    expect(doc.getLine(0)).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. KeyboardHandler
// ═══════════════════════════════════════════════════════════════════════════

describe('KeyboardHandler', () => {
  function makeHandler(doc: Document) {
    return new KeyboardHandler(makeActions(doc), new InputMap('other'));
  }

  it('mapped key dispatches correct action and returns true', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 3);
    const handled = makeHandler(doc).handleKey(key('ArrowLeft'));
    expect(handled).toBe(true);
    expect(doc.cursor.column).toBe(2);
  });

  it('Ctrl+z dispatches undo', () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    const h = makeHandler(doc);
    h.handleKey(key('a'));           // insert 'a'
    h.handleKey(key('z', { ctrl: true })); // undo
    expect(doc.getText()).toBe('');
  });

  it('printable character falls through to insertText (LOCK-27)', () => {
    const doc = makeDoc('');
    placeCursor(doc, 0, 0);
    const handled = makeHandler(doc).handleKey(key('x'));
    expect(handled).toBe(true);
    expect(doc.getText()).toBe('x');
  });

  it('Ctrl+key does NOT fall through to insertText (LOCK-27)', () => {
    const doc = makeDoc('');
    const h = makeHandler(doc);
    // Ctrl+P is not bound — should return false, not insert 'p'
    const handled = h.handleKey(key('p', { ctrl: true }));
    expect(handled).toBe(false);
    expect(doc.getText()).toBe('');
  });

  it('Meta+key does NOT fall through to insertText (LOCK-27)', () => {
    const doc = makeDoc('');
    const h = makeHandler(doc);
    const handled = h.handleKey(key('p', { meta: true }));
    expect(handled).toBe(false);
    expect(doc.getText()).toBe('');
  });

  it('non-printable unmapped key returns false', () => {
    const doc = makeDoc('');
    const handled = makeHandler(doc).handleKey(key('F12'));
    expect(handled).toBe(false);
  });

  it('setInputMap swaps the binding table', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 3);
    const h = makeHandler(doc);
    const newMap = new InputMap('other');
    newMap.bind(key('F1'), 'moveToDocStart');
    h.setInputMap(newMap);
    h.handleKey(key('F1'));
    expect(doc.cursor.line).toBe(0);
    expect(doc.cursor.column).toBe(0);
  });

  it('Enter inserts newline', () => {
    const doc = makeDoc('helloworld');
    placeCursor(doc, 0, 5);
    makeHandler(doc).handleKey(key('Enter'));
    expect(doc.lineCount).toBe(2);
  });

  it('Backspace deletes backward', () => {
    const doc = makeDoc('hello');
    placeCursor(doc, 0, 5);
    makeHandler(doc).handleKey(key('Backspace'));
    expect(doc.getText()).toBe('hell');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F. MouseHandler
// ═══════════════════════════════════════════════════════════════════════════

describe('MouseHandler', () => {
  function makeMouseHandler(doc: Document, vp?: Viewport): MouseHandler {
    const viewport = vp ?? makeViewport();
    return new MouseHandler(doc, () => viewport);
  }

  function ptrDown(x: number, y: number, opts: Partial<EditorPointerEventOpts> = {}) {
    return { x, y, button: 0 as const, shift: false, ctrl: false, alt: false, meta: false, ...opts };
  }

  type EditorPointerEventOpts = { button: 0|1|2; shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };

  it('click moves cursor to the correct (line, column)', () => {
    const doc = makeDoc('hello\nworld\nfoo');
    // lineHeight=20, charWidth=8, scrollTop=0
    // y=20 → line 1; x=24 → column 3
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handlePointerDown(ptrDown(24, 20));
    expect(doc.cursor.line).toBe(1);
    expect(doc.cursor.column).toBe(3);
  });

  it('click collapses any existing selection', () => {
    const doc = makeDoc('hello world');
    doc.moveCursor(doc.createCursor(0, 0));
    doc.extendSelection(doc.createCursor(0, 5));
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handlePointerDown(ptrDown(0, 0));
    expect(doc.selection.isCollapsed).toBe(true);
  });

  it('shift-click extends selection from current anchor', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 0);
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handlePointerDown(ptrDown(40, 0, { shift: true }));
    expect(doc.selection.isCollapsed).toBe(false);
    const { start, end } = doc.selection.ordered();
    expect(start.column).toBe(0);
    expect(end.column).toBe(5);
  });

  it('drag (down + move) creates a selection', () => {
    const doc = makeDoc('hello world');
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handlePointerDown(ptrDown(0, 0));  // cursor at (0,0)
    h.handlePointerMove(ptrDown(40, 0), true);  // extend to col 5
    expect(doc.selection.isCollapsed).toBe(false);
    const { end } = doc.selection.ordered();
    expect(end.column).toBe(5);
  });

  it('handlePointerMove with isDown=false does nothing', () => {
    const doc = makeDoc('hello world');
    placeCursor(doc, 0, 0);
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handlePointerMove(ptrDown(40, 0), false);
    expect(doc.selection.isCollapsed).toBe(true);
    expect(doc.cursor.column).toBe(0);
  });

  it('double-click selects the word under pointer', () => {
    const doc = makeDoc('hello world');
    // x=48 → col 6, which is inside "world"
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handleDoubleClick(ptrDown(48, 0));
    expect(doc.selection.isCollapsed).toBe(false);
    const { start, end } = doc.selection.ordered();
    expect(start.column).toBe(6);
    expect(end.column).toBe(11);
  });

  it('click is clamped to document bounds (below last line)', () => {
    const doc = makeDoc('hello');
    // y=9999 should clamp to last line (0)
    const h = makeMouseHandler(doc, makeViewport(0));
    h.handlePointerDown(ptrDown(0, 9999));
    expect(doc.cursor.line).toBe(0);
  });

  it('click respects scroll offset via Viewport', () => {
    const doc = makeDoc('line0\nline1\nline2\nline3\nline4');
    // scrollTop=40 (scrolled 2 lines down): y=0 should hit line 2
    const h = makeMouseHandler(doc, makeViewport(40));
    h.handlePointerDown(ptrDown(0, 0));
    expect(doc.cursor.line).toBe(2);
  });
});
