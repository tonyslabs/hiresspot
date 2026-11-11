import { useEffect, type RefObject } from 'react';
import { buildLensMap } from '@hiresspot/core';

// ---------------------------------------------------------------------------
// Refracción "Liquid Glass": CSS no tiene lentes, así que se usa un filtro SVG con
// feDisplacementMap dentro de `backdrop-filter` (solo Chromium; Electron lo es).
// El mapa de desplazamiento se genera con un bisel de rectángulo redondeado del tamaño
// exacto del elemento (ver core/lensMap.ts) y se sirve como `data:` URL a feImage.
// Si algo falla, el vidrio degrada a blur normal (la variable --lens queda vacía).
// ---------------------------------------------------------------------------

export const LENS_IDS = ['lens-dock', 'lens-play'] as const;
export type LensId = (typeof LENS_IDS)[number];

/** Una sola vez en el shell: define los filtros que luego rellena `useLensFilter`. */
export const GlassDefs = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
    {LENS_IDS.map((id) => (
      <filter key={id} id={id} x="0" y="0" width="100%" height="100%" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage result="map" x="0" y="0" width="1" height="1" preserveAspectRatio="none" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    ))}
  </svg>
);

const mapToDataUrl = (w: number, h: number, radius: number, bezel: number): string | null => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const data = buildLensMap(w, h, radius, bezel);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return canvas.toDataURL('image/png');
};

interface LensOptions {
  id: LensId;
  /** Radio de esquina del elemento (999 → cápsula). */
  radius: number;
  bezel: number;
  scale: number;
}

/** Ajusta el filtro `id` al tamaño real del elemento y activa `--lens` en él. */
export const useLensFilter = (ref: RefObject<HTMLElement | null>, { id, radius, bezel, scale }: LensOptions): void => {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      const filter = document.getElementById(id);
      if (!filter || w < 4 || h < 4) return;
      const url = mapToDataUrl(w, h, Math.min(radius, Math.min(w, h) / 2), bezel);
      if (!url) return;
      const img = filter.querySelector('feImage');
      const disp = filter.querySelector('feDisplacementMap');
      if (!img || !disp) return;
      img.setAttribute('href', url);
      img.setAttribute('width', String(w));
      img.setAttribute('height', String(h));
      disp.setAttribute('scale', String(scale));
      el.style.setProperty('--lens', `url(#${id})`);
      el.style.setProperty('--lens-blur', '3px');
    };

    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(apply, 150);
    });
    observer.observe(el);
    apply();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      el.style.removeProperty('--lens');
      el.style.removeProperty('--lens-blur');
    };
  }, [ref, id, radius, bezel, scale]);
};
