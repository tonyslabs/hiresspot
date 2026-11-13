import { describe, expect, it } from 'vitest';
import { buildFlacLayout, parseRange, planFlacSlice, type RangeReader } from './flac';

const block = (type: number, body: number[], last = false) => [(last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];

const file = (blocks: number[][], audio: number[]) => new Uint8Array([0x66, 0x4c, 0x61, 0x43, ...blocks.flat(), ...audio]);
const readerOf = (bytes: Uint8Array): RangeReader => async (s, e) => bytes.slice(s, e + 1);

const STREAMINFO = block(0, Array(34).fill(7));
const COMMENT = block(4, [1, 2, 3, 4, 5]);
const PICTURE = block(6, Array(1000).fill(9));
const AUDIO = [0xff, 0xf8, 1, 2, 3, 4, 5, 6, 7, 8];

describe('buildFlacLayout', () => {
  it('quita el PICTURE y deja el audio intacto', async () => {
    const bytes = file([STREAMINFO, PICTURE, block(4, [1, 2, 3, 4, 5], true)], AUDIO);
    const layout = (await buildFlacLayout(readerOf(bytes)))!;
    expect(layout.removed).toBe(PICTURE.length);
    expect(layout.audioStart).toBe(bytes.length - AUDIO.length);
    // cabecera = magic + streaminfo + comentario (último)
    expect(layout.header.length).toBe(4 + STREAMINFO.length + COMMENT.length);
    expect(layout.header[4] & 0x80).toBe(0); // streaminfo ya no es el último
    expect(layout.header[4 + STREAMINFO.length] & 0x80).toBe(0x80); // el comentario sí
  });

  it('si el PICTURE era el último bloque, marca el anterior como último', async () => {
    const bytes = file([STREAMINFO, COMMENT, block(6, [9, 9, 9], true)], AUDIO);
    const layout = (await buildFlacLayout(readerOf(bytes)))!;
    expect(layout.header.length).toBe(4 + STREAMINFO.length + COMMENT.length);
    expect(layout.header[4 + STREAMINFO.length] & 0x80).toBe(0x80);
  });

  it('un archivo sin PICTURE queda igual', async () => {
    const bytes = file([STREAMINFO, block(4, [1, 2, 3, 4, 5], true)], AUDIO);
    const layout = (await buildFlacLayout(readerOf(bytes)))!;
    expect(layout.removed).toBe(0);
    expect(Array.from(layout.header)).toEqual(Array.from(bytes.slice(0, layout.audioStart)));
  });

  it('no inventa nada si no es FLAC o está truncado', async () => {
    expect(await buildFlacLayout(readerOf(new Uint8Array([1, 2, 3, 4, 5, 6])))).toBeNull();
    expect(await buildFlacLayout(readerOf(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0])))).toBeNull();
    expect(await buildFlacLayout(readerOf(file([STREAMINFO], [])))).toBeNull(); // sin bloque "último"
  });
});

describe('parseRange', () => {
  it('interpreta los formatos habituales', () => {
    expect(parseRange(null, 100)).toBe('full');
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=10-999', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('chunks=1-2', 100)).toBe('invalid');
  });
});

describe('planFlacSlice', () => {
  const layout = { header: new Uint8Array(50), audioStart: 1050, removed: 1000 };
  it('rango solo en la cabecera', () => {
    expect(planFlacSlice(layout, { start: 0, end: 9 })).toEqual({ headerStart: 0, headerEnd: 10, upstream: null });
  });
  it('rango a caballo entre cabecera y audio', () => {
    expect(planFlacSlice(layout, { start: 40, end: 59 })).toEqual({ headerStart: 40, headerEnd: 50, upstream: { start: 1050, end: 1059 } });
  });
  it('rango solo en el audio (seek)', () => {
    expect(planFlacSlice(layout, { start: 150, end: 249 })).toEqual({ headerStart: 50, headerEnd: 50, upstream: { start: 1150, end: 1249 } });
  });
});
