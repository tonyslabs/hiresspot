import type { Track } from '@hiresspot/core';

// Caché de la biblioteca remota en IndexedDB: permite mostrar la biblioteca al instante
// (y sin red) mientras se sincroniza en segundo plano. Cualquier fallo se ignora: es solo caché.

const DB_NAME = 'hiresspot';
const STORE = 'tracks';

interface CacheEntry {
  tracks: Track[];
  savedAt: number;
}

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    }).finally(() => db.close());
  } catch {
    return null;
  }
};

export const loadCachedTracks = async (key: string): Promise<CacheEntry | null> =>
  (await run<CacheEntry | undefined>('readonly', (s) => s.get(key))) ?? null;

export const saveCachedTracks = async (key: string, tracks: Track[]): Promise<void> => {
  await run('readwrite', (s) => s.put({ tracks, savedAt: Date.now() } satisfies CacheEntry, key));
};

export const clearCachedTracks = async (key: string): Promise<void> => {
  await run('readwrite', (s) => s.delete(key));
};
