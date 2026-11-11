import type { Track } from '../types';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Cola de reproducción como estado inmutable.
 * `order[pos]` es el índice en `items` de la pista actual; con shuffle `order` es una
 * permutación y sin shuffle es la identidad.
 */
export interface QueueState {
  items: Track[];
  order: number[];
  pos: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export type Rng = () => number;

export const emptyQueue = (): QueueState => ({ items: [], order: [], pos: -1, shuffle: false, repeat: 'off' });

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Fisher–Yates. Si `first` está definido, queda en la posición 0. */
const shuffledOrder = (n: number, first: number | null, rng: Rng): number[] => {
  const rest = identity(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first === null ? rest : [first, ...rest];
};

export const currentIndex = (q: QueueState): number => (q.pos >= 0 ? q.order[q.pos] : -1);

export const currentTrack = (q: QueueState): Track | null => {
  const i = currentIndex(q);
  return i >= 0 ? q.items[i] : null;
};

/** Reemplaza la cola. `startIndex` es el índice en `items` por el que se empieza. */
export const setItems = (q: QueueState, items: Track[], startIndex = 0, rng: Rng = Math.random): QueueState => {
  if (items.length === 0) return { ...q, items: [], order: [], pos: -1 };
  const start = Math.min(Math.max(startIndex, 0), items.length - 1);
  const order = q.shuffle ? shuffledOrder(items.length, start, rng) : identity(items.length);
  return { ...q, items, order, pos: q.shuffle ? 0 : start };
};

/** Pista que sonaría al terminar la actual (sin consumirla). null si la cola termina. */
export const peekNext = (q: QueueState): Track | null => {
  if (q.pos < 0) return null;
  if (q.repeat === 'one') return currentTrack(q);
  if (q.pos + 1 < q.order.length) return q.items[q.order[q.pos + 1]];
  if (q.repeat === 'all' && q.order.length > 0) return q.items[q.order[0]];
  return null;
};

/**
 * Avanza. `auto` = terminó sola la pista (repeat 'one' la repite); manual = el usuario pulsó
 * "siguiente" (repeat 'one' no aplica). Devuelve null si no hay siguiente.
 */
export const next = (q: QueueState, auto: boolean): QueueState | null => {
  if (q.pos < 0) return null;
  if (auto && q.repeat === 'one') return q;
  if (q.pos + 1 < q.order.length) return { ...q, pos: q.pos + 1 };
  if (q.repeat === 'all' && q.order.length > 0) return { ...q, pos: 0 };
  return null;
};

/** Retrocede. Devuelve null si ya está en la primera pista y no hay repeat 'all'. */
export const prev = (q: QueueState): QueueState | null => {
  if (q.pos < 0) return null;
  if (q.pos > 0) return { ...q, pos: q.pos - 1 };
  if (q.repeat === 'all' && q.order.length > 0) return { ...q, pos: q.order.length - 1 };
  return null;
};

/** Salta a un índice de `items`. */
export const jumpTo = (q: QueueState, itemIndex: number): QueueState => {
  const pos = q.order.indexOf(itemIndex);
  return pos < 0 ? q : { ...q, pos };
};

/** Agrega al final de la cola (y del orden de shuffle). */
export const append = (q: QueueState, tracks: Track[], rng: Rng = Math.random): QueueState => {
  if (tracks.length === 0) return q;
  if (q.items.length === 0) return setItems(q, tracks, 0, rng);
  const items = [...q.items, ...tracks];
  const added = tracks.map((_, i) => q.items.length + i);
  return { ...q, items, order: [...q.order, ...added] };
};

/** Inserta justo después de la pista actual ("reproducir a continuación"). */
export const insertNext = (q: QueueState, tracks: Track[], rng: Rng = Math.random): QueueState => {
  if (tracks.length === 0) return q;
  if (q.items.length === 0) return setItems(q, tracks, 0, rng);
  const items = [...q.items, ...tracks];
  const added = tracks.map((_, i) => q.items.length + i);
  const order = [...q.order.slice(0, q.pos + 1), ...added, ...q.order.slice(q.pos + 1)];
  return { ...q, items, order };
};

/** Quita la pista en la posición `itemIndex` de `items`. Conserva la actual si es otra. */
export const removeAt = (q: QueueState, itemIndex: number): QueueState => {
  if (itemIndex < 0 || itemIndex >= q.items.length) return q;
  const wasCurrent = currentIndex(q) === itemIndex;
  const removedPos = q.order.indexOf(itemIndex);
  const items = q.items.filter((_, i) => i !== itemIndex);
  const order = q.order.filter((i) => i !== itemIndex).map((i) => (i > itemIndex ? i - 1 : i));
  if (items.length === 0) return { ...q, items, order, pos: -1 };
  let pos = q.pos;
  if (removedPos < q.pos) pos -= 1;
  else if (wasCurrent) pos = Math.min(q.pos, order.length - 1);
  return { ...q, items, order, pos };
};

export const setShuffle = (q: QueueState, shuffle: boolean, rng: Rng = Math.random): QueueState => {
  if (shuffle === q.shuffle) return q;
  if (q.items.length === 0) return { ...q, shuffle };
  const cur = currentIndex(q);
  if (shuffle) return { ...q, shuffle, order: shuffledOrder(q.items.length, cur, rng), pos: 0 };
  return { ...q, shuffle, order: identity(q.items.length), pos: cur };
};

export const setRepeat = (q: QueueState, repeat: RepeatMode): QueueState => ({ ...q, repeat });
