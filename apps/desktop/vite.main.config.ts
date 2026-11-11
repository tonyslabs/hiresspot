import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'out/main',
    emptyOutDir: false,
    lib: {
      entry: 'src/main/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.js'
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
