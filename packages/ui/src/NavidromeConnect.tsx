import React, { useEffect, useState } from 'react';
import { useNavidrome } from './navidrome';

const STATUS_LABEL = {
  disconnected: 'Sin conexión',
  connecting: 'Conectando…',
  syncing: 'Sincronizando biblioteca…',
  ready: 'Conectado',
  error: 'Error'
} as const;

const field =
  'w-full h-11 px-3.5 rounded-ctl bg-fill-1 border border-line-soft text-fg outline-none focus:border-tint focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--tint)_22%,transparent)]';

export const NavidromeConnect: React.FC = () => {
  const nd = useNavidrome();
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  // Precargar URL y usuario guardados (nunca la contraseña)
  useEffect(() => {
    if (nd.saved) {
      setBaseUrl((v) => v || nd.saved!.baseUrl);
      setUsername((v) => v || nd.saved!.username);
    }
  }, [nd.saved]);

  const busy = nd.status === 'connecting' || nd.status === 'syncing';
  const connected = nd.server !== null && (nd.status === 'ready' || nd.status === 'syncing');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await nd.connect({ baseUrl, username, password }, remember);
    if (ok) setPassword('');
  };

  return (
    <section className="max-w-[440px] mx-auto mt-[8vh] rounded-panel bg-fill-1 p-8">
      <h2 className="text-title-2 mb-2">Navidrome</h2>
      <p className="text-callout text-muted mb-6">Conecta tu servidor Navidrome (o cualquier servidor compatible con Subsonic/OpenSubsonic) para escuchar tu biblioteca en calidad original.</p>

      <div className="flex items-center gap-2 mb-4 text-callout">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            nd.status === 'ready' ? 'bg-ok' : nd.status === 'error' ? 'bg-danger' : busy ? 'bg-tint' : 'bg-muted'
          }`}
        />
        <span>{STATUS_LABEL[nd.status]}</span>
        {nd.status === 'syncing' ? <span className="text-muted">({nd.progress} pistas)</span> : null}
      </div>

      {nd.error ? (
        <div className="mb-4 rounded-ctl bg-danger/10 text-danger px-3.5 py-2.5 text-callout" role="alert">{nd.error}</div>
      ) : null}

      {connected ? (
        <div className="space-y-4">
          <div className="rounded-ctl bg-fill-1 border border-line-soft p-4 font-mono text-callout space-y-1">
            <div><span className="text-muted">Servidor:</span> {nd.saved?.baseUrl}</div>
            <div><span className="text-muted">Usuario:</span> {nd.saved?.username}</div>
            <div>
              <span className="text-muted">Software:</span> {nd.server?.type ?? 'desconocido'} {nd.server?.serverVersion ?? ''}
              <span className="text-muted"> · API {nd.server?.apiVersion}{nd.server?.openSubsonic ? ' · OpenSubsonic' : ''}</span>
            </div>
            <div><span className="text-muted">Biblioteca:</span> {nd.tracks.length} pistas</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout disabled:opacity-50" disabled={busy} onClick={() => nd.resync()}>Resincronizar</button>
            <button className="h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout" onClick={() => nd.disconnect(false)}>Desconectar</button>
            <button className="h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout text-danger" onClick={() => nd.disconnect(true)}>Olvidar servidor</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-caption text-fg-2 mb-1.5">URL del servidor</span>
            <input className={field} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://100.76.255.29:4533" autoComplete="url" spellCheck={false} />
          </label>
          <label className="block">
            <span className="block text-caption text-fg-2 mb-1.5">Usuario</span>
            <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
          </label>
          <label className="block">
            <span className="block text-caption text-fg-2 mb-1.5">Contraseña</span>
            <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <label className={`flex items-center gap-2 text-callout text-fg-2 ${nd.canRemember ? '' : 'opacity-60'}`}>
            <input type="checkbox" checked={remember && nd.canRemember} disabled={!nd.canRemember} onChange={(e) => setRemember(e.target.checked)} />
            Recordar contraseña en el llavero del sistema
          </label>
          {!nd.canRemember ? (
            <p className="text-caption text-muted">No se detectó un llavero del sistema (en Linux hace falta GNOME Keyring o KWallet), así que la contraseña no se guardará y habrá que escribirla en cada inicio.</p>
          ) : null}
          <button type="submit" disabled={busy} className="w-full h-11 rounded-full bg-tint text-tint-fg font-semibold hover:opacity-90 disabled:opacity-50">
            {busy ? 'Conectando…' : 'Conectar'}
          </button>
        </form>
      )}
    </section>
  );
};
