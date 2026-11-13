import { normalize, primaryArtistForTrack } from './text';
import type { AlbumGroup, ArtistGroup, Track } from './types';

const UNKNOWN_ALBUM = 'Álbum desconocido';

/** Agrupa pistas en álbumes por (álbum normalizado + artista principal normalizado). */
export const groupAlbums = (tracks: Track[]): AlbumGroup[] => {
  const group = new Map<string, AlbumGroup>();
  for (const t of tracks) {
    const album = t.album || UNKNOWN_ALBUM;
    const artist = primaryArtistForTrack(t);
    const albumKey = normalize(album);
    const artistKey = normalize(artist);
    const key = `${albumKey}__${artistKey}`;
    const item = group.get(key) ?? { key, album, artist, artistKey, albumKey, coverUrl: t.coverUrl, tracks: [] };
    if (!item.coverUrl && t.coverUrl) item.coverUrl = t.coverUrl;
    item.tracks.push(t);
    group.set(key, item);
  }
  const albums = Array.from(group.values());
  for (const a of albums) a.tracks.sort(compareTrackOrder);
  return albums.sort((a, b) => a.album.localeCompare(b.album));
};

/** Agrupa pistas por artista principal. */
export const groupArtists = (tracks: Track[]): ArtistGroup[] => {
  const group = new Map<string, ArtistGroup>();
  for (const t of tracks) {
    const artist = primaryArtistForTrack(t) || 'Artista desconocido';
    const key = normalize(artist);
    const item = group.get(key) ?? { key, artist, coverUrl: t.coverUrl, albums: new Set<string>(), tracks: [] };
    if (!item.coverUrl && t.coverUrl) item.coverUrl = t.coverUrl;
    item.albums.add(t.album || UNKNOWN_ALBUM);
    item.tracks.push(t);
    group.set(key, item);
  }
  return Array.from(group.values()).sort((a, b) => a.artist.localeCompare(b.artist));
};

/** Orden de álbum: disco, número de pista, y como último recurso el título. */
export const compareTrackOrder = (a: Track, b: Track): number =>
  (a.discNo ?? 1) - (b.discNo ?? 1) ||
  (a.trackNo ?? Number.MAX_SAFE_INTEGER) - (b.trackNo ?? Number.MAX_SAFE_INTEGER) ||
  a.title.localeCompare(b.title);

export const tracksOfAlbum = (tracks: Track[], albumKey: string, artistKey: string): Track[] =>
  tracks
    .filter((t) => normalize(t.album) === albumKey && normalize(primaryArtistForTrack(t)) === artistKey)
    .sort(compareTrackOrder);

export const tracksOfArtist = (tracks: Track[], artistKey: string): Track[] =>
  tracks.filter((t) => normalize(primaryArtistForTrack(t)) === artistKey);

/** Búsqueda por tokens, sin acentos ni mayúsculas. Todos los tokens deben aparecer. */
export const filterTracks = (tracks: Track[], tokens: string[]): Track[] => {
  if (tokens.length === 0) return tracks;
  return tracks.filter((t) => {
    const hay = `${normalize(t.title)} ${normalize(t.artist)} ${normalize(t.album)}`;
    return tokens.every((tk) => hay.includes(tk));
  });
};

export const filterAlbums = (albums: AlbumGroup[], tokens: string[]): AlbumGroup[] => {
  if (tokens.length === 0) return albums;
  return albums.filter((a) => {
    const hay = `${normalize(a.album)} ${normalize(a.artist)}`;
    return tokens.every((tk) => hay.includes(tk));
  });
};

export const filterArtists = (artists: ArtistGroup[], tokens: string[]): ArtistGroup[] => {
  if (tokens.length === 0) return artists;
  return artists.filter((a) => {
    const hay = normalize(a.artist);
    return tokens.every((tk) => hay.includes(tk));
  });
};
