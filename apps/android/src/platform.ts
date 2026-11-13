import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { DEFAULT_TIMEOUT_MS, type HttpClient, type PlatformAPI } from '@hiresspot/core';
import { createNativeAudio, onNativeRemoteCommand } from './nativeAudio';

/** Peticiones por el HTTP nativo de Android: sin CORS ni restricciones de contenido mixto. */
const http: HttpClient = async (url, options = {}) => {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = CapacitorHttp.request({ url, method: 'GET', responseType: 'text', connectTimeout: timeout, readTimeout: timeout });
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => reject(new Error('Cancelado'));
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
  });
  const res = await Promise.race([request, aborted]);
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  return { ok: res.status >= 200 && res.status < 300, status: res.status, statusText: '', text };
};

const notYet = (what: string) => () => Promise.reject(new Error(`${what} aún no está disponible en Android.`));

export const createAndroidPlatform = (): PlatformAPI => ({
  // La biblioteca local (carpetas) llega más adelante con el acceso al almacenamiento de Android
  library: {
    supported: false,
    getRoots: async () => [],
    addRoot: async () => null,
    removeRoot: async () => {},
    scan: async () => []
  },
  media: {
    urlFor: () => '',
    // Reproductor nativo (ExoPlayer en un servicio en primer plano): suena con la pantalla apagada y abre los
    // FLAC con portada mal formada que el WebView rechaza
    createAudio: createNativeAudio,
    supportsEqualizer: false,
    onRemoteCommand: onNativeRemoteCommand
  },
  http,
  settings: {
    async get<T>(key: string) {
      const { value } = await Preferences.get({ key: `settings.${key}` });
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await Preferences.set({ key: `settings.${key}`, value: JSON.stringify(value) });
    }
  },
  // Keystore de Android (AES-GCM): las contraseñas nunca quedan en claro en el almacenamiento
  secrets: {
    isAvailable: async () => Capacitor.isNativePlatform(),
    async get(key) {
      const v = await SecureStorage.get(key, false, false);
      return typeof v === 'string' ? v : null;
    },
    async set(key, value) {
      await SecureStorage.set(key, value, false, false);
    },
    async delete(key) {
      await SecureStorage.remove(key, false);
    }
  },
  // El inicio de sesión de Spotify (PKCE) necesita un esquema de redirección propio registrado en su panel
  spotify: {
    status: async () => ({ connected: false }),
    login: notYet('Spotify'),
    logout: async () => {},
    api: notYet('Spotify')
  }
});
