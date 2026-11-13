import React, { useState } from 'react';
import type { SpotifyPlaylist, Track } from '@hiresspot/core';
import { Cover, ROW_HEIGHT, TrackRow } from './components';
import { IconBack } from './icons';
import { useSpotify } from './spotify';

const STATUS_LABEL = {
  disconnected: 'Sin conexión',
  connecting: 'Esperando autorización en el navegador…',
  syncing: 'Sincronizando',
  ready: 'Conectado',
  error: 'Error'
} as const;

export const SpotifyConnect: React.FC = () => {
  const sp = useSpotify();
  const busy = sp.status === 'connecting' || sp.status === 'syncing';
  const dot = sp.status === 'ready' ? 'bg-ok' : sp.status === 'error' ? 'bg-danger' : busy ? 'bg-tint' : 'bg-muted';

  return (
    <section className="max-w-[440px] mx-auto mt-[8vh] rounded-panel bg-fill-1 p-8">
      <h2 className="text-title-2 mb-2">Spotify</h2>
      <p className="text-callout text-muted mb-6">
        Conecta tu cuenta para ver tu biblioteca (canciones que te gustan, álbumes y playlists) y compararla con Navidrome o tu música local.
        Spotify no entrega el audio: aquí solo se consulta la biblioteca.
      </p>

      <div className="flex items-center gap-2 mb-4 text-callout">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        {STATUS_LABEL[sp.status]}
        {sp.status === 'syncing' ? <span className="text-muted">({sp.progress} pistas)</span> : null}
      </div>

      {sp.error ? (
        <div className="mb-4 rounded-ctl bg-danger/10 text-danger px-3.5 py-2.5 text-callout" role="alert">{sp.error}</div>
      ) : null}

      {sp.status === 'ready' || sp.tracks.length > 0 ? (
        <div className="space-y-4">
          <div className="rounded-ctl bg-fill-1 border border-line-soft p-4 font-mono text-callout space-y-1">
            {sp.name ? <div><span className="text-muted">Cuenta:</span> {sp.name}</div> : null}
            <div><span className="text-muted">Biblioteca:</span> {sp.tracks.length} pistas · {sp.playlists.length} playlists</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout disabled:opacity-50" disabled={busy || sp.status === 'disconnected'} onClick={() => sp.resync()}>Resincronizar</button>
            <button type="button" className="h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout text-danger" onClick={() => sp.disconnect()}>Desconectar y olvidar</button>
          </div>
          {sp.status === 'disconnected' ? (
            <button type="button" className="w-full h-11 rounded-full bg-tint text-tint-fg font-semibold hover:opacity-90" onClick={() => sp.connect()}>Reconectar</button>
          ) : null}
        </div>
      ) : (
        <button type="button" disabled={busy} className="w-full h-11 rounded-full bg-tint text-tint-fg font-semibold hover:opacity-90 disabled:opacity-50" onClick={() => sp.connect()}>
          Conectar con Spotify
        </button>
      )}

      <p className="text-caption text-muted mt-6">
        Se abre el navegador para que autorices el acceso de solo lectura. HiResSpot nunca ve tu contraseña de Spotify.
        En modo desarrollo de Spotify, tu cuenta debe estar en la lista de usuarios de la app.
      </p>
    </section>
  );
};

export const SpotifyPlaylists: React.FC = () => {
  const sp = useSpotify();
  const [open, setOpen] = useState<SpotifyPlaylist | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const show = async (pl: SpotifyPlaylist) => {
    setOpen(pl);
    setTracks(null);
    setLoadError(null);
    try {
      setTracks(await sp.loadPlaylist(pl.id));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'No se pudo cargar la playlist.');
    }
  };

  if (open) {
    return (
      <section className="page">
        <button type="button" className="inline-flex items-center gap-1 text-callout text-fg-2 hover:text-fg mb-4" onClick={() => setOpen(null)}>
          <IconBack size={16} /> Playlists
        </button>
        <div className="flex items-center gap-6 mb-6">
          <Cover src={open.coverUrl} className="w-32 h-32 rounded-card shadow-cover" />
          <div className="min-w-0">
            <div className="text-micro uppercase text-muted">Playlist</div>
            <h2 className="text-title-1 truncate">{open.name}</h2>
            <div className="text-callout text-muted">{open.owner} • {open.total} pista(s)</div>
          </div>
        </div>
        {loadError ? <p className="text-danger text-callout">{loadError}</p> : tracks === null ? <p className="text-muted text-callout">Cargando…</p> : (
          <div className="divide-y divide-line-soft">
            {tracks.map((t, i) => (
              <div key={`${t.id}:${i}`} style={{ height: ROW_HEIGHT }}>
                <TrackRow track={t} index={i} showCover subtitle={`${t.artist} • ${t.album}`} />
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="page">
      <h2 className="text-title-1 mb-6">Playlists <span className="text-callout font-normal text-muted">({sp.playlists.length})</span></h2>
      {sp.playlists.length === 0 ? <p className="text-callout text-muted">No hay playlists (o aún no se han sincronizado).</p> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7">
          {sp.playlists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              disabled={!pl.readable}
              onClick={() => show(pl)}
              title={pl.readable ? undefined : 'Spotify no permite leer playlists de otros usuarios en modo desarrollo'}
              className={`group text-left min-w-0 ${pl.readable ? '' : 'opacity-50 cursor-not-allowed'}`}
            >
              <Cover
                src={pl.coverUrl}
                className="aspect-square w-full rounded-card shadow-cover transition duration-[var(--dur-2)] ease-glide group-hover:-translate-y-1 group-hover:scale-[1.02] group-hover:shadow-lift"
              />
              <div className="text-headline truncate mt-3" title={pl.name}>{pl.name}</div>
              <div className="text-callout text-muted truncate">{pl.owner} • {pl.total}</div>
            </button>
          ))}
        </div>
      )}
      <p className="text-caption text-muted mt-6">Solo se pueden abrir tus playlists y las colaborativas (límite de Spotify en modo desarrollo).</p>
    </section>
  );
};

export const SpotifyArtists: React.FC = () => {
  const sp = useSpotify();
  return (
    <section className="page">
      <h2 className="text-title-1 mb-6">Artistas que sigues <span className="text-callout font-normal text-muted">({sp.artists.length})</span></h2>
      {sp.artists.length === 0 ? <p className="text-callout text-muted">No sigues a ningún artista (o aún no se han sincronizado).</p> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-7">
          {sp.artists.map((a) => (
            <div key={a.id} className="group text-center min-w-0">
              <Cover
                src={a.coverUrl}
                className="aspect-square w-full rounded-full shadow-cover transition duration-[var(--dur-2)] ease-glide group-hover:-translate-y-1 group-hover:scale-[1.02] group-hover:shadow-lift"
              />
              <div className="text-headline truncate mt-3 text-center" title={a.name}>{a.name}</div>
              <div className="text-callout text-muted truncate text-center">{a.genres.slice(0, 2).join(', ')}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
