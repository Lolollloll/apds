import { defineConfig } from 'vite';
import { resolve }       from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root:    resolve(__dirname, 'demo'),
  base:    './',
  resolve: {
    alias: {
      // Allow demo code to import APDS source directly via relative paths.
      // No bundled build needed — Vite handles TypeScript transpilation.
    },
  },
  build: {
    outDir:      resolve(__dirname, 'demo-dist'),
    emptyOutDir: true,
    target:      'es2022',
    rollupOptions: {
      input: resolve(__dirname, 'demo/index.html'),
    },
  },
  server: {
    port:      5173,
    open:      true,
    host:      true,
  },
  optimizeDeps: {
    // Vite should not pre-bundle our local TS source
    exclude: [],
  },
});
