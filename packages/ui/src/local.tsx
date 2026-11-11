import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Track } from '@hiresspot/core';
import { usePlatform } from './platform';

export interface LocalLibrary {
  roots: string[];
  tracks: Track[];
  addFolder(): Promise<void>;
  removeFolder(root: string): Promise<void>;
  reload(): Promise<void>;
}

const Ctx = createContext<LocalLibrary | null>(null);

/** Carpetas locales autorizadas y sus pistas (vive en el contexto para usarse desde Inicio y Ajustes). */
export const LocalLibraryProvider = ({ children }: { children: ReactNode }) => {
  const platform = usePlatform();
  const [roots, setRoots] = useState<string[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);

  const scanRoots = async (list: string[]) => {
    const all = (await Promise.all(list.map((r) => platform.library.scan(r)))).flat();
    setTracks(Array.from(new Map(all.map((t) => [t.id, t])).values()));
  };

  useEffect(() => {
    platform.library
      .getRoots()
      .then(async (list) => {
        setRoots(list);
        if (list.length > 0) await scanRoots(list);
      })
      .catch((err) => console.error('[Library] getRoots failed', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo<LocalLibrary>(
    () => ({
      roots,
      tracks,
      addFolder: async () => {
        const root = await platform.library.addRoot();
        if (!root) return;
        const next = roots.includes(root) ? roots : [...roots, root];
        setRoots(next);
        await scanRoots(next);
      },
      removeFolder: async (root) => {
        await platform.library.removeRoot(root);
        const next = roots.filter((r) => r !== root);
        setRoots(next);
        await scanRoots(next);
      },
      reload: () => scanRoots(roots)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, tracks, platform]
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
};

export const useLocal = (): LocalLibrary => {
  const api = useContext(Ctx);
  if (!api) throw new Error('useLocal: falta <LocalLibraryProvider>');
  return api;
};
