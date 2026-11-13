import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { groupAlbums, isHiRes, type AlbumGroup, type PlaylistInfo, type SourceKind, type Track } from '@hiresspot/core';
import { Cover, QualitySeal } from './components';
import { IconBack, IconForward, IconPlay } from './icons';
import { useLocal } from './local';
import { useNavidrome } from './navidrome';
import { useSpotify } from './spotify';
import { usePlatform } from './platform';
import { usePlayer } from './player';
import { useToast } from './TrackMenu';

interface Card {
  title: string;
  status: string;
  tone: 'ok' | 'warn' | 'off';
  detail: string;
  to: string;
  action: string;
  source?: 'local' | 'navidrome' | 'spotify';
}

const DOT = { ok: 'bg-ok', warn: 'bg-accent', off: 'bg-muted' } as const;
const enc = encodeURIComponent;

/** Álbum con la ruta de su biblioteca (para navegar al detalle). */
interface Entry {
  album: AlbumGroup;
  to: string;
}

const baseOf = (t: Track | undefined): string => (t?.source === 'navidrome' ? '/navidrome' : t?.source === 'spotify' ? '/spotify' : '/local');
const entryOf = (album: AlbumGroup): Entry => ({ album, to: `${baseOf(album.tracks[0])}/albums/${enc(album.albumKey)}/${enc(album.artistKey)}` });

const shuffled = <T,>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------------------------------------------------------------------------
// Carrusel horizontal con flechas
// ---------------------------------------------------------------------------

const Carousel: React.FC<{ title: string; onRefresh?: () => void; children: React.ReactNode }> = ({ title, onRefresh, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  const btn = 'w-8 h-8 max-md:w-10 max-md:h-10 grid place-items-center rounded-full bg-fill-2 hover:bg-fill-3 text-fg-2 hover:text-fg';
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-title-2 font-semibold">{title}</h3>
        <div className="flex items-center gap-1.5">
          {onRefresh ? (
            <button type="button" onClick={onRefresh} className="h-8 px-3 rounded-full bg-fill-2 hover:bg-fill-3 text-callout text-fg-2 hover:text-fg">
              Otros
            </button>
          ) : null}
          <button type="button" aria-label="Anterior" className={btn} onClick={() => scroll(-1)}>
            <IconBack size={16} />
          </button>
          <button type="button" aria-label="Siguiente" className={btn} onClick={() => scroll(1)}>
            <IconForward size={16} />
          </button>
        </div>
      </div>
      <div ref={ref} className="flex gap-5 overflow-x-auto snap-x pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </section>
  );
};

