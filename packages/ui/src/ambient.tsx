import { useEffect, useRef, useState } from 'react';
import { ambientFor, extractPalette, fallbackPalette, hslToCss, type Hsl, type Palette, type Track } from '@hiresspot/core';
import { usePlatform } from './platform';
import { usePlayerState } from './player';

// ---------------------------------------------------------------------------
// Fondo ambiental: la carátula de la pista actual tiñe toda la app ("fuente de luz").
//  - Capa 1: malla de 3 radiales con los colores de la paleta (fundido por @property).
//  - Capa 2: la propia carátula, difuminada y con poca opacidad (no necesita leer píxeles).
//  - Capa 3: scrim + grano para garantizar el contraste del texto.
// La paleta se calcula una vez por álbum (LRU en memoria; nunca a disco).
// ---------------------------------------------------------------------------

const cache = new Map<string, Palette>();
const CACHE_MAX = 200;

const keyOf = (t: Track): string => t.coverId ?? `${t.album}|${t.albumArtist ?? t.artist}`;

const remember = (key: string, p: Palette): Palette => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, p);
  return p;
};

/** Lee 32x32 píxeles de la carátula con un canvas; lanza si el canvas queda "tainted" (sin CORS). */
const pixelsViaCanvas = (url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('sin canvas'));
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve({ data: ctx.getImageData(0, 0, 32, 32).data, width: 32, height: 32 });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('no se pudo cargar la carátula'));
    img.src = url;
  });

export const loadPalette = async (
  track: Track,
  coverPixels?: (url: string) => Promise<{ data: Uint8ClampedArray; width: number; height: number } | null>
): Promise<Palette> => {
  const key = keyOf(track);
  const hit = cache.get(key);
  if (hit) return hit;
  const url = track.coverUrl;
  if (url) {
    try {
      const px = await pixelsViaCanvas(url);
      return remember(key, extractPalette(px.data, px.width, px.height));
    } catch {
      // Sin CORS (Navidrome): el proceso main descarga y reduce la imagen
      try {
        const px = await coverPixels?.(url);
        if (px) return remember(key, extractPalette(px.data, px.width, px.height));
      } catch {
        /* cae a la paleta por hash */
      }
    }
  }
  return remember(key, fallbackPalette(key));
};

const lum = (c: Hsl) => c.l;
/** Texto sobre el tinte: negro o blanco según su luminosidad. */
const inkFor = (c: Hsl) => (lum(c) > 52 ? '#14110a' : '#ffffff');

const applyPalette = (p: Palette | null) => {
  const root = document.documentElement.style;
  const names = ['--amb-d1', '--amb-d2', '--amb-d3', '--amb-l1', '--amb-l2', '--amb-l3', '--tint-d', '--tint-l', '--tint-fg-d', '--tint-fg-l'];
  if (!p) {
    names.forEach((n) => root.removeProperty(n));
    return;
  }
  const dark = ambientFor(p, 'dark');
  const light = ambientFor(p, 'light');
  dark.forEach((c, i) => root.setProperty(`--amb-d${i + 1}`, hslToCss(c)));
  light.forEach((c, i) => root.setProperty(`--amb-l${i + 1}`, hslToCss(c)));
  root.setProperty('--tint-d', hslToCss(p.accent.dark));
  root.setProperty('--tint-l', hslToCss(p.accent.light));
  root.setProperty('--tint-fg-d', inkFor(p.accent.dark));
  root.setProperty('--tint-fg-l', inkFor(p.accent.light));
};

/** Lienzo ambiental a sangre. Hijo directo del shell. */
export const Ambient = () => {
  const platform = usePlatform();
  const { current } = usePlayerState();
  const [layers, setLayers] = useState<{ key: string; url: string }[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    if (!current) {
      applyPalette(null);
      setLayers([]);
      return;
    }
    const key = keyOf(current);
    if (current.coverUrl) setLayers((prev) => (prev[prev.length - 1]?.key === key ? prev : [...prev.slice(-1), { key, url: current.coverUrl as string }]));
    else setLayers([]);

    const run = () =>
      loadPalette(current, platform.media.coverPixels).then((p) => {
        if (id === seq.current) applyPalette(p);
      });
    // Fuera del frame del cambio de pista
    if (typeof requestIdleCallback === 'function') {
      const h = requestIdleCallback(() => void run(), { timeout: 400 });
      return () => cancelIdleCallback(h);
    }
    const t = setTimeout(() => void run(), 30);
    return () => clearTimeout(t);
  }, [current, platform]);

  // Desmonta la capa anterior cuando termina el fundido
  useEffect(() => {
    if (layers.length < 2) return;
    const t = setTimeout(() => setLayers((prev) => prev.slice(-1)), 1000);
    return () => clearTimeout(t);
  }, [layers]);

  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-mesh" />
      {layers.map((l, i) => (
        <img key={l.key} src={l.url} alt="" className="ambient-art" data-on={i === layers.length - 1} />
      ))}
      <div className="ambient-scrim" />
      <div className="ambient-grain" />
    </div>
  );
};
