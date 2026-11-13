import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpResponse } from '../../http';
import { NavidromeClient, normalizeBaseUrl, type SubsonicSong } from './client';
import { NavidromeError } from './errors';
import { md5 } from './md5';

describe('md5', () => {
  it('coincide con los vectores conocidos', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });
  it('coincide con el ejemplo de la especificación Subsonic', () => {
    expect(md5('sesame' + 'c19b2d')).toBe('26719a1196d2a940705a59634eb18eab');
  });
  it('maneja entradas largas (varios bloques) y UTF-8', () => {
    expect(md5('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
    expect(md5('contraseña')).toBe(md5('contraseña'));
    expect(md5('é')).not.toBe(md5('e'));
  });
});

describe('normalizeBaseUrl', () => {
  it('añade http a hosts locales/Tailscale y https al resto, y quita la barra final', () => {
    expect(normalizeBaseUrl('100.76.255.29:4533/')).toBe('http://100.76.255.29:4533');
    expect(normalizeBaseUrl('homelab.tailee7f40.ts.net:4533')).toBe('http://homelab.tailee7f40.ts.net:4533');
    expect(normalizeBaseUrl('localhost:4533')).toBe('http://localhost:4533');
    expect(normalizeBaseUrl('music.example.com')).toBe('https://music.example.com');
  });
  it('respeta el esquema y el subpath', () => {
    expect(normalizeBaseUrl('https://example.com/navidrome/')).toBe('https://example.com/navidrome');
  });
  it('rechaza vacío y esquemas raros', () => {
    expect(() => normalizeBaseUrl('  ')).toThrow(NavidromeError);
    expect(() => normalizeBaseUrl('ftp://x.com')).toThrow(/http/);
  });
});

const ok = (body: unknown): HttpResponse => ({ ok: true, status: 200, statusText: 'OK', text: JSON.stringify(body) });
const sub = (extra: Record<string, unknown> = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } });

const song = (id: string, extra: Partial<SubsonicSong> = {}): SubsonicSong => ({ id, title: `t${id}`, ...extra });

const clientWith = (http: HttpClient) =>
  new NavidromeClient({ baseUrl: 'http://srv:4533/', username: 'darius', password: 'sesame' }, { http, salt: 'c19b2d' });

