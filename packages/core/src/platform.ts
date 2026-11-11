import type { HttpClient } from './http';
import type { Track } from './types';

/**
 * Contrato entre la UI/core y cada shell (Electron hoy, Capacitor después).
 * La UI nunca toca `window.api` ni `electron`: solo recibe un PlatformAPI.
 */
export interface SpotifyStatus {
  connected: boolean;
  /** Nombre visible de la cuenta, si se conoce. */
  name?: string;
}

export interface PlatformAPI {
  library: {
    /** Carpetas de música que el usuario autorizó. */
    getRoots(): Promise<string[]>;
    /** Abre el selector de carpeta, la autoriza y la devuelve (null si cancela). */
    addRoot(): Promise<string | null>;
    removeRoot(root: string): Promise<void>;
    /** Escanea una carpeta autorizada. */
    scan(root: string): Promise<Track[]>;
  };
  media: {
    /** URL reproducible por <audio> para una pista local (la plataforma decide el esquema). */
    urlFor(track: Track): string;
    /**
     * Opcional. URL equivalente a `upstreamUrl` (stream FLAC de un servidor) pero sin los bloques PICTURE
     * defectuosos que Chromium no sabe abrir. Si la plataforma no lo necesita, se usa la URL original.
     */
    sanitizedFlacUrl?(upstreamUrl: string): string;
    /**
     * Opcional. Píxeles RGBA 32x32 de una carátula remota que el canvas no puede leer (sin CORS), para derivar
     * la paleta. La plataforma solo debe atender URLs de portada del servidor configurado.
     */
    coverPixels?(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null>;
  };
  /** Opcional. Integración con el sistema operativo de escritorio. */
  power?: {
    /** Mientras es true, el sistema no se suspende (música sonando). */
    setPlaying(playing: boolean): Promise<void>;
  };
  /** Peticiones HTTP a la API de un servidor (sin CORS). Solo rutas /rest/ de Subsonic/Navidrome. */
  http: HttpClient;
  /** Ajustes no sensibles (JSON). */
  settings: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  /**
   * Secretos (contraseñas, tokens) cifrados con el llavero del sistema. Si `isAvailable()` es
   * false (p. ej. Linux sin llavero) NO se persiste nada: la app debe pedir el secreto de nuevo.
   */
  secrets: {
    isAvailable(): Promise<boolean>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /**
   * Spotify (solo biblioteca). El OAuth y los tokens viven en la plataforma: la UI nunca los ve y
   * solo puede pedir rutas de lectura de la Web API (`/v1/...`).
   */
  spotify: {
    status(): Promise<SpotifyStatus>;
    /** Abre el navegador para autorizar y espera el resultado. */
    login(): Promise<SpotifyStatus>;
    logout(): Promise<void>;
    /** GET autenticado a la Web API; `path` empieza por `/v1/`. Devuelve el JSON. */
    api(path: string): Promise<unknown>;
  };
}
