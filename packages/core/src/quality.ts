import type { Track } from './types';

const LOSSLESS = new Set(['FLAC', 'WAV', 'WAVE', 'AIFF', 'ALAC', 'APE', 'WV', 'DSF', 'DFF']);

const formatKHz = (hz: number): string => {
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
};

export const isLossless = (t: Track): boolean => !!t.format && LOSSLESS.has(t.format.toUpperCase());

/** Más que calidad CD: más de 16 bits o más de 44.1/48 kHz, en un formato sin pérdida. */
export const isHiRes = (t: Track): boolean =>
  isLossless(t) && ((t.bitDepth ?? 0) > 16 || (t.sampleRate ?? 0) > 48000);

/** Descripción corta de la calidad de la fuente, p. ej. "FLAC · 24-bit / 96 kHz". */
export const formatQuality = (t: Track): string => {
  const parts: string[] = [];
  if (t.format) parts.push(t.format.toUpperCase());
  if (isLossless(t)) {
    const spec = [t.bitDepth ? `${t.bitDepth}-bit` : null, t.sampleRate ? formatKHz(t.sampleRate) : null]
      .filter(Boolean)
      .join(' / ');
    if (spec) parts.push(spec);
  } else {
    if (t.bitrate) parts.push(`${t.bitrate} kbps`);
    if (t.sampleRate) parts.push(formatKHz(t.sampleRate));
  }
  return parts.join(' · ');
};

export type QualityTier = 'hires' | 'lossless' | 'lossy' | 'unknown';

const LOSSY = new Set(['MP3', 'AAC', 'OGG', 'OPUS', 'VORBIS', 'M4A', 'WMA', 'MP2', 'MPC']);
const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

export const qualityTier = (t: Track): QualityTier => {
  if (isHiRes(t)) return 'hires';
  if (isLossless(t)) return 'lossless';
  if (LOSSY.has(t.format?.toUpperCase() ?? '') || (t.bitrate ?? 0) > 0) return 'lossy';
  return 'unknown';
};

export const formatSpec = (t: Track): string => {
  if (qualityTier(t) === 'lossy') {
    return t.format && (t.bitrate ?? 0) > 0
      ? `${t.format.toUpperCase()} ${Math.round(t.bitrate!)}`
      : '';
  }
  if (!(t.bitDepth && t.bitDepth > 0 && t.sampleRate && t.sampleRate > 0)) return '';
  const khz = t.sampleRate / 1000;
  return `${t.bitDepth}/${Number.isInteger(khz) ? khz : khz.toFixed(1)}`;
};

export const fidelity = (t: Track): { rate: number; depth: number; integrity: number; tier: QualityTier } => {
  const tier = qualityTier(t);
  const bits = t.bitDepth ?? 0;
  // Los tramos 0–16, 16–24 y 24–32 tienen la misma pendiente.
  const depth = clampUnit(bits / 32);
  const rate = t.sampleRate && t.sampleRate > 0
    ? clampUnit(Math.log(t.sampleRate / 44100) / Math.log(192000 / 44100))
    : 0;
  const integrity = tier === 'hires' || tier === 'lossless'
    ? 1
    : tier === 'lossy' ? clampUnit((t.bitrate ?? 0) / 320) : 0;
  return { rate, depth, integrity, tier };
};
