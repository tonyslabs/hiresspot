import { describe, expect, it } from 'vitest';
import { PlayerEngine, replayGainFactor } from './engine';
import type { Track } from '../types';

/** <audio> mínimo para pruebas: guarda estado y emite los eventos que usa el motor. */
class FakeAudio extends EventTarget {
  src = '';
  preload = '';
  currentTime = 0;
  duration = NaN;
  paused = true;
  ended = false;
  volume = 1;
  muted = false;
  error: MediaError | null = null;
  playCalls = 0;

  play() {
    this.playCalls++;
    this.paused = false;
    this.ended = false;
    queueMicrotask(() => this.dispatchEvent(new Event('playing')));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  load() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  finish() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}

const t = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  source: 'local',
  sourceId: id,
  title: id,
  artist: 'A',
  album: 'B',
  duration: 100,
  ...extra
});

const setup = () => {
  const els: FakeAudio[] = [];
  const engine = new PlayerEngine({
    resolveUrl: (track) => `mem://${track.id}`,
    createAudio: () => {
      const el = new FakeAudio();
      els.push(el);
      return el as unknown as HTMLAudioElement;
    },
    rng: () => 0.5
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { engine, els, tick };
};

describe('PlayerEngine', () => {
  it('reproduce la pista pedida y pasa a playing', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    await tick();
    expect(engine.getState().status).toBe('playing');
    expect(engine.getState().current?.id).toBe('a');
    expect(els[0].src).toBe('mem://a');
  });

  it('precarga la siguiente en el elemento en espera', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    await tick();
    expect(els[1].src).toBe('mem://b');
  });

  it('al terminar, pasa a la siguiente reusando el elemento precargado', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    await tick();
    els[0].finish();
    await tick();
    expect(engine.getState().current?.id).toBe('b');
    expect(els[1].playCalls).toBe(1);
    expect(engine.getState().status).toBe('playing');
  });

  it('regresión: pausar NO salta a la siguiente pista', async () => {
    const { engine, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    await tick();
    engine.pause();
    await tick();
    expect(engine.getState().current?.id).toBe('a');
    expect(engine.getState().status).toBe('paused');
  });

  it('regresión: seek no cambia de pista y conserva el estado', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    await tick();
    engine.seek(42);
    await tick();
    expect(els[0].currentTime).toBe(42);
    expect(engine.getState().current?.id).toBe('a');
    expect(engine.getState().status).toBe('playing');
  });

  it('toggle alterna entre pausa y reproducción', async () => {
    const { engine, tick } = setup();
    engine.setQueue([t('a')], 0);
    await tick();
    engine.toggle();
    expect(engine.getState().status).toBe('paused');
    engine.toggle();
    await tick();
    expect(engine.getState().status).toBe('playing');
  });

  it('prev reinicia si pasaron más de 3 s, si no va a la anterior', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a'), t('b')], 1);
    await tick();
    els[0].currentTime = 10;
    els[0].dispatchEvent(new Event('timeupdate'));
    engine.prev();
    expect(engine.getState().current?.id).toBe('b');
    expect(els[0].currentTime).toBe(0);
    engine.prev();
    await tick();
    expect(engine.getState().current?.id).toBe('a');
  });

  it('al terminar la última pista sin repeat, queda en pausa sin error', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a')], 0);
    await tick();
    els[0].finish();
    expect(engine.getState().status).toBe('paused');
    expect(engine.getState().current?.id).toBe('a');
  });

  it('repeat one repite la pista al terminar', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    engine.setRepeat('one');
    await tick();
    els[0].finish();
    await tick();
    expect(engine.getState().current?.id).toBe('a');
    expect(els[0].playCalls).toBe(2);
  });

  it('un error del elemento deja el estado en error con mensaje', async () => {
    const { engine, els, tick } = setup();
    engine.setQueue([t('a')], 0);
    await tick();
    els[0].error = { message: 'sin red' } as MediaError;
    els[0].dispatchEvent(new Event('error'));
    expect(engine.getState().status).toBe('error');
    expect(engine.getState().error).toBe('sin red');
  });

  it('notifica a los suscriptores y devuelve un snapshot estable entre cambios', async () => {
    const { engine, tick } = setup();
    let calls = 0;
    const off = engine.subscribe(() => calls++);
    const s1 = engine.getState();
    expect(engine.getState()).toBe(s1);
    engine.setQueue([t('a')], 0);
    await tick();
    expect(calls).toBeGreaterThan(0);
    off();
    const before = calls;
    engine.setVolume(0.5);
    expect(calls).toBe(before);
  });

  it('regresión: un suscriptor que lanza no rompe el motor ni a los demás', async () => {
    const { engine, tick } = setup();
    let healthy = 0;
    engine.subscribe(() => {
      throw new Error('boom');
    });
    engine.subscribe(() => healthy++);
    engine.setQueue([t('a')], 0);
    await tick();
    expect(engine.getState().status).toBe('playing');
    expect(healthy).toBeGreaterThan(0);
  });

  it('aplica el volumen y ReplayGain solo atenuando', async () => {
    const { engine, els, tick } = setup();
    engine.setVolume(0.8);
    engine.setQueue([t('a', { replayGain: { trackGain: -6 } })], 0);
    await tick();
    expect(els[0].volume).toBeCloseTo(0.8 * 10 ** (-6 / 20), 5);
    engine.setReplayGain('off');
    expect(els[0].volume).toBeCloseTo(0.8, 5);
  });

  it('removeAt de la actual pasa a la siguiente y sigue sonando', async () => {
    const { engine, tick } = setup();
    engine.setQueue([t('a'), t('b')], 0);
    await tick();
    engine.removeAt(0);
    await tick();
    expect(engine.getState().current?.id).toBe('b');
    expect(engine.getState().status).toBe('playing');
  });
});

describe('replayGainFactor', () => {
  it('no amplifica nunca y respeta el pico', () => {
    expect(replayGainFactor(t('a', { replayGain: { trackGain: +6 } }), 'track')).toBe(1);
    expect(replayGainFactor(t('a', { replayGain: { trackGain: -3, trackPeak: 1 } }), 'track')).toBeCloseTo(10 ** (-3 / 20), 5);
    expect(replayGainFactor(t('a', { replayGain: { trackGain: -3 } }), 'off')).toBe(1);
    expect(replayGainFactor(t('a'), 'track')).toBe(1);
  });
});
