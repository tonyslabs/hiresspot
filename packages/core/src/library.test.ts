import { describe, expect, it } from 'vitest';
import { filterTracks, groupAlbums, groupArtists, tracksOfAlbum } from './library';
import { normalize, pickPrimary, tokenize } from './text';
import type { Track } from './types';

const track = (over: Partial<Track>): Track => ({
  id: `local:${over.title}`,
  source: 'local',
  sourceId: String(over.title),
  title: 'T',
  artist: 'A',
  album: 'Al',
  ...over,
});

describe('normalize', () => {
  it('quita acentos, símbolos y mayúsculas', () => {
    expect(normalize('  Beyoncé — Lemonade!! ')).toBe('beyonce lemonade');
  });
  it('tolera undefined', () => {
    expect(normalize(undefined)).toBe('');
  });
});

describe('pickPrimary', () => {
  it('toma el primer artista ante feat., ft., con, coma, & y x', () => {
    expect(pickPrimary('Bad Bunny feat. Drake')).toBe('Bad Bunny');
    expect(pickPrimary('Rosalía ft. Travis Scott')).toBe('Rosalía');
    expect(pickPrimary('Juanes con Nelly Furtado')).toBe('Juanes');
    expect(pickPrimary('Daft Punk, Pharrell')).toBe('Daft Punk');
    expect(pickPrimary('Shakira & Wyclef')).toBe('Shakira');
    expect(pickPrimary('Peso Pluma x Natanael Cano')).toBe('Peso Pluma');
  });
  it('no parte palabras que contienen "con" ni el nombre AC/DC', () => {
    expect(pickPrimary('Concrete Blonde')).toBe('Concrete Blonde');
    expect(pickPrimary('Beacon')).toBe('Beacon');
    expect(pickPrimary('AC/DC')).toBe('AC/DC');
  });
  it('usa un valor por defecto si no hay artista', () => {
    expect(pickPrimary('')).toBe('Artista desconocido');
    expect(pickPrimary(undefined)).toBe('Artista desconocido');
  });
});

describe('groupAlbums / groupArtists', () => {
  const tracks = [
    track({ title: 'b', album: 'Ágape', artist: 'Ana feat. Luis', trackNo: 2, coverUrl: 'c1' }),
    track({ title: 'a', album: 'agape', artist: 'Ana', trackNo: 1 }),
    track({ title: 'z', album: 'Otro', artist: 'Beto', albumArtist: 'Beto' }),
  ];

  it('une álbumes que difieren solo en acentos/mayúsculas e invitados', () => {
    const albums = groupAlbums(tracks);
    expect(albums).toHaveLength(2);
    const agape = albums.find((a) => a.albumKey === 'agape')!;
    expect(agape.tracks.map((t) => t.title)).toEqual(['a', 'b']);
    expect(agape.coverUrl).toBe('c1');
  });

  it('agrupa artistas por artista principal', () => {
    const artists = groupArtists(tracks);
    expect(artists.map((a) => a.artist)).toEqual(['Ana', 'Beto']);
    expect(artists[0].albums.size).toBe(2);
  });

  it('tracksOfAlbum devuelve solo las pistas del álbum, en orden', () => {
    const list = tracksOfAlbum(tracks, 'agape', 'ana');
    expect(list.map((t) => t.title)).toEqual(['a', 'b']);
  });
});

describe('filterTracks', () => {
  const tracks = [
    track({ title: 'Despacito', artist: 'Luis Fonsi', album: 'Vida' }),
    track({ title: 'Ojalá', artist: 'Silvio Rodríguez', album: 'Días y flores' }),
  ];
  it('requiere todos los tokens y ignora acentos', () => {
    expect(filterTracks(tracks, tokenize('ojala silvio'))).toHaveLength(1);
    expect(filterTracks(tracks, tokenize('ojala fonsi'))).toHaveLength(0);
  });
  it('sin tokens devuelve todo', () => {
    expect(filterTracks(tracks, [])).toHaveLength(2);
  });
});
