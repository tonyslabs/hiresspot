import { describe, expect, it } from 'vitest';
import { ambientFor, contrastRatio, extractPalette, fallbackPalette, hslToCss, type Palette } from './palette';

type Rgba = [number, number, number, number];
const red: Rgba = [255, 0, 0, 255];
const blue: Rgba = [0, 0, 255, 255];
const image = (...colors: Rgba[]): Uint8ClampedArray => new Uint8ClampedArray(colors.flat());
const dark = { h: 240, s: 1.7241379310344827, l: 22.745098039215687 };
const light = { h: 240, s: 1.7241379310344827, l: 77.25490196078432 };

function valid(p: Palette): void {
  expect(p.swatches.length).toBeGreaterThanOrEqual(3);
  expect(p.swatches.length).toBeLessThanOrEqual(5);
  for (const c of [...p.swatches, ...p.ambient, p.accent.dark, p.accent.light]) {
    expect(c.h).toBeGreaterThanOrEqual(0);
    expect(c.h).toBeLessThanOrEqual(360);
    expect(c.s).toBeGreaterThanOrEqual(0);
    expect(c.s).toBeLessThanOrEqual(100);
    expect(c.l).toBeGreaterThanOrEqual(0);
    expect(c.l).toBeLessThanOrEqual(100);
  }
  for (const theme of ['dark', 'light'] as const) {
    expect(contrastRatio(p.accent[theme], theme === 'dark' ? dark : light)).toBeGreaterThanOrEqual(4.5);
    expect(p.accent[theme].s).toBeGreaterThanOrEqual(45);
    expect(p.accent[theme].s).toBeLessThanOrEqual(90);
    const ambient = ambientFor(p, theme);
    expect(ambient).toHaveLength(3);
    for (const c of ambient) {
      expect(c.s).toBeLessThanOrEqual(theme === 'dark' ? 70 : 60);
      expect(c.l).toBeGreaterThanOrEqual(theme === 'dark' ? 14 : 78);
      expect(c.l).toBeLessThanOrEqual(theme === 'dark' ? 32 : 90);
    }
  }
  expect(ambientFor(p, 'dark')).toEqual(p.ambient);
}

