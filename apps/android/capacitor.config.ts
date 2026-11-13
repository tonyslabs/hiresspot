import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.drskxll.hiresspot',
  appName: 'HiResSpot',
  webDir: 'dist',
  android: {
    // Navidrome suele estar en http (Tailscale/LAN): el WebView debe poder cargar portadas y audio http desde la app
    allowMixedContent: true
  },
  server: {
    // Esquema http (evita el bloqueo de contenido mixto hacia servidores propios en http) y cleartext permitido para hablar con servidores propios en http
    androidScheme: 'http',
    cleartext: true
  }
};

export default config;
