import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'out/preload',
    emptyOutDir: false,
    lib: {
      entry: 'src/preload/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.js'
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((moduleName) => `node:${moduleName}`)
      ]
    }
  }
});
