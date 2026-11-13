import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { bindMediaSession, normalizeEq, PlayerEngine, type EqualizerSettings, type PlayerState, type Track } from '@hiresspot/core';
import { useLocal } from './local';
import { useNavidrome } from './navidrome';
import { usePlatform } from './platform';

const PlayerContext = createContext<PlayerEngine | null>(null);

/** Crea el motor una sola vez (vive lo que vive la app) y lo conecta a la Media Session. */
export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const platform = usePlatform();
  const navidrome = useNavidrome();
  // `streamUrl` es estable (lee el cliente actual de un ref), por eso el motor se crea una sola vez
  const [engine] = useState(
    () =>
      new PlayerEngine({
        createAudio: platform.media.createAudio ? () => platform.media.createAudio!() : undefined,
        resolveUrl: (track) => {
          if (track.source !== 'navidrome') return platform.media.urlFor(track);
          const url = navidrome.streamUrl(track);
          // Todo Navidrome pasa por el proxy local: sanea los FLAC con portada mal formada (Chromium
          // no los abre) y añade CORS, necesario para el ecualizador (Web Audio)
          return url && platform.media.sanitizedFlacUrl ? platform.media.sanitizedFlacUrl(url) : url;
        }
      })
  );

  useEffect(() => bindMediaSession(engine), [engine]);

  // Siguiente/anterior desde la notificación o los auriculares (plataformas con reproductor nativo)
  useEffect(
    () => platform.media.onRemoteCommand?.((command) => (command === 'next' ? engine.next() : engine.prev())),
    [platform, engine]
  );

  // Modo ReplayGain guardado (por defecto el motor usa "pista")
  useEffect(() => {
    platform.settings
      .get<string>('replayGain')
      .then((m) => (m === 'off' || m === 'track' || m === 'album') && engine.setReplayGain(m))
      .catch(() => {});
  }, [platform, engine]);

  // Ecualizador guardado
  useEffect(() => {
    platform.settings
      .get<Partial<EqualizerSettings>>('equalizer')
      .then((eq) => eq && engine.setEqualizer(normalizeEq(eq)))
      .catch(() => {});
  }, [platform, engine]);

  return <PlayerContext.Provider value={engine}>{children}</PlayerContext.Provider>;
};

/** Cambia el ecualizador y lo guarda. */
export const useEqualizerActions = () => {
  const engine = usePlayer();
  const platform = usePlatform();
  return (patch: Partial<EqualizerSettings>) => {
    engine.setEqualizer(patch);
    void platform.settings.set('equalizer', engine.getState().equalizer).catch(() => {});
  };
};

interface SavedQueue {
  ids: string[];
  index: number;
  position: number;
}

/**
 * Guarda la cola (solo ids, nunca URLs con credenciales) y la restaura al abrir la app, cuando
 * las bibliotecas ya tienen las pistas. Restaura en pausa y en la posición donde se quedó.
 */
export const QueuePersistence = () => {
  const engine = usePlayer();
  const platform = usePlatform();
  const nd = useNavidrome();
  const local = useLocal();
  const restored = useRef(false);
  const saved = useRef<SavedQueue | null | undefined>(undefined); // undefined = aún leyendo

  useEffect(() => {
    platform.settings
      .get<SavedQueue>('queue')
      .then((q) => (saved.current = q && Array.isArray(q.ids) ? q : null))
      .catch(() => (saved.current = null));
  }, [platform]);

  // Restaurar en cuanto las pistas guardadas aparecen en alguna biblioteca (o tras 6 s con las que haya)
  const byId = useRef(new Map<string, Track>());
  useEffect(() => {
    byId.current = new Map([...local.tracks, ...nd.tracks].map((t) => [t.id, t]));
  }, [local.tracks, nd.tracks]);

  useEffect(() => {
    if (restored.current) return;
    const tryRestore = (force: boolean) => {
      const q = saved.current;
      if (restored.current || q === undefined) return;
      if (q === null || q.ids.length === 0) {
        restored.current = true;
        return;
      }
      const found = q.ids.map((id) => byId.current.get(id));
      const complete = found.every(Boolean);
      if (!complete && !force) return;
      restored.current = true;
      const tracks = found.filter((t): t is Track => !!t);
      if (tracks.length === 0 || engine.getState().current) return; // ya hay algo sonando: no pisarlo
      const wantedId = q.ids[q.index];
      const idx = Math.max(0, tracks.findIndex((t) => t.id === wantedId));
      engine.setQueue(tracks, idx, false);
      if (q.position > 1) engine.seek(q.position);
    };
    tryRestore(false);
    const poll = setInterval(() => tryRestore(false), 500);
    const stop = setTimeout(() => tryRestore(true), 6000);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [engine, local.tracks, nd.tracks]);

  // Guardar con retardo (la posición cambia 4 veces por segundo: se guarda cada ~5 s)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const persist = () => {
      timer = null;
      if (!restored.current) return;
      const s = engine.getState();
      const payload: SavedQueue = { ids: s.queue.map((t) => t.id), index: s.index, position: Math.floor(engine.getPosition()) };
      void platform.settings.set('queue', payload).catch(() => {});
    };
    const off = engine.subscribe(() => {
      if (!timer) timer = setTimeout(persist, 5000);
    });
    return () => {
      off();
      if (timer) {
        clearTimeout(timer);
        persist();
      }
    };
  }, [engine, platform]);

  return null;
};

const typing = (el: EventTarget | null): boolean => {
  const e = el as HTMLElement | null;
  const tag = e?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!e?.isContentEditable;
};

export const SEEK_STEP_S = 10;
export const VOLUME_STEP = 0.05;

