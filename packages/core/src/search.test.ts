import { describe, expect, it } from 'vitest';
import { buildSearchIndex, search } from './search';
import type { SourceKind, Track } from './types';

const track = (id: string, source: SourceKind = 'local', over: Partial<Track> = {}): Track => ({
  id: `${source}:${id}`, sourceId: id, source, title: 'Canción', artist: 'Ana', album: 'Disco', ...over,
});
const indexOf = (...tracks: Track[]) => buildSearchIndex(
  (['spotify', 'local', 'navidrome'] as const).map((id) => ({ id, tracks: tracks.filter((t) => t.source === id) })),
);

describe('search', () => {
  it('colapsa ISRC normalizado y conserva todas las copias', () => {
    const a = track('a', 'spotify', { isrc: 'us-aa 123', title: 'Canción original' });
    const b = track('b', 'local', { isrc: 'USAA123', title: 'Canción alternativa' });
    const hits = search(indexOf(a, b), 'original').tracks;
    expect(hits).toHaveLength(1);
    expect(hits[0].track).toBe(b);
    expect(hits[0].tracks).toEqual(expect.arrayContaining([a, b]));
    expect(hits[0].sources).toEqual(expect.arrayContaining(['spotify', 'local']));
  });

  it('colapsa metadatos con artista principal y hasta tres segundos de diferencia', () => {
    const a = track('a', 'spotify', { duration: 100, artist: 'Ána feat. Beto' });
    const b = track('b', 'local', { duration: 103, title: 'Canción (Remastered)' });
    expect(search(indexOf(a, b), 'cancion').tracks).toHaveLength(1);
    expect(search(indexOf(a, track('c', 'local')), 'cancion').tracks).toHaveLength(1);
  });

  it('mantiene separadas versiones en vivo y duraciones distintas', () => {
    const tracks = [track('a', 'spotify', { duration: 100 }),
      track('b', 'local', { duration: 104 }),
      track('c', 'navidrome', { duration: 100, title: 'Canción (Live)' })];
    expect(search(indexOf(...tracks), 'cancion').tracks).toHaveLength(3);
  });

  it('prefiere navidrome, después local y después spotify', () => {
    const a = track('a', 'spotify');
    const b = track('b', 'local');
    const c = track('c', 'navidrome');
    expect(search(indexOf(a, b, c), 'cancion').tracks[0].track).toBe(c);
    expect(search(indexOf(a, b), 'cancion').tracks[0].track).toBe(b);
  });

  it('devuelve vacío para consultas vacías o solo símbolos', () => {
    for (const query of ['', '  ', '!?']) {
      expect(search(indexOf(track('a')), query)).toEqual({ tracks: [], albums: [], artists: [] });
    }
  });

  it('exige todos los tokens normalizados como subcadenas', () => {
    const index = indexOf(track('a'));
    expect(search(index, 'CIÓN an DIS').tracks).toHaveLength(1);
    expect(search(index, 'cancion beto').tracks).toHaveLength(0);
  });

  it('ordena título exacto, prefijo y resto alfabético', () => {
    const tracks = ['Z canción', 'Canción azul', 'Canción', 'A canción'].map((title) => track(title, 'local', { title }));
    expect(search(indexOf(...tracks), 'cancion').tracks.map((h) => h.track.title))
      .toEqual(['Canción', 'Canción azul', 'A canción', 'Z canción']);
  });

  it('ordena alfabéticamente por el representante de cada canción', () => {
    const index = indexOf(
      track('a', 'spotify', { title: 'A tema', isrc: 'UNO' }),
      track('b', 'navidrome', { title: 'Z tema', isrc: 'UNO' }),
      track('c', 'local', { title: 'M tema' }),
    );
    expect(search(index, 'tema').tracks.map((hit) => hit.track.title)).toEqual(['M tema', 'Z tema']);
  });

  it('agrupa coincidencias por álbum y artista como library, conservando fuentes y portada', () => {
    const a = track('a', 'spotify', { album: 'Ágape', artist: 'Invitado', albumArtist: 'Banda', coverUrl: 'cover' });
    const b = track('b', 'local', { album: 'agape', artist: 'Invitado', albumArtist: 'Banda', title: 'Otra' });
    const index = indexOf(a, b);
    const result = search(index, 'agape');
    expect(result.albums[0]).toMatchObject({ key: 'agape__banda', trackCount: 2, coverUrl: 'cover' });
    expect(result.albums[0].tracks).toHaveLength(2);
    expect(result.artists[0]).toMatchObject({ key: 'banda', trackCount: 2 });
    expect(result.albums[0].sources).toEqual(expect.arrayContaining(['local', 'spotify']));
    expect(search(index, 'banda').artists).toHaveLength(1);
    expect(search(index, 'otra').albums[0].trackCount).toBe(1);
  });

  it('limita cada grupo y usa ocho por defecto', () => {
    const tracks = Array.from({ length: 12 }, (_, i) => track(String(i), 'local', {
      title: `Tema ${i}`, artist: `Artista ${i}`, album: `Disco ${i}`,
    }));
    const index = indexOf(...tracks);
    for (const hits of Object.values(search(index, 'tema'))) expect(hits).toHaveLength(8);
    for (const hits of Object.values(search(index, 'tema', 2))) expect(hits).toHaveLength(2);
    for (const hits of Object.values(search(index, 'tema', 0))) expect(hits).toHaveLength(0);
  });

  it('busca en 50 000 pistas dentro del margen de humo de 500 ms', () => {
    const tracks = Array.from({ length: 50_000 }, (_, i) => track(String(i), 'local', {
      title: `Tema ${i}`, artist: `Artista ${i % 100}`, album: `Disco ${i % 1000}`,
    }));
    const index = indexOf(...tracks);
    const start = performance.now();
    const result = search(index, 'tema');
    const elapsed = performance.now() - start;
    expect(result.tracks).toHaveLength(8);
    expect(elapsed).toBeLessThan(500);
  });
});
