import React, { useEffect, useState } from 'react';
import type { PlaylistInfo, Track } from '@hiresspot/core';
import { Cover, formatTime, ROW_HEIGHT, TrackRow } from './components';
import { IconBack, IconPlay, IconShuffle } from './icons';
import { useNavidrome } from './navidrome';
import { useCurrentTrackId, usePlayer } from './player';

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'No se pudieron cargar las playlists.');

const pill = 'inline-flex items-center gap-2 h-11 px-5 rounded-full font-semibold transition-colors duration-[var(--dur-1)]';
const meta = (pl: PlaylistInfo) => `${pl.songCount} pista(s)${pl.duration ? ` • ${formatTime(pl.duration)}` : ''}`;

/** Tarjeta de playlist: portada del servidor (o degradado si no tiene), botón de reproducir al pasar el mouse. */
const PlaylistTile: React.FC<{ pl: PlaylistInfo; busy: boolean; onOpen: () => void; onPlay: () => void }> = ({ pl, busy, onOpen, onPlay }) => (
  <div className="group relative min-w-0" style={{ contentVisibility: 'auto', containIntrinsicSize: '168px 228px' }}>
    <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Abrir ${pl.name}`}>
      <Cover
        src={pl.coverUrl}
        seed={pl.name}
        alt=""
        className="aspect-square w-full rounded-card shadow-cover transition-all duration-[var(--dur-2)] ease-glide group-hover:-translate-y-1 group-hover:scale-[1.02] group-hover:shadow-lift"
      />
      <div className="mt-3">
        <div className="text-headline truncate" title={pl.name}>{pl.name}</div>
        <div className="text-callout text-muted truncate tabular-nums">{meta(pl)}</div>
      </div>
    </button>
    {pl.songCount > 0 ? (
      <button
        type="button"
        aria-label={`Reproducir ${pl.name}`}
        title="Reproducir"
        disabled={busy}
        onClick={onPlay}
        className="absolute right-2 top-[calc(100%-4.5rem)] w-10 h-10 rounded-full bg-tint text-tint-fg grid place-items-center shadow-lift opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-60"
      >
        <IconPlay size={16} />
      </button>
    ) : null}
  </div>
);

/** Playlists del servidor Navidrome: cuadrícula con portadas y detalle con reproducción. */
export const NavidromePlaylists: React.FC = () => {
  const nd = useNavidrome();
  const player = usePlayer();
  const currentId = useCurrentTrackId();
  const [list, setList] = useState<PlaylistInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PlaylistInfo | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const online = nd.status === 'ready';
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    setError(null);
    nd.loadPlaylists()
      .then((r) => !cancelled && setList(r))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [online, nd.loadPlaylists]);

  const show = async (pl: PlaylistInfo) => {
    setOpen(pl);
    setTracks(null);
    setError(null);
    try {
      setTracks(await nd.loadPlaylistTracks(pl.id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  /** Reproduce una playlist desde la cuadrícula sin abrirla (carga sus pistas primero). */
  const playFromList = async (pl: PlaylistInfo, shuffle: boolean) => {
    setBusyId(pl.id);
    setError(null);
    try {
      const list = await nd.loadPlaylistTracks(pl.id);
      if (list.length === 0) return;
      if (shuffle) player.setShuffle(true);
      player.setQueue(list, shuffle ? Math.floor(Math.random() * list.length) : 0);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!online) {
    return <section className="page"><p className="text-callout text-muted">Conéctate al servidor para ver sus playlists.</p></section>;
  }

  if (open) {
    return (
      <section className="page">
        <button type="button" className="inline-flex items-center gap-1 text-callout text-fg-2 hover:text-fg mb-4" onClick={() => setOpen(null)}>
          <IconBack size={16} /> Playlists
        </button>
        <div className="flex items-end gap-5 mb-5">
          <Cover src={open.coverUrl ?? tracks?.find((t) => t.coverUrl)?.coverUrl} seed={open.name} className="w-36 h-36 sm:w-44 sm:h-44 rounded-card shadow-cover" />
          <div className="min-w-0">
            <div className="text-micro uppercase text-muted mb-1">Playlist</div>
            <h2 className="text-title-1 truncate" title={open.name}>{open.name}</h2>
            <div className="text-callout text-muted tabular-nums">{meta(open)}</div>
          </div>
        </div>
        {error ? <p className="text-danger text-callout">{error}</p> : tracks === null ? <p className="text-muted text-callout">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <button type="button" className={`${pill} bg-tint text-tint-fg hover:opacity-90`} onClick={() => player.setQueue(tracks, 0)}>
                <IconPlay size={16} /> Reproducir
              </button>
              <button
                type="button"
                className={`${pill} bg-fill-2 hover:bg-fill-3 font-medium`}
                onClick={() => {
                  player.setShuffle(true);
                  player.setQueue(tracks, Math.floor(Math.random() * tracks.length));
                }}
              >
                <IconShuffle size={16} /> Aleatorio
              </button>
              <button type="button" className={`${pill} bg-fill-2 hover:bg-fill-3 font-medium`} onClick={() => player.addToQueue(tracks)}>Agregar a la cola</button>
            </div>
            <div className="divide-y divide-line-soft">
              {tracks.map((t, i) => (
                <div key={`${t.id}:${i}`} style={{ height: ROW_HEIGHT }}>
                  <TrackRow track={t} index={i} showCover subtitle={`${t.artist} • ${t.album}`} playing={currentId === t.id} onPlay={() => player.setQueue(tracks, i)} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="page">
      <h2 className="text-title-1 mb-6">Playlists <span className="text-callout font-normal text-muted">({list?.length ?? 0})</span></h2>
      {error ? <p className="text-danger text-callout">{error}</p> : list === null ? <p className="text-muted text-callout">Cargando…</p> : list.length === 0 ? (
        <p className="text-muted text-callout">No hay playlists en el servidor.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7">
          {list.map((pl) => (
            <PlaylistTile key={pl.id} pl={pl} busy={busyId === pl.id} onOpen={() => show(pl)} onPlay={() => playFromList(pl, false)} />
          ))}
        </div>
      )}
    </section>
  );
};
