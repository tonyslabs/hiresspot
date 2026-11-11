import { normalizeIsrc, titleKey } from './compare';
import { groupAlbums, groupArtists } from './library';
import { normalize, pickPrimary, tokenize } from './text';
import type { AlbumGroup, ArtistGroup, SourceKind, Track } from './types';

export interface SearchSource { id: SourceKind; tracks: Track[] }

const opaque: unique symbol = Symbol('SearchIndex');
/** Índice opaco: las claves y agrupaciones se calculan una sola vez. */
export interface SearchIndex { readonly [opaque]: true }
export interface TrackHit { track: Track; sources: SourceKind[]; tracks: Track[] }
export interface AlbumHit {
  key: string;
  album: string;
  artist: string;
  coverUrl?: string;
  sources: SourceKind[];
  trackCount: number;
  tracks: Track[];
}
export interface ArtistHit {
  key: string;
  artist: string;
  coverUrl?: string;
  sources: SourceKind[];
  trackCount: number;
}
export interface SearchResults { tracks: TrackHit[]; albums: AlbumHit[]; artists: ArtistHit[] }

interface Entry { track: Track; key: string; title: string; hit: TrackHit }
interface IndexedGroup<T> { group: T; key: string }
interface IndexData {
  entries: Entry[];
  hits: TrackHit[];
  albums: IndexedGroup<AlbumGroup>[];
  artists: IndexedGroup<ArtistGroup>[];
  sources: Map<Track, SourceKind>;
}
const indexes = new WeakMap<SearchIndex, IndexData>();
const priority: Record<SourceKind, number> = { navidrome: 0, local: 1, spotify: 2 };
const sourcesOf = (tracks: Track[], sources: Map<Track, SourceKind>): SourceKind[] =>
  [...new Set(tracks.map((t) => sources.get(t) ?? t.source))].sort((a, b) => priority[a] - priority[b]);

export const buildSearchIndex = (sources: SearchSource[]): SearchIndex => {
  const entries: Entry[] = [];
  const sourceMap = new Map<Track, SourceKind>();
  const isrcs = new Map<string, TrackHit>();
  const metadata = new Map<string, TrackHit[]>();
  for (const source of sources) {
    for (const track of source.tracks) {
      sourceMap.set(track, source.id);
      const isrc = normalizeIsrc(track.isrc);
      const meta = `${titleKey(track.title)}__${normalize(pickPrimary(track.artist))}`;
      const candidates = metadata.get(meta) ?? [];
      // No se encadenan duraciones: cada copia debe ser compatible con las anteriores.
      let hit = (isrc ? isrcs.get(isrc) : undefined) ?? candidates.find((candidate) =>
        candidate.tracks.every((copy) => copy.duration === undefined || track.duration === undefined ||
          Math.abs(copy.duration - track.duration) <= 3));
      if (!hit) {
        hit = { track, sources: [], tracks: [] };
        candidates.push(hit);
        metadata.set(meta, candidates);
      }
      hit.tracks.push(track);
      if (!hit.sources.includes(source.id)) hit.sources.push(source.id);
      if (priority[source.id] < priority[sourceMap.get(hit.track) ?? hit.track.source]) hit.track = track;
      if (isrc) isrcs.set(isrc, hit);
      // La clave completa conserva álbum, créditos y etiquetas de versión para buscar.
      entries.push({ track, key: normalize(`${track.title} ${track.artist} ${track.album}`),
        title: normalize(track.title), hit });
    }
  }
  for (const entry of entries) entry.hit.sources.sort((a, b) => priority[a] - priority[b]);
  entries.sort((a, b) => a.track.title.localeCompare(b.track.title));
  const tracks = entries.map((entry) => entry.track);
  const index: SearchIndex = { [opaque]: true };
  indexes.set(index, {
    entries,
    hits: [...new Set(entries.map((entry) => entry.hit))]
      .sort((a, b) => a.track.title.localeCompare(b.track.title)),
    // Se conservan el orden y las claves de library; al buscar se seleccionan sus miembros coincidentes.
    albums: groupAlbums(tracks).map((group) => ({ group, key: normalize(`${group.album} ${group.artist}`) })),
    artists: groupArtists(tracks).map((group) => ({ group, key: normalize(group.artist) })),
    sources: sourceMap,
  });
  return index;
};

export const search = (index: SearchIndex, query: string, limit = 8): SearchResults => {
  const empty: SearchResults = { tracks: [], albums: [], artists: [] };
  const tokens = tokenize(query);
  const count = Math.max(0, Math.floor(limit));
  if (!tokens.length || !count) return empty;
  const data = indexes.get(index);
  if (!data) return empty;
  const matches = (key: string): boolean => tokens.every((token) => key.includes(token));
  const queryKey = tokens.join(' ');
  const matched = new Set<Track>();
  const ranks = new Map<TrackHit, number>();
  const buckets: TrackHit[][] = [[], [], []];
  for (const entry of data.entries) {
    if (!matches(entry.key)) continue;
    matched.add(entry.track);
    const rank = entry.title === queryKey ? 0 : entry.title.startsWith(queryKey) ? 1 : 2;
    const previous = ranks.get(entry.hit);
    if (previous === undefined || rank < previous) ranks.set(entry.hit, rank);
  }
  // El orden alfabético ya está precalculado; tres pasadas evitan ordenar cada consulta.
  for (const hit of data.hits) {
    const rank = ranks.get(hit);
    if (rank !== undefined) buckets[rank].push(hit);
  }
  const tracks = buckets.flat().slice(0, count).map((hit) => ({
    track: hit.track, tracks: [...hit.tracks], sources: [...hit.sources],
  }));
  const albums: AlbumHit[] = [];
  for (const { group, key } of data.albums) {
    const members = matches(key) ? group.tracks : group.tracks.filter((track) => matched.has(track));
    if (!members.length) continue;
    albums.push({ key: group.key, album: group.album, artist: group.artist,
      coverUrl: members.find((track) => track.coverUrl)?.coverUrl,
      sources: sourcesOf(members, data.sources), trackCount: members.length, tracks: [...members] });
    if (albums.length >= count) break;
  }
  const artists: ArtistHit[] = [];
  for (const { group, key } of data.artists) {
    const members = matches(key) ? group.tracks : group.tracks.filter((track) => matched.has(track));
    if (!members.length) continue;
    artists.push({ key: group.key, artist: group.artist,
      coverUrl: members.find((track) => track.coverUrl)?.coverUrl,
      sources: sourcesOf(members, data.sources), trackCount: members.length });
    if (artists.length >= count) break;
  }
  return { tracks, albums, artists };
};
