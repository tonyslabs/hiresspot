import { DEFAULT_TIMEOUT_MS, fetchHttp, type HttpClient } from '../../http';
import type { Track } from '../../types';
import type { Lyrics } from '../../lyrics';
import { isAuthCode, NavidromeError, subsonicErrorMessage } from './errors';
import { md5 } from './md5';

export const API_VERSION = '1.16.1';

export interface NavidromeConfig {
  /** URL base del servidor, p. ej. http://100.76.255.29:4533 */
  baseUrl: string;
  username: string;
  password: string;
}

export interface NavidromeClientOptions {
  http?: HttpClient;
  /** Nombre con el que el cliente se identifica ante el servidor (parámetro `c`). */
  clientName?: string;
  timeoutMs?: number;
  /** Sal fija (solo pruebas). Por defecto aleatoria por instancia. */
  salt?: string;
}

// ---- Tipos de la API (solo los campos que usamos) ----

export interface SubsonicSong {
  id: string;
  title: string;
  album?: string;
  artist?: string;
  displayAlbumArtist?: string;
  albumArtists?: { id?: string; name: string }[];
  track?: number;
  discNumber?: number;
  year?: number;
  duration?: number;
  bitRate?: number;
  samplingRate?: number;
  bitDepth?: number;
  suffix?: string;
  coverArt?: string;
  isrc?: string[];
  musicBrainzId?: string;
  replayGain?: { trackGain?: number; albumGain?: number; trackPeak?: number; albumPeak?: number };
  starred?: string;
  genre?: string;
  userRating?: number;
  playCount?: number;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  songCount?: number;
  song?: SubsonicSong[];
}

export interface ServerInfo {
  /** Versión de la API Subsonic. */
  apiVersion: string;
  /** Tipo de servidor, p. ej. "navidrome". */
  type?: string;
  serverVersion?: string;
  openSubsonic: boolean;
}

export interface PlaylistInfo {
  id: string;
  name: string;
  songCount: number;
  duration?: number;
  /** Id de portada que reporta el servidor (Navidrome arma un collage de la playlist). */
  coverArt?: string;
  /** URL de la portada con la autenticación de esta sesión; no se guarda en caché. */
  coverUrl?: string;
}

export interface SyncProgress {
  loaded: number;
  /** Total estimado si se conoce. */
  total?: number;
}

// ---- Utilidades ----

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[?::1\]?)/;

/**
 * Normaliza la URL del servidor: añade esquema si falta (http para hosts locales/Tailscale,
 * https para el resto), quita barras finales y valida que sea http(s).
 */
