/**
 * APDS — Embed Entry Point
 *
 * Mounts the editor into #editor-mount.
 * Access the host via window.apds for programmatic control:
 *
 *   window.apds.loadText(code)          — load content
 *   window.apds.setTheme('dark'|'light')— switch theme
 *   window.apds.loadEmpty()             — clear editor
 */

import { EditorHost } from './EditorHost.js';
import './style.css';

document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('editor-mount');
  if (!mount) {
    console.error('APDS: #editor-mount not found');
    return;
  }

  const host = new EditorHost(mount, '');
  (window as any).apds = host;
});
