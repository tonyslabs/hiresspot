import { describe, expect, it } from 'vitest';
import { buildLensMap } from './lensMap';

function pixel(map: Uint8ClampedArray, w: number, x: number, y: number): number[] {
  const offset = (y * w + x) * 4;
  return Array.from(map.slice(offset, offset + 4));
}

describe('buildLensMap', () => {
  it('devuelve RGBA con longitud correcta y centro neutro', () => {
    const map = buildLensMap(21, 15, 4, 3);
    expect(map).toBeInstanceOf(Uint8ClampedArray);
    expect(map).toHaveLength(21 * 15 * 4);
    expect(pixel(map, 21, 10, 7)).toEqual([128, 128, 128, 255]);
    for (let i = 0; i < map.length; i += 4) {
      expect(map[i + 2]).toBe(128);
      expect(map[i + 3]).toBe(255);
    }
  });

  it('respeta la simetría horizontal y vertical', () => {
    const w = 24;
    const h = 18;
    const map = buildLensMap(w, h, 6, 5);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const horizontal = (y * w + w - 1 - x) * 4;
        const vertical = ((h - 1 - y) * w + x) * 4;
        expect(Math.abs(map[i] + map[horizontal] - 256)).toBeLessThanOrEqual(1);
        expect(Math.abs(map[i + 1] + map[vertical + 1] - 256)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('apunta hacia dentro en los cuatro bordes con la caída cúbica indicada', () => {
    const map = buildLensMap(21, 21, 4, 4);
    const shift = Math.round(127 * (1 - 0.5 / 4) ** 3);
    expect(pixel(map, 21, 0, 10)).toEqual([128 + shift, 128, 128, 255]);
    expect(pixel(map, 21, 20, 10)).toEqual([128 - shift, 128, 128, 255]);
    expect(pixel(map, 21, 10, 0)).toEqual([128, 128 + shift, 128, 255]);
    expect(pixel(map, 21, 10, 20)).toEqual([128, 128 - shift, 128, 255]);
  });

  it('usa normales diagonales en las esquinas y distancia cero fuera', () => {
    const map = buildLensMap(20, 20, 6, 4);
    const shift = Math.round(127 / Math.SQRT2);
    expect(pixel(map, 20, 0, 0)).toEqual([128 + shift, 128 + shift, 128, 255]);
    expect(pixel(map, 20, 19, 0)).toEqual([128 - shift, 128 + shift, 128, 255]);
    expect(pixel(map, 20, 0, 19)).toEqual([128 + shift, 128 - shift, 128, 255]);
    expect(pixel(map, 20, 19, 19)).toEqual([128 - shift, 128 - shift, 128, 255]);
    const insideShift = Math.round(127 / Math.SQRT2 * (1 - (6 - Math.hypot(2.5, 2.5)) / 4) ** 3);
    expect(pixel(map, 20, 3, 3)).toEqual([128 + insideShift, 128 + insideShift, 128, 255]);
  });

  it('limita el radio y produce resultados deterministas', () => {
    expect(buildLensMap(16, 10, 100, 3)).toEqual(buildLensMap(16, 10, 5, 3));
    expect(buildLensMap(16, 10, 3, 3)).toEqual(buildLensMap(16, 10, 3, 3));
  });

  it('deja neutras las normales indefinidas incluso con un bisel grande', () => {
    const map = buildLensMap(11, 11, 0, 20);
    expect(pixel(map, 11, 5, 5)).toEqual([128, 128, 128, 255]);
    expect(pixel(map, 11, 2, 2)).toEqual([128, 128, 128, 255]);
  });

  it.each([0, -3])('devuelve un mapa neutro cuando bezel=%s', (bezel) => {
    const map = buildLensMap(8, 6, 2, bezel);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 8; x++) {
        expect(pixel(map, 8, x, y)).toEqual([128, 128, 128, 255]);
      }
    }
  });

  it.each([[0, 5], [5, 0], [-1, 5], [5, -1]])('devuelve vacío con dimensiones %s × %s', (w, h) => {
    expect(buildLensMap(w, h, 2, 3)).toHaveLength(0);
  });
});
