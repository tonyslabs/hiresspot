import type { Track } from '../types';
import * as Q from './queue';
import type { RepeatMode, Rng } from './queue';
import { EqualizerGraph, FLAT_EQ, normalizeEq, type EqualizerSettings } from './equalizer';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type ReplayGainMode = 'off' | 'track' | 'album';

export interface PlayerState {
  /** Pistas en el orden de la lista (no el de shuffle). */
  queue: Track[];
  /** Índice de la pista actual dentro de `queue`; -1 si no hay. */
  index: number;
  current: Track | null;
  status: PlayerStatus;
  /** Segundos. Se actualiza con `timeupdate`. */
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  replayGain: ReplayGainMode;
  /** Velocidad de reproducción (0.5–2). */
  rate: number;
  equalizer: EqualizerSettings;
  error: string | null;
}

export interface PlayerEngineOptions {
  /** URL reproducible por un <audio> para la pista (la fuente/plataforma la construye). */
  resolveUrl: (track: Track) => string;
  /** Inyectable para pruebas. Por defecto `new Audio()`. */
  createAudio?: () => HTMLAudioElement;
  rng?: Rng;
}

const RESTART_THRESHOLD_S = 3;

/**
 * Factor de volumen por ReplayGain. Solo atenúa (nunca >1): <audio> no puede amplificar
 * sin pasar por Web Audio, y esa ruta altera la señal. Con pico conocido también evita clipping.
 */
export const replayGainFactor = (track: Track | undefined, mode: ReplayGainMode): number => {
  if (!track || mode === 'off') return 1;
  const rg = track.replayGain;
  if (!rg) return 1;
  const gain = mode === 'album' ? (rg.albumGain ?? rg.trackGain) : (rg.trackGain ?? rg.albumGain);
  if (gain === undefined || Number.isNaN(gain)) return 1;
  const peak = mode === 'album' ? (rg.albumPeak ?? rg.trackPeak) : (rg.trackPeak ?? rg.albumPeak);
  let factor = 10 ** (gain / 20);
  if (peak && peak > 0) factor = Math.min(factor, 1 / peak);
  return Math.min(1, factor);
};

/**
 * Motor de reproducción sobre dos elementos <audio>: uno activo y otro en espera con la
 * siguiente pista ya precargada, de modo que el cambio al terminar la pista es casi inmediato.
 * No es gapless a nivel de muestra (eso exige un motor nativo), pero evita el silencio de
 * cargar la pista siguiente desde cero.
 */
export class PlayerEngine {
  private readonly resolveUrl: PlayerEngineOptions['resolveUrl'];
  private readonly rng: Rng;
  private readonly abort = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly trackOf = new Map<HTMLAudioElement, Track>();

  private q: Q.QueueState = Q.emptyQueue();
  private active: HTMLAudioElement;
  private standby: HTMLAudioElement;

  private status: PlayerStatus = 'idle';
  private position = 0;
  private duration = 0;
  private volume = 1;
  private muted = false;
  private replayGain: ReplayGainMode = 'track';
  private rate = 1;
  private eq: EqualizerSettings = FLAT_EQ;
  private eqGraph: EqualizerGraph | null = null;
  private error: string | null = null;
  private state: PlayerState;

  constructor(options: PlayerEngineOptions) {
    this.resolveUrl = options.resolveUrl;
    this.rng = options.rng ?? Math.random;
    const create = options.createAudio ?? (() => new Audio());
    this.active = this.setup(create());
    this.standby = this.setup(create());
    this.state = this.snapshot();
  }

  // ---- Suscripción (compatible con useSyncExternalStore) ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlayerState => this.state;

  /** Posición exacta en este instante (para barras de progreso con rAF). */
  getPosition(): number {
    return this.active.currentTime || 0;
  }

  // ---- Control de la cola ----

  /** Reemplaza la cola y empieza por `startIndex`. */
  setQueue(tracks: Track[], startIndex = 0, autoplay = true): void {
    this.q = Q.setItems(this.q, tracks, startIndex, this.rng);
    this.startCurrent(autoplay);
  }

  addToQueue(tracks: Track[]): void {
    const hadCurrent = Q.currentTrack(this.q) !== null;
    this.q = Q.append(this.q, tracks, this.rng);
    if (hadCurrent) this.queueChanged();
    else this.startCurrent(false);
  }

  /** Inserta justo después de la actual. */
  playNext(tracks: Track[]): void {
    const hadCurrent = Q.currentTrack(this.q) !== null;
    this.q = Q.insertNext(this.q, tracks, this.rng);
    if (hadCurrent) this.queueChanged();
    else this.startCurrent(false);
  }

