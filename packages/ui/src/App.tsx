import React, { useEffect, useMemo, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Ambient } from './ambient';
import { NowPlayingBar, SourceChip } from './components';
import { CommandPalette } from './CommandPalette';
import { CompareView } from './CompareView';
import { GlassDefs } from './glass';
import { Home } from './Home';
import { IconBack, IconCompare, IconFolder, IconForward, IconHome, IconSearch, IconServer, IconSettings, IconWaves } from './icons';
import { LibraryBrowser } from './LibraryBrowser';
import { LocalLibraryProvider, useLocal } from './local';
import { NavidromeConnect } from './NavidromeConnect';
import { usePlatform } from './platform';
import { NavidromeProvider, useNavidrome } from './navidrome';
import { NowPlaying } from './NowPlaying';
import { NavidromePlaylists } from './PlaylistPages';
import { HistoryBridge, HotkeysBridge, PlayerProvider, PowerBridge, QueuePersistence, ScrobbleBridge, usePlayer, usePlayerStatus } from './player';
import { Settings } from './Settings';
import { SpotifyProvider, useSpotify } from './spotify';
import { SpotifyArtists, SpotifyConnect, SpotifyPlaylists } from './SpotifyPages';
import { ThemeProvider } from './theme';
import { TrackMenuProvider } from './TrackMenu';
import { useIsMobile } from './useMediaQuery';

// ---------------------------------------------------------------------------
// Shell "Cristal de Estudio": lienzo ambiental a sangre + tres islas de vidrio flotantes
// (sidebar, cabecera, dock). El contenido hace scroll por debajo del cromo.
// ---------------------------------------------------------------------------

const dotColor = (status: string) =>
  status === 'ready' ? 'bg-ok' : status === 'error' ? 'bg-danger' : status === 'disconnected' ? 'bg-muted' : 'bg-accent animate-pulse';

