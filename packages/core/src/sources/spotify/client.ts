import type { Track } from '../../types';

// ---------------------------------------------------------------------------
// Cliente de la Web API de Spotify (solo lectura de la biblioteca).
// No conoce tokens: recibe una función `api(path)` que la plataforma autentica.
// Respeta el modo desarrollo vigente desde feb-2026: máx. 50 por página en /me/*,
// y `/playlists/{id}/items` solo para listas propias o colaborativas.
// ---------------------------------------------------------------------------

export type SpotifyApi = (path: string) => Promise<unknown>;

interface Page<T> {
  items?: T[];
  total?: number;
  next?: string | null;
}

interface SpImage {
  url: string;
  width?: number | null;
}
interface SpArtist {
  name: string;
}
interface SpTrack {
  id?: string | null;
  type?: string;
  is_local?: boolean;
  name: string;
  artists?: SpArtist[];
  album?: SpAlbum;
  track_number?: number;
  disc_number?: number;
  duration_ms?: number;
  external_ids?: { isrc?: string };
}
interface SpAlbum {
  id?: string;
  name: string;
  artists?: SpArtist[];
  images?: SpImage[];
  release_date?: string;
  total_tracks?: number;
  tracks?: Page<SpTrack>;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  coverUrl?: string;
  genres: string[];
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  coverUrl?: string;
  owner: string;
  total: number;
  /** false si la API no deja leer sus pistas (listas de otros usuarios). */
  readable: boolean;
}

const PAGE = 50;
const MAX_PAGES = 400; // 20 000 elementos: tope de seguridad contra bucles

/** Portada de tamaño intermedio (~300 px) si existe. */
const pickImage = (images?: SpImage[]): string | undefined => {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) <= 400) ?? sorted[sorted.length - 1]).url;
};

const joinArtists = (artists?: SpArtist[]): string => (artists ?? []).map((a) => a.name).filter(Boolean).join(', ');

/** Convierte una pista de Spotify en `Track`; null si es local, episodio o no tiene id. */
export const toTrack = (t: SpTrack, album?: SpAlbum): Track | null => {
  if (!t || !t.id || t.is_local || (t.type && t.type !== 'track')) return null;
  const alb = t.album ?? album;
  const year = Number.parseInt((alb?.release_date ?? '').slice(0, 4), 10);
  return {
    id: `spotify:${t.id}`,
    source: 'spotify',
    sourceId: t.id,
    title: t.name,
    artist: joinArtists(t.artists) || 'Artista desconocido',
    albumArtist: joinArtists(alb?.artists) || undefined,
    album: alb?.name || 'Álbum desconocido',
    trackNo: t.track_number,
    discNo: t.disc_number,
    year: Number.isFinite(year) ? year : undefined,
    duration: t.duration_ms !== undefined ? t.duration_ms / 1000 : undefined,
    isrc: t.external_ids?.isrc,
    coverUrl: pickImage(alb?.images ?? album?.images)
  };
};

export class SpotifyClient {
  constructor(private readonly api: SpotifyApi) {}

  private async pages<T>(basePath: string, pageSize: number, onPage?: (loaded: number) => void): Promise<T[]> {
    const out: T[] = [];
    const sep = basePath.includes('?') ? '&' : '?';
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = (await this.api(`${basePath}${sep}limit=${pageSize}&offset=${i * pageSize}`)) as Page<T>;
      const items = page.items ?? [];
      out.push(...items);
      onPage?.(out.length);
      if (items.length === 0 || !page.next) break;
    }
    return out;
  }

  /** Canciones que te gustan. */
  async getSavedTracks(onProgress?: (loaded: number) => void): Promise<Track[]> {
    const rows = await this.pages<{ track?: SpTrack }>('/v1/me/tracks', PAGE, onProgress);
    return rows.map((r) => (r.track ? toTrack(r.track) : null)).filter((t): t is Track => t !== null);
  }

  /** Pistas de los álbumes guardados (sin ISRC: la API no lo da en pistas simplificadas). */
  async getSavedAlbumTracks(onProgress?: (loaded: number) => void): Promise<Track[]> {
    const rows = await this.pages<{ album?: SpAlbum }>('/v1/me/albums', PAGE);
    const out: Track[] = [];
    for (const { album } of rows) {
      if (!album?.id) continue;
      let items = album.tracks?.items ?? [];
      if ((album.tracks?.total ?? items.length) > items.length) {
        items = await this.pages<SpTrack>(`/v1/albums/${album.id}/tracks`, PAGE);
      }
      for (const t of items) {
        const tr = toTrack(t, album);
        if (tr) out.push(tr);
      }
      onProgress?.(out.length);
    }
    return out;
  }

  /** Biblioteca de pistas: "me gusta" + álbumes guardados, sin duplicados (gana la versión con ISRC). */
  async getLibraryTracks(onProgress?: (loaded: number) => void): Promise<Track[]> {
    const liked = await this.getSavedTracks(onProgress);
    const fromAlbums = await this.getSavedAlbumTracks((n) => onProgress?.(liked.length + n));
    const likedIds = new Set(liked.map((t) => t.id));
    const byId = new Map<string, Track>();
    for (const t of [...liked, ...fromAlbums]) if (!byId.has(t.id)) byId.set(t.id, { ...t, favorite: likedIds.has(t.id) || undefined });
    return [...byId.values()];
  }

  /** Artistas que sigues (paginación por cursor `after`, no por offset). */
  async getFollowedArtists(): Promise<SpotifyArtist[]> {
    type Row = { id: string; name: string; images?: SpImage[]; genres?: string[] };
    const out: SpotifyArtist[] = [];
    let after = '';
    for (let i = 0; i < MAX_PAGES; i++) {
      const res = (await this.api(`/v1/me/following?type=artist&limit=${PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`)) as {
        artists?: { items?: Row[]; cursors?: { after?: string | null } };
      };
      const items = res.artists?.items ?? [];
      for (const a of items) if (a?.id) out.push({ id: a.id, name: a.name, coverUrl: pickImage(a.images), genres: a.genres ?? [] });
      after = res.artists?.cursors?.after ?? '';
      if (items.length === 0 || !after) break;
    }
    return out;
  }

  async getPlaylists(): Promise<SpotifyPlaylist[]> {
    type Row = { id: string; name: string; images?: SpImage[]; owner?: { id?: string; display_name?: string }; collaborative?: boolean; items?: { total?: number }; tracks?: { total?: number } };
    const [me, rows] = await Promise.all([this.api('/v1/me') as Promise<{ id?: string }>, this.pages<Row>('/v1/me/playlists', PAGE)]);
    return rows
      .filter((r) => r && r.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        coverUrl: pickImage(r.images),
        owner: r.owner?.display_name || r.owner?.id || '',
        total: r.items?.total ?? r.tracks?.total ?? 0,
        readable: !!r.collaborative || (!!me.id && r.owner?.id === me.id)
      }));
  }

  async getPlaylistTracks(id: string): Promise<Track[]> {
    if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Id de playlist inválido');
    const rows = await this.pages<{ item?: SpTrack; track?: SpTrack }>(`/v1/playlists/${id}/items`, 100);
    return rows.map((r) => toTrack((r.item ?? r.track) as SpTrack)).filter((t): t is Track => t !== null);
  }

  async getProfileName(): Promise<string | undefined> {
    const me = (await this.api('/v1/me')) as { display_name?: string; id?: string };
    return me.display_name || me.id;
  }
}
