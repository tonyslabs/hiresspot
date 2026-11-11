import { describe, expect, it } from 'vitest';
import * as Q from './queue';
import type { Track } from '../types';

const t = (id: string): Track => ({ id, source: 'local', sourceId: id, title: id, artist: 'A', album: 'B' });
const ids = (q: Q.QueueState) => q.order.map((i) => q.items[i].id);
const seqRng = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('queue', () => {
  const abc = [t('a'), t('b'), t('c')];

  it('setItems empieza en el índice pedido', () => {
    const q = Q.setItems(Q.emptyQueue(), abc, 1);
    expect(Q.currentTrack(q)?.id).toBe('b');
  });

  it('next avanza y termina en null sin repeat', () => {
    let q = Q.setItems(Q.emptyQueue(), abc, 0);
    q = Q.next(q, true)!;
    q = Q.next(q, true)!;
    expect(Q.currentTrack(q)?.id).toBe('c');
    expect(Q.next(q, true)).toBeNull();
  });

  it('repeat all da la vuelta; repeat one solo repite al terminar sola', () => {
    let q = Q.setRepeat(Q.setItems(Q.emptyQueue(), abc, 2), 'all');
    expect(Q.currentTrack(Q.next(q, true)!)?.id).toBe('a');
    expect(Q.peekNext(q)?.id).toBe('a');

    q = Q.setRepeat(Q.setItems(Q.emptyQueue(), abc, 1), 'one');
    expect(Q.currentTrack(Q.next(q, true)!)?.id).toBe('b');
    expect(Q.currentTrack(Q.next(q, false)!)?.id).toBe('c');
    expect(Q.peekNext(q)?.id).toBe('b');
  });

  it('prev retrocede y se detiene en la primera sin repeat', () => {
    const q = Q.setItems(Q.emptyQueue(), abc, 1);
    expect(Q.currentTrack(Q.prev(q)!)?.id).toBe('a');
    expect(Q.prev(Q.setItems(Q.emptyQueue(), abc, 0))).toBeNull();
  });

  it('shuffle deja la actual primero y es una permutación', () => {
    let q = Q.setItems(Q.emptyQueue(), abc, 1);
    q = Q.setShuffle(q, true, seqRng([0.1, 0.9]));
    expect(Q.currentTrack(q)?.id).toBe('b');
    expect(q.pos).toBe(0);
    expect([...ids(q)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('quitar shuffle conserva la pista actual', () => {
    let q = Q.setShuffle(Q.setItems(Q.emptyQueue(), abc, 2), true, seqRng([0.5]));
    q = Q.next(q, true)!;
    const cur = Q.currentTrack(q)!.id;
    q = Q.setShuffle(q, false);
    expect(Q.currentTrack(q)?.id).toBe(cur);
    expect(ids(q)).toEqual(['a', 'b', 'c']);
  });

  it('append y insertNext', () => {
    let q = Q.setItems(Q.emptyQueue(), abc, 0);
    q = Q.append(q, [t('d')]);
    q = Q.insertNext(q, [t('x')]);
    expect(ids(q)).toEqual(['a', 'x', 'b', 'c', 'd']);
    expect(Q.currentTrack(q)?.id).toBe('a');
  });

  it('append sobre cola vacía deja la primera como actual', () => {
    const q = Q.append(Q.emptyQueue(), abc);
    expect(Q.currentTrack(q)?.id).toBe('a');
  });

  it('removeAt conserva la actual si se quita otra, y pasa a la siguiente si se quita la actual', () => {
    let q = Q.setItems(Q.emptyQueue(), abc, 1);
    expect(Q.currentTrack(Q.removeAt(q, 0))?.id).toBe('b');
    expect(Q.currentTrack(Q.removeAt(q, 2))?.id).toBe('b');
    q = Q.removeAt(q, 1);
    expect(Q.currentTrack(q)?.id).toBe('c');
    expect(Q.currentTrack(Q.removeAt(Q.removeAt(q, 0), 0))).toBeNull();
  });

  it('jumpTo usa el índice en items aunque haya shuffle', () => {
    const q = Q.setShuffle(Q.setItems(Q.emptyQueue(), abc, 0), true, seqRng([0.3]));
    expect(Q.currentTrack(Q.jumpTo(q, 2))?.id).toBe('c');
  });
});
