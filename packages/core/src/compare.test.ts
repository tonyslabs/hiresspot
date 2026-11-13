import { describe, expect, it } from 'vitest';
import { compareLibraries, compareTracks, comparisonToCsv, normalizeIsrc, titleKey } from './compare';
import type { Track } from './types';

let n = 0;
const t = (source: Track['source'], over: Partial<Track>): Track => ({
  id: `${source}:${over.title}:${n++}`,
  source,
  sourceId: String(n),
  title: 'T',
  artist: 'A',
  album: 'Al',
  ...over
});
const nd = (o: Partial<Track>) => t('navidrome', o);
const sp = (o: Partial<Track>) => t('spotify', o);

describe('titleKey', () => {
  it('ignora remasters, invitados y mayúsculas/acentos', () => {
    expect(titleKey('Yesterday - Remastered 2009')).toBe('yesterday');
    expect(titleKey('Yesterday (Remastered 2009)')).toBe('yesterday');
    expect(titleKey('Despacito (feat. Daddy Yankee)')).toBe('despacito');
    expect(titleKey('Despacito - feat. Daddy Yankee')).toBe('despacito');
    expect(titleKey('Canción [Mono Version]')).toBe('cancion');
    expect(titleKey('Ojalá')).toBe(titleKey('OJALA'));
  });
  it('NO borra etiquetas que cambian la grabación (en vivo, acústico, remix)', () => {
    expect(titleKey('Song (Live at Wembley)')).not.toBe(titleKey('Song'));
    expect(titleKey('Song (Acoustic)')).not.toBe(titleKey('Song'));
    expect(titleKey('Song - Remix')).not.toBe(titleKey('Song'));
  });
});

describe('normalizeIsrc', () => {
  it('quita guiones y espacios y pasa a mayúsculas', () => {
    expect(normalizeIsrc('us-rc1 76-07839')).toBe('USRC17607839');
  });
});

describe('compareTracks', () => {
  it('empareja por ISRC aunque los títulos difieran', () => {
    const a = [nd({ title: 'Aurora', isrc: 'USRC17607839' })];
    const b = [sp({ title: 'Aurora (2024 Remaster)', isrc: 'US-RC1-76-07839', artist: 'Otro nombre' })];
    const r = compareTracks(a, b);
    expect(r.both).toHaveLength(1);
    expect(r.both[0].kind).toBe('isrc');
    expect(r.onlyA).toHaveLength(0);
    expect(r.onlyB).toHaveLength(0);
  });

  it('empareja por MusicBrainz id', () => {
    const r = compareTracks([nd({ title: 'X', mbid: 'ABC-1' })], [sp({ title: 'Otra cosa', mbid: 'abc-1' })]);
    expect(r.both[0].kind).toBe('mbid');
  });

  it('empareja por metadatos: invitados, remaster y acentos; respeta la duración', () => {
    const a = [
      nd({ title: 'Despacito', artist: 'Luis Fonsi', duration: 229 }),
      nd({ title: 'Ojalá', artist: 'Silvio Rodríguez', duration: 200 })
    ];
    const b = [
      sp({ title: 'Despacito (feat. Daddy Yankee)', artist: 'Luis Fonsi feat. Daddy Yankee', duration: 229.4 }),
      sp({ title: 'OJALA - Remastered 2010', artist: 'Silvio Rodriguez', duration: 201 })
    ];
    const r = compareTracks(a, b);
    expect(r.both).toHaveLength(2);
    expect(r.both.every((m) => m.kind === 'metadata')).toBe(true);
  });

  it('no empareja la versión en vivo con la de estudio (duración muy distinta)', () => {
    const r = compareTracks(
      [nd({ title: 'Song', artist: 'Band', duration: 200 })],
      [sp({ title: 'Song', artist: 'Band', duration: 410 })]
    );
    expect(r.both).toHaveLength(0);
    expect(r.onlyA).toHaveLength(1);
    expect(r.onlyB).toHaveLength(1);
  });

  it('es uno a uno: dos copias en A solo consumen una de B', () => {
    const a = [nd({ title: 'Dup', artist: 'X', duration: 100 }), nd({ title: 'Dup', artist: 'X', duration: 100 })];
    const b = [sp({ title: 'Dup', artist: 'X', duration: 100 })];
    const r = compareTracks(a, b);
    expect(r.both).toHaveLength(1);
    expect(r.onlyA).toHaveLength(1);
  });

  it('ante varios candidatos elige el de duración más cercana', () => {
    const a = [nd({ title: 'Same', artist: 'X', duration: 100 })];
    const near = sp({ title: 'Same', artist: 'X', duration: 101, album: 'Near' });
    const far = sp({ title: 'Same', artist: 'X', duration: 102.9, album: 'Far' });
    const r = compareTracks(a, [far, near]);
    expect(r.both[0].b).toBe(near);
  });

  it('sin duración en alguno de los lados empareja solo por título y artista', () => {
    const r = compareTracks([nd({ title: 'Z', artist: 'Q' })], [sp({ title: 'Z', artist: 'Q', duration: 180 })]);
    expect(r.both).toHaveLength(1);
  });

  it('no empareja si el artista es otro', () => {
    const r = compareTracks([nd({ title: 'Z', artist: 'Q' })], [sp({ title: 'Z', artist: 'W' })]);
    expect(r.both).toHaveLength(0);
  });

  it('un ISRC vacío no empareja todo con todo', () => {
    const r = compareTracks([nd({ title: 'A1', artist: 'x', isrc: '' })], [sp({ title: 'B1', artist: 'y', isrc: '' })]);
    expect(r.both).toHaveLength(0);
  });
});

