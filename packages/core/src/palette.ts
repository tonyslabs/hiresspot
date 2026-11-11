export interface Hsl { h: number; s: number; l: number }
export interface Palette {
  swatches: Hsl[];
  ambient: [Hsl, Hsl, Hsl];
  accent: { dark: Hsl; light: Hsl };
  monochrome: boolean;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
const hue = (h: number): number => ((h % 360) + 360) % 360;

function rgbToHsl(red: number, green: number, blue: number): Hsl {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min, l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };
  const sector = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: hue(sector * 60), s: delta / (1 - Math.abs(2 * l - 1)) * 100, l: l * 100 };
}

function luminance(c: Hsl): number {
  const s = c.s / 100, l = c.l / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const h = hue(c.h) / 60;
  const x = chroma * (1 - Math.abs(h % 2 - 1));
  const m = l - chroma / 2;
  const rgb = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x]
    : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const linear = rgb.map(v => {
    const channel = v + m;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(a: Hsl, b: Hsl): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hexToHsl(hex: string): Hsl {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgbToHsl(value >>> 16, (value >>> 8) & 255, value & 255);
}
const backgrounds = { dark: hexToHsl('#39393b'), light: hexToHsl('#c4c4c6') };

function accessible(c: Hsl, theme: 'dark' | 'light'): Hsl {
  const result = { ...c, s: clamp(c.s, 45, 90) };
  // Aclarar en oscuro y oscurecer en claro garantiza alcanzar el contraste.
  while (contrastRatio(result, backgrounds[theme]) < 4.5) {
    result.l = clamp(result.l + (theme === 'dark' ? 2 : -2), 0, 100);
  }
  return result;
}

function accents(c: Hsl, monochrome: boolean): Palette['accent'] {
  return {
    dark: accessible(monochrome ? { h: 40, s: 90, l: 58 } : c, 'dark'),
    light: accessible(monochrome ? { h: 36, s: 85, l: 30 } : c, 'light'),
  };
}

function ambientColors(swatches: Hsl[], theme: 'dark' | 'light'): [Hsl, Hsl, Hsl] {
  const convert = (c: Hsl): Hsl => ({ ...c,
    s: Math.min(c.s, theme === 'dark' ? 70 : 60),
    l: clamp(c.l, theme === 'dark' ? 14 : 78, theme === 'dark' ? 32 : 90),
  });
  return [convert(swatches[0]), convert(swatches[1]), convert(swatches[2])];
}

export function ambientFor(p: Palette, theme: 'dark' | 'light'): [Hsl, Hsl, Hsl] {
  return theme === 'dark' ? p.ambient.map(c => ({ ...c })) as [Hsl, Hsl, Hsl]
    : ambientColors(p.swatches, 'light');
}

export function fallbackPalette(seed: string): Palette {
  // FNV-1a sobre unidades UTF-16: estable también para cadenas vacías.
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  const h = hash % 360;
  const swatches = [30, 24, 18].map(l => ({ h, s: 45, l }));
  return { swatches, ambient: ambientColors(swatches, 'dark'), accent: accents(swatches[0], false), monochrome: false };
}

interface Bucket { count: number; r: number; g: number; b: number }
interface Cluster extends Bucket { color: Hsl; key: number }
const colorOf = (b: Bucket): Hsl => rgbToHsl(b.r / b.count, b.g / b.count, b.b / b.count);
const score = (c: Cluster): number => c.count * (0.3 + c.color.s / 100);
const ranked = (a: Cluster, b: Cluster): number => score(b) - score(a) || a.key - b.key;

/** Vacío, transparente, dimensiones inválidas o 1×1 usan fallbackPalette('').
 * Se ignoran bytes incompletos y píxeles fuera de las dimensiones indicadas.
 */
export function extractPalette(pixels: Uint8ClampedArray, width: number, height: number): Palette {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height === 1) {
    return fallbackPalette('');
  }
  const buckets = new Map<number, Bucket>();
  let useful = 0, extremes = 0;
  const length = Math.min(pixels.length - pixels.length % 4, width * height * 4);
  for (let i = 0; i < length; i += 4) {
    if (pixels[i + 3] < 125) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    useful++;
    const l = rgbToHsl(r, g, b).l;
    if (l > 95 || l < 6) extremes++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  if (useful === 0) return fallbackPalette('');
  const monochrome = extremes / useful > 0.85;
  const candidates: Cluster[] = [...buckets].map(([key, b]) => ({ ...b, key, color: colorOf(b) }))
    .filter(c => monochrome || (c.color.l >= 6 && c.color.l <= 95)).sort(ranked);
  const clusters: Cluster[] = [];
  for (const c of candidates) {
    const match = clusters.find(other => {
      const distance = Math.abs(c.color.h - other.color.h);
      return Math.min(distance, 360 - distance) < 18 && Math.abs(c.color.l - other.color.l) < 12;
    });
    if (match) {
      // Promediar RGB evita errores circulares al fusionar tonos cercanos a 0°.
      match.count += c.count;
      match.r += c.r; match.g += c.g; match.b += c.b;
      match.color = colorOf(match);
    } else clusters.push({ ...c });
  }
  clusters.sort(ranked);
  if (clusters.length === 0) return fallbackPalette('');
  const swatches = clusters.slice(0, 5).map(c => ({ ...c.color }));
  const dominant = swatches[0];
  for (const rotation of [25, -25]) {
    if (swatches.length >= 3) break;
    swatches.push({ ...dominant, h: hue(dominant.h + rotation) });
  }
  // Si ningún grupo alcanza el 3%, se usa el dominante como respaldo.
  const eligible = clusters.filter(c => c.count / useful >= 0.03)
    .sort((a, b) => b.color.s - a.color.s || ranked(a, b));
  const accent = (eligible[0] ?? clusters[0]).color;
  return { swatches, ambient: ambientColors(swatches, 'dark'), accent: accents(accent, monochrome), monochrome };
}

export function hslToCss(c: Hsl): string {
  return `hsl(${c.h} ${c.s}% ${c.l}%)`;
}
