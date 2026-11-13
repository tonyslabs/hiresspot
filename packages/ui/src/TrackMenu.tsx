import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlaylistInfo, Track } from '@hiresspot/core';
import { useNavidrome } from './navidrome';
import { usePlayer } from './player';

// ---------------------------------------------------------------------------
// Avisos breves (toasts)
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
}
type Notify = (text: string) => void;
const ToastCtx = createContext<Notify>(() => {});
export const useToast = (): Notify => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Menú contextual de pista
// ---------------------------------------------------------------------------

interface MenuApi {
  open(track: Track, x: number, y: number): void;
}
const MenuCtx = createContext<MenuApi | null>(null);
/** null fuera del proveedor: las filas funcionan igual, sin menú. */
export const useTrackMenu = (): MenuApi | null => useContext(MenuCtx);

interface OpenState {
  track: Track;
  x: number;
  y: number;
}

const itemCls =
  'w-full text-left px-3 h-9 flex items-center justify-between gap-6 rounded-ctl text-callout hover:bg-fill-2 focus-visible:bg-fill-2 outline-none';

export const TrackMenuProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [menu, setMenu] = useState<OpenState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const notify = useCallback<Notify>((text) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const api = useMemo<MenuApi>(() => ({ open: (track, x, y) => setMenu({ track, x, y }) }), []);

  return (
    <ToastCtx.Provider value={notify}>
      <MenuCtx.Provider value={api}>
        {children}
        {menu ? <MenuView state={menu} onClose={() => setMenu(null)} notify={notify} /> : null}
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="glass-thick px-4 h-10 flex items-center text-callout" style={{ borderRadius: 999 }}>
              {t.text}
            </div>
          ))}
        </div>
      </MenuCtx.Provider>
    </ToastCtx.Provider>
  );
};

const MenuView: React.FC<{ state: OpenState; onClose(): void; notify: Notify }> = ({ state, onClose, notify }) => {
  const { track } = state;
  const player = usePlayer();
  const nd = useNavidrome();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const [view, setView] = useState<'main' | 'playlists'>('main');
  const [lists, setLists] = useState<PlaylistInfo[] | null>(null);
  const [newName, setNewName] = useState('');

  const isNd = track.source === 'navidrome' && nd.status !== 'disconnected' && nd.status !== 'error';
  const playable = track.source !== 'spotify';

  // Dentro de la ventana
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(state.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8))
    });
  }, [state.x, state.y, view, lists]);

  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  useEffect(() => {
    if (view !== 'playlists' || lists) return;
    nd.loadPlaylists()
      .then(setLists)
      .catch(() => {
        notify('No se pudieron cargar las playlists.');
        setView('main');
      });
  }, [view, lists, nd, notify]);

  const run = async (label: string, fn: () => Promise<void> | void) => {
    onClose();
    try {
      await fn();
      if (label) notify(label);
    } catch {
      notify('No se pudo completar la acción.');
    }
  };

  const radio = () =>
    run('', async () => {
      const similar = await nd.similarTo(track);
      if (similar.length === 0) return notify('El servidor no tiene pistas parecidas para esta.');
      player.setQueue([track, ...similar.filter((t) => t.id !== track.id)], 0);
      notify(`Radio de «${track.title}»: ${similar.length} pistas`);
    });

  return (
    <div
      ref={ref}
      role="menu"
      className="glass-thick fixed z-[80] p-1.5 min-w-[230px] max-w-[300px]"
      style={{ left: pos.x, top: pos.y, borderRadius: 16 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {view === 'main' ? (
        <>
          <div className="px-3 pt-1.5 pb-2 text-micro text-muted truncate uppercase">{track.title}</div>
          {playable ? (
            <>
              <button type="button" role="menuitem" className={itemCls} onClick={() => run('Se reproducirá a continuación', () => player.playNext([track]))}>
                Reproducir a continuación
              </button>
              <button type="button" role="menuitem" className={itemCls} onClick={() => run('Añadida a la cola', () => player.addToQueue([track]))}>
                Añadir a la cola
              </button>
            </>
          ) : null}
          {isNd ? (
            <>
              <button type="button" role="menuitem" className={itemCls} onClick={radio}>
                Iniciar radio
              </button>
              <button type="button" role="menuitem" className={itemCls} onClick={() => run(track.favorite ? 'Quitada de favoritos' : 'Añadida a favoritos', () => nd.toggleFavorite(track))}>
                {track.favorite ? 'Quitar de favoritos' : 'Marcar como favorita'}
              </button>
              <button type="button" role="menuitem" className={itemCls} onClick={() => setView('playlists')}>
                Añadir a una playlist <span aria-hidden>›</span>
              </button>
              <div className="px-3 pt-2 pb-1.5 flex items-center justify-between gap-2" role="group" aria-label="Valoración">
                <span className="text-callout text-muted">Valoración</span>
                <span className="flex">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
                      className={`w-6 h-7 text-[16px] leading-none ${n <= (track.rating ?? 0) ? 'text-accent' : 'text-muted hover:text-fg'}`}
                      onClick={() => run(n === track.rating ? 'Valoración quitada' : `Valorada con ${n}`, () => nd.setRating(track, n === track.rating ? 0 : n))}
                    >
                      ★
                    </button>
                  ))}
                </span>
              </div>
            </>
          ) : null}
          {!playable && !isNd ? <div className="px-3 py-2 text-callout text-muted">Spotify es solo de consulta: no entrega audio.</div> : null}
        </>
      ) : (
        <>
          <button type="button" className={`${itemCls} text-muted`} onClick={() => setView('main')}>
            <span aria-hidden>‹</span> Volver
          </button>
          <div className="max-h-[260px] overflow-auto">
            {lists === null ? <div className="px-3 py-2 text-callout text-muted">Cargando…</div> : null}
            {lists?.map((p) => (
              <button key={p.id} type="button" role="menuitem" className={itemCls} onClick={() => run(`Añadida a «${p.name}»`, () => nd.addToPlaylist(p.id, [track]))}>
                <span className="truncate">{p.name}</span>
                <span className="text-muted tabular-nums">{p.songCount}</span>
              </button>
            ))}
          </div>
          <form
            className="flex gap-1.5 p-1.5 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (name) void run(`Playlist «${name}» creada`, async () => void (await nd.createPlaylist(name, [track])));
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nueva playlist…"
              aria-label="Nombre de la nueva playlist"
              className="flex-1 min-w-0 h-9 px-3 rounded-ctl bg-fill-2 text-callout outline-none placeholder:text-muted"
            />
            <button type="submit" className="h-9 px-3 rounded-ctl bg-tint text-tint-fg text-callout" disabled={!newName.trim()}>
              Crear
            </button>
          </form>
        </>
      )}
    </div>
  );
};
