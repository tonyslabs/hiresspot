import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// CSP estricta solo en el build (en dev Vite necesita scripts inline y WebSocket para HMR).
const cspForBuild = (): Plugin => ({
  name: 'hiresspot-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: hires-media: http: https:",
          "media-src 'self' blob: hires-media: http: https:",
          "connect-src 'self' hires-media:",
          "worker-src 'self' blob:"
        ].join('; ')
      },
      injectTo: 'head-prepend'
    }
  ]
});

export default defineConfig({
  plugins: [react(), cspForBuild()],
  // Los paquetes del workspace se sirven como código fuente (HMR); si Vite los pre-empaqueta,
  // los cambios en packages/* no se reflejan hasta que cambie el lockfile.
  server: {
    // Puerto propio y estricto: con otro Vite en 5173 (IPv4 vs IPv6) la ventana podía cargar el servidor equivocado
    host: '127.0.0.1',
    // HIRESSPOT_VITE_PORT permite una 2ª instancia (pruebas) sin chocar con la de desarrollo
    port: Number(process.env.HIRESSPOT_VITE_PORT) || 5273,
    strictPort: true,
    // Nunca cachear en dev (ver `clearCache` en main.ts)
    headers: { 'Cache-Control': 'no-store' }
  },
  optimizeDeps: {
    exclude: ['@hiresspot/ui', '@hiresspot/core'],
    // Dependencias de los paquetes excluidos: sin pre-empaquetar, las CJS (p. ej. `cookie`, de react-router) fallan
    include: ['react-router-dom', '@tanstack/react-virtual']
  },
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  build: {
    emptyOutDir: true
  }
});
