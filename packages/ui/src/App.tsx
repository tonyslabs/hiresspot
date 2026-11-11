import React, { useEffect, useMemo, useRef, useState } from 'react';
// Carga diferida: usamos FLACDecoder de @wasm-audio-decoders/flac
// y decodificamos el archivo completo a channelData/sampleRate
type FlacDecoded = { sampleRate: number; channelData: Float32Array[]; samplesDecoded: number; bitDepth?: number };
const decodeFlacWholeFile = async (bytes: Uint8Array): Promise<FlacDecoded> => {
  const mod: any = await import('@wasm-audio-decoders/flac');
  const FLACDecoder = mod.FLACDecoder || mod.default || mod;
  if (!FLACDecoder) throw new Error('FLACDecoder export not found');
  const dec = new FLACDecoder();
  await dec.ready;
  try {
    const res = await dec.decodeFile(bytes);
    return res as FlacDecoded;
  } finally {
    try { await dec.free?.(); } catch {}
  }
};

type NavKey = ViewKind;

const formatTime = (sec?: number) => {
  if (!sec || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
};

const App: React.FC = () => {
  const [nav, setNav] = useState<NavKey>('local_albums');
  const [query, setQuery] = useState('');
  const [selectedAlbum, setSelectedAlbum] = useState<
    { album: string; albumKey: string; artistKey: string; artistName: string } | null
  >(null);
  const [selectedArtist, setSelectedArtist] = useState<{ name: string; artistKey: string } | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  // Web Audio state
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0); // audioCtx.currentTime when started
  const startOffsetRef = useRef<number>(0); // seconds into buffer when started
  const rafRef = useRef<number | null>(null);

  // Simple logger for debugging playback
  const dbg = (...args: any[]) => console.log('[Player]', ...args);

  // Initialize audio context on first user interaction
  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      dbg('Creating AudioContext');
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      gainRef.current = audioCtxRef.current.createGain();
      gainRef.current.connect(audioCtxRef.current.destination);
      dbg('AudioContext created. state=', audioCtxRef.current.state);
    }
    return audioCtxRef.current!;
  };

  const stopRaf = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const startRaf = () => {
    stopRaf();
    const tick = () => {
      const ctx = audioCtxRef.current;
      const buf = bufferRef.current;
      if (ctx && buf && isPlaying) {
        const elapsed = ctx.currentTime - startTimeRef.current;
        const pos = Math.min(startOffsetRef.current + elapsed, buf.duration);
        setPosition(pos);
        if (pos >= buf.duration) {
          // handled by onended, but keep guard
          setIsPlaying(false);
          stopRaf();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopSource = () => {
    if (sourceRef.current) console.log('[Player]', 'Stopping current source');
    try {
      sourceRef.current?.stop();
    } catch {}
    sourceRef.current = null;
  };

  const createAndStartSource = (offsetSec: number) => {
    const ctx = getAudioContext();
    const buf = bufferRef.current;
    if (!buf) return;
    console.log('[Player]', 'Starting source at', offsetSec, 'of', buf.duration, 'sr=', buf.sampleRate, 'ch=', buf.numberOfChannels);
    stopSource();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gainRef.current!);
    src.onended = () => {
      console.log('[Player]', 'Source ended');
      setIsPlaying(false);
      stopRaf();
      // auto-next if there is one
      if (queueIndex >= 0 && queueIndex + 1 < queue.length) {
        console.log('[Player]', 'Auto-next');
        playNext();
      }
    };
    startTimeRef.current = ctx.currentTime;
    startOffsetRef.current = offsetSec;
    sourceRef.current = src;
    src.start(0, Math.max(0, Math.min(offsetSec, buf.duration)));
    setIsPlaying(true);
    console.log('[Player]', 'Playback started');
    startRaf();
  };

  const decodeWav = async (data: ArrayBuffer) => {
    const ctx = getAudioContext();
    try {
      const audioBuf = await ctx.decodeAudioData(data.slice(0));
      console.log('[Player]', 'decodeWav ok', { dur: audioBuf.duration, sr: audioBuf.sampleRate, ch: audioBuf.numberOfChannels });
      return audioBuf;
    } catch (err) {
      console.error('[Player]', 'decodeWav failed', err);
      throw err;
    }
  };

  const decodeFlacFile = async (data: ArrayBuffer) => {
    try {
      const res = await decodeFlacWholeFile(new Uint8Array(data));
      if (!res || !res.channelData || res.channelData.length === 0) {
        throw new Error('decodeFlac returned empty channelData');
      }
      const ctx = getAudioContext();
      const numChannels = res.channelData.length;
      const length = res.channelData[0]?.length || 0;
      if (!length) throw new Error('decodeFlac returned zero length buffer');
      const audioBuf = ctx.createBuffer(numChannels, length, res.sampleRate);
      for (let ch = 0; ch < numChannels; ch++) {
        audioBuf.getChannelData(ch).set(res.channelData[ch]);
      }
      console.log('[Player]', 'decodeFlac ok', { dur: audioBuf.duration, sr: audioBuf.sampleRate, ch: audioBuf.numberOfChannels });
      return audioBuf;
    } catch (err) {
      console.error('[Player]', 'decodeFlac failed', err);
      throw err;
    }
  };

  const loadPathToBuffer = async (absPath: string) => {
    console.log('[Player]', 'loadPathToBuffer', absPath);
    const data = await window.api.file.read(absPath);
    console.log('[Player]', 'read bytes:', data.byteLength);
    const lower = absPath.toLowerCase();
    if (lower.endsWith('.wav')) {
      bufferRef.current = await decodeWav(data);
    } else if (lower.endsWith('.flac')) {
      bufferRef.current = await decodeFlacFile(data);
    } else {
      bufferRef.current = await decodeWav(data);
    }
    if (!bufferRef.current) throw new Error('No AudioBuffer produced');
    setDuration(bufferRef.current.duration || 0);
    console.log('[Player]', 'decoded buffer duration:', bufferRef.current.duration, 'sr:', bufferRef.current.sampleRate);
  };

  const playPath = async (absPath: string) => {
    // stop current
    stopSource();
    stopRaf();
    startOffsetRef.current = 0;

    // ensure context resumed (Chrome may suspend on init)
    const ctx = getAudioContext();
    console.log('[Player]', 'playPath. ctx.state=', ctx.state);
    if (ctx.state === 'suspended') {
      console.log('[Player]', 'Resuming AudioContext');
      await ctx.resume();
      console.log('[Player]', 'AudioContext state after resume:', ctx.state);
    }

    await loadPathToBuffer(absPath);
    setPosition(0);
    createAndStartSource(0);
  };

  const togglePlayPause = async () => {
    const ctx = getAudioContext();
    if (!bufferRef.current) return;
    if (isPlaying) {
      // pause: stop current source, keep offset
      const elapsed = ctx.currentTime - startTimeRef.current;
      startOffsetRef.current = Math.min(startOffsetRef.current + elapsed, bufferRef.current.duration);
      stopSource();
      setIsPlaying(false);
      stopRaf();
    } else {
      if (ctx.state === 'suspended') {
        console.log('[Player]', 'Resuming AudioContext');
        await ctx.resume();
      }
      console.log('[Player]', 'Resume from', startOffsetRef.current);
      createAndStartSource(startOffsetRef.current);
    }
  };

  const seek = async (ratio: number) => {
    const buf = bufferRef.current;
    if (!buf) return;
    const target = Math.max(0, Math.min(buf.duration, buf.duration * ratio));
    startOffsetRef.current = target;
    console.log('[Player]', 'Seek to', target, 'ratio=', ratio);
    if (isPlaying) {
      createAndStartSource(target);
    } else {
      setPosition(target);
    }
  };

  // Normalization helpers
  const normalize = (s?: string) =>
    (s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const pickPrimary = (s?: string) => {
    const base = (s || '').trim();
    const parts = base
      .split(/feat\.|ft\.|con|,|&| x |\//i)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts[0] || base || 'Artista desconocido';
  };
  const primaryArtistForTrack = (t: Track) => pickPrimary(t.albumArtist || t.artist);

  // Derived: albums from local tracks (normalized by album + primary album artist)
  const albums = useMemo(() => {
    const group = new Map<string, { key: string; album: string; artist: string; artistKey: string; albumKey: string; cover?: string; tracks: Track[] }>();
    for (const t of tracks) {
      const albumName = t.album || 'Álbum desconocido';
      const artistName = primaryArtistForTrack(t);
      const aKey = normalize(albumName);
      const arKey = normalize(artistName);
      const key = `${aKey}__${arKey}`;
      const item =
        group.get(key) || {
          key,
          album: albumName,
          artist: artistName,
          artistKey: arKey,
          albumKey: aKey,
          cover: t.picture,
          tracks: []
        };
      if (!item.cover && t.picture) item.cover = t.picture;
      item.tracks.push(t);
      group.set(key, item);
    }
    return Array.from(group.values()).sort((a, b) => a.album.localeCompare(b.album));
  }, [tracks]);

  // Derived: artists from local tracks (prefer albumArtist or primary artist)
  const artists = useMemo(() => {
    const group = new Map<string, { key: string; artist: string; cover?: string; albums: Set<string>; tracks: Track[] }>();
    for (const t of tracks) {
      const name = primaryArtistForTrack(t) || 'Artista desconocido';
      const key = normalize(name);
      const item = group.get(key) || { key, artist: name, cover: t.picture, albums: new Set<string>(), tracks: [] };
      if (!item.cover && t.picture) item.cover = t.picture;
      item.albums.add(t.album || 'Álbum desconocido');
      item.tracks.push(t);
      group.set(key, item);
    }
    return Array.from(group.values()).sort((a, b) => a.artist.localeCompare(b.artist));
  }, [tracks]);

  // Search helpers (accent/case-insensitive, token-based)
  // defined after normalize() to avoid TDZ issues
  const queryTokens = useMemo(() => normalize(query).split(' ').filter(Boolean), [query]);
  const filteredTracks = useMemo(() => {
    if (queryTokens.length === 0) return tracks;
    return tracks.filter((t) => {
      const hay = `${normalize(t.title)} ${normalize(t.artist)} ${normalize(t.album)}`;
      return queryTokens.every((tk) => hay.includes(tk));
    });
  }, [tracks, queryTokens]);
  const filteredAlbums = useMemo(() => {
    if (queryTokens.length === 0) return albums;
    return albums.filter((al) => {
      const hay = `${normalize(al.album)} ${normalize(al.artist)}`;
      return queryTokens.every((tk) => hay.includes(tk));
    });
  }, [albums, queryTokens]);
  const filteredArtists = useMemo(() => {
    if (queryTokens.length === 0) return artists;
    return artists.filter((ar) => {
      const hay = `${normalize(ar.artist)}`;
      return queryTokens.every((tk) => hay.includes(tk));
    });
  }, [artists, queryTokens]);

  // Debug: log filter results to verify search behavior
  useEffect(() => {
    console.log('[Search]', { q: query, tokens: queryTokens, tracks: filteredTracks.length });
  }, [query, queryTokens, filteredTracks]);

  const startPlayback = async (t: Track) => {
    setCurrent(t);
    await playPath(t.path);
  };

  const playTrack = (t: Track) => {
    const idx = queue.findIndex((q) => q.id === t.id);
    if (idx >= 0) setQueueIndex(idx);
    else {
      setQueue([t]);
      setQueueIndex(0);
    }
    startPlayback(t);
  };

  const setQueueAndPlay = (list: Track[]) => {
    const compact = list.filter(Boolean);
    if (compact.length === 0) return;
    setQueue(compact);
    setQueueIndex(0);
    startPlayback(compact[0]);
  };

  const addToQueue = (list: Track[]) => {
    const compact = list.filter(Boolean);
    if (compact.length === 0) return;
    setQueue((prev) => [...prev, ...compact]);
  };

  // (replaced by Web Audio togglePlay defined above)

  const playNext = () => {
    if (queueIndex >= 0 && queueIndex + 1 < queue.length) {
      const next = queue[queueIndex + 1];
      setQueueIndex(queueIndex + 1);
      startPlayback(next);
    }
  };

  const playPrev = () => {
    if (queueIndex > 0) {
      const prev = queue[queueIndex - 1];
      setQueueIndex(queueIndex - 1);
      startPlayback(prev);
    } else if (current) {
      // restart current track from beginning
      startOffsetRef.current = 0;
      if (bufferRef.current && isPlaying) createAndStartSource(0);
      setPosition(0);
    }
  };
  // (replaced by Web Audio seek defined above)

  const openAndScan = async () => {
    const folder = await window.api.system.openFolderDialog();
    if (!folder) return;
    const list = await window.api.library.scanFolder(folder);
    setTracks(list);
    setNav('local_albums');
    try {
      localStorage.setItem('defaultMusicFolder', folder);
      setDefaultFolder(folder);
    } catch {}
  };

  const dummyLogin = async () => {
    await window.api.spotify.login();
    setNav('spotify');
  };

  // Load default music folder on start (if present)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('defaultMusicFolder');
      if (stored) {
        setDefaultFolder(stored);
        window.api.library.scanFolder(stored).then((list) => {
          setTracks(list);
          setNav('local_albums');
        }).catch(() => {});
      }
    } catch {}
  }, []);

  // Basic keyboard shortcuts: Space to play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-screen w-screen grid grid-rows-[1fr_auto]">
      {/* Main area */}
      <div className="grid grid-cols-[240px_1fr] overflow-hidden">
        {/* Sidebar */}
        <aside className="border-r border-neutral-800 p-4 flex flex-col gap-3">
          <h1 className="text-lg font-semibold">HiResSpot</h1>

          <div className="mt-2 text-xs uppercase tracking-wide text-neutral-400">Reproducción local</div>
          <button className={`text-left px-3 py-2 rounded hover:bg-neutral-800 ${nav === 'local_albums' ? 'bg-neutral-800' : ''}`} onClick={() => setNav('local_albums')}>Álbumes</button>
          <button className={`text-left px-3 py-2 rounded hover:bg-neutral-800 ${nav === 'local_artists' ? 'bg-neutral-800' : ''}`} onClick={() => setNav('local_artists')}>Artistas</button>
          <button className={`text-left px-3 py-2 rounded hover:bg-neutral-800 ${nav === 'local_tracks' ? 'bg-neutral-800' : ''}`} onClick={() => setNav('local_tracks')}>Pistas</button>

          <div className="mt-2 text-xs uppercase tracking-wide text-neutral-400">Streaming</div>
          <button className={`text-left px-3 py-2 rounded hover:bg-neutral-800 ${nav === 'spotify' ? 'bg-neutral-800' : ''}`} onClick={dummyLogin}>Spotify</button>

          <div className="mt-4 space-y-2">
            <button className="w-full bg-neutral-700 hover:bg-neutral-600 active:bg-neutral-500 text-neutral-100 px-3 py-2 rounded" onClick={openAndScan}>
              Seleccionar carpeta…
            </button>
            {defaultFolder ? (
              <div className="text-xs text-neutral-400 break-all">
                Carpeta predeterminada: {defaultFolder}
                <div className="mt-2 flex gap-2">
                  <button
                    className="bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded"
                    onClick={() => {
                      window.api.library.scanFolder(defaultFolder).then((list) => setTracks(list));
                    }}
                  >
                    Recargar
                  </button>
                  <button
                    className="bg-neutral-800 hover:bg-neutral-700 px-2 py-1 rounded"
                    onClick={() => {
                      try { localStorage.removeItem('defaultMusicFolder'); } catch {}
                      setDefaultFolder(null);
                    }}
                  >
                    Olvidar
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Content */}
        <main className="p-6 overflow-auto">
          {nav === 'local_tracks' && (
            <div className="flex items-center gap-3 mb-6">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar pistas…"
                className="w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-neutral-600"
              />
            </div>
          )}
          {nav === 'local_albums' && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Álbumes</h2>
              {albums.length === 0 ? (
                <p className="text-neutral-400">No hay música cargada todavía.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {albums.map((al) => (
                    <button
                      key={al.key}
                      className="group text-left"
                      onClick={() => {
                        setSelectedAlbum({
                          album: al.album,
                          albumKey: al.key.split('__')[0],
                          artistKey: al.key.split('__')[1],
                          artistName: al.artist,
                        });
                        setNav('local_album');
                      }}
                    >
                      <div className="aspect-square w-full overflow-hidden rounded bg-neutral-900 border border-neutral-800">
                        {al.cover ? (
                          <img src={al.cover} alt={al.album} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-neutral-600">Sin portada</div>
                        )}
                      </div>
                      <div className="mt-2">
                        <div className="font-medium truncate" title={al.album}>{al.album}</div>
                        <div className="text-sm text-neutral-400 truncate" title={al.artist}>{al.artist}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {nav === 'local_artists' && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Artistas</h2>
              {artists.length === 0 ? (
                <p className="text-neutral-400">No hay música cargada todavía.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {artists.map((ar) => (
                    <button
                      key={ar.key}
                      className="group text-left"
                      onClick={() => {
                        setSelectedArtist({ name: ar.artist, artistKey: ar.key });
                        setNav('local_artist');
                      }}
                    >
                      <div className="aspect-square w-full overflow-hidden rounded bg-neutral-900 border border-neutral-800">
                        {ar.cover ? (
                          <img src={ar.cover} alt={ar.artist} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-neutral-600">Sin portada</div>
                        )}
                      </div>
                      <div className="mt-2">
                        <div className="font-medium truncate" title={ar.artist}>{ar.artist}</div>
                        <div className="text-sm text-neutral-400 truncate" title={`${ar.albums.size} álbum(es) • ${ar.tracks.length} pista(s)`}>
                          {ar.albums.size} álbum(es) • {ar.tracks.length} pista(s)
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {nav === 'local_album' && selectedAlbum && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <button
                  className="bg-neutral-800 hover:bg-neutral-700 px-3 py-1 rounded"
                  onClick={() => {
                    setSelectedAlbum(null);
                    setNav('local_albums');
                  }}
                >
                  ← Volver a Álbumes
                </button>
              </div>

              {(() => {
                const info = albums.find(
                  (a) => a.albumKey === selectedAlbum.albumKey && a.artistKey === selectedAlbum.artistKey
                );
                const list = tracks.filter(
                  (t) => normalize(t.album) === selectedAlbum.albumKey && normalize(primaryArtistForTrack(t)) === selectedAlbum.artistKey
                );
                return (
                  <div>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-28 h-28 rounded overflow-hidden bg-neutral-900 border border-neutral-800">
                        {info?.cover ? (
                          <img src={info.cover} alt={info.album} className="w-full h-full object-cover" />
                        ) : null}
                      </div>
                      <div>
                        <div className="text-sm text-neutral-400">Álbum</div>
                        <h2 className="text-2xl font-semibold">{selectedAlbum.album}</h2>
                        <div className="text-neutral-400">{selectedAlbum.artistName} • {list.length} pista(s)</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mb-3">
                      <button className="bg-neutral-700 hover:bg-neutral-600 px-3 py-2 rounded" onClick={() => setQueueAndPlay(list)}>Reproducir todo</button>
                      <button className="bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded" onClick={() => addToQueue(list)}>Agregar a la cola</button>
                    </div>

                    {list.length === 0 ? (
                      <p className="text-neutral-400">No hay pistas para este álbum.</p>
                    ) : (
                      <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded overflow-hidden">
                        {list.map((t, i) => (
                          <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-neutral-900">
                            <div className="w-8 text-neutral-500 text-right">{i + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate" title={t.title}>{t.title}</div>
                              <div className="text-sm text-neutral-400 truncate" title={t.artist}>{t.artist}</div>
                            </div>
                            <div className="text-sm text-neutral-500 w-12 text-right">{formatTime(t.duration)}</div>
                            <button className="ml-3 bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded" onClick={() => playTrack(t)}>Reproducir</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </section>
          )}

          {nav === 'local_artist' && selectedArtist && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <button
                  className="bg-neutral-800 hover:bg-neutral-700 px-3 py-1 rounded"
                  onClick={() => {
                    setSelectedArtist(null);
                    setNav('local_artists');
                  }}
                >
                  ← Volver a Artistas
                </button>
              </div>

              {(() => {
                const list = tracks.filter((t) => normalize(primaryArtistForTrack(t)) === selectedArtist.artistKey);
                const albumSet = new Set(list.map((t) => t.album || 'Álbum desconocido'));
                const cover = list.find((t) => t.picture)?.picture;
                return (
                  <div>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-28 h-28 rounded overflow-hidden bg-neutral-900 border border-neutral-800">
                        {cover ? <img src={cover} alt={selectedArtist.name} className="w-full h-full object-cover" /> : null}
                      </div>
                      <div>
                        <div className="text-sm text-neutral-400">Artista</div>
                        <h2 className="text-2xl font-semibold">{selectedArtist.name}</h2>
                        <div className="text-neutral-400">{albumSet.size} álbum(es) • {list.length} pista(s)</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mb-3">
                      <button className="bg-neutral-700 hover:bg-neutral-600 px-3 py-2 rounded" onClick={() => setQueueAndPlay(list)}>Reproducir todo</button>
                      <button className="bg-neutral-800 hover:bg-neutral-700 px-3 py-2 rounded" onClick={() => addToQueue(list)}>Agregar a la cola</button>
                    </div>

                    {list.length === 0 ? (
                      <p className="text-neutral-400">No hay pistas para este artista.</p>
                    ) : (
                      <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded overflow-hidden">
                        {list.map((t, i) => (
                          <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-neutral-900">
                            <div className="w-8 text-neutral-500 text-right">{i + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate" title={t.title}>{t.title}</div>
                              <div className="text-sm text-neutral-400 truncate" title={t.album}>{t.album}</div>
                            </div>
                            <div className="text-sm text-neutral-500 w-12 text-right">{formatTime(t.duration)}</div>
                            <button className="ml-3 bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded" onClick={() => playTrack(t)}>Reproducir</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
            </section>
          )}

          {nav === 'local_tracks' && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Pistas</h2>
              {tracks.length === 0 ? (
                <p className="text-neutral-400">No hay música cargada todavía.</p>
              ) : (
                <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded overflow-hidden">
                  {filteredTracks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-neutral-900">
                      <div className="w-12 h-12 overflow-hidden rounded bg-neutral-900 flex-shrink-0">
                        {t.picture ? <img src={t.picture} className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" title={t.title}>{t.title}</div>
                        <div className="text-sm text-neutral-400 truncate" title={`${t.artist} • ${t.album}`}>{t.artist} • {t.album}</div>
                      </div>
                      <div className="text-sm text-neutral-500 w-12 text-right">{formatTime(t.duration)}</div>
                      <button className="ml-3 bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded" onClick={() => playTrack(t)}>Reproducir</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {nav === 'search' && (
            <section>
              <h2 className="text-xl font-semibold mb-4">Resultados</h2>
              {filteredTracks.length === 0 ? (
                <p className="text-neutral-400">Sin resultados.</p>
              ) : (
                <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded overflow-hidden">
                  {filteredTracks.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-neutral-900">
                      <div className="w-12 h-12 overflow-hidden rounded bg-neutral-900 flex-shrink-0">
                        {t.picture ? <img src={t.picture} className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate" title={t.title}>{t.title}</div>
                        <div className="text-sm text-neutral-400 truncate" title={`${t.artist} • ${t.album}`}>{t.artist} • {t.album}</div>
                      </div>
                      <div className="text-sm text-neutral-500 w-12 text-right">{formatTime(t.duration)}</div>
                      <button className="ml-3 bg-neutral-700 hover:bg-neutral-600 px-3 py-1 rounded" onClick={() => playTrack(t)}>Reproducir</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {nav === 'spotify' && (
            <section>
              <h2 className="text-xl font-semibold mb-2">Spotify</h2>
              <p className="text-neutral-400">Inicio de sesión simulado. Preparado para OAuth PKCE.</p>
            </section>
          )}
        </main>
      </div>

      {/* Now Playing Bar */}
      <footer className="border-t border-neutral-800 h-20 grid grid-cols-[1fr_auto] items-center px-4 gap-4 bg-neutral-950/80">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-14 h-14 overflow-hidden rounded bg-neutral-900">
            {current?.picture ? <img src={current.picture} className="w-full h-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{current ? current.title : 'Nada reproduciendo'}</div>
            <div className="text-sm text-neutral-400 truncate">{current ? `${current.artist} • ${current.album}` : 'Selecciona una pista'}</div>
          </div>
        </div>

        <div className="flex flex-col items-center w-full max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <button className="bg-neutral-700 hover:bg-neutral-600 rounded px-3 py-1" onClick={playPrev}>Prev</button>
            <button className="bg-neutral-100 text-neutral-900 hover:bg-white rounded px-4 py-1" onClick={togglePlayPause}>{isPlaying ? 'Pausa' : 'Play'}</button>
            <button className="bg-neutral-700 hover:bg-neutral-600 rounded px-3 py-1" onClick={playNext}>Next</button>
          </div>
          <div className="flex items-center gap-3 w-full">
            <span className="text-xs text-neutral-400 tabular-nums w-10 text-right">{formatTime(position)}</span>
            <div className="relative h-2 w-full bg-neutral-800 rounded cursor-pointer" onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              seek(ratio);
            }}>
              <div className="absolute top-0 left-0 h-2 bg-neutral-200 rounded" style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-neutral-400 tabular-nums w-10">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Eliminado <audio>. Reproducción vía Web Audio API */}
      </footer>
    </div>
  );
};

export default App;
