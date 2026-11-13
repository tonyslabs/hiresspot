import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: Number(process.env.HIRESSPOT_ANDROID_PORT) || 5275, strictPort: true },
  optimizeDeps: {
    exclude: ['@hiresspot/ui', '@hiresspot/core'],
    include: ['react-router-dom', '@tanstack/react-virtual']
  },
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { emptyOutDir: true, target: 'es2022' }
});