/** Atajos de teclado dentro de la app (los globales del sistema los dan las teclas multimedia). */
export const HotkeysBridge = () => {
  const engine = usePlayer();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const s = engine.getState();
      const onSlider = (e.target as HTMLElement | null)?.getAttribute('role') === 'slider';
      switch (e.key) {
        case 'ArrowRight':
          if (onSlider) return;
          engine.seek(engine.getPosition() + SEEK_STEP_S);
          break;
        case 'ArrowLeft':
          if (onSlider) return;
          engine.seek(engine.getPosition() - SEEK_STEP_S);
          break;
        case 'ArrowUp':
          if (onSlider) return;
          engine.setVolume(s.volume + VOLUME_STEP);
          break;
        case 'ArrowDown':
          if (onSlider) return;
          engine.setVolume(s.volume - VOLUME_STEP);
          break;
        case 'n':
        case 'N':
          engine.next();
          break;
        case 'p':
        case 'P':
          engine.prev();
          break;
        case 'm':
        case 'M':
          engine.setMuted(!s.muted);
          break;
        case 's':
        case 'S':
          engine.setShuffle(!s.shuffle);
          break;
        case 'r':
        case 'R':
          engine.setRepeat(s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off');
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
  return null;
};

export const usePlayer = (): PlayerEngine => {
  const engine = useContext(PlayerContext);
  if (!engine) throw new Error('usePlayer: falta <PlayerProvider>');
  return engine;
};

export const usePlayerState = (): PlayerState => {
  const engine = usePlayer();
  return useSyncExternalStore(engine.subscribe, engine.getState);
};

/** Solo el id de la pista actual: no re-renderiza con cada tic de posición (~4 veces por segundo). */
export const useCurrentTrackId = (): string | null => {
  const engine = usePlayer();
  return useSyncExternalStore(engine.subscribe, () => engine.getState().current?.id ?? null);
};

/** Solo el estado de reproducción (idle/loading/playing/paused/error). */
export const usePlayerStatus = (): PlayerState['status'] => {
  const engine = usePlayer();
  return useSyncExternalStore(engine.subscribe, () => engine.getState().status);
};

/**
 * Informa a Navidrome qué suena y registra la reproducción (scrobble) al pasar la mitad de la
 * pista o 4 minutos, lo que ocurra primero (regla de Last.fm). Solo pistas de Navidrome.
 */
export const ScrobbleBridge = () => {
  const engine = usePlayer();
  const { scrobble } = useNavidrome();

  useEffect(() => {
    let announcedId: string | null = null;
    let startedAt = 0;
    let submitted = false;

    return engine.subscribe(() => {
      const s = engine.getState();
      const t = s.current;
      if (!t || t.source !== 'navidrome') {
        announcedId = null;
        return;
      }
      if (s.status !== 'playing') return;

      if (t.id !== announcedId) {
        announcedId = t.id;
        startedAt = Date.now();
        submitted = false;
        scrobble(t, false);
      }
      if (submitted && s.position < 1) {
        // La pista volvió a empezar (repeat one / seek al inicio): cuenta como nueva reproducción
        submitted = false;
        startedAt = Date.now();
      }
      const threshold = Math.min(s.duration * 0.5, 240);
      if (!submitted && s.duration >= 30 && s.position >= threshold) {
        submitted = true;
        scrobble(t, true, startedAt);
      }
    });
  }, [engine, scrobble]);

  return null;
};

/** Posición fluida (rAF mientras suena), más fina que los ~4 Hz de `timeupdate`. */
export const useSmoothPosition = (): number => {
  const engine = usePlayer();
  const { status, position } = usePlayerState();
  const [pos, setPos] = useState(position);

  useEffect(() => {
    setPos(engine.getPosition());
    if (status !== 'playing') return;
    let raf = 0;
    const tick = () => {
      setPos(engine.getPosition());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, status, position]);

  return pos;
};

/** Evita que el sistema se suspenda mientras suena música (se puede desactivar en Ajustes). */
export const PowerBridge = () => {
  const engine = usePlayer();
  const platform = usePlatform();
  useEffect(() => {
    if (!platform.power) return;
    let enabled = true;
    let last: boolean | null = null;
    const push = () => {
      const playing = enabled && engine.getState().status === 'playing';
      if (playing === last) return;
      last = playing;
      void platform.power?.setPlaying(playing).catch(() => {});
    };
    platform.settings
      .get<boolean>('preventSleep')
      .then((v) => {
        enabled = v !== false;
        push();
      })
      .catch(() => {});
    const onSetting = () => {
      platform.settings.get<boolean>('preventSleep').then((v) => {
        enabled = v !== false;
        push();
      }).catch(() => {});
    };
    window.addEventListener('hiresspot:settings', onSetting);
    const off = engine.subscribe(push);
    return () => {
      off();
      window.removeEventListener('hiresspot:settings', onSetting);
      void platform.power?.setPlaying(false).catch(() => {});
    };
  }, [engine, platform]);
  return null;
};

/** Historial de reproducción (últimas 60 pistas distintas) para "Escuchado recientemente". */
export const HistoryBridge = () => {
  const engine = usePlayer();
  const platform = usePlatform();
  useEffect(() => {
    let last: string | null = null;
    let list: string[] | null = null;
    platform.settings.get<string[]>('history').then((h) => (list = Array.isArray(h) ? h : [])).catch(() => (list = []));
    return engine.subscribe(() => {
      const s = engine.getState();
      if (s.status !== 'playing' || !s.current || s.current.id === last || list === null) return;
      last = s.current.id;
      list = [last, ...list.filter((id) => id !== last)].slice(0, 60);
      void platform.settings.set('history', list).catch(() => {});
    });
  }, [engine, platform]);
  return null;
};
