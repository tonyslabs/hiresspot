import { groupAlbums } from './library';
import { normalize, pickPrimary } from './text';
import type { AlbumGroup, Track } from './types';

// ---------------------------------------------------------------------------
// Comparación de bibliotecas (p. ej. Navidrome vs Spotify vs local).
// Emparejado uno-a-uno por niveles de confianza: ISRC → MusicBrainz → metadatos normalizados.
// ---------------------------------------------------------------------------

export type MatchKind = 'isrc' | 'mbid' | 'metadata';

export interface TrackMatch {
  a: Track;
  b: Track;
  kind: MatchKind;
}

export type CoverageStatus = 'complete' | 'partial' | 'missing';

export interface AlbumCoverage {
  album: AlbumGroup;
  /** Pistas del álbum que existen en la otra biblioteca. */
  matched: number;
  total: number;
  status: CoverageStatus;
}

export interface Comparison {
  both: TrackMatch[];
  onlyA: Track[];
  onlyB: Track[];
  /** Cobertura de cada álbum de A respecto de B. */
  albumsA: AlbumCoverage[];
  /** Cobertura de cada álbum de B respecto de A. */
  albumsB: AlbumCoverage[];
}

export interface CompareOptions {
  /** Diferencia máxima de duración (s) para el emparejado por metadatos. */
  durationToleranceSec?: number;
}

const DEFAULT_TOLERANCE_S = 3;

/** ISRC sin guiones ni espacios, en mayúsculas. */
export const normalizeIsrc = (isrc?: string): string => (isrc ?? '').replace(/[\s-]/g, '').toUpperCase();

/** Etiquetas que cambian el título sin cambiar la grabación (remaster, mono/stereo, invitados). */
const NOISE = [
  /\s*[([]\s*(?:feat\.?|ft\.?|featuring|con|with)\b[^)\]]*[)\]]/gi,
  /\s+-\s+(?:feat\.?|ft\.?|featuring)\b.*$/i,
  /\s*[([][^)\]]*\b(?:remaster(?:ed)?|remasterizad[oa]|mono|stereo|deluxe|expanded|bonus|anniversary|edition|version(?:\s+remaster)?)\b[^)\]]*[)\]]/gi,
  /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|remasterizad[oa])\b.*$/i
];

/** Clave comparable de un título: sin etiquetas de remaster/invitados, sin acentos ni símbolos. */
export const titleKey = (title: string): string => {
  let t = title;
  for (const re of NOISE) t = t.replace(re, '');
  return normalize(t);
};

const artistKey = (t: Track): string => normalize(pickPrimary(t.artist));
const metaKey = (t: Track): string => `${titleKey(t.title)}__${artistKey(t)}`;

const durationGap = (x: Track, y: Track): number =>
  x.duration !== undefined && y.duration !== undefined ? Math.abs(x.duration - y.duration) : 0;

/**
 * Empareja `a` con `b` uno a uno. Cada pista de B se usa a lo sumo una vez; ante varios
 * candidatos gana el de duración más cercana y, a igualdad, el del mismo álbum.
 */
export const compareTracks = (
  a: Track[],
  b: Track[],
  options: CompareOptions = {}
): Pick<Comparison, 'both' | 'onlyA' | 'onlyB'> => {
  const tolerance = options.durationToleranceSec ?? DEFAULT_TOLERANCE_S;
  const usedB = new Set<number>();
  const matchedA = new Set<number>();
  const both: TrackMatch[] = [];

  const index = (keyOf: (t: Track) => string): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    b.forEach((t, i) => {
      const k = keyOf(t);
      if (!k || k.startsWith('__') || k.endsWith('__')) return;
      (m.get(k) ?? m.set(k, []).get(k)!).push(i);
    });
    return m;
  };

  const runTier = (kind: MatchKind, keyOf: (t: Track) => string, accept: (x: Track, y: Track) => boolean) => {
    const idx = index(keyOf);
    a.forEach((x, ai) => {
      if (matchedA.has(ai)) return;
      const k = keyOf(x);
      if (!k || k.startsWith('__') || k.endsWith('__')) return;
      const candidates = (idx.get(k) ?? []).filter((bi) => !usedB.has(bi) && accept(x, b[bi]));
      if (candidates.length === 0) return;
      candidates.sort((p, q) => {
        const gap = durationGap(x, b[p]) - durationGap(x, b[q]);
        if (gap !== 0) return gap;
        const sameAlbum = (y: Track) => (normalize(y.album) === normalize(x.album) ? 0 : 1);
        return sameAlbum(b[p]) - sameAlbum(b[q]);
      });
      const bi = candidates[0];
      usedB.add(bi);
      matchedA.add(ai);
      both.push({ a: x, b: b[bi], kind });
    });
  };

  runTier('isrc', (t) => normalizeIsrc(t.isrc), () => true);
  runTier('mbid', (t) => (t.mbid ?? '').toLowerCase(), () => true);
  runTier('metadata', metaKey, (x, y) => durationGap(x, y) <= tolerance);

  return {
    both,
    onlyA: a.filter((_, i) => !matchedA.has(i)),
    onlyB: b.filter((_, i) => !usedB.has(i))
  };
};

const coverage = (tracks: Track[], matchedIds: Set<string>): AlbumCoverage[] =>
  groupAlbums(tracks).map((album) => {
    const matched = album.tracks.filter((t) => matchedIds.has(t.id)).length;
    const total = album.tracks.length;
    return { album, matched, total, status: matched === 0 ? 'missing' : matched === total ? 'complete' : 'partial' };
  });

/** Compara dos bibliotecas a nivel de pista y de álbum. */
export const compareLibraries = (a: Track[], b: Track[], options: CompareOptions = {}): Comparison => {
  const { both, onlyA, onlyB } = compareTracks(a, b, options);
  return {
    both,
    onlyA,
    onlyB,
    albumsA: coverage(a, new Set(both.map((m) => m.a.id))),
    albumsB: coverage(b, new Set(both.map((m) => m.b.id)))
  };
};

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

const csvCell = (v: string | number | undefined): string => {
  let s = v === undefined ? '' : String(v);
  // Evitar inyección de fórmulas al abrir el CSV en una hoja de cálculo
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV con una fila por pista: estado (en ambas / solo A / solo B) y datos de cada lado. */
export const comparisonToCsv = (cmp: Comparison, labelA: string, labelB: string): string => {
  const header = ['estado', 'titulo', 'artista', 'album', 'duracion_s', 'isrc', 'emparejado_por'];
  const rows: string[][] = [];
  const row = (state: string, t: Track, by = '') =>
    rows.push([state, t.title, t.artist, t.album, t.duration !== undefined ? String(Math.round(t.duration)) : '', t.isrc ?? '', by].map(csvCell));
  for (const m of cmp.both) row('en ambas', m.a, m.kind);
  for (const t of cmp.onlyA) row(`solo en ${labelA}`, t);
  for (const t of cmp.onlyB) row(`solo en ${labelB}`, t);
  return [header, ...rows].map((r) => r.join(',')).join('\n');
};
