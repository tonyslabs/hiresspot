import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, powerSaveBlocker, protocol, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import { createSpotify } from './spotify';
import * as mm from 'music-metadata';
import { buildFlacLayout, parseRange, planFlacSlice, type FlacLayout, type HttpResponse, type Track } from '@hiresspot/core';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// ---------------------------------------------------------------------------
// Configuración de depuración (solo para pruebas locales, nunca en producción)
// ---------------------------------------------------------------------------
// Solo en builds sin empaquetar: en la app distribuida estas variables no hacen nada.
const DEBUG = !app.isPackaged && process.env.HIRESSPOT_DEBUG === '1';
if (!app.isPackaged && process.env.HIRESSPOT_USER_DATA) app.setPath('userData', process.env.HIRESSPOT_USER_DATA);

// Linux: Electron solo detecta el llavero en GNOME/KDE y en otros escritorios (bspwm, i3…) cae a
// "basic_text" (sin cifrado real). Si hay un servicio org.freedesktop.secrets (gnome-keyring,
// KeePassXC…) se pide libsecret explícitamente; si no existe, Chromium vuelve a basic_text y la
// app no guarda secretos (lo detecta `secretsAvailable`).
if (process.platform === 'linux' && !app.commandLine.hasSwitch('password-store')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

// ---------------------------------------------------------------------------
// Protocolo hires-media://  (audio y portadas locales, restringido a las carpetas autorizadas)
//   hires-media://audio/<ruta URL-encoded>   → bytes del archivo (con soporte de Range)
//   hires-media://cover/<ruta URL-encoded>   → portada embebida del archivo
// ---------------------------------------------------------------------------
const SCHEME = 'hires-media';
const AUDIO_EXTENSIONS = new Set(['.flac', '.wav']);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

// ---------------------------------------------------------------------------
// Carpetas de música autorizadas (persistidas en userData)
// ---------------------------------------------------------------------------
let roots: string[] = [];
const rootsFile = () => join(app.getPath('userData'), 'library-roots.json');

const loadRoots = async () => {
  try {
    const parsed = JSON.parse(await readFile(rootsFile(), 'utf8'));
    if (Array.isArray(parsed.roots)) roots = parsed.roots.filter((r: unknown): r is string => typeof r === 'string');
  } catch {
    roots = [];
  }
  if (DEBUG && process.env.HIRESSPOT_ROOTS) {
    for (const r of process.env.HIRESSPOT_ROOTS.split(':').filter(Boolean)) {
      try {
        const real = await realpath(r);
        if (!roots.includes(real)) roots.push(real);
      } catch {
        /* ruta inexistente: se ignora */
      }
    }
  }
};

const saveRoots = async () => {
  await mkdir(dirname(rootsFile()), { recursive: true });
  await writeFile(rootsFile(), JSON.stringify({ roots }, null, 2));
};

const isInside = (root: string, target: string) => {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/** Resuelve symlinks y comprueba que la ruta esté dentro de una carpeta autorizada. */
const resolveAllowed = async (target: string): Promise<string | null> => {
  try {
    const real = await realpath(target);
    return roots.some((r) => isInside(r, real)) ? real : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
//   hires-media://flac/<URL de stream, URL-encoded> → el mismo FLAC de Navidrome sin bloques PICTURE.
//   Chromium no abre FLAC con una portada embebida de MIME inválido; el audio no se modifica.
//   Solo se acepta /rest/stream del servidor Navidrome configurado (nunca URLs arbitrarias).
// ---------------------------------------------------------------------------
interface FlacEntry {
  layout: FlacLayout;
  total: number;
}
const flacCache = new Map<string, FlacEntry>();
const FLAC_CACHE_MAX = 200;

const allowedServerUrl = async (raw: string, pathRe: RegExp): Promise<URL | null> => {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (!pathRe.test(target.pathname)) return null;
  const saved = (await readJson(settingsFile())).navidrome as { baseUrl?: string } | undefined;
  try {
    return saved?.baseUrl && new URL(saved.baseUrl).origin === target.origin ? target : null;
  } catch {
    return null;
  }
};

const allowedStreamUrl = (raw: string) => allowedServerUrl(raw, /\/rest\/stream(\.view)?$/);
const allowedCoverUrl = (raw: string) => allowedServerUrl(raw, /\/rest\/getCoverArt(\.view)?$/);

const fetchRange = async (url: string, start: number, end: number, signal?: AbortSignal) =>
  net.fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });

const flacEntry = async (url: string): Promise<FlacEntry | null> => {
  const cached = flacCache.get(url);
  if (cached) return cached;
  let total = 0;
  const layout = await buildFlacLayout(async (start, end) => {
    const res = await fetchRange(url, start, end);
    if (res.status !== 206) throw new Error(`El servidor no atiende Range (${res.status})`);
    if (!total) total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? 0);
    return new Uint8Array(await res.arrayBuffer());
  });
  if (!layout || !total) return null;
  if (flacCache.size >= FLAC_CACHE_MAX) flacCache.delete(flacCache.keys().next().value as string);
  const entry = { layout, total };
  flacCache.set(url, entry);
  return entry;
};

/** Copia de la respuesta con CORS abierto: Web Audio (ecualizador) exige orígenes con CORS. */
const withCors = (res: Response): Response => {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

const handleFlacRequest = async (request: Request, rawUpstream: string): Promise<Response> => {
  const upstream = await allowedStreamUrl(rawUpstream);
  if (!upstream) return new Response('Forbidden', { status: 403 });
  const url = upstream.toString();

  const entry = await flacEntry(url);
  // No parece FLAC o el servidor no soporta Range: se deja pasar tal cual
  if (!entry) return withCors(await net.fetch(url, { headers: request.headers, signal: request.signal }));

  const { layout, total } = entry;
  const length = layout.header.length + (total - layout.audioStart);
  const range = parseRange(request.headers.get('range'), length);
  if (range === 'invalid') return new Response('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${length}` } });

  const span = range === 'full' ? { start: 0, end: length - 1 } : range;
  const plan = planFlacSlice(layout, span);
  const head = layout.header.subarray(plan.headerStart, plan.headerEnd);
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  if (plan.upstream) {
    const res = await fetchRange(url, plan.upstream.start, plan.upstream.end, abort.signal);
    if (res.status !== 206 || !res.body) return new Response('Bad gateway', { status: 502 });
    reader = res.body.getReader();
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length > 0) controller.enqueue(head);
      if (!reader) controller.close();
    },
    async pull(controller) {
      if (!reader) return;
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() {
      abort.abort();
    }
  });

  return new Response(body, {
    status: range === 'full' ? 200 : 206,
    headers: {
      'Content-Type': 'audio/flac',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(span.end - span.start + 1),
      ...(range === 'full' ? {} : { 'Content-Range': `bytes ${span.start}-${span.end}/${length}` })
    }
  });
};

const handleMediaRequest = async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'flac') return await handleFlacRequest(request, decodeURIComponent(url.pathname.slice(1)));
    const target = decodeURIComponent(url.pathname.slice(1));
    const real = await resolveAllowed(target);
    if (!real) return new Response('Forbidden', { status: 403 });

    if (url.hostname === 'audio') {
      if (!AUDIO_EXTENSIONS.has(extname(real).toLowerCase())) return new Response('Forbidden', { status: 403 });
      // net.fetch sobre file:// atiende peticiones Range (seek sin cargar el archivo entero)
      return withCors(await net.fetch(pathToFileURL(real).toString(), { headers: request.headers }));
    }

    if (url.hostname === 'cover') {
      const meta = await mm.parseFile(real, { skipPostHeaders: true });
      const pic = meta.common.picture?.[0];
      if (!pic) return new Response('No cover', { status: 404 });
      return new Response(new Uint8Array(pic.data), {
        headers: {
          'Content-Type': pic.format || 'image/jpeg',
          'Cache-Control': 'private, max-age=31536000',
          // Permite fetch() desde el renderer (la Media Session necesita un blob:)
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response('Not found', { status: 404 });
  } catch (err) {
    console.error('hires-media error', err);
    return new Response('Error', { status: 500 });
  }
};

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------
const devUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : '';

const isAppUrl = (url: string) => url.startsWith('file://') || (devUrl !== '' && url.startsWith(devUrl));

const createWindow = async () => {
  // Sin barra de menús (Archivo/Editar/Ver/Ventana); en macOS se conserva porque el sistema la exige
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: 'HiResSpot',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
      devTools: !app.isPackaged
    }
  });

  if (DEBUG) {
    mainWindow.webContents.on('console-message', (...args: unknown[]) => {
      const first = args[0] as { level?: unknown; message?: string } | undefined;
      const message = first && typeof first === 'object' && 'message' in first ? first.message : args[2];
      console.log(`[renderer] ${message}`);
    });
  }

  if (devUrl) {
    // Solo dev: HIRESSPOT_HASH=/__glass abre directamente una ruta (pruebas visuales)
    const startHash = !app.isPackaged && /^\/[\w/-]*$/.test(process.env.HIRESSPOT_HASH ?? '') ? `#${process.env.HIRESSPOT_HASH}` : '';
    await mainWindow.loadURL(devUrl + startHash);
  } else {
    await mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
});

