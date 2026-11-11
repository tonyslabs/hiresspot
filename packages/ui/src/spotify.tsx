import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SpotifyClient, type SpotifyArtist, type SpotifyPlaylist, type Track } from '@hiresspot/core';
import { usePlatform } from './platform';
import { clearCachedTracks, loadCachedTracks, saveCachedTracks } from './trackCache';

export type SpotifyUiStatus = 'disconnected' | 'connecting' | 'syncing' | 'ready' | 'error';

export interface SpotifyApiCtx {
  status: SpotifyUiStatus;
  error: string | null;
  /** Nombre de la cuenta conectada. */
  name: string | null;
  /** Canciones que te gustan + pistas de álbumes guardados. */
  tracks: Track[];
  playlists: SpotifyPlaylist[];
  /** Artistas que sigues. */
  artists: SpotifyArtist[];
  progress: number;
  connect(): Promise<void>;
  resync(): Promise<void>;
  disconnect(): Promise<void>;
  loadPlaylist(id: string): Promise<Track[]>;
}

const Ctx = createContext<SpotifyApiCtx | null>(null);
const CACHE_KEY = 'spotify:library';

/** Los errores del IPC llegan como "Error invoking remote method 'x': Error: mensaje". */
const cleanMessage = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Ocurrió un error inesperado con Spotify.';
};

export const SpotifyProvider = ({ children }: { children: ReactNode }) => {
  const platform = usePlatform();
  const [status, setStatus] = useState<SpotifyUiStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [artists, setArtists] = useState<SpotifyArtist[]>([]);
  const [progress, setProgress] = useState(0);

  const generation = useRef(0);
  const client = useMemo(() => new SpotifyClient((path) => platform.spotify.api(path)), [platform]);

  const sync = useCallback(async () => {
    const gen = ++generation.current;
    setStatus('syncing');
    setProgress(0);
    setError(null);
    try {
      const all = await client.getLibraryTracks((n) => gen === generation.current && setProgress(n));
      if (gen !== generation.current) return;
      setTracks(all);
      void saveCachedTracks(CACHE_KEY, all);
      // Las playlists son secundarias: si fallan, la biblioteca sigue siendo válida
      try {
        const pl = await client.getPlaylists();
        if (gen === generation.current) setPlaylists(pl);
      } catch {
        /* se muestra sin playlists */
      }
      try {
        const ar = await client.getFollowedArtists();
        if (gen === generation.current) setArtists(ar);
      } catch {
        /* se muestra sin artistas seguidos */
      }
      // Tras reiniciar solo se conoce la sesión guardada: recuperar el nombre de la cuenta
      client.getProfileName().then((n) => gen === generation.current && n && setName(n)).catch(() => {});
      if (gen === generation.current) setStatus('ready');
    } catch (err) {
      if (gen !== generation.current) return;
      setError(cleanMessage(err));
      setStatus('error');
    }
  }, [client]);

  // Al iniciar: biblioteca en caché al instante y, si hay sesión guardada, sincroniza sola
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedTracks(CACHE_KEY).catch(() => null);
      if (cached && !cancelled) setTracks(cached.tracks);
      const st = await platform.spotify.status().catch(() => ({ connected: false }) as { connected: boolean; name?: string });
      if (cancelled || !st.connected) return;
      setName(st.name ?? null);
      void sync();
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, sync]);

  const connect = useCallback(async () => {
    generation.current++;
    setStatus('connecting');
    setError(null);
    try {
      const st = await platform.spotify.login();
      setName(st.name ?? null);
      await sync();
    } catch (err) {
      setError(cleanMessage(err));
      setStatus('error');
    }
  }, [platform, sync]);

  const disconnect = useCallback(async () => {
    generation.current++;
    await platform.spotify.logout().catch(() => {});
    await clearCachedTracks(CACHE_KEY).catch(() => {});
    setTracks([]);
    setPlaylists([]);
    setArtists([]);
    setName(null);
    setError(null);
    setStatus('disconnected');
  }, [platform]);

  const loadPlaylist = useCallback((id: string) => client.getPlaylistTracks(id), [client]);

  const api = useMemo<SpotifyApiCtx>(
    () => ({ status, error, name, tracks, playlists, artists, progress, connect, resync: sync, disconnect, loadPlaylist }),
    [status, error, name, tracks, playlists, artists, progress, connect, sync, disconnect, loadPlaylist]
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
};

export const useSpotify = (): SpotifyApiCtx => {
  const api = useContext(Ctx);
  if (!api) throw new Error('useSpotify: falta <SpotifyProvider>');
  return api;
};