  jumpTo(index: number): void {
    this.q = Q.jumpTo(this.q, index);
    this.startCurrent(true);
  }

  removeAt(index: number): void {
    const wasCurrent = Q.currentIndex(this.q) === index;
    const wasPlaying = this.status === 'playing' || this.status === 'loading';
    this.q = Q.removeAt(this.q, index);
    if (!wasCurrent) return this.queueChanged();
    if (Q.currentTrack(this.q)) this.startCurrent(wasPlaying);
    else this.clear();
  }

  clear(): void {
    this.releaseElement(this.active);
    this.releaseElement(this.standby);
    this.q = { ...Q.emptyQueue(), shuffle: this.q.shuffle, repeat: this.q.repeat };
    this.status = 'idle';
    this.position = 0;
    this.duration = 0;
    this.error = null;
    this.emit();
  }

  // ---- Transporte ----

  play(): void {
    if (!Q.currentTrack(this.q)) return;
    if (this.status === 'error' || !this.trackOf.has(this.active)) return this.startCurrent(true);
    this.status = 'loading';
    this.emit();
    this.active.play().catch((err) => this.fail(err));
  }

  pause(): void {
    if (!this.trackOf.has(this.active)) return;
    this.active.pause();
    this.status = 'paused';
    this.emit();
  }

  toggle(): void {
    if (this.status === 'playing' || this.status === 'loading') this.pause();
    else this.play();
  }

  next(): void {
    const n = Q.next(this.q, false);
    if (!n) return;
    this.q = n;
    this.startCurrent(true);
  }

  prev(): void {
    if (this.position > RESTART_THRESHOLD_S) return this.seek(0);
    const p = Q.prev(this.q);
    if (!p) return this.seek(0);
    this.q = p;
    this.startCurrent(true);
  }

  seek(seconds: number): void {
    if (!this.trackOf.has(this.active)) return;
    const max = this.duration > 0 ? this.duration : Number.MAX_SAFE_INTEGER;
    const t = Math.min(Math.max(seconds, 0), max);
    this.active.currentTime = t;
    this.position = t;
    this.emit();
  }

  seekRatio(ratio: number): void {
    if (this.duration > 0) this.seek(this.duration * Math.min(Math.max(ratio, 0), 1));
  }