app.whenReady().then(async () => {
  await loadRoots();

  // Desarrollo: Vite marca los módulos de los paquetes del workspace como inmutables y Chromium los
  // guarda en la caché de userData; tras cambiar `packages/*` servía versiones viejas y la ventana
  // quedaba en negro ("does not provide an export named …"). En dev se parte siempre de caché limpia.
  if (devUrl) await session.defaultSession.clearCache();

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  protocol.handle(SCHEME, handleMediaRequest);

  createWindow().catch((error) => console.error('Failed to create main window:', error));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error('Failed to recreate main window:', error));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
const trusted = (event: IpcMainInvokeEvent) => isAppUrl(event.senderFrame?.url ?? '');

const handle = <A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<R> | R) => {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error(`IPC ${channel}: remitente no confiable`);
    return fn(event, ...(args as A));
  });
};


let sleepBlocker: number | null = null;
handle('power:playing', (_e, playing: boolean) => {
  if (playing && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension');
  else if (!playing && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
});

handle('library:getRoots', async () => roots);

handle('library:addRoot', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona tu carpeta de música',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const real = await realpath(result.filePaths[0]);
  if (!roots.includes(real)) {
    roots.push(real);
    await saveRoots();
  }
  return real;
});

handle('library:removeRoot', async (_e, root: string) => {
  roots = roots.filter((r) => r !== root);
  await saveRoots();
});

/** Ejecuta `fn` sobre `items` con a lo sumo `limit` tareas en paralelo. */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const coverUrlFor = (filePath: string) => `${SCHEME}://cover/${encodeURIComponent(filePath)}`;

handle('library:scan', async (_e, root: string): Promise<Track[]> => {
  if (!roots.includes(root)) throw new Error('Carpeta no autorizada');
  try {
    const files = await fg(['**/*.flac', '**/*.wav'], {
      cwd: root,
      onlyFiles: true,
      absolute: true,
      dot: false,
      followSymbolicLinks: true,
      caseSensitiveMatch: false
    });

    const parsed = await mapLimit(files, 8, async (filePath): Promise<Track | null> => {
      try {
        const { common, format } = await mm.parseFile(filePath, { duration: true });
        const base = filePath.split(/[\\/]/).pop() ?? filePath;
        return {
          id: `local:${filePath}`,
          source: 'local',
          sourceId: filePath,
          path: filePath,
          title: common.title || base,
          // Artista principal único, para no agrupar distinto por invitados
          artist: common.artist || common.artists?.[0] || 'Unknown Artist',
          albumArtist: common.albumartist,
          album: common.album || 'Unknown Album',
          trackNo: common.track?.no ?? undefined,
          discNo: common.disk?.no ?? undefined,
          year: common.year,
          genre: common.genre?.[0],
          duration: typeof format.duration === 'number' ? format.duration : undefined,
          sampleRate: format.sampleRate,
          bitDepth: format.bitsPerSample || undefined,
          bitrate: typeof format.bitrate === 'number' ? Math.round(format.bitrate / 1000) : undefined,
          format: format.container?.toUpperCase(),
          isrc: common.isrc?.[0],
          mbid: common.musicbrainz_recordingid,
          replayGain: {
            trackGain: common.replaygain_track_gain?.dB,
            trackPeak: common.replaygain_track_peak?.ratio,
            albumGain: common.replaygain_album_gain?.dB,
            albumPeak: common.replaygain_album_peak?.ratio
          },
          coverUrl: common.picture?.length ? coverUrlFor(filePath) : undefined
        };
      } catch {
        // Un archivo ilegible no debe tumbar todo el escaneo
        return null;
      }
    });

    return parsed.filter((t): t is Track => t !== null);
  } catch (error) {
    console.error('library:scan error', error);
    return [];
  }
});

// ---------------------------------------------------------------------------
// HTTP hacia servidores Subsonic/Navidrome (sin CORS; solo la API /rest/)
// ---------------------------------------------------------------------------
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

handle('http:request', async (_e, url: string, options?: { timeoutMs?: number }): Promise<HttpResponse> => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Solo se permite http(s)');
  if (!parsed.pathname.includes('/rest/')) throw new Error('Solo se permite la API /rest/');
  const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 15_000, 1_000), 120_000);
  const res = await net.fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error('Respuesta demasiado grande');
  return { ok: res.ok, status: res.status, statusText: res.statusText, text };
});

