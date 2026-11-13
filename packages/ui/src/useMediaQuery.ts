import { useSyncExternalStore } from 'react';

/** Suscripción reactiva a una media query (p. ej. el teléfono en vertical). */
export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', notify);
      return () => m.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );

/** Debajo de `md` (768 px): el diseño pasa de barra lateral a barra inferior. */
export const useIsMobile = (): boolean => useMediaQuery('(max-width: 767px)');
