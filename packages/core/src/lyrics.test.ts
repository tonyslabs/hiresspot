import { describe, expect, it } from 'vitest';
import { activeLineIndex, parseLrc } from './lyrics';

describe('parseLrc', () => {
  it('expande varias marcas, ordena e ignora metadatos', () => {
    expect(parseLrc('[ar:Autor]\n[ti:Título]\n[00:20.25][00:01.5] Dos veces\n[00:03.125] Otra')).toEqual({
      synced: true,
      lines: [
        { timeMs: 1500, text: 'Dos veces' },
        { timeMs: 3125, text: 'Otra' },
        { timeMs: 20250, text: 'Dos veces' }
      ]
    });
  });

  it.each([['+250', 1250], ['-1500', -500]])('aplica offset %s aunque aparezca al final', (offset, timeMs) => {
    expect(parseLrc(`[00:01.00] Inicio\n[offset:${offset}]`).lines).toEqual([{ timeMs, text: 'Inicio' }]);
  });

  it('conserva líneas sin marca con tiempo null', () => {
    expect(parseLrc('Texto libre\n[00:02] Sincronizada\nOtro texto\n')).toEqual({
      synced: true,
      lines: [{ timeMs: 2000, text: 'Sincronizada' }, { timeMs: null, text: 'Texto libre' }, { timeMs: null, text: 'Otro texto' }]
    });
    expect(parseLrc('Primera\r\nSegunda')).toEqual({
      synced: false, lines: [{ timeMs: null, text: 'Primera' }, { timeMs: null, text: 'Segunda' }]
    });
    expect(parseLrc('[ar:Autor]\n')).toEqual({ synced: false, lines: [] });
  });
});

describe('activeLineIndex', () => {
  const lines = parseLrc('[00:01] Una\n[00:03] Dos\n[00:03] Tres\n[00:05] Cuatro\nSin marca').lines;
  it.each([[0, -1], [1000, 0], [2000, 0], [3000, 2], [4500, 2], [9000, 3]])(
    'en %i ms devuelve %i', (position, index) => {
      expect(activeLineIndex(lines, position)).toBe(index);
    }
  );
  it('devuelve -1 si no hay sincronía o líneas', () => {
    expect(activeLineIndex(parseLrc('Texto libre').lines, 10000)).toBe(-1);
    expect(activeLineIndex([], 10000)).toBe(-1);
  });
});
