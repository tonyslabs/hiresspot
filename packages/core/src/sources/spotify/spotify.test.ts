import { describe, expect, it } from 'vitest';
import { pickPrimary } from '../../text';
import { SpotifyClient, toTrack } from './client';

const album = { id: 'A1', name: 'Un Verano Sin Ti', artists: [{ name: 'Bad Bunny' }], release_date: '2022-05-06', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] };

describe('toTrack', () => {
  it('mapea los campos y elige la portada intermedia', () => {
    const t = toTrack({ id: 'T1', name: 'Tití Me Preguntó', artists: [{ name: 'Bad Bunny' }], album, track_number: 3, disc_number: 1, duration_ms: 243000, external_ids: { isrc: 'USSD12200001' } })!;
    expect(t).toMatchObject({ id: 'spotify:T1', source: 'spotify', title: 'Tití Me Preguntó', artist: 'Bad Bunny', album: 'Un Verano Sin Ti', year: 2022, duration: 243, isrc: 'USSD12200001', coverUrl: 'mid' });
  });
  it('descarta pistas locales, episodios y sin id', () => {
    expect(toTrack({ id: 'x', name: 'a', is_local: true })).toBeNull();
    expect(toTrack({ id: 'x', name: 'a', type: 'episode' })).toBeNull();
    expect(toTrack({ id: null, name: 'a' })).toBeNull();
  });
  it('varios artistas se unen con coma y el principal se reconoce', () => {
    const t = toTrack({ id: 'T2', name: 'x', artists: [{ name: 'Bad Bunny' }, { name: 'ROSALÍA' }], album })!;
    expect(t.artist).toBe('Bad Bunny, ROSALÍA');
    expect(pickPrimary(t.artist)).toBe('Bad Bunny');
    expect(pickPrimary('Bad Bunny; ROSALÍA')).toBe('Bad Bunny'); // formato de Navidrome
  });
});

describe('SpotifyClient', () => {
  const fake = (routes: Record<string, unknown>) => async (path: string) => {
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) throw new Error(`ruta no simulada: ${path}`);
    const r = routes[key];
    return typeof r === 'function' ? (r as (p: string) => unknown)(path) : r;
  };

  it('pagina /me/tracks hasta que no hay más', async () => {
    const mk = (id: string) => ({ track: { id, name: id, artists: [{ name: 'A' }], album } });
    const api = fake({
      '/v1/me/tracks': (p: string) => (p.includes('offset=0') ? { items: [mk('1'), mk('2')], next: 'x' } : { items: [mk('3')], next: null })
    });
    const tracks = await new SpotifyClient(api).getSavedTracks();
    expect(tracks.map((t) => t.sourceId)).toEqual(['1', '2', '3']);
  });

  it('combina "me gusta" y álbumes sin duplicar, y completa álbumes largos', async () => {
    const api = fake({
      '/v1/me/tracks': { items: [{ track: { id: 'L1', name: 'Liked', artists: [{ name: 'A' }], album, external_ids: { isrc: 'ISRC1' } } }], next: null },
      '/v1/me/albums': {
        items: [{ album: { ...album, tracks: { total: 3, items: [{ id: 'L1', name: 'Liked', artists: [{ name: 'A' }] }, { id: 'B2', name: 'Two', artists: [{ name: 'A' }] }] } } }],
        next: null
      },
      '/v1/albums/A1/tracks': { items: [{ id: 'L1', name: 'Liked' }, { id: 'B2', name: 'Two' }, { id: 'B3', name: 'Three' }].map((t) => ({ ...t, artists: [{ name: 'A' }] })), next: null }
    });
    const all = await new SpotifyClient(api).getLibraryTracks();
    expect(all.map((t) => t.sourceId).sort()).toEqual(['B2', 'B3', 'L1']);
    const liked = all.find((t) => t.sourceId === 'L1')!;
    expect(liked.isrc).toBe('ISRC1'); // conserva la versión con ISRC
    expect(liked.favorite).toBe(true);
    expect(all.find((t) => t.sourceId === 'B2')!.favorite).toBeUndefined();
  });

  it('marca como no legibles las playlists ajenas', async () => {
    const api = fake({
      '/v1/me/playlists': { items: [{ id: 'P1', name: 'Mía', owner: { id: 'me' }, items: { total: 5 } }, { id: 'P2', name: 'Ajena', owner: { id: 'otro' }, tracks: { total: 9 } }, { id: 'P3', name: 'Colab', owner: { id: 'otro' }, collaborative: true }], next: null },
      '/v1/me': { id: 'me' }
    });
    const pl = await new SpotifyClient(api).getPlaylists();
    expect(pl.map((p) => [p.name, p.readable, p.total])).toEqual([['Mía', true, 5], ['Ajena', false, 9], ['Colab', true, 0]]);
  });

  it('pagina artistas seguidos por cursor', async () => {
    const api = fake({
      '/v1/me/following': (p: string) =>
        p.includes('after=') ? { artists: { items: [{ id: 'a3', name: 'C' }], cursors: { after: null } } } : { artists: { items: [{ id: 'a1', name: 'A', genres: ['trap'] }, { id: 'a2', name: 'B' }], cursors: { after: 'a2' } } }
    });
    const artists = await new SpotifyClient(api).getFollowedArtists();
    expect(artists.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(artists[0].genres).toEqual(['trap']);
  });
});