// ---------------------------------------------------------------------------
// Ajustes y secretos (userData). Los secretos van cifrados con safeStorage (llavero del sistema).
// ---------------------------------------------------------------------------
const KEY_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
const assertKey = (key: string) => {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new Error('Clave inválida');
};

const readJson = async (file: string): Promise<Record<string, unknown>> => {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeJson = async (file: string, data: Record<string, unknown>) => {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
};

const settingsFile = () => join(app.getPath('userData'), 'settings.json');
const secretsFile = () => join(app.getPath('userData'), 'secrets.json');

handle('settings:get', async (_e, key: string) => {
  assertKey(key);
  return (await readJson(settingsFile()))[key] ?? null;
});

// Los guardados se encadenan: leer-modificar-escribir en paralelo perdía ajustes (se pisaban entre sí)
let settingsQueue: Promise<unknown> = Promise.resolve();
handle('settings:set', (_e, key: string, value: unknown) => {
  assertKey(key);
  const run = async () => {
    const all = await readJson(settingsFile());
    if (value === null || value === undefined) delete all[key];
    else all[key] = value;
    await writeJson(settingsFile(), all);
  };
  const next = settingsQueue.then(run, run);
  settingsQueue = next.catch(() => {});
  return next;
});

/** En Linux sin llavero Electron cae a "basic_text" (texto casi plano): no lo consideramos seguro. */
const secretsAvailable = async () => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
  return true;
};

