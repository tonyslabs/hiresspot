/**
 * HTTP inyectable. En escritorio las peticiones pasan por el proceso main (sin CORS ni CSP del
 * renderer); en pruebas y entornos sin esas restricciones sirve `fetchHttp`.
 */
export interface HttpOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
}

export type HttpClient = (url: string, options?: HttpOptions) => Promise<HttpResponse>;

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Implementación basada en `fetch` global, con timeout. */
export const fetchHttp: HttpClient = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, statusText: res.statusText, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};