describe('paletas', () => {
  it('conserva el color plano y rellena con rotaciones de ±25°', () => {
    const p = extractPalette(image(red, red), 2, 1);
    expect(p.swatches).toEqual([{ h: 0, s: 100, l: 50 }, { h: 25, s: 100, l: 50 }, { h: 335, s: 100, l: 50 }]);
    expect(p.monochrome).toBe(false);
    valid(p);
  });

  it('ordena una imagen bicolor 70/30 por población y saturación', () => {
    const p = extractPalette(image(...Array<Rgba>(70).fill(red), ...Array<Rgba>(30).fill(blue)), 10, 10);
    expect(p.swatches.slice(0, 2).map(c => c.h)).toEqual([0, 240]);
    valid(p);
  });

  it('conserva blanco y negro dominantes y usa oro de marca', () => {
    const p = extractPalette(image([0, 0, 0, 255], [255, 255, 255, 255]), 2, 1);
    expect(p.monochrome).toBe(true);
    expect(p.swatches.slice(0, 2).map(c => c.l)).toEqual([0, 100]);
    expect(p.accent.dark).toMatchObject({ h: 40, s: 90 });
    expect(p.accent.light).toMatchObject({ h: 36, s: 85 });
    valid(p);
  });

  it('descarta extremos hasta el umbral estricto del 85%', () => {
    const pixels = (n: number) => image(...Array<Rgba>(n).fill([255, 255, 255, 255]), ...Array<Rgba>(100 - n).fill(red));
    expect(extractPalette(pixels(85), 10, 10).monochrome).toBe(false);
    expect(extractPalette(pixels(85), 10, 10).swatches.every(c => c.l === 50)).toBe(true);
    expect(extractPalette(pixels(86), 10, 10).monochrome).toBe(true);
  });

  it('usa respaldo para vacío, transparente y 1×1', () => {
    for (const [pixels, w, h] of [[image(), 0, 0], [image([10, 20, 30, 0], [0, 0, 0, 124]), 2, 1], [image(red), 1, 1]] as const) {
      expect(extractPalette(pixels, w, h)).toEqual(fallbackPalette(''));
      valid(extractPalette(pixels, w, h));
    }
  });

  it('acepta alpha 125 e ignora los píxeles fuera de las dimensiones', () => {
    expect(extractPalette(image([255, 0, 0, 125], red, blue), 2, 1)).toEqual(extractPalette(image(red, red), 2, 1));
  });

  it('fusiona tonos próximos atravesando 0° y suma sus poblaciones', () => {
    const p = extractPalette(image([255, 0, 16, 255], [255, 16, 0, 255], blue), 3, 1);
    expect(Math.min(p.swatches[0].h, 360 - p.swatches[0].h)).toBeLessThan(1);
    expect(p.swatches[1].h).toBe(240);
  });

  it('elige el más saturado con población mínima del 3%', () => {
    const p = extractPalette(image(...Array<Rgba>(96).fill([160, 100, 100, 255]), ...Array<Rgba>(3).fill(blue), [0, 255, 0, 255]), 10, 10);
    expect(p.accent.dark.h).toBe(240);
    expect(p.accent.light.h).toBe(240);
  });

  it('es determinista, no muta la entrada y mantiene el respaldo estable', () => {
    const pixels = image(red, blue, [180, 60, 80, 255]);
    const before = pixels.slice();
    expect(extractPalette(pixels, 3, 1)).toEqual(extractPalette(pixels, 3, 1));
    expect(pixels).toEqual(before);
    expect(fallbackPalette('álbum')).toEqual(fallbackPalette('álbum'));
    expect(fallbackPalette('a').swatches[0].h).not.toBe(fallbackPalette('b').swatches[0].h);
    expect(fallbackPalette('a').ambient.map(c => c.l)).toEqual([30, 24, 18]);
    expect(fallbackPalette('a').ambient.every(c => c.s === 45)).toBe(true);
    const p = fallbackPalette('a');
    const copy = structuredClone(p);
    ambientFor(p, 'light');
    expect(p).toEqual(copy);
    valid(p);
  });

  it('pondera saturación además de población y limita a cinco muestras', () => {
    const p = extractPalette(image(...Array<Rgba>(6).fill([128, 128, 128, 255]), ...Array<Rgba>(4).fill(blue)), 10, 1);
    expect(p.swatches[0].h).toBe(240);
    const many = extractPalette(image(red, blue, [255, 255, 0, 255], [0, 255, 0, 255], [255, 0, 255, 255], [0, 255, 255, 255]), 6, 1);
    expect(many.swatches).toHaveLength(5);
  });

  it('no fusiona el mismo tono cuando difiere más de 12 puntos de luminosidad', () => {
    const p = extractPalette(image(red, [128, 0, 0, 255]), 2, 1);
    expect(p.swatches[1]).toEqual({ h: 0, s: 100, l: 50 });
    expect(p.swatches[0].h).toBe(0);
    expect(p.swatches[0].l).toBeCloseTo(25.098, 3);
  });

  it('garantiza contraste en 200 imágenes con PRNG de semilla fija', () => {
    let seed = 0x12345678;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    };
    for (let n = 0; n < 200; n++) {
      const pixels = new Uint8ClampedArray(32 * 32 * 4);
      for (let i = 0; i < pixels.length; i++) pixels[i] = next();
      valid(extractPalette(pixels, 32, 32));
    }
  });
});

describe('conversiones', () => {
  it('calcula WCAG: blanco/negro 21, identidad 1 y simetría', () => {
    expect(contrastRatio({ h: 0, s: 0, l: 0 }, { h: 0, s: 0, l: 100 })).toBeCloseTo(21, 10);
    expect(contrastRatio(dark, dark)).toBe(1);
    expect(contrastRatio(dark, light)).toBeCloseTo(contrastRatio(light, dark), 12);
    expect(contrastRatio({ h: 0, s: 100, l: 50 }, { h: 0, s: 0, l: 0 })).toBeCloseTo(5.252, 3);
  });
  it('formatea CSS sin comas', () => {
    expect(hslToCss({ h: 12, s: 70, l: 60 })).toBe('hsl(12 70% 60%)');
  });
});
