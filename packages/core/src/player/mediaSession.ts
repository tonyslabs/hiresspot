import type { PlayerEngine } from './engine';

const SEEK_STEP_S = 10;
const MEDIA_SESSION_SCHEMES = new Set(['http:', 'https:', 'data:', 'blob:']);

/**
 * La Media Session solo acepta artwork http/https/data/blob. Para esquemas propios (p. ej.
 * hires-media://) se descarga la imagen y se expone como blob:. Devuelve null si falla.
 */
const artworkUrl = async (src: string): Promise<{ url: string; revoke: boolean } | null> => {
  try {
    if (MEDIA_SESSION_SCHEMES.has(new URL(src).protocol)) return { url: src, revoke: false };
    const res = await fetch(src);
    if (!res.ok) return null;
    return { url: URL.createObjectURL(await res.blob()), revoke: true };
  } catch {
    return null;
  }
};

/**
 * Conecta el motor con la Media Session del navegador: teclas multimedia, notificación del
 * sistema y metadatos. Devuelve la función para desconectar. No hace nada si no hay soporte.
 */
export const bindMediaSession = (engine: PlayerEngine): (() => void) => {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => {};
  const ms = navigator.mediaSession;

  const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* acción no soportada */
    }
  };

  setHandler('play', () => engine.play());
  setHandler('pause', () => engine.pause());
  setHandler('previoustrack', () => engine.prev());
  setHandler('nexttrack', () => engine.next());
  setHandler('seekto', (d) => {
    if (typeof d.seekTime === 'number') engine.seek(d.seekTime);
  });
  setHandler('seekbackward', () => engine.seek(engine.getPosition() - SEEK_STEP_S));
  setHandler('seekforward', () => engine.seek(engine.getPosition() + SEEK_STEP_S));

  let lastTrackId: string | null = null;
  let blobToRevoke: string | null = null;
  const releaseBlob = () => {
    if (blobToRevoke) URL.revokeObjectURL(blobToRevoke);
    blobToRevoke = null;
  };

  const setMetadata = (track: NonNullable<ReturnType<typeof engine.getState>['current']>) => {
    const base = { title: track.title, artist: track.artist, album: track.album };
    try {
      ms.metadata = new MediaMetadata(base);
    } catch {
      return;
    }
    if (!track.coverUrl) return;
    void artworkUrl(track.coverUrl).then((art) => {
      // Si ya cambió la pista, descarta este resultado
      if (!art || engine.getState().current?.id !== track.id) {
        if (art?.revoke) URL.revokeObjectURL(art.url);
        return;
      }
      releaseBlob();
      if (art.revoke) blobToRevoke = art.url;
      try {
        ms.metadata = new MediaMetadata({ ...base, artwork: [{ src: art.url }] });
      } catch {
        /* artwork no soportado */
      }
    });
  };

  const sync = () => {
    const s = engine.getState();
    if ((s.current?.id ?? null) !== lastTrackId) {
      lastTrackId = s.current?.id ?? null;
      if (s.current) setMetadata(s.current);
      else ms.metadata = null;
    }
    ms.playbackState = s.status === 'playing' || s.status === 'loading' ? 'playing' : s.current ? 'paused' : 'none';
    if (s.duration > 0) {
      try {
        ms.setPositionState({ duration: s.duration, position: Math.min(s.position, s.duration), playbackRate: 1 });
      } catch {
        /* valores fuera de rango durante la carga */
      }
    }
  };

  const unsubscribe = engine.subscribe(sync);
  sync();

  return () => {
    unsubscribe();
    for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'seekbackward', 'seekforward'] as const) {
      setHandler(a, null);
    }
    releaseBlob();
    ms.metadata = null;
  };
};
