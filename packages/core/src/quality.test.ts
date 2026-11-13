import { describe, expect, it } from 'vitest';
import { fidelity, formatSpec, formatQuality, isHiRes, qualityTier } from './quality';
import type { Track } from './types';

const t = (over: Partial<Track>): Track => ({ id: 'x', source: 'local', sourceId: 'x', title: 'x', artist: 'a', album: 'b', ...over });

describe('quality', () => {
  it('formatea FLAC hi-res y calidad CD', () => {
    expect(formatQuality(t({ format: 'flac', bitDepth: 24, sampleRate: 96000 }))).toBe('FLAC · 24-bit / 96 kHz');
    expect(formatQuality(t({ format: 'FLAC', bitDepth: 16, sampleRate: 44100 }))).toBe('FLAC · 16-bit / 44.1 kHz');
  });
  it('formatea con pérdida con bitrate', () => {
    expect(formatQuality(t({ format: 'mp3', bitrate: 320, sampleRate: 44100 }))).toBe('MP3 · 320 kbps · 44.1 kHz');
  });
  it('detecta hi-res solo en formatos sin pérdida', () => {
    expect(isHiRes(t({ format: 'FLAC', bitDepth: 24, sampleRate: 48000 }))).toBe(true);
    expect(isHiRes(t({ format: 'FLAC', bitDepth: 16, sampleRate: 44100 }))).toBe(false);
    expect(isHiRes(t({ format: 'MP3', sampleRate: 96000 }))).toBe(false);
  });
});


describe('qualityTier', () => {
  it('clasifica sin pérdida antes de considerar el bitrate', () => {
    expect(qualityTier(t({ format: 'flac', bitDepth: 24 }))).toBe('hires');
    expect(qualityTier(t({ format: 'ALAC', bitrate: 900 }))).toBe('lossless');
    expect(qualityTier(t({ format: 'FLAC', bitDepth: 16, sampleRate: 48000 }))).toBe('lossless');
  });
  it.each(['MP3', 'aac', 'OGG', 'OPUS', 'VORBIS', 'WMA'])('reconoce %s sin bitrate', (format) => {
    expect(qualityTier(t({ format }))).toBe('lossy');
  });
  it('usa el bitrate como respaldo y deja datos insuficientes como desconocidos', () => {
    expect(qualityTier(t({ bitrate: 128 }))).toBe('lossy');
    expect(qualityTier(t({ format: 'otro', bitrate: 128 }))).toBe('lossy');
    expect(qualityTier(t({}))).toBe('unknown');
    expect(qualityTier(t({ format: 'otro', sampleRate: 96000 }))).toBe('unknown');
  });
});

describe('formatSpec', () => {
  it.each([[24, 96000, '24/96'], [16, 44100, '16/44.1'], [24, 88200, '24/88.2']])(
    'formatea %i bits y %i Hz', (bitDepth, sampleRate, expected) => {
      expect(formatSpec(t({ format: 'FLAC', bitDepth, sampleRate }))).toBe(expected);
    },
  );
  it('formatea bitrate en kbps redondeados', () => {
    expect(formatSpec(t({ format: 'mp3', bitrate: 319.6, bitDepth: 16, sampleRate: 44100 }))).toBe('MP3 320');
  });
  it.each([{}, { format: 'FLAC', bitDepth: 24 }, { sampleRate: 96000 }, { format: 'MP3' }, { bitrate: 320 }])(
    'devuelve vacío cuando faltan datos', (over) => expect(formatSpec(t(over))).toBe(''),
  );
});

describe('fidelity', () => {
  it('normaliza calidad CD y los extremos de hi-res', () => {
    expect(fidelity(t({ format: 'FLAC', bitDepth: 16, sampleRate: 44100 })))
      .toEqual({ rate: 0, depth: 0.5, integrity: 1, tier: 'lossless' });
    expect(fidelity(t({ format: 'FLAC', bitDepth: 32, sampleRate: 192000 })))
      .toEqual({ rate: 1, depth: 1, integrity: 1, tier: 'hires' });
  });
  it('interpola frecuencia logarítmica y profundidad', () => {
    expect(fidelity(t({ sampleRate: Math.sqrt(44100 * 192000) })).rate).toBeCloseTo(0.5);
    for (const [bitDepth, depth] of [[8, 0.25], [20, 0.625], [24, 0.75], [28, 0.875]] as const) {
      expect(fidelity(t({ bitDepth })).depth).toBe(depth);
    }
  });
  it('limita los valores y contempla ausencia de datos', () => {
    expect(fidelity(t({}))).toEqual({ rate: 0, depth: 0, integrity: 0, tier: 'unknown' });
    expect(fidelity(t({ sampleRate: 22050, bitDepth: -1 })).rate).toBe(0);
    expect(fidelity(t({ bitDepth: -1 })).depth).toBe(0);
    expect(fidelity(t({ sampleRate: 384000, bitDepth: 64 })).rate).toBe(1);
    expect(fidelity(t({ bitDepth: 64 })).depth).toBe(1);
  });
  it('normaliza integridad con pérdida y sin bitrate', () => {
    expect(fidelity(t({ format: 'MP3', bitrate: 160 })).integrity).toBe(0.5);
    expect(fidelity(t({ format: 'OPUS', bitrate: 500 })).integrity).toBe(1);
    expect(fidelity(t({ format: 'AAC' })).integrity).toBe(0);
    expect(fidelity(t({ format: 'MP3', bitrate: -10 })).integrity).toBe(0);
  });
});
