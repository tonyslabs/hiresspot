import type { Track } from './types';

/** Minúsculas, sin acentos ni símbolos, espacios colapsados. Base de agrupación y búsqueda. */
export const normalize = (s?: string): string =>
  (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Separadores de artistas invitados. Con límites de palabra para no partir
 * nombres como "Concrete Blonde" (por "con") ni "AC/DC" (por "/").
 */
const FEATURING = /\s+(?:feat\.?|ft\.?|featuring|con|with)\s+|\s*[,;]\s*|\s+&\s+|\s+x\s+|\s+\/\s+/i;

/** Artista principal de una cadena de créditos ("A feat. B" → "A"). */
export const pickPrimary = (s?: string): string => {
  const base = (s || '').trim();
  const first = base
    .split(FEATURING)
    .map((p) => p.trim())
    .filter(Boolean)[0];
  return first || base || 'Artista desconocido';
};

export const primaryArtistForTrack = (t: Track): string => pickPrimary(t.albumArtist || t.artist);

export const tokenize = (query: string): string[] => normalize(query).split(' ').filter(Boolean);