const NavItem: React.FC<{ to: string; icon: React.ReactNode; children: React.ReactNode; match?: string[]; sourceColor?: string; status?: string; statusTo?: string }> = ({
  to,
  icon,
  children,
  match,
  sourceColor,
  status,
  statusTo
}) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = match ? match.some((m) => pathname.startsWith(m)) : pathname === to;
  return (
    <div className="relative">
      <NavLink
        to={to}
        aria-current={active ? 'page' : undefined}
        title={typeof children === 'string' ? children : undefined}
        className={`h-9 px-3 rounded-ctl flex items-center gap-3 text-callout transition-colors duration-[var(--dur-1)] ${
          active ? 'bg-fill-2 text-fg font-semibold' : 'text-fg-2 hover:bg-fill-1 hover:text-fg'
        }`}
      >
        {active ? <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full" style={{ background: sourceColor ?? 'var(--tint)' }} /> : null}
        <span className="shrink-0" style={{ color: active && sourceColor ? sourceColor : undefined }}>{icon}</span>
        <span className="hidden min-[1080px]:inline truncate">{children}</span>
      </NavLink>
      {status ? (
        <button
          type="button"
          onClick={() => navigate(statusTo ?? to)}
          aria-label={`Estado: ${status}`}
          title={`Estado: ${status}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 hidden min-[1080px]:block"
        >
          <span className={`block w-2 h-2 rounded-full ${dotColor(status)}`} />
        </button>
      ) : null}
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-4 mb-1 px-3 text-micro uppercase text-muted hidden min-[1080px]:block">{children}</div>
);

const Sidebar: React.FC = () => {
  const localSupported = usePlatform().library.supported !== false;
  const nd = useNavidrome();
  const sp = useSpotify();
  const local = useLocal();
  const ndHasLibrary = nd.tracks.length > 0;
  const spHasLibrary = sp.tracks.length > 0;
  return (
    <aside className="glass-regular fixed top-3 bottom-3 left-3 z-30 flex flex-col p-3 gap-0.5 max-md:hidden" style={{ width: 'var(--sidebar-w)' }}>
      <div className="flex items-center gap-2 px-3 py-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
        <span className="text-headline font-bold hidden min-[1080px]:inline">HiResSpot</span>
      </div>
      <NavItem to="/" icon={<IconHome size={18} />}>Inicio</NavItem>

      <SectionLabel>Bibliotecas</SectionLabel>
      {localSupported ? <NavItem to="/local/albums" match={['/local']} icon={<IconFolder size={18} />} sourceColor="var(--src-local)">Local</NavItem> : null}
      <NavItem
        to={ndHasLibrary ? '/navidrome/albums' : '/connect'}
        match={['/navidrome', '/connect']}
        icon={<IconServer size={18} />}
        sourceColor="var(--src-navidrome)"
        status={nd.status}
        statusTo="/connect"
      >
        Navidrome
      </NavItem>
      <NavItem
        to={spHasLibrary ? '/spotify/albums' : '/spotify-connect'}
        match={['/spotify']}
        icon={<IconWaves size={18} />}
        sourceColor="var(--src-spotify)"
        status={sp.status}
        statusTo="/spotify-connect"
      >
        Spotify
      </NavItem>

      <SectionLabel>Herramientas</SectionLabel>
      <NavItem to="/compare" icon={<IconCompare size={18} />}>Comparar</NavItem>

      <div className="mt-auto pt-2">
        {local.tracks.length === 0 ? null : null}
        <NavItem to="/settings" icon={<IconSettings size={18} />}>Ajustes</NavItem>
      </div>
    </aside>
  );
};

interface Tab {
  to: string;
  label: string;
}

/** Pestañas de la biblioteca en la que estás (las rutas de siempre, solo cambia dónde se navegan). */
const useLibraryTabs = (): Tab[] => {
  const { pathname } = useLocation();
  if (pathname.startsWith('/local')) {
    return [
      { to: '/local/albums', label: 'Álbumes' },
      { to: '/local/artists', label: 'Artistas' },
      { to: '/local/tracks', label: 'Pistas' },
      { to: '/local/genres', label: 'Géneros' }
    ];
  }
  if (pathname.startsWith('/navidrome')) {
    return [
      { to: '/navidrome/albums', label: 'Álbumes' },
      { to: '/navidrome/artists', label: 'Artistas' },
      { to: '/navidrome/tracks', label: 'Pistas' },
      { to: '/navidrome/genres', label: 'Géneros' },
      { to: '/navidrome/favorites', label: 'Favoritas' },
      { to: '/navidrome-playlists', label: 'Playlists' }
    ];
  }
  if (pathname.startsWith('/spotify') && pathname !== '/spotify-connect') {
    return [
      { to: '/spotify/albums', label: 'Álbumes' },
      { to: '/spotify/artists', label: 'Artistas' },
      { to: '/spotify/tracks', label: 'Pistas' },
      { to: '/spotify/favorites', label: 'Me gusta' },
      { to: '/spotify-playlists', label: 'Playlists' },
      { to: '/spotify-artists', label: 'Seguidos' }
    ];
  }
  return [];
};

/** Navegación principal del teléfono: reemplaza a la barra lateral. */
const BottomNav: React.FC = () => {
  const localSupported = usePlatform().library.supported !== false;
  const { pathname } = useLocation();
  const nd = useNavidrome();
  const sp = useSpotify();
  const items: { to: string; label: string; icon: React.ReactNode; match?: string[]; color?: string }[] = [
    { to: '/', label: 'Inicio', icon: <IconHome size={22} /> },
    ...(localSupported ? [{ to: '/local/albums', label: 'Local', icon: <IconFolder size={22} />, match: ['/local'], color: 'var(--src-local)' }] : []),
    { to: nd.tracks.length > 0 ? '/navidrome/albums' : '/connect', label: 'Navidrome', icon: <IconServer size={22} />, match: ['/navidrome', '/connect'], color: 'var(--src-navidrome)' },
    { to: sp.tracks.length > 0 ? '/spotify/albums' : '/spotify-connect', label: 'Spotify', icon: <IconWaves size={22} />, match: ['/spotify'], color: 'var(--src-spotify)' },
    { to: '/compare', label: 'Comparar', icon: <IconCompare size={22} /> },
    { to: '/settings', label: 'Ajustes', icon: <IconSettings size={22} /> }
  ];
  return (
    <nav
      aria-label="Principal"
      className="md:hidden glass-regular fixed z-30 grid items-stretch gap-0.5 p-1"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, left: 'var(--gutter)', right: 'var(--gutter)', bottom: 'calc(var(--safe-bottom) + var(--gutter))', height: 'var(--nav-h)', borderRadius: 26 }}
    >
      {items.map((it) => {
        const active = it.match ? it.match.some((m) => pathname.startsWith(m)) : pathname === it.to;
        return (
          <NavLink
            key={it.to + it.label}
            to={it.to}
            aria-current={active ? 'page' : undefined}
            className={`min-w-0 rounded-[22px] flex flex-col items-center justify-center gap-0.5 transition-colors duration-[var(--dur-1)] ${active ? 'bg-fill-2 text-fg' : 'text-fg-2'}`}
          >
            <span style={{ color: active ? (it.color ?? 'var(--tint)') : undefined }}>{it.icon}</span>
            <span className={`text-[10.5px] leading-3 truncate max-w-full px-0.5 ${active ? 'font-semibold' : ''}`}>{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
};

const HeaderBar: React.FC<{ onSearch: () => void }> = ({ onSearch }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tabs = useLibraryTabs();
  return (
    <header className="glass-thin fixed right-3 z-30 h-12 flex items-center gap-3 px-3" style={{ top: 'calc(var(--safe-top) + 12px)', left: 'var(--chrome-left)' }}>
      <div className="flex items-center gap-1 max-md:hidden">
        <button type="button" aria-label="Atrás" title="Atrás" onClick={() => navigate(-1)} className="grid place-items-center w-8 h-8 rounded-full hover:bg-fill-2">
          <IconBack size={18} />
        </button>
        <button type="button" aria-label="Adelante" title="Adelante" onClick={() => navigate(1)} className="grid place-items-center w-8 h-8 rounded-full hover:bg-fill-2">
          <IconForward size={18} />
        </button>
      </div>

      {tabs.length > 0 ? (
        <nav role="tablist" aria-label="Biblioteca" className="flex items-center gap-0.5 bg-fill-1 rounded-full p-0.5 mx-auto max-md:mx-0 max-md:flex-1 max-md:min-w-0 max-md:overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const active = pathname === t.to || (t.to.endsWith('/albums') && pathname.startsWith(t.to.replace('/albums', '/albums/'))) || (t.to.endsWith('/artists') && pathname.startsWith(t.to.replace('/artists', '/artists/')));
            return (
              <NavLink
                key={t.to}
                to={t.to}
                role="tab"
                aria-selected={active}
                className={`h-8 max-md:h-10 px-3.5 rounded-full text-callout grid place-items-center shrink-0 transition-colors duration-[var(--dur-1)] ${
                  active ? 'bg-fill-3 text-fg font-semibold shadow-[inset_0_1px_0_var(--glass-hi)]' : 'text-fg-2 hover:text-fg'
                }`}
              >
                {t.label}
              </NavLink>
            );
          })}
        </nav>
      ) : (
        <>
          <span className="md:hidden flex-1 min-w-0 pl-1 text-headline font-bold truncate">HiResSpot</span>
          <div className="mx-auto max-md:hidden" />
        </>
      )}

      <button
        type="button"
        onClick={onSearch}
        aria-label="Buscar en todo (Ctrl K)"
        className="flex items-center gap-2 h-8 max-md:h-10 max-md:w-10 max-md:justify-center min-[1080px]:w-56 px-3 max-md:px-0 rounded-full bg-fill-1 hover:bg-fill-2 transition-colors text-callout text-fg-2"
      >
        <IconSearch size={16} />
        <span className="flex-1 text-left hidden min-[1080px]:inline">Buscar en todo</span>
        <kbd className="text-micro font-mono opacity-70 hidden min-[1080px]:inline">Ctrl K</kbd>
      </button>
    </header>
  );
};

const Shell: React.FC = () => {
  const player = usePlayer();
  const status = usePlayerStatus();
  const nd = useNavidrome();
  const sp = useSpotify();
  const local = useLocal();
  const navigate = useNavigate();
  const [nowOpen, setNowOpen] = useState(false);
  const mobile = useIsMobile();
  const localSupported = usePlatform().library.supported !== false;
  const [searchOpen, setSearchOpen] = useState(false);

  // Espacio = play/pausa (sin robarlo al buscador, formularios ni botones enfocados)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || el?.getAttribute('role') === 'slider') return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  // Ctrl/Cmd+K abre la búsqueda global desde cualquier pantalla
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searchSources = useMemo(
    () => [
      { id: 'local' as const, tracks: local.tracks },
      { id: 'navidrome' as const, tracks: nd.tracks },
      { id: 'spotify' as const, tracks: sp.tracks }
    ],
    [local.tracks, nd.tracks, sp.tracks]
  );

  const compareSources = useMemo(
    () => [
      { id: 'local', label: 'Local', tracks: local.tracks },
      { id: 'navidrome', label: 'Navidrome', tracks: nd.tracks },
      { id: 'spotify', label: 'Spotify', tracks: sp.tracks }
    ],
    [local.tracks, nd.tracks, sp.tracks]
  );

  // Ventana sin foco: se pausan las animaciones continuas del ambiente
  useEffect(() => {
    const root = document.documentElement;
    const idle = () => root.setAttribute('data-idle', '');
    const active = () => root.removeAttribute('data-idle');
    window.addEventListener('blur', idle);
    window.addEventListener('focus', active);
    return () => {
      window.removeEventListener('blur', idle);
      window.removeEventListener('focus', active);
    };
  }, []);

  // El ecualizador decorativo solo se mueve mientras suena
  useEffect(() => {
    const root = document.documentElement;
    if (status === 'playing') root.setAttribute('data-playing', '');
    else root.removeAttribute('data-playing');
  }, [status]);

  const ndHasLibrary = nd.tracks.length > 0;
  const spHasLibrary = sp.tracks.length > 0;

  const tone = (t: 'ok' | 'off' | 'warn'): 'ok' | 'off' | 'warn' => t;
  const homeCards: React.ComponentProps<typeof Home>['cards'] = [
                  ...(localSupported ? [{
                    title: 'Música local',
                    status: local.roots.length > 0 ? `${local.roots.length} carpeta(s)` : 'Sin carpetas',
                    tone: tone(local.tracks.length > 0 ? 'ok' : 'off'),
                    detail: local.tracks.length > 0 ? `${local.tracks.length} pistas FLAC/WAV` : 'Agrega una carpeta desde Ajustes para empezar.',
                    to: local.tracks.length > 0 ? '/local/albums' : '/settings',
                    action: local.tracks.length > 0 ? 'Explorar' : 'Agregar carpeta',
                    source: 'local' as const
                  }] : []),
                  {
                    title: 'Navidrome',
                    status: nd.status === 'ready' ? 'Conectado' : ndHasLibrary ? 'Biblioteca guardada' : 'Sin conexión',
                    tone: tone(nd.status === 'ready' ? 'ok' : nd.status === 'disconnected' ? 'off' : 'warn'),
                    detail: ndHasLibrary ? `${nd.tracks.length} pistas${nd.saved ? ` · ${nd.saved.username}` : ''}` : 'Conecta tu servidor para escuchar en calidad original.',
                    to: ndHasLibrary ? '/navidrome/albums' : '/connect',
                    action: ndHasLibrary ? 'Explorar' : 'Conectar',
                    source: 'navidrome'
                  },
                  {
                    title: 'Spotify',
                    status: sp.status === 'ready' ? 'Conectado' : spHasLibrary ? 'Biblioteca guardada' : 'Sin conexión',
                    tone: tone(sp.status === 'ready' ? 'ok' : sp.status === 'disconnected' ? 'off' : 'warn'),
                    detail: spHasLibrary ? `${sp.tracks.length} pistas · ${sp.playlists.length} playlists` : 'Conecta tu cuenta para ver y comparar tu biblioteca.',
                    to: spHasLibrary ? '/spotify/albums' : '/spotify-connect',
                    action: spHasLibrary ? 'Explorar' : 'Conectar',
                    source: 'spotify'
                  }
  ];

  return (
    <div className="shell relative h-screen w-screen overflow-hidden bg-bg text-fg" data-np={nowOpen ? '' : undefined}>
      <Ambient />

      <main className="absolute inset-0 z-10">
        <Routes>
          <Route
            path="/"
            element={
              <Home cards={homeCards} />
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="/navidrome-playlists" element={ndHasLibrary ? <NavidromePlaylists /> : <Navigate to="/connect" replace />} />
          <Route path="/spotify-artists" element={spHasLibrary ? <SpotifyArtists /> : <Navigate to="/spotify-connect" replace />} />
          <Route
            path="/local/*"
            element={
              <LibraryBrowser
                tracks={local.tracks}
                basePath="/local"
                empty={<p className="text-muted">No hay música local todavía. Agrega una carpeta desde Ajustes.</p>}
              />
            }
          />
          <Route
            path="/navidrome/*"
            element={
              ndHasLibrary ? (
                <>
                  <LibraryBrowser
                    tracks={nd.tracks}
                    basePath="/navidrome"
                    empty={<p className="text-muted">La biblioteca del servidor está vacía.</p>}
                    onToggleFavorite={nd.toggleFavorite}
                    favoritesLabel="Favoritas"
                  />
                  {nd.status === 'disconnected' || nd.status === 'error' ? (
                    <div
                      className="fixed z-20 glass-thick flex items-center gap-3 h-11 px-4 text-callout"
                      style={{ bottom: 'calc(var(--chrome-bottom) + 4px)', left: 'var(--chrome-left)', right: 'var(--gutter)', marginInline: 'auto', width: 'fit-content', maxWidth: 'calc(100% - var(--chrome-left) - 24px)', borderRadius: 999 }}
                    >
                      <span className="truncate">Biblioteca guardada, sin conexión con el servidor.</span>
                      <button type="button" className="bg-fill-2 hover:bg-fill-3 px-3 py-1 rounded-full shrink-0" onClick={() => navigate('/connect')}>
                        Conectar
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Navigate to="/connect" replace />
              )
            }
          />
          <Route path="/connect" element={<div className="page"><NavidromeConnect /></div>} />
          <Route
            path="/compare"
            element={
              <div className="page">
                <CompareView sources={compareSources} />
              </div>
            }
          />
          <Route
            path="/spotify/*"
            element={
              spHasLibrary ? (
                <LibraryBrowser tracks={sp.tracks} basePath="/spotify" readOnly favoritesLabel="Canciones que te gustan" empty={<p className="text-muted">Tu biblioteca de Spotify está vacía.</p>} />
              ) : (
                <Navigate to="/spotify-connect" replace />
              )
            }
          />
          <Route path="/spotify-playlists" element={spHasLibrary ? <SpotifyPlaylists /> : <Navigate to="/spotify-connect" replace />} />
          <Route path="/spotify-connect" element={<div className="page"><SpotifyConnect /></div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* En el teléfono, "Reproduciendo" es una pantalla completa sin fondo propio: el resto del cromo se oculta */}
      {mobile && nowOpen ? null : (
        <>
          <Sidebar />
          <BottomNav />
          <HeaderBar onSearch={() => setSearchOpen(true)} />
          <NowPlayingBar onOpen={() => setNowOpen(true)} queueOpen={nowOpen} />
        </>
      )}
      <GlassDefs />
      <ScrobbleBridge />
      <QueuePersistence />
      <HotkeysBridge />
      <HistoryBridge />
      <PowerBridge />
      {nowOpen ? <NowPlaying onClose={() => setNowOpen(false)} /> : null}
      {searchOpen ? <CommandPalette sources={searchSources} onClose={() => setSearchOpen(false)} /> : null}
    </div>
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <NavidromeProvider>
      <SpotifyProvider>
        <LocalLibraryProvider>
          <PlayerProvider>
            <HashRouter>
              <TrackMenuProvider>
                <Shell />
              </TrackMenuProvider>
            </HashRouter>
          </PlayerProvider>
        </LocalLibraryProvider>
      </SpotifyProvider>
    </NavidromeProvider>
  </ThemeProvider>
);

export default App;
