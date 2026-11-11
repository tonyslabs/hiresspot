import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  filterTracks,
  groupAlbums,
  type AlbumGroup,
  type ArtistGroup,
  groupArtists,
  isHiRes,
  qualityTier,
  tokenize,
  tracksOfAlbum,
  tracksOfArtist,
  type Track
} from '@hiresspot/core';
import { Cover, QualitySeal, ROW_HEIGHT, TrackRow } from './components';
import { Hero, useTintStyle } from './Hero';
import { IconBack, IconPlay, IconShuffle } from './icons';
import { useCurrentTrackId, usePlayer } from './player';
import { VirtualList } from './VirtualList';

interface Props {
  tracks: Track[];
  /** Ruta base donde está montado el navegador (p. ej. `/local`). */
  basePath: string;
  empty: ReactNode;
  onToggleFavorite?: (track: Track) => void;
  /** Sin reproducción (fuentes que solo se consultan, como Spotify). */
  readOnly?: boolean;
  /** Título de la vista de favoritas (p. ej. "Me gusta" en Spotify). */
  favoritesLabel?: string;
}

const enc = encodeURIComponent;
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7';

const Tile: React.FC<{ to: string; cover?: string; title: string; subtitle: string; round?: boolean }> = ({ to, cover, title, subtitle, round }) => (
  <Link to={to} className="group block min-w-0" style={{ contentVisibility: 'auto', containIntrinsicSize: '168px 228px' }}>
    <Cover
      src={cover}
      seed={title}
      className={`aspect-square w-full shadow-cover transition-all duration-[var(--dur-2)] ease-glide group-hover:-translate-y-1 group-hover:scale-[1.02] group-hover:shadow-lift active:scale-[0.98] ${
        round ? 'rounded-full' : 'rounded-card'
      }`}
    />
    <div className={`mt-3 ${round ? 'text-center' : ''}`}>
      <div className="text-headline truncate" title={title}>{title}</div>
      <div className="text-callout text-muted truncate" title={subtitle}>{subtitle}</div>
    </div>
  </Link>
);

const PageTitle: React.FC<{ title: string; count: number }> = ({ title, count }) => (
  <h2 className="text-title-1 mb-4">
    {title} <span className="text-callout font-normal text-muted tabular-nums">{count}</span>
  </h2>
);

const pill = 'inline-flex items-center gap-2 h-11 px-5 rounded-full font-semibold transition-colors duration-[var(--dur-1)]';

const Actions: React.FC<{ list: Track[] }> = ({ list }) => {
  const player = usePlayer();
  return (
    <>
      <button type="button" className={`${pill} bg-tint text-tint-fg hover:opacity-90`} onClick={() => player.setQueue(list, 0)}>
        <IconPlay size={16} /> Reproducir
      </button>
      <button
        type="button"
        className={`${pill} bg-fill-2 hover:bg-fill-3 font-medium`}
        onClick={() => {
          player.setShuffle(true);
          player.setQueue(list, 0);
        }}
      >
        <IconShuffle size={16} /> Aleatorio
      </button>
      <button type="button" className={`${pill} bg-fill-2 hover:bg-fill-3 font-medium`} onClick={() => player.addToQueue(list)}>
        Agregar a la cola
      </button>
    </>
  );
};