const AlbumCard: React.FC<{ entry: Entry; subtitle?: string }> = ({ entry, subtitle }) => {
  const player = usePlayer();
  const { album } = entry;
  return (
    <div className="group relative snap-start shrink-0 w-[168px]" style={{ contentVisibility: 'auto', containIntrinsicSize: '168px 228px' }}>
      <Link to={entry.to} className="block">
        <Cover
          src={album.coverUrl}
          seed={album.album}
          className="aspect-square w-full rounded-card shadow-cover transition-all duration-[var(--dur-2)] ease-glide group-hover:-translate-y-1 group-hover:shadow-lift"
        />
        <div className="mt-3">
          <div className="text-headline truncate" title={album.album}>{album.album}</div>
          <div className="text-callout text-muted truncate" title={subtitle ?? album.artist}>{subtitle ?? album.artist}</div>
        </div>
      </Link>
      {album.tracks[0]?.source === 'spotify' ? null : <button
        type="button"
        aria-label={`Reproducir ${album.album}`}
        title="Reproducir"
        onClick={() => player.setQueue(album.tracks, 0)}
        className="absolute right-2 top-[calc(168px-3rem)] w-10 h-10 rounded-full bg-tint text-tint-fg grid place-items-center shadow-lift opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <IconPlay size={16} />
      </button>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Banner destacado
// ---------------------------------------------------------------------------

const Feature: React.FC<{ entries: Entry[] }> = ({ entries }) => {
  const player = usePlayer();
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [entries]);
  const e = entries[i];
  if (!e) return null;
  const { album } = e;
  const best = album.tracks.find(isHiRes) ?? album.tracks[0];
  const go = (d: number) => setI((n) => (n + d + entries.length) % entries.length);
  return (
    <section className="relative overflow-hidden rounded-island min-h-[260px] flex items-end bg-fill-1" style={{ borderRadius: 28 }}>
      {album.coverUrl ? (
        <img src={album.coverUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-50 pointer-events-none" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-black/45 via-black/10 to-transparent pointer-events-none" />
      <div className="relative flex items-center gap-6 p-6 w-full max-md:flex-col max-md:items-start max-md:gap-4 max-md:p-5">
        <Cover src={album.coverUrl} seed={album.album} className="w-[180px] h-[180px] max-md:w-[132px] max-md:h-[132px] shrink-0 rounded-card shadow-lift" />
        <div className="min-w-0 flex-1">
          <div className="text-micro uppercase text-fg-2 mb-1">Para descubrir</div>
          <Link to={e.to} className="block text-title-1 font-semibold truncate hover:underline" title={album.album}>{album.album}</Link>
          <div className="text-body text-fg-2 truncate">{album.artist}</div>
          <div className="flex items-center gap-3 mt-3 text-callout text-fg-2">
            {best ? <QualitySeal track={best} /> : null}
            <span className="tabular-nums">{album.tracks.length} pista(s)</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            {album.tracks[0]?.source === 'spotify' ? null : (
              <button type="button" onClick={() => player.setQueue(album.tracks, 0)} className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-tint text-tint-fg font-semibold hover:opacity-90">
                <IconPlay size={16} /> Reproducir
              </button>
            )}
            <Link to={e.to} className="inline-flex items-center h-10 px-5 rounded-full bg-fill-2 hover:bg-fill-3 font-medium">Ver álbum</Link>
          </div>
        </div>
        {entries.length > 1 ? (
          <div className="absolute right-5 top-0 max-md:right-4 max-md:top-4 flex items-center gap-1.5">
            <button type="button" aria-label="Anterior" onClick={() => go(-1)} className="w-8 h-8 max-md:w-10 max-md:h-10 grid place-items-center rounded-full bg-fill-2 hover:bg-fill-3"><IconBack size={16} /></button>
            <button type="button" aria-label="Siguiente" onClick={() => go(1)} className="w-8 h-8 max-md:w-10 max-md:h-10 grid place-items-center rounded-full bg-fill-2 hover:bg-fill-3"><IconForward size={16} /></button>
          </div>
        ) : null}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

const ROW = 18;

export const Home: React.FC<{ cards: Card[] }> = ({ cards }) => {
  const nd = useNavidrome();
  const sp = useSpotify();
  const local = useLocal();
  const platform = usePlatform();
  const player = usePlayer();
  const navigate = useNavigate();
  const toast = useToast();
  const [seed, setSeed] = useState(0); // "Otros" / refrescar
  const [only, setOnly] = useState<SourceKind | null>(null); // fuente elegida: el Inicio muestra solo sus datos
  const [history, setHistory] = useState<string[]>([]);
  const [lists, setLists] = useState<PlaylistInfo[]>([]);

  const playable = useMemo(() => {
    if (only === 'local') return local.tracks;
    if (only === 'navidrome') return nd.tracks;
    if (only === 'spotify') return sp.tracks;
    return [...local.tracks, ...nd.tracks];
  }, [only, local.tracks, nd.tracks, sp.tracks]);
  const albums = useMemo(() => groupAlbums(playable), [playable]);

  useEffect(() => {
    platform.settings.get<string[]>('history').then((h) => Array.isArray(h) && setHistory(h)).catch(() => {});
  }, [platform]);

  useEffect(() => {
    if (nd.status !== 'ready') return;
    let off = false;
    nd.loadPlaylists().then((l) => !off && setLists(l)).catch(() => {});
    return () => {
      off = true;
    };
  }, [nd.status, nd.loadPlaylists]);

  const random = useMemo(() => shuffled(albums).slice(0, ROW), [albums, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const featured = useMemo(() => shuffled(albums.filter((a) => a.coverUrl)).slice(0, 6), [albums]);

  const recent = useMemo(() => {
    const byTrack = new Map(playable.map((t) => [t.id, t]));
    const seen = new Set<string>();
    const out: AlbumGroup[] = [];
    const byKey = new Map(albums.map((a) => [a.key, a]));
    for (const id of history) {
      const t = byTrack.get(id);
      if (!t) continue;
      const a = albums.find((x) => x.tracks.some((tt) => tt.id === t.id));
      if (a && !seen.has(a.key) && byKey.has(a.key)) {
        seen.add(a.key);
        out.push(a);
      }
    }
    return out.slice(0, ROW);
  }, [history, playable, albums]);

  const mostPlayed = useMemo(
    () =>
      albums
        .map((a) => ({ a, n: a.tracks.reduce((s, t) => s + (t.playCount ?? 0), 0) }))
        .filter((x) => x.n > 0)
        .sort((x, y) => y.n - x.n)
        .slice(0, ROW),
    [albums]
  );
  const released = useMemo(
    () =>
      albums
        .map((a) => ({ a, y: Math.max(0, ...a.tracks.map((t) => t.year ?? 0)) }))
        .filter((x) => x.y > 0)
        .sort((x, y) => y.y - x.y)
        .slice(0, ROW),
    [albums]
  );
  const hires = useMemo(() => shuffled(albums.filter((a) => a.tracks.some(isHiRes))).slice(0, ROW), [albums, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const rated = useMemo(
    () =>
      albums
        .map((a) => {
          const r = a.tracks.filter((t) => (t.rating ?? 0) > 0);
          return { a, avg: r.length ? r.reduce((s, t) => s + (t.rating ?? 0), 0) / r.length : 0 };
        })
        .filter((x) => x.avg >= 4)
        .sort((x, y) => y.avg - x.avg)
        .slice(0, ROW),
    [albums]
  );
  const genres = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of nd.tracks) if (t.genre) m.set(t.genre, (m.get(t.genre) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [nd.tracks]);

  const mix = useCallback(() => {
    nd.randomMix(50)
      .then((l) => (l.length ? player.setQueue(l, 0) : toast('El servidor no devolvió pistas.')))
      .catch(() => toast('No se pudo crear la mezcla.'));
  }, [nd, player, toast]);

  const empty = albums.length === 0 && !only;
  const showNd = !only || only === 'navidrome';
  const pill = 'inline-flex items-center h-9 px-4 rounded-full bg-fill-2 hover:bg-fill-3 text-callout';

  return (
    <div className="page">
      <div className="flex flex-col gap-9">
        {empty ? (
          <div>
            <h2 className="text-title-1 font-semibold mb-1">Bienvenido</h2>
            <p className="text-callout text-muted">Conecta una fuente para ver aquí tu música: escucha en alta fidelidad y compara tus bibliotecas.</p>
          </div>
        ) : (
          <Feature entries={featured.map(entryOf)} />
        )}

        {!empty ? (
          <div className="flex flex-wrap items-center gap-2">
            {nd.status === 'ready' && showNd ? (
              <button type="button" className={`${pill} bg-tint text-tint-fg hover:opacity-90 font-semibold`} onClick={mix}>
                Mezcla aleatoria
              </button>
            ) : null}
            <button type="button" className={pill} onClick={() => navigate('/compare')}>Comparar bibliotecas</button>
            {cards.map((c) => {
              const kind = c.source;
              const on = !!kind && only === kind;
              return (
                <button
                  key={c.title}
                  type="button"
                  aria-pressed={on}
                  onClick={() => kind && setOnly(on ? null : kind)}
                  className={`${pill} gap-2 ${on ? 'ring-2 ring-tint bg-tint-soft' : ''}`}
                  title={`${c.title}: ${c.detail}`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${DOT[c.tone]}`} />
                  {c.title}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cards.map((c) => (
              <Link key={c.title} to={c.to} className="block rounded-panel p-5 min-h-[200px] relative overflow-hidden bg-fill-1 hover:bg-fill-2 transition-colors">
                {c.source && (
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'radial-gradient(60% 80% at 100% 0%, color-mix(in oklab, var(--src-' + c.source + ') 28%, transparent), transparent)' }}
                  />
                )}
                <div className="relative">
                  <div className="flex items-center gap-2 text-caption text-fg-2">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[c.tone]}`} /> {c.status}
                  </div>
                  <div className="text-title-2 font-semibold mt-2">{c.title}</div>
                  <div className="text-callout text-muted mt-1">{c.detail}</div>
                  <div className="inline-flex items-center h-8 px-3.5 rounded-full bg-fill-2 text-callout font-semibold text-fg mt-4">{c.action} →</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {only ? (() => {
          const c = cards.find((x) => x.source === only);
          return c ? (
            <div className="rounded-panel bg-fill-1 p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-caption text-fg-2">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[c.tone]}`} /> {c.status}
                </div>
                <div className="text-title-2 font-semibold mt-1">{c.title}</div>
                <div className="text-callout text-muted">{c.detail}</div>
              </div>
              <Link to={c.to} className="inline-flex items-center h-9 px-4 rounded-full bg-fill-2 hover:bg-fill-3 text-callout font-semibold">{c.action} →</Link>
            </div>
          ) : null;
        })() : null}
        {only && albums.length === 0 ? <p className="text-callout text-muted">Esta fuente aún no tiene música para mostrar.</p> : null}

        {recent.length > 0 ? (
          <Carousel title="Escuchado recientemente">
            {recent.map((a) => <AlbumCard key={a.key} entry={entryOf(a)} />)}
          </Carousel>
        ) : null}
        {random.length > 0 ? (
          <Carousel title="Explorar" onRefresh={() => setSeed((s) => s + 1)}>
            {random.map((a) => <AlbumCard key={a.key} entry={entryOf(a)} />)}
          </Carousel>
        ) : null}
        {mostPlayed.length > 0 ? (
          <Carousel title="Más escuchados">
            {mostPlayed.map(({ a, n }) => <AlbumCard key={a.key} entry={entryOf(a)} subtitle={`${a.artist} · ${n} reproducciones`} />)}
          </Carousel>
        ) : null}
        {released.length > 0 ? (
          <Carousel title="Lanzamientos recientes">
            {released.map(({ a, y }) => <AlbumCard key={a.key} entry={entryOf(a)} subtitle={`${a.artist} · ${y}`} />)}
          </Carousel>
        ) : null}
        {hires.length > 0 ? (
          <Carousel title="En alta resolución" onRefresh={() => setSeed((s) => s + 1)}>
            {hires.map((a) => <AlbumCard key={a.key} entry={entryOf(a)} />)}
          </Carousel>
        ) : null}
        {rated.length > 0 ? (
          <Carousel title="Mejor valorados">
            {rated.map(({ a }) => <AlbumCard key={a.key} entry={entryOf(a)} />)}
          </Carousel>
        ) : null}
        {lists.length > 0 && showNd ? (
          <Carousel title="Playlists">
            {lists.map((p) => (
              <Link key={p.id} to="/navidrome-playlists" className="snap-start shrink-0 w-[168px]">
                <Cover seed={p.name} className="aspect-square w-full rounded-card shadow-cover" />
                <div className="mt-3 text-headline truncate" title={p.name}>{p.name}</div>
                <div className="text-callout text-muted">{p.songCount} pista(s)</div>
              </Link>
            ))}
          </Carousel>
        ) : null}
        {genres.length > 0 && showNd ? (
          <section>
            <h3 className="text-title-2 font-semibold mb-3">Géneros</h3>
            <div className="flex flex-wrap gap-2">
              {genres.map(([g, n]) => (
                <Link key={g} to={`/navidrome/genres/${enc(g)}`} className="h-10 px-4 rounded-full bg-fill-1 hover:bg-fill-2 inline-flex items-center gap-2 text-callout">
                  {g} <span className="text-muted tabular-nums">{n}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};
