import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Track } from '@hiresspot/core';

/**
 * Audio nativo de Android (ExoPlayer en un servicio en primer plano).
 *
 * El motor (`PlayerEngine`) trabaja con dos elementos <audio>: uno activo y otro con la siguiente pista precargada.
 * Aquí cada "elemento" es un envoltorio que imita lo que el motor usa de HTMLAudioElement, pero hay UN solo
 * reproductor nativo con una lista de a lo sumo dos pistas (actual + siguiente). El elemento que lo "posee" recibe
 * los eventos; cuando el reproductor pasa solo a la siguiente (aunque el WebView esté suspendido con la pantalla
 * apagada) la propiedad se traspasa al otro elemento y el anterior recibe `ended`, que es lo que el motor espera.
 */

interface NativeState {
  url?: string;
  playing?: boolean;
  buffering?: boolean;
  ended?: boolean;
  positionMs?: number;
  durationMs?: number;
}

interface SourceArgs {
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  artwork?: string;
}

interface NativeAudioPlugin {
  setSource(o: SourceArgs & { autoplay?: boolean; startMs?: number }): Promise<void>;
  setNext(o: Partial<SourceArgs>): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(o: { ms: number }): Promise<void>;
  setVolume(o: { volume: number }): Promise<void>;
  setRate(o: { rate: number }): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<NativeState>;
  addListener(event: 'state', fn: (s: NativeState) => void): Promise<PluginListenerHandle>;
  addListener(event: 'transition', fn: (s: { url: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', fn: (s: { message: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'command', fn: (s: { name: string }) => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<NativeAudioPlugin>('NativeAudio');

type RemoteCommand = 'next' | 'prev';

const metaOf = (el: NativeAudioElement): SourceArgs => {
  const t: Track | undefined = el.track;
  return { url: el.src, title: t?.title, artist: t?.artist, album: t?.album, artwork: t?.coverUrl };
};

class Backend {
  elements = new Set<NativeAudioElement>();
  owner: NativeAudioElement | null = null;
  /** URL que el reproductor nativo tiene cargada como pista actual. */
  nativeUrl = '';
  private commandListeners = new Set<(c: RemoteCommand) => void>();
  private started = false;

  /** Se engancha a los eventos nativos la primera vez que se crea un elemento. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void Native.addListener('state', (s) => this.applyState(s));
    void Native.addListener('transition', (s) => this.transitionTo(s.url));
    void Native.addListener('error', (e) => this.owner?.fail(e.message));
    void Native.addListener('command', (c) => {
      if (c.name === 'next' || c.name === 'prev') for (const l of this.commandListeners) l(c.name);
    });
    // Con la pantalla apagada el WebView puede perderse eventos: al volver, se reconcilia con el estado nativo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void Native.getState().then((s) => this.applyState(s)).catch(() => {});
    });
  }

  onCommand(listener: (c: RemoteCommand) => void): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  /** El otro elemento (el de la siguiente pista) respecto al dueño. */
  other(of: NativeAudioElement | null): NativeAudioElement | null {
    for (const e of this.elements) if (e !== of) return e;
    return null;
  }

  /** Sincroniza la "siguiente pista" nativa con el elemento en espera. */
  syncNext(): void {
    if (!this.owner || !this.nativeUrl) return;
    const standby = this.other(this.owner);
    if (standby && standby.src && standby.src !== this.nativeUrl) void Native.setNext(metaOf(standby)).catch(() => {});
    else void Native.setNext({}).catch(() => {});
  }

  /** El reproductor nativo pasó solo a la pista `url`: el elemento en espera pasa a ser el activo. */
  transitionTo(url: string): void {
    const old = this.owner;
    if (!old || old.src === url) return;
    const next = [...this.elements].find((e) => e !== old && e.src === url);
    this.nativeUrl = url;
    if (!next) return; // sin elemento que lo represente: el motor se reajustará al cargar otra cosa
    this.owner = next;
    next.adoptNative();
    old.finishedByNative(); // dispara `ended` en el anterior: el motor avanza su cola y reusa el elemento ya cargado
  }

  applyState(s: NativeState): void {
    if (s.url && this.owner && this.owner.src !== s.url) this.transitionTo(s.url); // transición perdida
    this.owner?.applyNative(s);
  }
}

const backend = new Backend();

/** Imita lo que `PlayerEngine` usa de HTMLAudioElement. */
class NativeAudioElement extends EventTarget {
  track?: Track;
  preload = 'auto';
  crossOrigin: string | null = null;
  preservesPitch = true;

  private _src = '';
  private _pos = 0;
  private _posAt = 0;
  private _duration = 0;
  private _volume = 1;
  private _muted = false;
  private _rate = 1;
  private _playing = false;
  private _ended = false;
  private _error: { message: string } | null = null;
  private _pendingSeek = 0;
  private _gotDuration = false;

  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this._ended = false;
    this._error = null;
    this._duration = 0;
    this._gotDuration = false;
    this._pos = 0;
    this._posAt = performance.now();
    this._pendingSeek = 0;
    if (backend.owner === this) {
      // Como un <audio> real: cambiar `src` corta lo que sonaba (si luego no hay play(), no debe seguir el audio viejo)
      if (this._playing) void Native.pause().catch(() => {});
      this._playing = false;
      backend.nativeUrl = '';
    } else if (v) {
      backend.syncNext();
    }
  }
  removeAttribute(name: string): void {
    if (name !== 'src') return;
    this._src = '';
    if (backend.owner !== this) backend.syncNext();
  }
  load(): void {
    /* el motor lo llama tras vaciar `src`: nada que hacer */
  }

  get paused(): boolean {
    return !this._playing;
  }
  get ended(): boolean {
    return this._ended;
  }
  get error(): MediaError | null {
    return this._error as unknown as MediaError | null;
  }
  get readyState(): number {
    return this._src ? 4 : 0;
  }
  get duration(): number {
    return this._duration > 0 ? this._duration : Number.NaN;
  }

  get currentTime(): number {
    if (backend.owner === this && this._playing) return this._pos + ((performance.now() - this._posAt) / 1000) * this._rate;
    return this._pos;
  }
  set currentTime(t: number) {
    this._pos = t;
    this._posAt = performance.now();
    if (backend.owner === this) void Native.seek({ ms: Math.round(t * 1000) }).catch(() => {});
    else this._pendingSeek = t;
  }

  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
    this.pushVolume();
  }
  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    this.pushVolume();
  }
  get playbackRate(): number {
    return this._rate;
  }
  set playbackRate(r: number) {
    this._rate = r;
    if (backend.owner === this) void Native.setRate({ rate: r }).catch(() => {});
  }

  private pushVolume(): void {
    if (backend.owner === this) void Native.setVolume({ volume: this._muted ? 0 : this._volume }).catch(() => {});
  }

  async play(): Promise<void> {
    if (!this._src) throw new Error('No hay pista cargada.');
    const wasOwner = backend.owner === this;
    backend.owner = this;
    if (backend.nativeUrl === this._src) {
      await Native.play();
    } else {
      backend.nativeUrl = this._src;
      this._ended = false;
      await Native.setSource({ ...metaOf(this), autoplay: true, startMs: Math.round(this._pendingSeek * 1000) });
      this._pendingSeek = 0;
      backend.syncNext();
    }
    if (!wasOwner) {
      void Native.setRate({ rate: this._rate }).catch(() => {});
      this.pushVolume();
    }
  }

  pause(): void {
    if (backend.owner !== this) return;
    this._pos = this.currentTime;
    this._posAt = performance.now();
    this._playing = false;
    void Native.pause().catch(() => {});
  }

  // ---- llamados por el backend ----

  /** Pasa a ser el reproductor activo por una transición nativa (mismo audio ya sonando). */
  adoptNative(): void {
    this._ended = false;
    this._pos = 0;
    this._posAt = performance.now();
    this._playing = true;
    void Native.setRate({ rate: this._rate }).catch(() => {});
    this.pushVolume();
  }

  finishedByNative(): void {
    this._playing = false;
    this._ended = true;
    this.emit('ended');
  }

  applyNative(s: NativeState): void {
    const pos = (s.positionMs ?? 0) / 1000;
    const dur = (s.durationMs ?? 0) / 1000;
    if (dur > 0 && dur !== this._duration) {
      this._duration = dur;
      this.emit('durationchange');
      if (!this._gotDuration) {
        this._gotDuration = true;
        this.emit('loadedmetadata');
      }
    }
    this._pos = pos;
    this._posAt = performance.now();
    const was = this._playing;
    if (s.ended) {
      if (!this._ended) {
        this._ended = true;
        this._playing = false;
        this.emit('ended');
      }
      return;
    }
    this._playing = !!s.playing;
    if (s.playing && !was) this.emit('playing');
    else if (!s.playing && s.buffering && was) this.emit('waiting');
    else if (!s.playing && !s.buffering && was) this.emit('pause');
    this.emit('timeupdate');
  }

  fail(message: string): void {
    this._error = { message };
    this._playing = false;
    this.emit('error');
  }

  private emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

export const createNativeAudio = (): HTMLAudioElement => {
  backend.start();
  const el = new NativeAudioElement();
  backend.elements.add(el);
  return el as unknown as HTMLAudioElement;
};

export const onNativeRemoteCommand = (listener: (c: RemoteCommand) => void): (() => void) => {
  backend.start();
  return backend.onCommand(listener);
};
