import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    // Evita prebundle problemático del decoder WASM en dev
    exclude: ['@wasm-audio-decoders/flac', '@eshaz/web-worker']
  },
  resolve: {
    alias: [
      {
        find: /^@eshaz\/web-worker$/,
        replacement: resolve(__dirname, 'src/renderer/shims/eshaz-web-worker.ts'),
      },
      {
        find: '@renderer',
        replacement: resolve(__dirname, 'src/renderer'),
      },
    ],
  },
  build: {
    outDir: '../../out/renderer/main_window',
    emptyOutDir: true
  },
  worker: {
    format: 'es'
  }
});
