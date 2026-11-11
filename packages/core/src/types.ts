// Modelo de dominio de HiResSpot. Independiente de la plataforma.

export type SourceKind = 'local' | 'navidrome' | 'spotify';

export interface ReplayGain {
  trackGain?: number; // dB
  trackPeak?: number;
  albumGain?: number; // dB
  albumPeak?: number;
}

export interface Track {
  /** Id único global: `${source}:${sourceId}`. */
  id: string;
  source: SourceKind;
  /** Id dentro de la fuente: ruta absoluta (local), id Subsonic (navidrome), id de Spotify. */
  sourceId: string;
  /** Ruta absoluta del archivo (solo fuente local). */
  path?: string;
  title: string;
  /** Artista de la pista (puede incluir invitados). */
  artist: string;
  /** Preferido para agrupar álbumes si existe. */
  albumArtist?: string;
  album: string;
  trackNo?: number;
  discNo?: number;
  year?: number;
  /** Segundos. */
  duration?: number;
  /** Hz. */
  sampleRate?: number;
  /** Bits por muestra. */
  bitDepth?: number;
  /** kbps. */
  bitrate?: number;
  /** Contenedor/códec, p. ej. "FLAC", "WAV", "MP3". */
  format?: string;
  isrc?: string;
  /** MusicBrainz recording id. */
  mbid?: string;
  replayGain?: ReplayGain;
  /** URL de la portada, resoluble por el navegador. Puede llevar credenciales: no persistir. */
  coverUrl?: string;
  /** Id de portada en la fuente (Navidrome: coverArt). Seguro de persistir; sirve para rehacer `coverUrl`. */
  coverId?: string;
  /** Marcada como favorita en su fuente (Navidrome: "starred"). */
  favorite?: boolean;
  /** Género principal (tag). */
  genre?: string;
  /** Valoración del usuario, 1–5 (0/undefined = sin valorar). */
  rating?: number;
  /** Veces reproducida (Navidrome). */
  playCount?: number;
}

export interface AlbumGroup {
  key: string;
  album: string;
  artist: string;
  artistKey: string;
  albumKey: string;
  coverUrl?: string;
  tracks: Track[];
}

export interface ArtistGroup {
  key: string;
  artist: string;
  coverUrl?: string;
  albums: Set<string>;
  tracks: Track[];
}