describe('NavidromeClient', () => {
  it('construye la autenticación por token+sal (nunca la contraseña) y pide JSON', async () => {
    let seen = '';
    const c = clientWith(async (url) => {
      seen = url;
      return ok(sub({ type: 'navidrome', serverVersion: '0.64.2', openSubsonic: true }));
    });
    const info = await c.ping();
    expect(info).toEqual({ apiVersion: '1.16.1', type: 'navidrome', serverVersion: '0.64.2', openSubsonic: true });
    const u = new URL(seen);
    expect(u.origin + u.pathname).toBe('http://srv:4533/rest/ping.view');
    expect(u.searchParams.get('u')).toBe('darius');
    expect(u.searchParams.get('t')).toBe('26719a1196d2a940705a59634eb18eab');
    expect(u.searchParams.get('s')).toBe('c19b2d');
    expect(u.searchParams.get('f')).toBe('json');
    expect(seen).not.toContain('sesame');
  });

  it('streamUrl pide el original (format=raw) y es estable; coverArtUrl lleva tamaño', () => {
    const c = clientWith(async () => ok(sub()));
    const a = c.streamUrl('42');
    expect(a).toBe(c.streamUrl('42'));
    const u = new URL(a);
    expect(u.pathname).toBe('/rest/stream.view');
    expect(u.searchParams.get('id')).toBe('42');
    expect(u.searchParams.get('format')).toBe('raw');
    expect(u.searchParams.has('f')).toBe(false);
    expect(new URL(c.streamUrl('42', { format: 'mp3', maxBitRate: 192 })).searchParams.get('maxBitRate')).toBe('192');
    expect(new URL(c.coverArtUrl('al-1', 300)).searchParams.get('size')).toBe('300');
  });

  it('clasifica los errores: credenciales, red, HTTP y protocolo', async () => {
    const kind = async (http: HttpClient) => {
      try {
        await clientWith(http).ping();
      } catch (e) {
        return (e as NavidromeError).kind;
      }
      return 'sin-error';
    };
    const failed = (code: number) => ok({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message: 'x' } } });
    expect(await kind(async () => failed(40))).toBe('auth');
    expect(await kind(async () => failed(70))).toBe('api');
    expect(await kind(async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: '' }))).toBe('auth');
    expect(await kind(async () => ({ ok: false, status: 502, statusText: 'Bad Gateway', text: '' }))).toBe('http');
    expect(await kind(async () => ({ ok: true, status: 200, statusText: 'OK', text: '<html>' }))).toBe('protocol');
    expect(await kind(async () => ok({ hola: 1 }))).toBe('protocol');
    expect(await kind(async () => { throw new Error('ECONNREFUSED'); })).toBe('network');
    expect(await kind(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; })).toBe('network');
  });

  it('el mensaje de credenciales incorrectas está en español', async () => {
    const c = clientWith(async () => ok({ 'subsonic-response': { status: 'failed', error: { code: 40 } } }));
    await expect(c.ping()).rejects.toThrow('Usuario o contraseña incorrectos.');
  });

  it('exige usuario y contraseña', () => {
    expect(() => new NavidromeClient({ baseUrl: 'x.com', username: '', password: 'p' })).toThrow(NavidromeError);
    expect(() => new NavidromeClient({ baseUrl: 'x.com', username: 'u', password: '' })).toThrow(NavidromeError);
  });

  it('getAllTracks pagina search3 hasta que una página viene incompleta', async () => {
    const calls: string[] = [];
    const total = 1203;
    const c = clientWith(async (url) => {
      const q = new URL(url).searchParams;
      calls.push(`${q.get('songOffset')}:${q.get('songCount')}:${JSON.stringify(q.get('query'))}`);
      const offset = Number(q.get('songOffset'));
      const n = Math.min(500, total - offset);
      return ok(sub({ searchResult3: { song: Array.from({ length: n }, (_, i) => song(String(offset + i))) } }));
    });
    const progress: number[] = [];
    const tracks = await c.getAllTracks((p) => progress.push(p.loaded));
    expect(tracks).toHaveLength(total);
    expect(calls).toEqual(['0:500:""', '500:500:""', '1000:500:""']);
    expect(progress).toEqual([500, 1000, 1203]);
    expect(tracks[0].id).toBe('navidrome:0');
  });

  it('si search3 no devuelve nada, recorre los álbumes', async () => {
    const c = clientWith(async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('search3.view')) return ok(sub({ searchResult3: {} }));
      if (u.pathname.endsWith('getAlbumList2.view')) {
        return ok(sub({ albumList2: { album: [{ id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }] } }));
      }
      const id = u.searchParams.get('id')!;
      // Navidrome puede devolver un objeto en vez de arreglo cuando hay una sola pista
      return ok(sub({ album: { id, name: id, song: id === 'a1' ? song('s1') : [song('s2'), song('s3')] } }));
    });
    const tracks = await c.getAllTracks();
    expect(tracks.map((t) => t.sourceId).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('mapea una pista de OpenSubsonic a Track', () => {
    const c = clientWith(async () => ok(sub()));
    const t = c.toTrack({
      id: '9',
      title: 'Aurora',
      artist: 'Luna Roja feat. Ana',
      displayAlbumArtist: 'Luna Roja',
      album: 'Noches',
      track: 3,
      discNumber: 2,
      year: 2024,
      duration: 201,
      bitRate: 4608,
      samplingRate: 96000,
      bitDepth: 24,
      suffix: 'flac',
      coverArt: 'al-7',
      isrc: ['USRC17607839'],
      musicBrainzId: 'mbid-1',
      replayGain: { trackGain: -7.5, albumGain: -6, trackPeak: 0.98 }
    });
    expect(t).toMatchObject({
      id: 'navidrome:9',
      source: 'navidrome',
      sourceId: '9',
      albumArtist: 'Luna Roja',
      trackNo: 3,
      discNo: 2,
      sampleRate: 96000,
      bitDepth: 24,
      format: 'FLAC',
      isrc: 'USRC17607839',
      mbid: 'mbid-1',
      replayGain: { trackGain: -7.5, albumGain: -6, trackPeak: 0.98 }
    });
    expect(t.coverUrl).toContain('/rest/getCoverArt.view');
  });

  it('hydrateCovers rehace la URL de portada desde coverId (la caché no guarda credenciales)', () => {
    const c = clientWith(async () => ok(sub()));
    const stored = { ...c.toTrack({ id: '1', title: 'x', coverArt: 'al-9' }), coverUrl: undefined };
    const [t] = c.hydrateCovers([stored]);
    expect(t.coverId).toBe('al-9');
    expect(new URL(t.coverUrl!).searchParams.get('id')).toBe('al-9');
    expect(c.hydrateCovers([{ ...stored, coverId: undefined }])[0].coverUrl).toBeUndefined();
  });

  it('un servidor sin bitDepth/samplingRate no inventa valores', () => {
    const c = clientWith(async () => ok(sub()));
    const t = c.toTrack({ id: '1', title: 'x', samplingRate: 0, bitDepth: 0 });
    expect(t.sampleRate).toBeUndefined();
    expect(t.bitDepth).toBeUndefined();
    expect(t.artist).toBe('Unknown Artist');
  });

  it('scrobble y star llaman al endpoint correcto', async () => {
    const paths: string[] = [];
    const c = clientWith(async (url) => {
      const u = new URL(url);
      paths.push(`${u.pathname.split('/').pop()}?submission=${u.searchParams.get('submission')}`);
      return ok(sub());
    });
    await c.scrobble('1', true, 1700000000000);
    await c.scrobble('1', false);
    await c.star('1');
    expect(paths).toEqual(['scrobble.view?submission=true', 'scrobble.view?submission=false', 'star.view?submission=null']);
  });
});


