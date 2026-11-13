import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildSearchIndex, groupAlbums, search, type SearchSource, type SourceKind } from '@hiresspot/core';
import { Cover, SourceChip } from './components';
import { IconSearch } from './icons';
import { usePlayer } from './player';
import { useTheme } from './theme';

const ORDER: SourceKind[] = ['navidrome', 'local', 'spotify'];
const BASE: Record<SourceKind, string> = { navidrome: '/navidrome', local: '/local', spotify: '/spotify' };
const best = (sources: SourceKind[]): SourceKind => ORDER.find((s) => sources.includes(s)) ?? sources[0];
const enc = encodeURIComponent;

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  cover?: string;
  sources?: SourceKind[];
  run: () => void;
}

/** Paleta Ctrl+K: búsqueda global en las tres fuentes y acciones rápidas. Vidrio grueso, sin fondo difuminado detrás. */
export const CommandPalette: React.FC<{ sources: SearchSource[]; onClose: () => void }> = ({ sources, onClose }) => {
  const navigate = useNavigate();
  const player = usePlayer();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // El índice normaliza las pistas una sola vez; solo se rehace si cambian las bibliotecas
  const index = useMemo(() => buildSearchIndex(sources), [sources]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 80);
    return () => clearTimeout(t);
  }, [query]);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const q = debounced.trim();
    if (q) {
      const r = search(index, q, 8);
      for (const h of r.tracks) {
        const playable = best(h.sources) !== 'spotify';
        out.push({
          id: `t:${h.track.id}`,
          group: 'Pistas',
          title: h.track.title,
          subtitle: `${h.track.artist} · ${h.track.album}`,
          cover: h.track.coverUrl,
          sources: h.sources,
          run: () => {
            if (playable) {
              const rep = h.tracks.find((t) => t.source === best(h.sources)) ?? h.track;
              player.setQueue([rep], 0);
              onClose();
            } else {
              const g = groupAlbums(h.tracks.filter((t) => t.source === 'spotify'))[0];
              go(g ? `/spotify/albums/${enc(g.albumKey)}/${enc(g.artistKey)}` : '/spotify/tracks');
            }
          }
        });
      }
      for (const h of r.albums) {
        out.push({
          id: `a:${h.key}`,
          group: 'Álbumes',
          title: h.album,
          subtitle: `${h.artist} · ${h.trackCount} pistas`,
          cover: h.coverUrl,
          sources: h.sources,
          run: () => {
            const src = best(h.sources);
            const g = groupAlbums(h.tracks.filter((t) => t.source === src))[0];
            go(g ? `${BASE[src]}/albums/${enc(g.albumKey)}/${enc(g.artistKey)}` : `${BASE[src]}/albums`);
          }
        });
      }
      for (const h of r.artists) {
        out.push({
          id: `r:${h.key}`,
          group: 'Artistas',
          title: h.artist,
          subtitle: `${h.trackCount} pistas`,
          cover: h.coverUrl,
          sources: h.sources,
          run: () => go(`${BASE[best(h.sources)]}/artists/${enc(h.key)}`)
        });
      }
    }
    const actions: Item[] = [
      { id: 'x:home', group: 'Acciones', title: 'Ir a Inicio', run: () => go('/') },
      { id: 'x:compare', group: 'Acciones', title: 'Comparar bibliotecas', run: () => go('/compare') },
      { id: 'x:settings', group: 'Acciones', title: 'Abrir Ajustes', run: () => go('/settings') },
      { id: 'x:toggle', group: 'Acciones', title: 'Reproducir / Pausar', run: () => { player.toggle(); onClose(); } },
      { id: 'x:theme', group: 'Acciones', title: `Cambiar tema (ahora: ${theme === 'system' ? 'sistema' : theme === 'dark' ? 'oscuro' : 'claro'})`, run: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); onClose(); } }
    ];
    const needle = q.toLowerCase();
    return [...out, ...actions.filter((a) => !needle || a.title.toLowerCase().includes(needle))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, index, theme]);

  useEffect(() => setCursor(0), [items.length, debounced]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') setCursor((c) => Math.min(items.length - 1, c + 1));
    else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
    else if (e.key === 'Enter') items[cursor]?.run();
    else return;
    e.preventDefault();
  };

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[70] bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Búsqueda global"
        onKeyDown={onKey}
        className="glass-thick absolute left-1/2 -translate-x-1/2 flex flex-col overflow-hidden"
        style={{ top: '14vh', width: 'min(640px, calc(100vw - 48px))', maxHeight: 'min(520px, 70vh)' }}
      >
        <div className="flex items-center gap-3 px-5 h-[60px] shrink-0 border-b border-line-soft">
          <IconSearch size={20} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pistas, álbumes, artistas…"
            aria-label="Buscar"
            className="flex-1 bg-transparent outline-none focus-visible:outline-none text-title-2 placeholder:text-muted"
          />
          <kbd className="text-micro font-mono text-fg-2 bg-fill-2 rounded-chip px-1.5 py-1">Esc</kbd>
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-auto p-2" role="listbox">
          {items.length === 0 ? <p className="p-4 text-callout text-fg-2">Sin resultados.</p> : null}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <React.Fragment key={it.id}>
                {header ? <div className="px-3 pt-3 pb-1 text-micro uppercase text-fg-2">{header}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-idx={i}
                  onMouseMove={() => setCursor(i)}
                  onClick={it.run}
                  className={`w-full flex items-center gap-3 px-3 h-12 rounded-ctl text-left transition-colors duration-[var(--dur-1)] ${i === cursor ? 'bg-tint-soft' : ''}`}
                >
                  {it.group === 'Acciones' ? (
                    <span className="w-9 h-9 rounded-lg bg-fill-2 grid place-items-center text-fg-2"><IconSearch size={16} /></span>
                  ) : (
                    <Cover src={it.cover} seed={it.title} className={`w-9 h-9 ${it.group === 'Artistas' ? 'rounded-full' : 'rounded-lg'}`} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-callout font-medium truncate">{it.title}</span>
                    {it.subtitle ? <span className="block text-caption text-fg-2 truncate">{it.subtitle}</span> : null}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {(it.sources ?? []).map((s) => (
                      <SourceChip key={s} source={s} dot />
                    ))}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};
