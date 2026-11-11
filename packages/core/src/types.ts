// Global types for HiResSpot

interface Track {
  id: string; // unique id, using absolute path for local files
  path: string; // absolute path to audio file
  title: string;
  artist: string; // track artist (may include features)
  albumArtist?: string; // preferred for album grouping if present
  album: string;
  duration?: number; // seconds
  sampleRate?: number; // Hz
  bitDepth?: number; // bits
  picture?: string; // data URL for cover art
}

type ViewKind =
  | 'local_albums'
  | 'local_album'
  | 'local_artists'
  | 'local_artist'
  | 'local_tracks'
  | 'spotify'
  | 'search';

declare global {
  interface Window {
    api: {
      spotify: {
        login: () => Promise<string>;
        logout: () => Promise<string>;
      };
      system: {
        openFolderDialog: () => Promise<string | null>;
      };
      library: {
        scanFolder: (dir: string) => Promise<Track[]>;
      };
      file: {
        read: (path: string) => Promise<ArrayBuffer>;
      };
      utils: {
        toFileURL: (p: string) => string;
      };
    };
  }
}

export {};