describe('NavidromeClient.getLyrics', () => {
  it('pide el id y elige la primera versión sincronizada con su offset', async () => {
    const c = clientWith(async (url) => {
      const u = new URL(url);
      expect(u.pathname).toBe('/rest/getLyricsBySongId.view');
      expect(u.searchParams.get('id')).toBe('tema & 1');
      return ok(sub({ lyricsList: { structuredLyrics: [
        { lang: 'en', synced: false, line: [{ value: 'Libre' }] },
        { lang: 'es', synced: true, offset: -250, line: [{ start: 3000, value: 'Dos' }, { start: 1000, value: 'Una' }] },
        { lang: 'fr', synced: true, line: [{ start: 0, value: 'Otra versión' }] }
      ] } }));
    });
    await expect(c.getLyrics('tema & 1')).resolves.toEqual({
      lang: 'es', synced: true,
      lines: [{ timeMs: 750, text: 'Una' }, { timeMs: 2750, text: 'Dos' }]
    });
  });

  it('elige la primera versión sin sincronía y conserva tiempos null', async () => {
    const c = clientWith(async () => ok(sub({ lyricsList: { structuredLyrics: [
      { lang: 'es', synced: false, offset: 100, line: [{ start: 50, value: 'Una' }, { value: 'Dos' }] },
      { lang: 'en', synced: false, line: [{ value: 'Otra' }] }
    ] } })));
    await expect(c.getLyrics('1')).resolves.toEqual({
      lang: 'es', synced: false, lines: [{ timeMs: null, text: 'Una' }, { timeMs: null, text: 'Dos' }]
    });
  });

  it('normaliza objetos individuales y no inventa tiempos ausentes', async () => {
    const c = clientWith(async () => ok(sub({ lyricsList: { structuredLyrics:
      { synced: true, offset: 200, line: { value: 'Sin marca' } }
    } })));
    await expect(c.getLyrics('1')).resolves.toEqual({ synced: true, lines: [{ timeMs: null, text: 'Sin marca' }] });
  });

  it.each([{}, { lyricsList: {} }, { lyricsList: { structuredLyrics: [] } },
    { lyricsList: { structuredLyrics: [{ synced: true, line: [] }] } }
  ])('devuelve null sin letras: %j', async (body) => {
    await expect(clientWith(async () => ok(sub(body))).getLyrics('1')).resolves.toBeNull();
  });

  it.each([0, 70])('devuelve null ante error de API %i', async (code) => {
    const c = clientWith(async () => ok(sub({ status: 'failed', error: { code, message: 'No disponible' } })));
    await expect(c.getLyrics('1')).resolves.toBeNull();
  });

  it('devuelve null ante HTTP 404', async () => {
    const c = clientWith(async () => ({ ok: false, status: 404, statusText: 'Not Found', text: '' }));
    await expect(c.getLyrics('1')).resolves.toBeNull();
  });

  it('propaga errores de red, autenticación y otros errores HTTP', async () => {
    await expect(clientWith(async () => { throw new Error('Sin red'); }).getLyrics('1')).rejects.toMatchObject({ kind: 'network' });
    await expect(clientWith(async () => ok(sub({ status: 'failed', error: { code: 40 } }))).getLyrics('1'))
      .rejects.toMatchObject({ kind: 'auth' });
    await expect(clientWith(async () => ({ ok: false, status: 500, statusText: 'Error', text: '' })).getLyrics('1'))
      .rejects.toMatchObject({ kind: 'http', code: 500 });
  });
});