export const normalizeBaseUrl = (input: string): string => {
  let raw = input.trim();
  if (!raw) throw new NavidromeError('config', 'Escribe la URL del servidor.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = raw.split(/[/:]/)[0];
    const isLocal = LOCAL_HOST.test(host) || host.endsWith('.local') || host.endsWith('.ts.net');
    raw = `${isLocal ? 'http' : 'https'}://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NavidromeError('config', 'La URL del servidor no es válida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NavidromeError('config', 'La URL debe empezar con http:// o https://.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

const randomSalt = (): string => {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const toArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// ---- Cliente ----

export class NavidromeClient {
  readonly baseUrl: string;
  private readonly username: string;
  private readonly token: string;
  private readonly salt: string;
  private readonly http: HttpClient;
  private readonly clientName: string;
  private readonly timeoutMs: number;

  constructor(config: NavidromeConfig, options: NavidromeClientOptions = {}) {
    if (!config.username.trim()) throw new NavidromeError('config', 'Escribe el usuario.');
    if (!config.password) throw new NavidromeError('config', 'Escribe la contraseña.');
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.username = config.username.trim();
    this.salt = options.salt ?? randomSalt();
    // El token se calcula una vez: así las URLs de stream y portada son estables (cacheables)
    // y la contraseña no viaja en claro ni se guarda en las URLs.
    this.token = md5(config.password + this.salt);
    this.http = options.http ?? fetchHttp;
    this.clientName = options.clientName ?? 'HiResSpot';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ---- URLs ----

  private authParams(): URLSearchParams {
    return new URLSearchParams({ u: this.username, t: this.token, s: this.salt, v: API_VERSION, c: this.clientName });
  }

  private url(endpoint: string, params: Record<string, string | number | string[] | number[] | undefined> = {}, json = true): string {
    const q = this.authParams();
    if (json) q.set('f', 'json');
    // Los parámetros repetidos (songId, songIdToAdd…) se envían una vez por valor
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const item of v) q.append(k, String(item));
      else q.set(k, String(v));
    }
    return `${this.baseUrl}/rest/${endpoint}.view?${q.toString()}`;
  }

  /**
   * URL de streaming. Por defecto `format=raw`: el archivo original sin transcodificar
   * (clave para hi-fi). Con `maxBitRate`/`format` el servidor transcodifica.
   */
  streamUrl(id: string, opts: { format?: string; maxBitRate?: number } = {}): string {
    return this.url('stream', { id, format: opts.format ?? 'raw', maxBitRate: opts.maxBitRate }, false);
  }

  coverArtUrl(id: string, size?: number): string {
    return this.url('getCoverArt', { id, size }, false);
  }

  // ---- Llamadas ----

  private async call<T>(endpoint: string, params: Record<string, string | number | string[] | number[] | undefined> = {}): Promise<T> {
    let res;
    try {
      res = await this.http(this.url(endpoint, params), { timeoutMs: this.timeoutMs });
    } catch (err) {
      const aborted = err instanceof Error && (err.name === 'AbortError' || /abort|timeout/i.test(err.message));
      throw new NavidromeError(
        'network',
        aborted ? 'El servidor tardó demasiado en responder.' : 'No se pudo conectar con el servidor. Revisa la URL y la red.'
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new NavidromeError('auth', 'El servidor rechazó las credenciales.', res.status);
    }
    if (!res.ok) {
      throw new NavidromeError('http', `El servidor respondió ${res.status} ${res.statusText}`.trim(), res.status);
    }

    let body: { 'subsonic-response'?: Record<string, unknown> };
    try {
      body = JSON.parse(res.text);
    } catch {
      throw new NavidromeError('protocol', 'La respuesta no es JSON: ¿es un servidor Navidrome/Subsonic?');
    }
    const root = body['subsonic-response'];
    if (!root || typeof root !== 'object') {
      throw new NavidromeError('protocol', 'La respuesta no es de la API Subsonic: ¿es la URL correcta?');
    }
    if (root.status !== 'ok') {
      const e = (root.error ?? {}) as { code?: number; message?: string };
      const code = typeof e.code === 'number' ? e.code : 0;
      throw new NavidromeError(isAuthCode(code) ? 'auth' : 'api', subsonicErrorMessage(code, e.message), code);
    }
    return root as T;
  }

  /** Comprueba conexión y credenciales. */
  async ping(): Promise<ServerInfo> {
    const r = await this.call<{ version: string; type?: string; serverVersion?: string; openSubsonic?: boolean }>('ping');
    return { apiVersion: r.version, type: r.type, serverVersion: r.serverVersion, openSubsonic: r.openSubsonic === true };
  }

  async getLyrics(id: string): Promise<Lyrics | null> {
    interface StructuredLyrics {
      lang?: string;
      synced: boolean;
      offset?: number;
      line?: { start?: number; value: string } | { start?: number; value: string }[];
    }
    try {
      const r = await this.call<{ lyricsList?: { structuredLyrics?: StructuredLyrics | StructuredLyrics[] } }>(
        'getLyricsBySongId', { id }
      );
      const available = toArray(r.lyricsList?.structuredLyrics);
      const selected = available.find((lyrics) => lyrics.synced) ?? available[0];
      if (!selected) return null;
      const lines = toArray(selected.line).map((line) => ({
        timeMs: selected.synced && line.start !== undefined ? line.start + (selected.offset ?? 0) : null,
        text: line.value
      }));
      if (lines.length === 0) return null;
      lines.sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity));
      return { synced: selected.synced, lang: selected.lang, lines };
    } catch (err) {
      // La extensión es opcional: servidores antiguos pueden rechazarla.
      if (err instanceof NavidromeError && (err.kind === 'api' || (err.kind === 'http' && err.code === 404))) return null;
      throw err;
    }
  }

  async getAlbum(id: string): Promise<SubsonicAlbum> {
    const r = await this.call<{ album: SubsonicAlbum & { song?: SubsonicSong | SubsonicSong[] } }>('getAlbum', { id });
    return { ...r.album, song: toArray(r.album.song) };
  }

  /** Una página de pistas vía `search3` con consulta vacía (devuelve toda la biblioteca). */
  async searchSongs(query: string, count: number, offset: number): Promise<SubsonicSong[]> {
    const r = await this.call<{ searchResult3?: { song?: SubsonicSong | SubsonicSong[] } }>('search3', {
      query,
      artistCount: 0,
      albumCount: 0,
      songCount: count,
      songOffset: offset
    });
    return toArray(r.searchResult3?.song);
  }

  private async listAlbums(count: number, offset: number): Promise<SubsonicAlbum[]> {
    const r = await this.call<{ albumList2?: { album?: SubsonicAlbum | SubsonicAlbum[] } }>('getAlbumList2', {
      type: 'alphabeticalByName',
      size: count,
      offset
    });
    return toArray(r.albumList2?.album);
  }

  /**
   * Descarga toda la biblioteca como pistas. Usa `search3` paginado; si el servidor no
   * devuelve nada así, recorre los álbumes con `getAlbumList2` + `getAlbum`.
   */
  async getAllTracks(onProgress?: (p: SyncProgress) => void, signal?: AbortSignal): Promise<Track[]> {
    const PAGE = 500;
    const songs: SubsonicSong[] = [];

    for (let offset = 0; ; offset += PAGE) {
      if (signal?.aborted) throw new NavidromeError('network', 'Sincronización cancelada.');
      const page = await this.searchSongs('', PAGE, offset);
      songs.push(...page);
      onProgress?.({ loaded: songs.length });
      if (page.length < PAGE) break;
    }

    if (songs.length === 0) {
      const albums: SubsonicAlbum[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = await this.listAlbums(PAGE, offset);
        albums.push(...page);
        if (page.length < PAGE) break;
      }
      let next = 0;
      const worker = async () => {
        while (next < albums.length) {
          if (signal?.aborted) throw new NavidromeError('network', 'Sincronización cancelada.');
          const album = albums[next++];
          songs.push(...(await this.getAlbum(album.id)).song!);
          onProgress?.({ loaded: songs.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, albums.length) }, worker));
    }

    return songs.map((s) => this.toTrack(s));
  }

  // ---- Acciones del usuario ----

  async star(id: string): Promise<void> {
    await this.call('star', { id });
  }

  async unstar(id: string): Promise<void> {
    await this.call('unstar', { id });
  }

  /** `submission=false` avisa "está sonando"; `true` registra la reproducción (scrobble). */
  async scrobble(id: string, submission: boolean, timeMs?: number): Promise<void> {
    await this.call('scrobble', { id, submission: String(submission), time: timeMs });
  }

  /** Valoración 1–5; 0 la quita. */
  async setRating(id: string, rating: number): Promise<void> {
    await this.call('setRating', { id, rating: Math.min(5, Math.max(0, Math.round(rating))) });
  }

  /** Pistas al azar del servidor (mezcla aleatoria). */
  async getRandomSongs(size = 50, genre?: string): Promise<Track[]> {
    const r = await this.call<{ randomSongs?: { song?: SubsonicSong | SubsonicSong[] } }>('getRandomSongs', { size, genre });
    return toArray(r.randomSongs?.song).map((s) => this.toTrack(s));
  }

  /** Pistas parecidas a una (radio). Navidrome las obtiene de su agente de metadatos (p. ej. Last.fm). */
  async getSimilarSongs(id: string, count = 50): Promise<Track[]> {
    const r = await this.call<{ similarSongs2?: { song?: SubsonicSong | SubsonicSong[] } }>('getSimilarSongs2', { id, count });
    return toArray(r.similarSongs2?.song).map((s) => this.toTrack(s));
  }

  async createPlaylist(name: string, songIds: string[] = []): Promise<string> {
    const r = await this.call<{ playlist?: { id: string } }>('createPlaylist', { name, songId: songIds.length ? songIds : undefined });
    return r.playlist?.id ?? '';
  }

  async addToPlaylist(playlistId: string, songIds: string[]): Promise<void> {
    if (songIds.length) await this.call('updatePlaylist', { playlistId, songIdToAdd: songIds });
  }

  /** Quita por posición en la playlist (así lo define la API). */
  async removeFromPlaylist(playlistId: string, indexes: number[]): Promise<void> {
    if (indexes.length) await this.call('updatePlaylist', { playlistId, songIndexToRemove: indexes });
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.call('deletePlaylist', { id });
  }

  async getPlaylists(): Promise<PlaylistInfo[]> {
    const r = await this.call<{ playlists?: { playlist?: PlaylistInfo | PlaylistInfo[] } }>('getPlaylists');
    return toArray(r.playlists?.playlist).map((p) => (p.coverArt ? { ...p, coverUrl: this.coverArtUrl(p.coverArt, 400) } : p));
  }

  async getPlaylistTracks(id: string): Promise<Track[]> {
    const r = await this.call<{ playlist: { entry?: SubsonicSong | SubsonicSong[] } }>('getPlaylist', { id });
    return toArray(r.playlist.entry).map((s) => this.toTrack(s));
  }

  // ---- Mapeo ----

  toTrack(s: SubsonicSong): Track {
    const rg = s.replayGain;
    return {
      id: `navidrome:${s.id}`,
      source: 'navidrome',
      sourceId: s.id,
      title: s.title,
      artist: s.artist || 'Unknown Artist',
      albumArtist: s.displayAlbumArtist || s.albumArtists?.[0]?.name || undefined,
      album: s.album || 'Unknown Album',
      trackNo: s.track,
      discNo: s.discNumber,
      year: s.year,
      duration: s.duration,
      bitrate: s.bitRate,
      sampleRate: s.samplingRate || undefined,
      bitDepth: s.bitDepth || undefined,
      format: s.suffix ? s.suffix.toUpperCase() : undefined,
      isrc: s.isrc?.[0],
      mbid: s.musicBrainzId,
      replayGain: rg ? { trackGain: rg.trackGain, trackPeak: rg.trackPeak, albumGain: rg.albumGain, albumPeak: rg.albumPeak } : undefined,
      coverUrl: s.coverArt ? this.coverArtUrl(s.coverArt, 300) : undefined,
      coverId: s.coverArt,
      favorite: !!s.starred,
      genre: s.genre || undefined,
      rating: s.userRating || undefined,
      playCount: s.playCount || undefined
    };
  }

  /** Rehace `coverUrl` (con la autenticación de esta sesión) para pistas guardadas solo con `coverId`. */
  hydrateCovers(tracks: Track[], size = 300): Track[] {
    return tracks.map((t) => (t.coverId ? { ...t, coverUrl: this.coverArtUrl(t.coverId, size) } : t));
  }
}