describe('compareLibraries', () => {
  const a = [
    nd({ title: 'Uno', artist: 'Ana', album: 'Disco', duration: 100 }),
    nd({ title: 'Dos', artist: 'Ana', album: 'Disco', duration: 100 }),
    nd({ title: 'Solo A', artist: 'Beto', album: 'Otro', duration: 100 })
  ];
  const b = [
    sp({ title: 'Uno', artist: 'Ana', album: 'Disco', duration: 100 }),
    sp({ title: 'Tres', artist: 'Ana', album: 'Disco', duration: 100 }),
    sp({ title: 'Solo B', artist: 'Cami', album: 'Nuevo', duration: 100 })
  ];
  const cmp = compareLibraries(a, b);

  it('separa en ambas / solo A / solo B', () => {
    expect(cmp.both.map((m) => m.a.title)).toEqual(['Uno']);
    expect(cmp.onlyA.map((x) => x.title).sort()).toEqual(['Dos', 'Solo A']);
    expect(cmp.onlyB.map((x) => x.title).sort()).toEqual(['Solo B', 'Tres']);
  });

  it('calcula la cobertura por álbum', () => {
    const disco = cmp.albumsA.find((x) => x.album.album === 'Disco')!;
    expect(disco).toMatchObject({ matched: 1, total: 2, status: 'partial' });
    expect(cmp.albumsA.find((x) => x.album.album === 'Otro')!.status).toBe('missing');
    expect(cmp.albumsB.find((x) => x.album.album === 'Nuevo')!.status).toBe('missing');
  });

  it('un álbum totalmente presente es complete', () => {
    const full = compareLibraries([nd({ title: 'U', artist: 'Z', album: 'AA' })], [sp({ title: 'U', artist: 'Z', album: 'AA' })]);
    expect(full.albumsA[0].status).toBe('complete');
  });
});

describe('comparisonToCsv', () => {
  it('escapa comillas/comas y neutraliza fórmulas', () => {
    const cmp = compareLibraries(
      [nd({ title: '=HYPERLINK("x")', artist: 'A, B', album: 'C', duration: 61.4 })],
      []
    );
    const csv = comparisonToCsv(cmp, 'Navidrome', 'Spotify');
    const [header, row] = csv.split('\n');
    expect(header).toBe('estado,titulo,artista,album,duracion_s,isrc,emparejado_por');
    expect(row).toContain('solo en Navidrome');
    expect(row).toContain('"\'=HYPERLINK(""x"")"');
    expect(row).toContain('"A, B"');
    expect(row).toContain(',61,');
  });
});