describe('NavidromeClient: valoraciones, radio y playlists', () => {
  it('setRating limita 0–5 y toTrack expone género, valoración y reproducciones', async () => {
    const seen: URL[] = [];
    const c = clientWith(async (url) => {
      seen.push(new URL(url));
      return ok(sub());
    });
    await c.setRating('7', 9);
    expect(seen[0].pathname).toBe('/rest/setRating.view');
    expect(seen[0].searchParams.get('rating')).toBe('5');
    const t = c.toTrack(song('1', { genre: 'Jazz', userRating: 4, playCount: 12 }));
    expect([t.genre, t.rating, t.playCount]).toEqual(['Jazz', 4, 12]);
  });

  it('getRandomSongs y getSimilarSongs devuelven pistas (una sola o lista)', async () => {
    const c = clientWith(async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('getRandomSongs.view')) return ok(sub({ randomSongs: { song: [song('1'), song('2')] } }));
      expect(u.searchParams.get('id')).toBe('9');
      return ok(sub({ similarSongs2: { song: song('3') } }));
    });
    expect((await c.getRandomSongs(2)).map((t) => t.sourceId)).toEqual(['1', '2']);
    expect((await c.getSimilarSongs('9')).map((t) => t.sourceId)).toEqual(['3']);
  });

  it('getPlaylists añade la URL de portada autenticada solo a las que tienen coverArt', async () => {
    let seen: URL | null = null;
    const c = clientWith(async (url) => {
      seen = new URL(url);
      return ok(sub({ playlists: { playlist: [{ id: 'a', name: 'A', songCount: 3, coverArt: 'pl-a_1' }, { id: 'b', name: 'B', songCount: 0 }] } }));
    });
    const [a, b] = await c.getPlaylists();
    expect(seen!.pathname).toBe('/rest/getPlaylists.view');
    const cover = new URL(a.coverUrl!);
    expect(cover.pathname).toBe('/rest/getCoverArt.view');
    expect([cover.searchParams.get('id'), cover.searchParams.get('size')]).toEqual(['pl-a_1', '400']);
    expect(cover.searchParams.get('t')).toBeTruthy(); // token+sal, nunca la contraseña
    expect(cover.search).not.toContain('sesame');
    expect(b.coverUrl).toBeUndefined();
  });

  it('createPlaylist y updatePlaylist repiten el parámetro por cada pista', async () => {
    const seen: URL[] = [];
    const c = clientWith(async (url) => {
      seen.push(new URL(url));
      return ok(sub({ playlist: { id: 'p1' } }));
    });
    expect(await c.createPlaylist('Mi lista', ['a', 'b'])).toBe('p1');
    expect(seen[0].searchParams.getAll('songId')).toEqual(['a', 'b']);
    await c.addToPlaylist('p1', ['c', 'd']);
    expect(seen[1].searchParams.getAll('songIdToAdd')).toEqual(['c', 'd']);
    await c.removeFromPlaylist('p1', [0, 2]);
    expect(seen[2].searchParams.getAll('songIndexToRemove')).toEqual(['0', '2']);
    await c.addToPlaylist('p1', []);
    expect(seen).toHaveLength(3); // sin pistas no hay llamada
  });
});
