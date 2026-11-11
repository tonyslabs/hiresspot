import React, { useEffect, useState } from 'react';
import type { PlaylistInfo, Track } from '@hiresspot/core';
import { formatTime, ROW_HEIGHT, TrackRow } from './components';
import { IconBack, IconPlay } from './icons';
import { useNavidrome } from './navidrome';
import { useCurrentTrackId, usePlayer } from './player';

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'No se pudieron cargar las playlists.');

/** Playlists del servidor Navidrome: lista y detalle con reproducción. */
export const NavidromePlaylists: React.FC = () => {
  const nd = useNavidrome();
  const player = usePlayer();
  const currentId = useCurrentTrackId();
  const [list, setList] = useState<PlaylistInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PlaylistInfo | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);

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

  if (!online) {
    return <section className="page"><p className="text-callout text-muted">Conéctate al servidor para ver sus playlists.</p></section>;
  }

  if (open) {
    return (
      <section className="page">
        <button type="button" className="inline-flex items-center gap-1 text-callout text-fg-2 hover:text-fg mb-4" onClick={() => setOpen(null)}>
          <IconBack size={16} /> Playlists
        </button>
        <h2 className="text-title-1">{open.name}</h2>
        <div className="text-callout text-muted tabular-nums mb-4">{open.songCount} pista(s){open.duration ? ` • ${formatTime(open.duration)}` : ''}</div>
        {error ? <p className="text-danger text-callout">{error}</p> : tracks === null ? <p className="text-muted text-callout">Cargando…</p> : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <button type="button" className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-tint text-tint-fg text-callout font-semibold hover:opacity-90" onClick={() => player.setQueue(tracks, 0)}>
                <IconPlay size={16} /> Reproducir todo
              </button>
              <button type="button" className="h-9 px-4 rounded-full bg-fill-2 hover:bg-fill-3 text-callout text-fg" onClick={() => player.addToQueue(tracks)}>Agregar a la cola</button>
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
        <div className="space-y-1">
          {list.map((pl) => (
            <button key={pl.id} type="button" onClick={() => show(pl)} className="w-full flex items-center justify-between gap-4 px-4 h-14 rounded-ctl hover:bg-fill-1 text-left transition-colors duration-[var(--dur-1)]">
              <span className="text-headline truncate">{pl.name}</span>
              <span className="text-callout text-muted tabular-nums shrink-0">{pl.songCount} pistas{pl.duration ? ` • ${formatTime(pl.duration)}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
