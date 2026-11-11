import React, { useEffect, useRef, useState } from 'react';
import { activeLineIndex, formatQuality, type Lyrics, type Track } from '@hiresspot/core';
import { Cover, EqBars, formatTime, IconButton, QualitySeal, ROW_HEIGHT, SeekBar, SourceChip, Transport, VolumeControl } from './components';
import { FidelityRing } from './Fidelity';
import { IconChevronDown, IconClose } from './icons';
import { useNavidrome } from './navidrome';
import { usePlayer, usePlayerState, useSmoothPosition } from './player';
import { VirtualList } from './VirtualList';

type PanelTab = 'queue' | 'lyrics';

const Segmented: React.FC<{ value: PanelTab; onChange: (v: PanelTab) => void }> = ({ value, onChange }) => (
  <div role="tablist" aria-label="Panel" className="flex items-center gap-0.5 bg-fill-1 rounded-full p-0.5">
    {([['queue', 'Cola'], ['lyrics', 'Letras']] as const).map(([id, label]) => (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={value === id}
        onClick={() => onChange(id)}
        className={`h-8 px-3.5 rounded-full text-callout transition-colors duration-[var(--dur-1)] ${
          value === id ? 'bg-fill-3 text-fg font-semibold shadow-[inset_0_1px_0_var(--glass-hi)]' : 'text-fg-2 hover:text-fg'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

/** Letras: sincronizadas (línea activa, clic para saltar) o texto plano; solo pistas de Navidrome con letra. */
const LyricsPanel: React.FC<{ track: Track | null }> = ({ track }) => {
  const nd = useNavidrome();
  const player = usePlayer();
  const position = useSmoothPosition();
  const [state, setState] = useState<{ id: string; lyrics: Lyrics | null } | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setState(null);
    nd.loadLyrics(track).then((lyrics) => !cancelled && setState({ id: track.id, lyrics }));
    return () => {
      cancelled = true;
    };
  }, [track?.id, nd.loadLyrics]); // eslint-disable-line react-hooks/exhaustive-deps

  const lyrics = state && track && state.id === track.id ? state.lyrics : undefined;
  const idx = lyrics?.synced ? activeLineIndex(lyrics.lines, position * 1000) : -1;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx]);

  if (!track) return <p className="p-6 text-callout text-fg-2">Nada reproduciendo.</p>;
  if (track.source !== 'navidrome') return <p className="p-6 text-callout text-fg-2">Las letras solo están disponibles para pistas de Navidrome.</p>;
  if (lyrics === undefined) return <div className="p-6 space-y-3">{[70, 90, 55, 80].map((w) => <div key={w} className="skeleton h-5" style={{ width: `${w}%` }} />)}</div>;
  if (!lyrics || lyrics.lines.length === 0) return <p className="p-6 text-callout text-fg-2">Esta pista no tiene letra en el servidor.</p>;

  return (
    <div className="flex-1 min-h-0 overflow-auto px-6 py-8 text-center">
      {lyrics.lines.map((l, i) => {
        const active = i === idx;
        const className = `block w-full py-1.5 text-title-2 transition-all duration-[var(--dur-3)] ease-glide ${
          active ? 'text-fg scale-100' : lyrics.synced ? 'text-fg-2 opacity-50 hover:opacity-80' : 'text-fg-2'
        }`;
        return lyrics.synced && l.timeMs !== null ? (
          <button key={i} ref={active ? activeRef : undefined} type="button" className={className} onClick={() => player.seek((l.timeMs ?? 0) / 1000)} aria-current={active}>
            {l.text || '♪'}
          </button>
        ) : (
          <p key={i} className={className}>{l.text || ' '}</p>
        );
      })}
    </div>
  );
};

/**
 * Pantalla completa "Reproduciendo": la carátula manda. Sin fondo propio: deja ver el lienzo ambiental
 * (con la aurora viva y el scrim más suave), y solo lleva 3 vidrios: panel, cápsula de controles y Play.
 */
export const NowPlaying: React.FC<{ onClose: () => void; initialTab?: PanelTab }> = ({ onClose, initialTab = 'queue' }) => {
  const player = usePlayer();
  const s = usePlayerState();
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);
  const playing = s.status === 'playing' || s.status === 'loading';

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = s.current;
  const upcoming = Math.max(0, s.queue.length - s.index - 1);

  return (
    <div role="dialog" aria-modal="true" aria-label="Reproduciendo" className="fixed inset-0 z-[60] grid grid-rows-[auto_minmax(0,1fr)] p-6 gap-4">
      <div className="flex items-center justify-between">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar (Esc)"
          title="Cerrar (Esc)"
          className="grid place-items-center w-9 h-9 rounded-full bg-fill-1 hover:bg-fill-2 transition-colors"
        >
          <IconChevronDown size={22} />
        </button>
        <div className="text-micro uppercase text-fg-2">Reproduciendo</div>
        <span className="w-9" />
      </div>

      <div className="grid gap-8 min-h-0 grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        {/* ---- Izquierda: carátula, datos y controles ---- */}
        <div className="flex flex-col items-center justify-center gap-5 min-h-0 min-w-0 mx-auto w-full max-w-[560px]">
          <div className="relative" style={{ width: 'min(46vh, 440px)', aspectRatio: '1 / 1' }}>
            {t?.coverUrl ? (
              <img
                src={t.coverUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover rounded-island transition-all duration-[var(--dur-3)] ease-spring"
                style={{ filter: 'blur(48px) saturate(1.6)', opacity: playing ? 0.55 : 0.3, transform: 'translateY(28px) scale(0.92)' }}
              />
            ) : null}
            <Cover
              src={t?.coverUrl}
              seed={t ? `${t.album}|${t.artist}` : undefined}
              className={`relative w-full h-full rounded-island shadow-lift transition-transform duration-[var(--dur-3)] ease-spring ${playing ? 'scale-100' : 'scale-[0.94]'}`}
            />
          </div>

          <div className="text-center max-w-full w-full">
            <div className="text-display line-clamp-2 [text-wrap:balance]" title={t?.title}>{t?.title ?? 'Nada reproduciendo'}</div>
            <div className="text-title-2 text-fg-2 font-medium truncate mt-1">{t?.artist ?? ''}</div>
            <div className="text-callout text-fg-2 truncate">{t?.album ?? ''}</div>
            {t ? (
              <div className="mt-3 flex items-center justify-center gap-2.5 flex-wrap">
                <FidelityRing track={t} />
                <QualitySeal track={t} size="lg" />
                <span className="font-mono text-callout text-fg-2">{formatQuality(t)}</span>
                <SourceChip source={t.source} />
              </div>
            ) : null}
            {s.error ? <div className="text-callout text-danger mt-2">Error: {s.error}</div> : null}
          </div>

          <div className="w-full max-w-[520px]">
            <SeekBar />
          </div>

          <div className="glass-regular flex items-center gap-4 h-[84px] px-6" style={{ borderRadius: 999 }}>
            <Transport large />
            <VolumeControl />
          </div>
        </div>

        {/* ---- Derecha: cola / letras ---- */}
        <div className="glass-regular rounded-island flex flex-col min-h-0 overflow-hidden" style={{ borderRadius: 28 }}>
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
            <Segmented value={tab} onChange={setTab} />
            {tab === 'queue' ? (
              <button type="button" className="text-callout text-fg-2 hover:text-danger px-2 py-1 rounded-ctl" onClick={() => player.clear()}>
                Vaciar
              </button>
            ) : null}
          </div>

          {tab === 'queue' ? (
            <>
              <div className="px-4 pb-2 text-caption text-fg-2">
                A continuación · {upcoming} · {s.queue.length} en total
              </div>
              {s.queue.length === 0 ? (
                <p className="p-4 text-callout text-fg-2">La cola está vacía.</p>
              ) : (
                <VirtualList
                  className="flex-1 min-h-0"
                  items={s.queue}
                  rowHeight={ROW_HEIGHT - 8}
                  initialIndex={s.index}
                  padEnd={8}
                  getKey={(tr, i) => `${tr.id}:${i}`}
                  renderRow={(tr, i) => (
                    <div
                      className={`group mx-2 px-2 h-full flex items-center gap-3 rounded-ctl transition-colors duration-[var(--dur-1)] ${
                        i === s.index ? 'bg-tint-soft' : 'hover:bg-fill-1'
                      } ${i < s.index ? 'opacity-55' : ''}`}
                    >
                      <button type="button" className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => player.jumpTo(i)} aria-label={`Reproducir ${tr.title}`}>
                        <div className="relative w-10 h-10 shrink-0">
                          <Cover src={tr.coverUrl} seed={`${tr.album}|${tr.artist}`} className="w-10 h-10 rounded-lg" />
                          {i === s.index ? (
                            <div className="absolute inset-0 rounded-lg bg-black/45 grid place-items-center">
                              <EqBars />
                            </div>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <div className={`truncate text-callout ${i === s.index ? 'font-semibold' : 'font-medium'}`}>{tr.title}</div>
                          <div className="truncate text-caption text-fg-2">{tr.artist}</div>
                        </div>
                      </button>
                      <span className="text-caption text-fg-2 tabular-nums">{formatTime(tr.duration)}</span>
                      <IconButton
                        label={`Quitar ${tr.title} de la cola`}
                        onClick={() => player.removeAt(i)}
                        className="!w-7 !h-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <IconClose size={14} />
                      </IconButton>
                    </div>
                  )}
                />
              )}
            </>
          ) : (
            <LyricsPanel track={t} />
          )}
        </div>
      </div>
    </div>
  );
};
