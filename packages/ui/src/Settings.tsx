import React, { useEffect, useState } from 'react';
import type { ReplayGainMode } from '@hiresspot/core';
import { useLocal } from './local';
import { useNavidrome } from './navidrome';
import { usePlatform } from './platform';
import { usePlayer, usePlayerState } from './player';
import { useSpotify } from './spotify';
import { useTheme, type ThemeChoice } from './theme';
import { ColorSettings } from './ColorSettings';
import { EqualizerPanel, RateSelect, ShortcutList } from './PlaybackSettings';

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="mb-8">
    <h3 className="text-micro text-muted mb-2 px-4 uppercase">{title}</h3>
    <div className="rounded-panel bg-fill-1 divide-y divide-line-soft">{children}</div>
  </section>
);

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-6 px-4 py-3.5 min-h-[56px]">
    <div className="min-w-0">
      <div className="text-body font-medium">{label}</div>
      {hint ? <div className="text-callout text-muted">{hint}</div> : null}
    </div>
    <div className="shrink-0 flex items-center gap-2">{children}</div>
  </div>
);

const selectCls = 'ctl-select h-9 pl-3 pr-9 rounded-ctl text-callout';
const btnCls = 'h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout';
const dangerBtnCls = 'h-9 px-3.5 rounded-ctl bg-fill-2 text-callout text-danger hover:bg-danger/10';

