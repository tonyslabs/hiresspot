import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  NavidromeClient,
  NavidromeError,
  normalizeBaseUrl,
  type NavidromeConfig,
  type Lyrics,
  type PlaylistInfo,
  type ServerInfo,
  type Track
} from '@hiresspot/core';
import { usePlatform } from './platform';
import { clearCachedTracks, loadCachedTracks, saveCachedTracks } from './trackCache';

export type NavidromeStatus = 'disconnected' | 'connecting' | 'syncing' | 'ready' | 'error';

interface SavedConfig {
  baseUrl: string;
  username: string;
}

export interface NavidromeApi {
  status: NavidromeStatus;
  error: string | null;
  server: ServerInfo | null;
  tracks: Track[];
  /** Pistas descargadas durante la sincronización. */
  progress: number;
  /** Última configuración usada (para precargar el formulario). */
  saved: SavedConfig | null;
  /** false si el sistema no tiene llavero: la contraseña no se puede guardar. */
  canRemember: boolean;
  connect(config: NavidromeConfig, remember: boolean): Promise<boolean>;
  resync(): Promise<void>;
  disconnect(forget?: boolean): Promise<void>;
  /** URL de streaming del archivo original; '' si no hay conexión. */
  streamUrl(track: Track): string;
  toggleFavorite(track: Track): Promise<void>;
  /** Playlists del servidor (requiere conexión). */
  loadPlaylists(): Promise<PlaylistInfo[]>;
  loadPlaylistTracks(id: string): Promise<Track[]>;
  /** Letras (OpenSubsonic); null si no hay o el servidor no las soporta. */
  loadLyrics(track: Track): Promise<Lyrics | null>;
  scrobble(track: Track, submission: boolean, startedAtMs?: number): void;
  /** Valoración 1–5 (0 la quita). */
  setRating(track: Track, rating: number): Promise<void>;
  /** Mezcla aleatoria del servidor. */
  randomMix(size?: number): Promise<Track[]>;
  /** Pistas parecidas a `track` (radio). Vacío si el servidor no tiene datos. */
  similarTo(track: Track): Promise<Track[]>;
  /** Crea una playlist (opcionalmente con pistas) y devuelve su id. */
  createPlaylist(name: string, tracks?: Track[]): Promise<string>;
  addToPlaylist(playlistId: string, tracks: Track[]): Promise<void>;
  removeFromPlaylist(playlistId: string, indexes: number[]): Promise<void>;
  deletePlaylist(playlistId: string): Promise<void>;
}

const NavidromeContext = createContext<NavidromeApi | null>(null);

const SETTINGS_KEY = 'navidrome';
const SECRET_KEY = 'navidrome.password';
const cacheKey = (c: SavedConfig) => `navidrome:${c.baseUrl}:${c.username}`;

/** La caché nunca guarda `coverUrl`: lleva el token de autenticación. Se rehace con `hydrateCovers`. */
const scrub = (tracks: Track[]): Track[] => tracks.map((t) => ({ ...t, coverUrl: undefined }));

const messageOf = (err: unknown): string => {
  if (err instanceof NavidromeError) return err.message;
  // Los errores del IPC llegan como Error genérico: no exponer detalles internos
  return 'Ocurrió un error inesperado al hablar con el servidor.';
};

