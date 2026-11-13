// Ecualizador paramétrico de 10 bandas sobre Web Audio. Es opcional y está apagado por defecto:
// al activarlo la señal pasa por el mezclador del navegador (no es bit-perfect).

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MAX_DB = 12;

export interface EqualizerSettings {
  enabled: boolean;
  /** dB, -12..12. */
  preamp: number;
  /** dB por banda (misma longitud que EQ_BANDS), -12..12. */
  gains: number[];
}

export const FLAT_EQ: EqualizerSettings = { enabled: false, preamp: 0, gains: EQ_BANDS.map(() => 0) };

export const EQ_PRESETS: Record<string, number[]> = {
  Plano: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Refuerzo de graves': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Refuerzo de agudos': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Rock: [4, 3, 1, -1, -2, -1, 1, 3, 4, 5],
  Jazz: [3, 2, 1, 2, -2, -2, 0, 1, 3, 4],
  Clásica: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  Electrónica: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
  Loudness: [5, 3, 0, 0, -1, 0, -1, 0, 3, 5]
};

export const clampDb = (v: number): number => (Number.isFinite(v) ? Math.min(EQ_MAX_DB, Math.max(-EQ_MAX_DB, v)) : 0);

export const normalizeEq = (raw: Partial<EqualizerSettings> | null | undefined): EqualizerSettings => ({
  enabled: !!raw?.enabled,
  preamp: clampDb(raw?.preamp ?? 0),
  gains: EQ_BANDS.map((_, i) => clampDb(raw?.gains?.[i] ?? 0))
});

/**
 * Cadena: fuente → preamp → 10 filtros peaking → destino. Cada <audio> se conecta una sola vez
 * (limitación de createMediaElementSource), por eso solo se crea al activar el ecualizador.
 */
export class EqualizerGraph {
  private readonly ctx: AudioContext;
  private readonly preamp: GainNode;
  private readonly filters: BiquadFilterNode[];
  private readonly connected = new WeakSet<HTMLAudioElement>();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.preamp = this.ctx.createGain();
    this.filters = EQ_BANDS.map((f) => {
      const b = this.ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    let node: AudioNode = this.preamp;
    for (const f of this.filters) {
      node.connect(f);
      node = f;
    }
    node.connect(this.ctx.destination);
  }

  connect(el: HTMLAudioElement): void {
    if (this.connected.has(el)) return;
    this.connected.add(el);
    this.ctx.createMediaElementSource(el).connect(this.preamp);
  }

  apply(s: EqualizerSettings): void {
    this.preamp.gain.value = 10 ** (clampDb(s.preamp) / 20);
    this.filters.forEach((f, i) => (f.gain.value = clampDb(s.gains[i] ?? 0)));
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  dispose(): void {
    void this.ctx.close().catch(() => {});
  }
}