export const Settings: React.FC = () => {
  const platform = usePlatform();
  const player = usePlayer();
  const { replayGain } = usePlayerState();
  const { theme, setTheme, glass, setGlass, motion, setMotion, ambient, setAmbient } = useTheme();
  const nd = useNavidrome();
  const sp = useSpotify();
  const local = useLocal();
  const [tolerance, setTolerance] = useState(3);
  const [preventSleep, setPreventSleep] = useState(true);

  useEffect(() => {
    platform.settings
      .get<number>('compareTolerance')
      .then((v) => typeof v === 'number' && setTolerance(v))
      .catch(() => {});
  }, [platform]);

  useEffect(() => {
    platform.settings
      .get<boolean>('preventSleep')
      .then((v) => setPreventSleep(v !== false))
      .catch(() => {});
  }, [platform]);

  const changePreventSleep = (on: boolean) => {
    setPreventSleep(on);
    platform.settings
      .set('preventSleep', on)
      .then(() => window.dispatchEvent(new Event('hiresspot:settings')))
      .catch(() => {});
  };

  const changeReplayGain = (mode: ReplayGainMode) => {
    player.setReplayGain(mode);
    platform.settings.set('replayGain', mode).catch(() => {});
  };

  const changeTolerance = (v: number) => {
    const clamped = Math.min(10, Math.max(0, Number.isFinite(v) ? v : 3));
    setTolerance(clamped);
    platform.settings.set('compareTolerance', clamped).catch(() => {});
  };

  return (
    <div className="page">
      <div className="max-w-[720px]">
      <h2 className="text-title-1 mb-6">Ajustes</h2>

      <Group title="Apariencia">
        <Row label="Tema">
          <select className={selectCls} value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
            <option value="system">Sistema</option>
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
        </Row>
        <Row label="Transparencia" hint="Vidrio translúcido o superficies sólidas (más contraste y menos carga gráfica).">
          <select className={selectCls} value={glass} onChange={(e) => setGlass(e.target.value as 'auto' | 'reduced')}>
            <option value="auto">Automática</option>
            <option value="reduced">Reducida</option>
          </select>
        </Row>
        <Row label="Movimiento" hint="Reduce animaciones y transiciones.">
          <select className={selectCls} value={motion} onChange={(e) => setMotion(e.target.value as 'auto' | 'reduced')}>
            <option value="auto">Automático</option>
            <option value="reduced">Reducido</option>
          </select>
        </Row>
        <Row label="Fondo ambiental" hint="Tiñe la app con los colores de la carátula que suena.">
          <select className={selectCls} value={ambient ? 'on' : 'off'} onChange={(e) => setAmbient(e.target.value === 'on')}>
            <option value="on">Activado</option>
            <option value="off">Desactivado</option>
          </select>
        </Row>
      </Group>

      <Group title="Colores">
        <ColorSettings />
      </Group>

      <Group title="Reproducción">
        <Row label="Normalización (ReplayGain)" hint="Solo baja el volumen de pistas fuertes; nunca lo sube por encima del original.">
          <select className={selectCls} value={replayGain} onChange={(e) => changeReplayGain(e.target.value as ReplayGainMode)}>
            <option value="off">Desactivada</option>
            <option value="track">Por pista</option>
            <option value="album">Por álbum</option>
          </select>
        </Row>
        {platform.power ? (
          <Row label="Evitar suspensión" hint="El sistema no se suspende mientras suena música.">
            <select className={selectCls} value={preventSleep ? 'on' : 'off'} onChange={(e) => changePreventSleep(e.target.value === 'on')}>
              <option value="on">Activado</option>
              <option value="off">Desactivado</option>
            </select>
          </Row>
        ) : null}
        <Row label="Velocidad" hint="Cambia el ritmo sin alterar el tono.">
          <RateSelect />
        </Row>
      </Group>

      <Group title="Ecualizador">
        <EqualizerPanel />
      </Group>

      <Group title="Atajos de teclado">
        <ShortcutList />
      </Group>

      <Group title="Comparación de bibliotecas">
        <Row label="Tolerancia de duración" hint="Diferencia máxima, en segundos, para dar por iguales dos pistas emparejadas por título y artista.">
          <input type="number" min={0} max={10} step={1} value={tolerance} onChange={(e) => changeTolerance(Number(e.target.value))} className="ctl-input h-9 px-3 rounded-ctl text-callout w-20" aria-label="Tolerancia en segundos" />
          <span className="text-callout text-muted">s</span>
        </Row>
      </Group>

      <Group title="Bibliotecas locales">
        <Row label="Carpetas de música" hint="FLAC y WAV de estas carpetas aparecen en Local. Solo se lee de las carpetas que autorices.">
          <button type="button" className={btnCls} onClick={() => local.addFolder()}>Agregar carpeta…</button>
          {local.roots.length > 0 ? <button type="button" className={btnCls} onClick={() => local.reload()}>Recargar</button> : null}
        </Row>
        {local.roots.map((r) => (
          <Row key={r} label={r.split('/').pop() || r} hint={r}>
            <button type="button" className={dangerBtnCls} onClick={() => local.removeFolder(r)}>Quitar</button>
          </Row>
        ))}
      </Group>

      <Group title="Cuentas y sesiones">
        <Row
          label="Almacenamiento seguro"
          hint={nd.canRemember ? 'Llavero del sistema disponible: las sesiones se guardan cifradas y se restauran al abrir la app.' : 'No hay llavero del sistema (GNOME Keyring, KWallet, KeePassXC…): las sesiones no se pueden guardar.'}
        >
          <span className={`text-callout ${nd.canRemember ? 'text-ok' : 'text-muted'}`}>{nd.canRemember ? 'Disponible' : 'No disponible'}</span>
        </Row>
        <Row label="Navidrome" hint={nd.saved ? `${nd.saved.username} @ ${nd.saved.baseUrl}` : 'Sin servidor configurado'}>
          <span className={`text-callout ${nd.status === 'ready' ? 'text-ok' : 'text-muted'}`}>{nd.status === 'ready' ? 'Conectado' : nd.status === 'disconnected' ? 'Sin conexión' : nd.status}</span>
          {nd.saved ? (
            <>
              <button type="button" className={btnCls} onClick={() => nd.disconnect(false)} disabled={nd.status === 'disconnected'}>Desconectar</button>
              <button type="button" className={dangerBtnCls} onClick={() => nd.disconnect(true)}>Olvidar</button>
            </>
          ) : null}
        </Row>
        <Row label="Spotify" hint={sp.name ? `Cuenta: ${sp.name}` : 'Sin cuenta conectada'}>
          <span className={`text-callout ${sp.status === 'ready' ? 'text-ok' : 'text-muted'}`}>{sp.status === 'ready' ? 'Conectado' : sp.status === 'disconnected' ? 'Sin conexión' : sp.status}</span>
          {sp.tracks.length > 0 || sp.status !== 'disconnected' ? (
            <button type="button" className={dangerBtnCls} onClick={() => sp.disconnect()}>Desconectar y olvidar</button>
          ) : null}
        </Row>
      </Group>
      </div>
    </div>
  );
};