export const NavidromeProvider = ({ children }: { children: ReactNode }) => {
  const platform = usePlatform();

  const [status, setStatus] = useState<NavidromeStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [progress, setProgress] = useState(0);
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [canRemember, setCanRemember] = useState(false);

  const clientRef = useRef<NavidromeClient | null>(null);
  const savedRef = useRef<SavedConfig | null>(null);
  const generation = useRef(0); // invalida respuestas de conexiones/sincronizaciones anteriores

  const sync = useCallback(
    async (client: NavidromeClient, key: string, gen: number) => {
      setStatus('syncing');
      setProgress(0);
      try {
        const all = await client.getAllTracks((p) => gen === generation.current && setProgress(p.loaded));
        if (gen !== generation.current) return;
        setTracks(all);
        setError(null);
        setStatus('ready');
        void saveCachedTracks(key, scrub(all));
      } catch (err) {
        if (gen !== generation.current) return;
        setError(messageOf(err));
        setStatus('error');
      }
    },
    []
  );

  const connect = useCallback(
    async (config: NavidromeConfig, remember: boolean): Promise<boolean> => {
      const gen = ++generation.current;
      setStatus('connecting');
      setError(null);
      try {
        const normalized: SavedConfig = { baseUrl: normalizeBaseUrl(config.baseUrl), username: config.username.trim() };
        const client = new NavidromeClient({ ...config, baseUrl: normalized.baseUrl }, { http: platform.http });
        const info = await client.ping();
        if (gen !== generation.current) return false;

        clientRef.current = client;
        savedRef.current = normalized;
        setServer(info);
        setSaved(normalized);
        await platform.settings.set(SETTINGS_KEY, normalized);
        if (remember && canRemember) await platform.secrets.set(SECRET_KEY, config.password);
        else await platform.secrets.delete(SECRET_KEY);

        // Biblioteca en caché al instante, y sincronización en segundo plano
        const cached = await loadCachedTracks(cacheKey(normalized));
        if (gen !== generation.current) return false;
        if (cached) setTracks(client.hydrateCovers(cached.tracks));
        void sync(client, cacheKey(normalized), gen);
        return true;
      } catch (err) {
        if (gen !== generation.current) return false;
        clientRef.current = null;
        setError(messageOf(err));
        setStatus('error');
        return false;
      }
    },
    [platform, canRemember, sync]
  );

  const resync = useCallback(async () => {
    const client = clientRef.current;
    const cfg = savedRef.current;
    if (!client || !cfg) return;
    await sync(client, cacheKey(cfg), ++generation.current);
  }, [sync]);

  const disconnect = useCallback(
    async (forget = false) => {
      generation.current++;
      const cfg = savedRef.current;
      clientRef.current = null;
      setTracks([]);
      setServer(null);
      setError(null);
      setStatus('disconnected');
      if (forget) {
        await platform.secrets.delete(SECRET_KEY);
        await platform.settings.set(SETTINGS_KEY, null);
        if (cfg) await clearCachedTracks(cacheKey(cfg));
        savedRef.current = null;
        setSaved(null);
      }
    },
    [platform]
  );

  // Al iniciar: leer lo guardado y, si hay contraseña guardada, reconectar sola
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await platform.secrets.isAvailable().catch(() => false);
      if (cancelled) return;
      setCanRemember(available);
      const cfg = await platform.settings.get<SavedConfig>(SETTINGS_KEY).catch(() => null);
      if (!cfg || cancelled) return;
      setSaved(cfg);
      savedRef.current = cfg;
      const password = available ? await platform.secrets.get(SECRET_KEY).catch(() => null) : null;
      if (!password) {
        // Sin contraseña guardada: mostrar al menos la biblioteca en caché (se navega sin conexión)
        const startGen = generation.current;
        const cached = await loadCachedTracks(cacheKey(cfg));
        if (cached && !cancelled && generation.current === startGen) setTracks(scrub(cached.tracks));
        return;
      }
      if (cancelled) return;
      const gen = ++generation.current;
      setStatus('connecting');
      try {
        const client = new NavidromeClient({ ...cfg, password }, { http: platform.http });
        const info = await client.ping();
        if (gen !== generation.current) return;
        clientRef.current = client;
        setServer(info);
        const cached = await loadCachedTracks(cacheKey(cfg));
        if (gen !== generation.current) return;
        if (cached) setTracks(client.hydrateCovers(cached.tracks));
        void sync(client, cacheKey(cfg), gen);
      } catch (err) {
        if (gen !== generation.current) return;
        setError(messageOf(err));
        setStatus('error');
        // Sin red al arrancar: seguir mostrando la biblioteca en caché
        const cached = await loadCachedTracks(cacheKey(cfg));
        if (cached && gen === generation.current) setTracks(scrub(cached.tracks));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, sync]);

  const streamUrl = useCallback((track: Track) => clientRef.current?.streamUrl(track.sourceId) ?? '', []);

  const toggleFavorite = useCallback(async (track: Track) => {
    const client = clientRef.current;
    if (!client) return;
    const next = !track.favorite;
    const apply = (value: boolean) =>
      setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, favorite: value } : t)));
    apply(next); // optimista
    try {
      await (next ? client.star(track.sourceId) : client.unstar(track.sourceId));
    } catch (err) {
      apply(!next); // revertir si el servidor falla
      setError(messageOf(err));
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    const client = clientRef.current;
    if (!client) throw new NavidromeError('config', 'Conéctate al servidor para ver las playlists.');
    return client.getPlaylists();
  }, []);

  const loadPlaylistTracks = useCallback(async (id: string) => {
    const client = clientRef.current;
    if (!client) throw new NavidromeError('config', 'Conéctate al servidor para ver las playlists.');
    return client.getPlaylistTracks(id);
  }, []);

  const loadLyrics = useCallback(async (track: Track) => {
    const client = clientRef.current;
    if (!client || track.source !== 'navidrome') return null;
    return client.getLyrics(track.sourceId).catch(() => null);
  }, []);

  const scrobble = useCallback((track: Track, submission: boolean, startedAtMs?: number) => {
    // Es best-effort: un fallo de scrobble nunca debe interrumpir la música
    clientRef.current?.scrobble(track.sourceId, submission, startedAtMs).catch(() => {});
  }, []);

  const need = (): NavidromeClient => {
    const client = clientRef.current;
    if (!client) throw new NavidromeError('config', 'Conéctate al servidor para hacer esto.');
    return client;
  };

  const setRating = useCallback(async (track: Track, rating: number) => {
    const client = need();
    const prev = track.rating ?? 0;
    const apply = (value: number) =>
      setTracks((all) => all.map((t) => (t.id === track.id ? { ...t, rating: value || undefined } : t)));
    apply(rating); // optimista
    try {
      await client.setRating(track.sourceId, rating);
    } catch (err) {
      apply(prev);
      setError(messageOf(err));
      throw err;
    }
  }, []);

  const randomMix = useCallback((size = 50) => need().getRandomSongs(size), []);
  const similarTo = useCallback((track: Track) => need().getSimilarSongs(track.sourceId, 50), []);
  const createPlaylist = useCallback((name: string, tracks: Track[] = []) => need().createPlaylist(name.trim(), tracks.map((t) => t.sourceId)), []);
  const addToPlaylist = useCallback((id: string, tracks: Track[]) => need().addToPlaylist(id, tracks.map((t) => t.sourceId)), []);
  const removeFromPlaylist = useCallback((id: string, indexes: number[]) => need().removeFromPlaylist(id, indexes), []);
  const deletePlaylist = useCallback((id: string) => need().deletePlaylist(id), []);

  const api = useMemo<NavidromeApi>(
    () => ({ status, error, server, tracks, progress, saved, canRemember, connect, resync, disconnect, streamUrl, toggleFavorite, loadPlaylists, loadPlaylistTracks, loadLyrics, scrobble, setRating, randomMix, similarTo, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist }),
    [status, error, server, tracks, progress, saved, canRemember, connect, resync, disconnect, streamUrl, toggleFavorite, loadPlaylists, loadPlaylistTracks, loadLyrics, scrobble, setRating, randomMix, similarTo, createPlaylist, addToPlaylist, removeFromPlaylist, deletePlaylist]
  );

  return <NavidromeContext.Provider value={api}>{children}</NavidromeContext.Provider>;
};

export const useNavidrome = (): NavidromeApi => {
  const api = useContext(NavidromeContext);
  if (!api) throw new Error('useNavidrome: falta <NavidromeProvider>');
  return api;
};
