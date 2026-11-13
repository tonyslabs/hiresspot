// Servidor de desarrollo de la landing: estático, sin caché y con recarga en vivo (SSE).
// Uso: node apps/landing/dev-server.mjs [puerto]   → http://127.0.0.1:5280  (y por la IP de Tailscale, para verla en el móvil)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 5280;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const SKIP = new Set(['dev-server.mjs']);

const clients = new Set();
let timer;
watch(ROOT, { recursive: true }, (_e, name) => {
  if (!name || SKIP.has(name) || name.startsWith('.')) return;
  clearTimeout(timer);
  timer = setTimeout(() => clients.forEach((res) => res.write(`data: reload\n\n`)), 80);
});

const RELOAD = `<script>new EventSource('/__live').onmessage=()=>location.reload()</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__live') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 500\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || SKIP.has(rel.replace(/^[/\\]/, ''))) { res.writeHead(404); return res.end('No encontrado'); }
  try {
    if (!(await stat(file)).isFile()) throw new Error('no es archivo');
    let body = await readFile(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    if (extname(file) === '.html') body = Buffer.from(body.toString('utf8').replace('</body>', `${RELOAD}</body>`));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
});

const hosts = ['127.0.0.1'];
try { hosts.push(execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).split('\n')[0].trim()); } catch { /* sin tailscale */ }
for (const host of hosts.filter(Boolean)) {
  http.createServer(server.listeners('request')[0]).listen(PORT, host, () => console.log(`landing en http://${host}:${PORT}`));
}
server.close();