  // ---- Ajustes ----

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    this.applyVolume();
    this.emit();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
    this.emit();
  }

  setShuffle(shuffle: boolean): void {
    this.q = Q.setShuffle(this.q, shuffle, this.rng);
    this.queueChanged();
  }

  setRepeat(repeat: RepeatMode): void {
    this.q = Q.setRepeat(this.q, repeat);
    this.queueChanged();
  }

  setReplayGain(mode: ReplayGainMode): void {
    this.replayGain = mode;
    this.applyVolume();
    this.emit();
  }

  setPlaybackRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.5, Number.isFinite(rate) ? rate : 1));
    this.applyRate();
    this.emit();
  }

  /** Aplica el ecualizador. La primera vez que se activa crea el grafo Web Audio. */
  setEqualizer(settings: Partial<EqualizerSettings>): void {
    this.eq = normalizeEq({ ...this.eq, ...settings });
    if (this.eq.enabled && !this.eqGraph && typeof AudioContext !== 'undefined') {
      try {
        this.eqGraph = new EqualizerGraph();
        for (const el of [this.active, this.standby]) this.eqGraph.connect(el);
      } catch (err) {
        console.error('[PlayerEngine] ecualizador no disponible', err);
        this.eqGraph = null;
        this.eq = { ...this.eq, enabled: false };
      }
    }
    // Apagado = plano (el grafo sigue conectado pero sin efecto)
    this.eqGraph?.apply(this.eq.enabled ? this.eq : FLAT_EQ);
    if (this.eq.enabled) this.eqGraph?.resume();
    this.emit();
  }

  dispose(): void {
    this.abort.abort();
    this.eqGraph?.dispose();
    this.releaseElement(this.active);
    this.releaseElement(this.standby);
    this.listeners.clear();
  }

  // ---- Internos ----

  private setup(el: HTMLAudioElement): HTMLAudioElement {
    el.preload = 'auto';
    const on = (type: string, fn: () => void) =>
      el.addEventListener(type, () => el === this.active && fn(), { signal: this.abort.signal });

    on('timeupdate', () => {
      this.position = el.currentTime;
      this.emit();
    });
    const syncDuration = () => {
      this.duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (this.trackOf.get(el)?.duration ?? 0);
      this.emit();
    };
    on('durationchange', syncDuration);
    on('loadedmetadata', syncDuration);
    on('playing', () => {
      this.status = 'playing';
      this.error = null;
      this.emit();
      this.preloadNext();
    });
    on('waiting', () => {
      if (this.status === 'playing') {
        this.status = 'loading';
        this.emit();
      }
    });
    on('pause', () => {
      if (!el.ended && this.status === 'playing') {
        this.status = 'paused';
        this.emit();
      }
    });
    on('ended', () => this.onEnded());
    on('error', () => this.fail(el.error ?? new Error('Error de reproducción')));
    return el;
  }

  private onEnded(): void {
    const n = Q.next(this.q, true);
    if (!n) {
      this.status = 'paused';
      this.position = this.duration;
      this.emit();
      return;
    }
    if (this.q.repeat === 'one') {
      this.active.currentTime = 0;
      this.active.play().catch((err) => this.fail(err));
      return;
    }
    this.q = n;
    this.startCurrent(true);
  }

  /** Pone la pista actual de la cola en el elemento activo (reusando la precarga si coincide). */
  private startCurrent(autoplay: boolean): void {
    const track = Q.currentTrack(this.q);
    if (!track) return this.clear();

    if (this.trackOf.get(this.standby)?.id === track.id) {
      const old = this.active;
      this.active = this.standby;
      this.standby = old;
      this.releaseElement(old);
    } else {
      this.releaseElement(this.standby);
      this.loadInto(this.active, track);
    }

    const realDuration = this.active.duration;
    this.position = 0;
    this.duration = Number.isFinite(realDuration) && realDuration > 0 ? realDuration : (track.duration ?? 0);
    this.error = null;
    this.status = autoplay ? 'loading' : 'paused';
    this.applyVolume();
    this.emit();

    if (autoplay) this.active.play().catch((err) => this.fail(err));
    else this.preloadNext();
  }

  private preloadNext(): void {
    const current = Q.currentTrack(this.q);
    const nxt = Q.peekNext(this.q);
    if (!current || !nxt || nxt.id === current.id) {
      this.releaseElement(this.standby);
      return;
    }
    if (this.trackOf.get(this.standby)?.id === nxt.id) return;
    this.loadInto(this.standby, nxt);
    this.applyVolume();
  }

  private queueChanged(): void {
    this.emit();
    if (Q.currentTrack(this.q)) this.preloadNext();
  }

  private loadInto(el: HTMLAudioElement, track: Track): void {
    const url = this.resolveUrl(track);
    // Web Audio solo recibe señal de orígenes con CORS: el protocolo propio la incluye
    el.crossOrigin = url.startsWith('hires-media:') ? 'anonymous' : null;
    el.src = url;
    el.preload = 'auto';
    this.trackOf.set(el, track);
  }

  private releaseElement(el: HTMLAudioElement): void {
    el.pause();
    if (this.trackOf.delete(el)) {
      el.removeAttribute('src');
      el.load();
    }
  }

  private applyRate(): void {
    for (const el of [this.active, this.standby]) {
      el.preservesPitch = true;
      el.playbackRate = this.rate;
    }
  }

  private applyVolume(): void {
    this.applyRate();
    for (const el of [this.active, this.standby]) {
      el.volume = Math.min(1, Math.max(0, this.volume * replayGainFactor(this.trackOf.get(el), this.replayGain)));
      el.muted = this.muted;
    }
  }

  private fail(err: unknown): void {
    if (err instanceof Error && err.name === 'AbortError') return; // play() interrumpido por un cambio de pista
    const message = err instanceof Error ? err.message : ((err as MediaError | undefined)?.message ?? 'Error de reproducción');
    this.status = 'error';
    this.error = message || 'Error de reproducción';
    this.emit();
  }

  private snapshot(): PlayerState {
    return {
      queue: this.q.items,
      index: Q.currentIndex(this.q),
      current: Q.currentTrack(this.q),
      status: this.status,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      muted: this.muted,
      shuffle: this.q.shuffle,
      repeat: this.q.repeat,
      replayGain: this.replayGain,
      rate: this.rate,
      equalizer: this.eq,
      error: this.error
    };
  }

  private emit(): void {
    this.state = this.snapshot();
    for (const l of this.listeners) {
      // Un suscriptor que falla no debe romper el motor ni a los demás suscriptores
      try {
        l();
      } catch (err) {
        console.error('[PlayerEngine] suscriptor falló', err);
      }
    }
  }
}