const totalDuration = (list: Track[]): string => {
  const min = Math.round(list.reduce((n, t) => n + (t.duration ?? 0), 0) / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

/** Mejor pista del grupo por calidad (para el sello del encabezado) y cuántas son Hi-Res. */
const qualitySummary = (list: Track[]): ReactNode => {
  const hires = list.filter(isHiRes);
  const best = hires[0] ?? list.find((t) => qualityTier(t) === 'lossless') ?? list[0];
  if (!best) return null;
  return (
    <>
      <QualitySeal track={best} size="lg" />
      {hires.length > 0 ? <span className="text-callout text-fg-2">{hires.length} de {list.length} en Hi-Res</span> : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// IMPORTANTE: las páginas son componentes de nivel superior (no se definen dentro del render de
// LibraryBrowser). El reproductor emite varias veces por segundo; si se crearan aquí dentro, React
// los remontaría en cada emisión y el scroll volvería al tope mientras suena una pista.
// ---------------------------------------------------------------------------

interface LibCtx {
  tracks: Track[];
  albums: AlbumGroup[];
  artists: ArtistGroup[];
  filteredTracks: Track[];
  favorites: Track[];
  query: string;
  setQuery: (q: string) => void;
  basePath: string;
  readOnly?: boolean;
  favoritesLabel: string;
  favorite: (t: Track) => (() => void) | undefined;
}

const Lib = createContext<LibCtx | null>(null);
const useLib = (): LibCtx => {
  const v = useContext(Lib);
  if (!v) throw new Error('useLib fuera de <LibraryBrowser>');
  return v;
};

const Rows: React.FC<{ list: Track[]; subtitleOf: (t: Track) => string }> = ({ list, subtitleOf }) => {
  const { readOnly, favorite } = useLib();
  const player = usePlayer();
  const currentId = useCurrentTrackId();
  return (
    <div className="relative z-10 pr-2">
      {list.map((t, i) => (
        <div key={`${t.id}:${i}`} style={{ height: ROW_HEIGHT }}>
          <TrackRow
            track={t}
            index={i}
            subtitle={subtitleOf(t)}
            playing={currentId === t.id}
            onPlay={readOnly ? undefined : () => player.setQueue(list, i)}
            onToggleFavorite={favorite(t)}
          />
        </div>
      ))}
    </div>
  );
};

const AlbumPage: React.FC = () => {
  const { albumKey = '', artistKey = '' } = useParams();
  const { albums, tracks, basePath, readOnly } = useLib();
  const info = albums.find((a) => a.albumKey === albumKey && a.artistKey === artistKey);
  const list = useMemo(() => tracksOfAlbum(tracks, albumKey, artistKey), [tracks, albumKey, artistKey]);
  const tint = useTintStyle(list.find((t) => t.coverUrl) ?? list[0]);
  if (!info) return <Navigate to={`${basePath}/albums`} replace />;
  const year = list.find((t) => t.year)?.year;
  return (
    <section className="page" style={tint}>
      <Hero
        cover={info.coverUrl}
        seed={`${info.album}|${info.artist}`}
        kind="Álbum"
        title={info.album}
        meta={[info.artist, year, `${list.length} pistas`, totalDuration(list)].filter(Boolean).join(' · ')}
        badges={qualitySummary(list)}
        actions={readOnly ? null : <Actions list={list} />}
      />
      <Rows list={list} subtitleOf={(t) => t.artist} />
    </section>
  );
};

const ArtistPage: React.FC = () => {
  const { artistKey = '' } = useParams();
  const { artists, tracks, basePath, readOnly } = useLib();
  const info = artists.find((a) => a.key === artistKey);
  const list = useMemo(() => tracksOfArtist(tracks, artistKey), [tracks, artistKey]);
  const tint = useTintStyle(list.find((t) => t.coverUrl) ?? list[0]);
  if (!info) return <Navigate to={`${basePath}/artists`} replace />;
  return (
    <section className="page" style={tint}>
      <Hero
        cover={info.coverUrl}
        seed={info.artist}
        kind="Artista"
        title={info.artist}
        meta={`${info.albums.size} álbumes · ${list.length} pistas · ${totalDuration(list)}`}
        round
        badges={qualitySummary(list)}
        actions={readOnly ? null : <Actions list={list} />}
      />
      <Rows list={list} subtitleOf={(t) => t.album} />
    </section>
  );
};

const AlbumGrid: React.FC = () => {
  const { albums, basePath } = useLib();
  return (
    <section className="page">
      <PageTitle title="Álbumes" count={albums.length} />
      <div className={GRID}>
        {albums.map((al) => (
          <Tile key={al.key} to={`${basePath}/albums/${enc(al.albumKey)}/${enc(al.artistKey)}`} cover={al.coverUrl} title={al.album} subtitle={al.artist} />
        ))}
      </div>
    </section>
  );
};

const ArtistGrid: React.FC = () => {
  const { artists, basePath } = useLib();
  return (
    <section className="page">
      <PageTitle title="Artistas" count={artists.length} />
      <div className={GRID}>
        {artists.map((ar) => (
          <Tile key={ar.key} to={`${basePath}/artists/${enc(ar.key)}`} cover={ar.coverUrl} title={ar.artist} subtitle={`${ar.albums.size} álbum(es) • ${ar.tracks.length} pista(s)`} round />
        ))}
      </div>
    </section>
  );
};

/** Géneros presentes en la biblioteca, de más a menos pistas. */
const genreGroups = (tracks: Track[]): { genre: string; tracks: Track[] }[] => {
  const map = new Map<string, Track[]>();
  for (const t of tracks) {
    const g = t.genre?.trim();
    if (g) (map.get(g) ?? map.set(g, []).get(g)!).push(t);
  }
  return [...map.entries()].map(([genre, list]) => ({ genre, tracks: list })).sort((a, b) => b.tracks.length - a.tracks.length || a.genre.localeCompare(b.genre));
};

const GenreGrid: React.FC = () => {
  const { tracks, basePath } = useLib();
  const groups = useMemo(() => genreGroups(tracks), [tracks]);
  return (
    <section className="page">
      <PageTitle title="Géneros" count={groups.length} />
      {groups.length === 0 ? (
        <p className="text-muted">Las pistas de esta biblioteca no traen etiqueta de género.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {groups.map((g) => (
            <Link key={g.genre} to={`${basePath}/genres/${enc(g.genre)}`} className="rounded-card bg-fill-1 hover:bg-fill-2 transition-colors p-4 min-h-[96px] flex flex-col justify-between min-w-0">
              <span className="text-headline truncate" title={g.genre}>{g.genre}</span>
              <span className="text-callout text-muted tabular-nums">{g.tracks.length} pista(s)</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
};

const GenrePage: React.FC = () => {
  const { tracks, basePath, readOnly, favorite } = useLib();
  const { genre = '' } = useParams();
  const player = usePlayer();
  const currentId = useCurrentTrackId();
  const list = useMemo(() => tracks.filter((t) => t.genre?.trim() === genre), [tracks, genre]);
  return (
    <section className="page-frame">
      <Link to={`${basePath}/genres`} className="inline-flex items-center gap-1 text-callout text-fg-2 hover:text-fg mb-3">
        <IconBack size={16} /> Géneros
      </Link>
      <PageTitle title={genre} count={list.length} />
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Actions list={list} />
        </div>
      )}
      <VirtualList
        className="flex-1 min-h-0"
        items={list}
        rowHeight={ROW_HEIGHT}
        padEnd={112}
        getKey={(t) => t.id}
        renderRow={(t, i) => (
          <TrackRow track={t} showCover subtitle={`${t.artist} • ${t.album}`} playing={currentId === t.id} onPlay={readOnly ? undefined : () => player.setQueue(list, i)} onToggleFavorite={favorite(t)} />
        )}
      />
    </section>
  );
};

const TrackList: React.FC<{ kind: 'all' | 'favorites' }> = ({ kind }) => {
  const { filteredTracks, favorites, query, setQuery, readOnly, favorite, favoritesLabel } = useLib();
  const player = usePlayer();
  const currentId = useCurrentTrackId();
  const list = kind === 'all' ? filteredTracks : favorites;
  return (
    <section className="page-frame">
      {kind === 'all' ? (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar pistas…"
          aria-label="Buscar pistas"
          className="w-full max-w-xl h-11 px-4 rounded-full bg-fill-1 border border-line-soft outline-none text-body placeholder:text-muted focus:border-tint focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--tint)_22%,transparent)]"
        />
      ) : null}
      <PageTitle title={kind === 'all' ? 'Pistas' : favoritesLabel} count={list.length} />
      {list.length === 0 ? (
        <p className="text-muted">Todavía no hay pistas aquí.</p>
      ) : (
        <VirtualList
          className="flex-1 min-h-0"
          items={list}
          rowHeight={ROW_HEIGHT}
          padEnd={112}
          getKey={(t) => t.id}
          renderRow={(t, i) => (
            <TrackRow
              track={t}
              showCover
              subtitle={`${t.artist} • ${t.album}`}
              playing={currentId === t.id}
              onPlay={readOnly ? undefined : () => player.setQueue(list, i)}
              onToggleFavorite={favorite(t)}
            />
          )}
        />
      )}
    </section>
  );
};

export const LibraryBrowser: React.FC<Props> = ({ tracks, basePath, empty, onToggleFavorite, readOnly, favoritesLabel = 'Favoritas' }) => {
  const [query, setQuery] = useState('');
  const albums = useMemo(() => groupAlbums(tracks), [tracks]);
  const artists = useMemo(() => groupArtists(tracks), [tracks]);
  const filteredTracks = useMemo(() => filterTracks(tracks, tokenize(query)), [tracks, query]);
  const favorites = useMemo(() => tracks.filter((t) => t.favorite), [tracks]);

  const value = useMemo<LibCtx>(
    () => ({
      tracks,
      albums,
      artists,
      filteredTracks,
      favorites,
      query,
      setQuery,
      basePath,
      readOnly,
      favoritesLabel,
      favorite: (t) => (onToggleFavorite ? () => onToggleFavorite(t) : undefined)
    }),
    [tracks, albums, artists, filteredTracks, favorites, query, basePath, readOnly, favoritesLabel, onToggleFavorite]
  );

  if (tracks.length === 0) return <section className="page">{empty}</section>;

  return (
    <Lib.Provider value={value}>
      <Routes>
        <Route index element={<Navigate to="albums" replace />} />
        <Route path="albums" element={<AlbumGrid />} />
        <Route path="albums/:albumKey/:artistKey" element={<AlbumPage />} />
        <Route path="artists" element={<ArtistGrid />} />
        <Route path="artists/:artistKey" element={<ArtistPage />} />
        <Route path="tracks" element={<TrackList kind="all" />} />
        <Route path="genres" element={<GenreGrid />} />
        <Route path="genres/:genre" element={<GenrePage />} />
        <Route path="favorites" element={<TrackList kind="favorites" />} />
        <Route path="*" element={<Navigate to={`${basePath}/albums`} replace />} />
      </Routes>
    </Lib.Provider>
  );
};
