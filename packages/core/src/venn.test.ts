import { describe, expect, it } from 'vitest';
import { areaLens, vennLayout } from './venn';

describe('vennLayout', () => {
  it('mantiene áreas proporcionales y círculos disjuntos tangentes', () => {
    const { rA, rB, d } = vennLayout(100, 40, 0);
    expect(Math.PI * rA ** 2).toBeCloseTo(100);
    expect(Math.PI * rB ** 2).toBeCloseTo(40);
    expect(d).toBe(rA + rB);
    expect(areaLens(rA, rB, d)).toBe(0);
  });
  it('representa contención completa', () => {
    const { rA, rB, d } = vennLayout(100, 40, 40);
    expect(d).toBe(Math.abs(rA - rB));
    expect(areaLens(rA, rB, d)).toBeCloseTo(40);
  });
  it('superpone círculos iguales por completo', () => {
    const { rA, rB, d } = vennLayout(60, 60, 60);
    expect(rA).toBe(rB);
    expect(d).toBe(0);
    expect(areaLens(rA, rB, d)).toBeCloseTo(60);
  });
  it.each([[100, 60, 25], [60, 100, 25], [100, 100, 50], [10, 200, 1]])(
    'resuelve la intersección de %i y %i con área %i', (a, b, both) => {
      const { rA, rB, d } = vennLayout(a, b, both);
      expect(Math.abs(areaLens(rA, rB, d) - both) / both).toBeLessThan(0.005);
    },
  );
  it('clampea la intersección a sus límites', () => {
    expect(vennLayout(100, 40, 200)).toEqual(vennLayout(100, 40, 40));
    expect(vennLayout(100, 40, -10)).toEqual(vennLayout(100, 40, 0));
  });
  it.each([[0, 0, 0], [0, 20, 5], [20, 0, 5]])('maneja ceros sin NaN', (a, b, both) => {
    const { rA, rB, d } = vennLayout(a, b, both);
    expect([rA, rB, d].every(Number.isFinite)).toBe(true);
    expect(rA).toBe(Math.sqrt(a / Math.PI));
    expect(rB).toBe(Math.sqrt(b / Math.PI));
    expect(areaLens(rA, rB, d)).toBe(0);
  });
});

describe('areaLens', () => {
  it('calcula una lente de área conocida', () => {
    expect(areaLens(1, 1, 1)).toBeCloseTo(2 * Math.PI / 3 - Math.sqrt(3) / 2);
  });
  it('contempla separación, contención y radios nulos', () => {
    expect(areaLens(1, 2, 4)).toBe(0);
    expect(areaLens(1, 2, 0)).toBe(Math.PI);
    expect(areaLens(0, 0, 0)).toBe(0);
    expect(areaLens(0, 2, 0)).toBe(0);
  });
});