const getSecret = async (key: string): Promise<string | null> => {
  assertKey(key);
  if (!(await secretsAvailable())) return null;
  const b64 = (await readJson(secretsFile()))[key];
  if (typeof b64 !== 'string') return null;
  try {
    return (await safeStorage.decryptStringAsync(Buffer.from(b64, 'base64'))).result;
  } catch {
    return null;
  }
};

// Misma cola que los ajustes: dos secretos guardados a la vez no deben pisarse
let secretsQueue: Promise<unknown> = Promise.resolve();
const serialSecrets = <T,>(run: () => Promise<T>): Promise<T> => {
  const next = secretsQueue.then(run, run);
  secretsQueue = next.catch(() => {});
  return next;
};

const setSecret = (key: string, value: string): Promise<void> => {
  assertKey(key);
  return serialSecrets(async () => {
    if (!(await secretsAvailable())) throw new Error('No hay llavero del sistema disponible');
    const all = await readJson(secretsFile());
    all[key] = (await safeStorage.encryptStringAsync(String(value))).toString('base64');
    await writeJson(secretsFile(), all);
  });
};

const deleteSecret = (key: string): Promise<void> => {
  assertKey(key);
  return serialSecrets(async () => {
    const all = await readJson(secretsFile());
    delete all[key];
    await writeJson(secretsFile(), all);
  });
};

handle('secrets:isAvailable', async () => secretsAvailable());
handle('secrets:get', async (_e, key: string) => getSecret(key));
handle('secrets:set', async (_e, key: string, value: string) => setSecret(key, value));
handle('secrets:delete', async (_e, key: string) => deleteSecret(key));

// ---------------------------------------------------------------------------
// Spotify (solo biblioteca): OAuth PKCE y lecturas en main; el renderer nunca ve tokens
// ---------------------------------------------------------------------------
const spotify = createSpotify({
  getSecret,
  setSecret,
  deleteSecret,
  secretsAvailable,
  openExternal: async (url) => {
    // Solo la página de autorización de Spotify
    if (!url.startsWith('https://accounts.spotify.com/authorize?')) throw new Error('URL no permitida');
    if (DEBUG) console.log(`[spotify-auth-url] ${url}`);
    await shell.openExternal(url);
  }
});

// Píxeles 32x32 de una carátula de Navidrome (el canvas del renderer no puede leerla: sin CORS)
handle('media:coverPixels', async (_e, raw: string) => {
  const url = await allowedCoverUrl(String(raw));
  if (!url) return null;
  const res = await net.fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) return null;
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const bgra = img.resize({ width: 32, height: 32 }).toBitmap(); // BGRA → RGBA
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  return { width: 32, height: 32, data: rgba };
});

handle('spotify:status', () => spotify.status());
handle('spotify:login', () => spotify.login());
handle('spotify:logout', () => spotify.logout());
handle('spotify:api', (_e, path: string) => spotify.api(path));
