import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { net } from 'electron';
import type { SpotifyStatus } from '@hiresspot/core';

// ---------------------------------------------------------------------------
// Spotify: OAuth Authorization Code + PKCE (sin client secret) y proxy de lectura.
// Los tokens nunca salen de este módulo: el renderer solo recibe JSON de la Web API.
// ---------------------------------------------------------------------------

/** El Client ID es público (PKCE no usa secreto). */
const CLIENT_ID = '03db996255c94ad08855824fe3bd4349';
const SCOPES = ['user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'user-follow-read'].join(' ');
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_ORIGIN = 'https://api.spotify.com';
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;
const REFRESH_SECRET = 'spotify.refresh';

/** Solo lecturas de biblioteca: nada más sale hacia api.spotify.com. */
const ALLOWED_PATHS = [
  /^\/v1\/me$/,
  /^\/v1\/me\/(tracks|albums|playlists)$/,
  /^\/v1\/me\/following$/,
  /^\/v1\/albums\/[A-Za-z0-9]{1,64}\/tracks$/,
  /^\/v1\/playlists\/[A-Za-z0-9]{1,64}\/items$/
];

export interface SpotifyDeps {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  secretsAvailable(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
}

interface Tokens {
  access: string;
  expiresAt: number;
  refresh?: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>HiResSpot</title><body style="font-family:system-ui;background:#0b0b0e;color:#ececf1;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${title}</h1><p>${body}</p></div>`;

export const createSpotify = (deps: SpotifyDeps) => {
  let tokens: Tokens | null = null;
  let name: string | undefined;
  let loginInFlight: Promise<SpotifyStatus> | null = null;

  const tokenRequest = async (params: Record<string, string>): Promise<Tokens> => {
    const res = await net.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
      signal: AbortSignal.timeout(15_000)
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) throw new Error(json.error === 'invalid_grant' ? 'invalid_grant' : `Spotify rechazó la autorización (${res.status})`);
    return { access: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, refresh: json.refresh_token };
  };

  const persistRefresh = async (refresh?: string) => {
    if (refresh && (await deps.secretsAvailable())) await deps.setSecret(REFRESH_SECRET, refresh);
  };

  /** Token vigente; renueva con el refresh token (en memoria o del llavero). Null si hay que iniciar sesión. */
  const accessToken = async (): Promise<string | null> => {
    if (tokens && tokens.expiresAt - Date.now() > 60_000) return tokens.access;
    const refresh = tokens?.refresh ?? (await deps.getSecret(REFRESH_SECRET));
    if (!refresh) return null;
    try {
      const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
      tokens = { ...next, refresh: next.refresh ?? refresh };
      await persistRefresh(tokens.refresh);
      return tokens.access;
    } catch (err) {
      if (err instanceof Error && err.message === 'invalid_grant') {
        tokens = null;
        await deps.deleteSecret(REFRESH_SECRET);
      }
      return null;
    }
  };

  const apiGet = async (path: string, attempt = 0): Promise<unknown> => {
    if (typeof path !== 'string') throw new Error('Ruta inválida');
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN || !ALLOWED_PATHS.some((re) => re.test(url.pathname))) throw new Error('Ruta de Spotify no permitida');
    const token = await accessToken();
    if (!token) throw new Error('Sesión de Spotify no iniciada o caducada. Vuelve a conectar.');

    const res = await net.fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('retry-after') ?? 1), 10);
      await new Promise((r) => setTimeout(r, (Number.isFinite(wait) ? wait : 1) * 1000));
      return apiGet(path, attempt + 1);
    }
    if (res.status === 401 && attempt < 1) {
      if (tokens) tokens.expiresAt = 0; // fuerza el refresco
      return apiGet(path, attempt + 1);
    }
    if (res.status === 403) throw new Error('Spotify denegó el acceso (403). En modo desarrollo tu cuenta debe estar en la lista de usuarios de la app y el dueño necesita Premium.');
    if (!res.ok) throw new Error(`Spotify respondió ${res.status}`);
    return res.json();
  };

  const status = async (): Promise<SpotifyStatus> => {
    const connected = !!tokens || !!(await deps.getSecret(REFRESH_SECRET));
    return { connected, name };
  };

  const doLogin = async (): Promise<SpotifyStatus> => {
    const verifier = b64url(randomBytes(64));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));

    let server: Server | undefined;
    try {
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Se agotó el tiempo para autorizar en Spotify.')), LOGIN_TIMEOUT_MS);
        server = createServer((req, res) => {
          const u = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (u.pathname !== '/callback') {
            res.writeHead(404).end();
            return;
          }
          const err = u.searchParams.get('error');
          const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(ok ? page('Listo', 'Ya puedes volver a HiResSpot.') : page('No se pudo conectar', 'Cierra esta pestaña y vuelve a intentarlo en HiResSpot.'));
          clearTimeout(timer);
          if (ok) resolve(u.searchParams.get('code') as string);
          else reject(new Error(err === 'access_denied' ? 'Cancelaste la autorización en Spotify.' : 'Spotify devolvió una respuesta inválida.'));
        });
        server.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        // Puerto dinámico: Spotify admite cualquier puerto en redirects de loopback (127.0.0.1)
        server.listen(0, '127.0.0.1', () => {
          const { port } = server!.address() as AddressInfo;
          const redirect = `http://127.0.0.1:${port}/callback`;
          const auth = new URL(AUTH_URL);
          auth.search = new URLSearchParams({
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: redirect,
            scope: SCOPES,
            state,
            code_challenge_method: 'S256',
            code_challenge: challenge
          }).toString();
          // El redirect de este intento se recuerda en la closure para el intercambio de código
          (server as Server & { redirect?: string }).redirect = redirect;
          deps.openExternal(auth.toString()).catch(reject);
        });
      });

      const redirect = (server as Server & { redirect?: string }).redirect as string;
      const next = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
      tokens = next;
      await persistRefresh(next.refresh);
      try {
        const me = (await apiGet('/v1/me')) as { display_name?: string; id?: string };
        name = me.display_name || me.id;
      } catch {
        name = undefined;
      }
      return { connected: true, name };
    } finally {
      server?.close();
    }
  };

  return {
    status,
    /** Un solo inicio de sesión a la vez. */
    login: () => (loginInFlight ??= doLogin().finally(() => (loginInFlight = null))),
    logout: async () => {
      tokens = null;
      name = undefined;
      await deps.deleteSecret(REFRESH_SECRET);
    },
    api: apiGet
  };
};
