import React, { useRef, useState } from 'react';
import { fallbackPalette, fidelity, formatQuality, formatSpec, hslToCss, isHiRes, qualityTier, type SourceKind, type Track } from '@hiresspot/core';
import { useLensFilter } from './glass';
import {
  IconHeart,
  IconHeartFill,
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconShuffle,
  IconVolume
} from './icons';
import { usePlayer, usePlayerState, useSmoothPosition } from './player';
import { useIsMobile } from './useMediaQuery';
import { useTrackMenu } from './TrackMenu';

export const formatTime = (sec?: number) => {
  if (!sec || Number.isNaN(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
};

export const ROW_HEIGHT = 60;

const REPEAT_LABEL = { off: 'Repetir: no', all: 'Repetir: todo', one: 'Repetir: una' } as const;
const NEXT_REPEAT = { off: 'all', all: 'one', one: 'off' } as const;

export const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ label, onClick, active, children, className = '' }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={active}
    onClick={onClick}
    className={`grid place-items-center w-9 h-9 max-md:w-11 max-md:h-11 rounded-full transition-colors duration-[var(--dur-1)] hover:bg-fill-2 ${
      active ? 'text-tint' : 'text-fg-2 hover:text-fg'
    } ${className}`}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Fuente y calidad
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<SourceKind, string> = { local: 'Local', navidrome: 'Navidrome', spotify: 'Spotify' };

/** Chip con el color fijo de cada fuente (variante `dot`: solo el punto, para filas densas). */
export const SourceChip: React.FC<{ source: SourceKind; dot?: boolean; className?: string }> = ({ source, dot, className = '' }) => {
  const color = `var(--src-${source})`;
  if (dot) {
    return <span title={SOURCE_LABEL[source]} aria-label={SOURCE_LABEL[source]} className={`inline-block w-2 h-2 rounded-full ${className}`} style={{ background: color }} />;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-micro uppercase ${className}`}
      style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {SOURCE_LABEL[source]}
    </span>
  );
};

/** Sello de calidad: dorado y con relieve para Hi-Res, discreto para el resto. */
export const QualitySeal: React.FC<{ track: Track; size?: 'sm' | 'lg' }> = ({ track, size = 'sm' }) => {
  const tier = qualityTier(track);
  const spec = formatSpec(track);
  if (tier === 'unknown' || !spec) return null;
  const aria = { hires: 'Alta resolución', lossless: 'Sin pérdida', lossy: 'Con pérdida', unknown: '' }[tier] + `, ${spec}`;
  const lg = size === 'lg';
  if (tier === 'hires') {
    return (
      <span
        aria-label={aria}
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-chip font-mono text-micro text-gold-fg ${lg ? 'h-7 px-2.5' : 'h-[18px] px-1.5'}`}
        style={{
          background: 'linear-gradient(135deg, #f8d67a, #f5b83d 45%, #c98a12)',
          boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.5), 0 1px 2px rgb(0 0 0 / 0.25)'
        }}
      >
        {lg ? <span>HI-RES</span> : null}
        {lg ? <span className="opacity-50">|</span> : null}
        <span>{spec}</span>
      </span>
    );
  }
  if (tier === 'lossless') {
    return (
      <span aria-label={aria} className={`shrink-0 inline-flex items-center rounded-chip border border-line font-mono text-micro text-fg-2 ${lg ? 'h-7 px-2.5' : 'h-[18px] px-1.5'}`}>
        {lg ? `LOSSLESS · ${spec}` : spec}
      </span>
    );
  }
  return (
    <span aria-label={aria} className={`shrink-0 font-mono text-micro ${lg ? 'text-fg-2' : 'text-muted'}`}>
      {spec}
    </span>
  );
};

/** Compatibilidad con código que aún usa el nombre antiguo. */
export const QualityBadge: React.FC<{ track: Track }> = ({ track }) => (isHiRes(track) ? <QualitySeal track={track} /> : null);

/** Ecualizador decorativo (no reacciona al audio: es un icono, no un medidor). */
export const EqBars: React.FC = () => (
  <span className="eq" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

export const Cover: React.FC<{ src?: string; alt?: string; className?: string; seed?: string }> = ({ src, alt = '', className = '', seed }) => {
  let fallback: string | undefined;
  if (!src && seed) {
    const sw = fallbackPalette(seed).swatches;
    fallback = `linear-gradient(135deg, ${hslToCss(sw[0])}, ${hslToCss(sw[1] ?? sw[0])})`;
  }
  return (
    <div className={`overflow-hidden bg-fill-2 shrink-0 ${className}`} style={fallback ? { background: fallback } : undefined}>
      {src ? <img src={src} alt={alt} loading="lazy" className="w-full h-full object-cover" /> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Fila de pista (alto fijo 60: va dentro de listas virtualizadas)
// ---------------------------------------------------------------------------

export const TrackRow: React.FC<{
  track: Track;
  index?: number;
  subtitle: string;
  showCover?: boolean;
  playing?: boolean;
  /** Sin `onPlay` la fila es de solo lectura (p. ej. Spotify: no entrega audio). */
  onPlay?: () => void;
  onToggleFavorite?: () => void;
}> = ({ track, index, subtitle, showCover, playing, onPlay, onToggleFavorite }) => {
  const menu = useTrackMenu();
  const playBtn = onPlay ? (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Reproducir ${track.title}`}
      title="Reproducir"
      className="grid place-items-center w-full h-full text-fg opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
    >
      <IconPlay size={14} />
    </button>
  ) : null;

  return (
    <div
      className={`group select-none mx-2 px-2 h-full flex items-center gap-3 rounded-ctl transition-colors duration-[var(--dur-1)] ${
        playing ? 'bg-tint-soft' : 'hover:bg-fill-1'
      }`}
      onDoubleClick={onPlay}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              menu.open(track, e.clientX, e.clientY);
            }
          : undefined
      }
    >
      {showCover ? (
        <div className="relative w-11 h-11 shrink-0">
          <Cover src={track.coverUrl} seed={`${track.album}|${track.artist}`} className="w-11 h-11 rounded-lg shadow-cover" />
          <div className={`absolute inset-0 rounded-lg grid place-items-center ${playing ? 'bg-black/45' : 'group-hover:bg-black/45'}`}>
            {playing ? <EqBars /> : playBtn}
          </div>
        </div>
      ) : (
        <div className="relative w-8 h-8 shrink-0 grid place-items-center text-callout text-muted tabular-nums">
          {playing ? (
            <EqBars />
          ) : (
            <>
              <span className={onPlay ? 'group-hover:opacity-0' : ''}>{index !== undefined ? index + 1 : ''}</span>
              <span className="absolute inset-0">{playBtn}</span>
            </>
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-headline truncate ${playing ? 'font-semibold' : ''}`} title={track.title}>{track.title}</div>
        <div className="text-callout text-muted truncate" title={subtitle}>{subtitle}</div>
      </div>
      <QualitySeal track={track} />
      {onToggleFavorite ? (
        <button
          type="button"
          className={`p-1 rounded ${track.favorite ? 'text-danger' : 'text-muted hover:text-fg opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
          onClick={onToggleFavorite}
          title={track.favorite ? 'Quitar de favoritos' : 'Marcar como favorita'}
          aria-label={track.favorite ? 'Quitar de favoritos' : 'Marcar como favorita'}
          aria-pressed={!!track.favorite}
        >
          {track.favorite ? <IconHeartFill size={18} /> : <IconHeart size={18} />}
        </button>
      ) : null}
      <div className="text-caption text-muted w-12 text-right tabular-nums">{formatTime(track.duration)}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Progreso, transporte y volumen
// ---------------------------------------------------------------------------

/** Barra de progreso con teclado (←/→ ±5 s). `inline`: línea fina pegada al borde del display del dock. */
export const SeekBar: React.FC<{ variant?: 'full' | 'inline' }> = ({ variant = 'full' }) => {
  const player = usePlayer();
  const { duration } = usePlayerState();
  const livePosition = useSmoothPosition();
  // Mientras se arrastra se muestra la posición bajo el puntero; el salto real se hace al soltar
  // (buscar en cada movimiento satura los streams remotos y corta el audio).
  const [drag, setDrag] = useState<number | null>(null);
  const position = drag !== null ? drag * duration : livePosition;
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  const inline = variant === 'inline';

  const ratioAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
  };

  const slider = (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Posición"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={`${formatTime(position)} de ${formatTime(duration)}`}
      className={`group/seek cursor-pointer select-none touch-none flex items-center ${inline ? 'absolute inset-x-4 bottom-0 h-5 items-end pb-1.5' : 'relative h-6 flex-1'}`}
      onPointerDown={(e) => {
        if (e.button !== 0 || !duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(ratioAt(e));
      }}
      onPointerMove={(e) => {
        if (drag !== null) setDrag(ratioAt(e));
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        const r = ratioAt(e);
        setDrag(null);
        player.seekRatio(r);
      }}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') player.seek(position + 5);
        else if (e.key === 'ArrowLeft') player.seek(Math.max(0, position - 5));
        else return;
        e.preventDefault();
      }}
    >
      <div className={`w-full rounded-full bg-fill-2 transition-[height] duration-[var(--dur-1)] ${inline ? 'h-[3px] group-hover/seek:h-[5px]' : 'h-1.5 group-hover/seek:h-2'} ${drag !== null ? (inline ? '!h-[5px]' : '!h-2') : ''}`}>
        <div className="h-full rounded-full bg-tint" style={{ width: `${pct}%` }} />
      </div>
      <span
        aria-hidden="true"
        className={`absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-fg shadow-lift pointer-events-none transition-opacity duration-[var(--dur-1)] ${
          drag !== null ? 'opacity-100 scale-110' : 'opacity-0 group-hover/seek:opacity-100 group-focus-visible/seek:opacity-100'
        } ${inline ? 'bottom-[3px]' : 'top-1/2 -translate-y-1/2'}`}
        style={{ left: inline ? `calc(${pct}% )` : `${pct}%` }}
      />
    </div>
  );

  if (inline) return slider;
  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-caption text-fg-2 tabular-nums w-10 text-right">{formatTime(position)}</span>
      {slider}
      <span className="text-caption text-fg-2 tabular-nums w-10">{formatTime(duration)}</span>
    </div>
  );
};

export const PlayButton: React.FC<{ size: number; glass?: boolean }> = ({ size, glass }) => {
  const player = usePlayer();
  const s = usePlayerState();
  const busy = s.status === 'playing' || s.status === 'loading';
  const ref = useRef<HTMLButtonElement>(null);
  useLensFilter(ref, { id: 'lens-play', radius: 999, bezel: 16, scale: 56 });
  const dim = `${size}px`;
  return (
    <button
      ref={glass ? ref : undefined}
      type="button"
      onClick={() => player.toggle()}
      aria-label={busy ? 'Pausa' : 'Reproducir'}
      title={busy ? 'Pausa' : 'Reproducir'}
      style={{ width: dim, height: dim }}
      className={`grid place-items-center rounded-full transition-transform duration-[var(--dur-2)] ease-spring ${
        glass ? 'glass-lens glass-press text-fg' : 'bg-fg text-bg hover:scale-105 active:scale-95'
      }`}
    >
      {busy ? <IconPause size={Math.round(size * 0.45)} /> : <IconPlay size={Math.round(size * 0.45)} />}
    </button>
  );
};

/** Anterior · Play · Siguiente (el dock). */
export const TransportMini: React.FC = () => {
  const player = usePlayer();
  return (
    <div className="flex items-center gap-1.5">
      <IconButton label="Anterior" onClick={() => player.prev()}>
        <IconPrev />
      </IconButton>
      <PlayButton size={44} />
      <IconButton label="Siguiente" onClick={() => player.next()}>
        <IconNext />
      </IconButton>
    </div>
  );
};

export const ShuffleRepeat: React.FC = () => {
  const player = usePlayer();
  const s = usePlayerState();
  return (
    <>
      <IconButton label="Aleatorio" active={s.shuffle} onClick={() => player.setShuffle(!s.shuffle)} className="!w-7 !h-7">
        <IconShuffle size={16} />
      </IconButton>
      <IconButton label={REPEAT_LABEL[s.repeat]} active={s.repeat !== 'off'} onClick={() => player.setRepeat(NEXT_REPEAT[s.repeat])} className="!w-7 !h-7">
        <span className="relative grid place-items-center">
          <IconRepeat size={16} />
          {s.repeat === 'one' ? <span className="absolute text-[8px] font-bold leading-none">1</span> : null}
        </span>
      </IconButton>
    </>
  );
};

/** Transporte completo (pantalla Reproduciendo): Play grande de vidrio con lente. */
export const Transport: React.FC<{ large?: boolean }> = ({ large }) => {
  const player = usePlayer();
  const s = usePlayerState();
  return (
    <div className="flex items-center gap-3">
      <IconButton label="Aleatorio" active={s.shuffle} onClick={() => player.setShuffle(!s.shuffle)}>
        <IconShuffle />
      </IconButton>
      <IconButton label="Anterior" onClick={() => player.prev()}>
        <IconPrev size={large ? 26 : 20} />
      </IconButton>
      <PlayButton size={large ? 64 : 44} glass={large} />
      <IconButton label="Siguiente" onClick={() => player.next()}>
        <IconNext size={large ? 26 : 20} />
      </IconButton>
      <IconButton label={REPEAT_LABEL[s.repeat]} active={s.repeat !== 'off'} onClick={() => player.setRepeat(NEXT_REPEAT[s.repeat])}>
        <span className="relative grid place-items-center">
          <IconRepeat />
          {s.repeat === 'one' ? <span className="absolute text-[9px] font-bold leading-none">1</span> : null}
        </span>
      </IconButton>
    </div>
  );
};

export const VolumeControl: React.FC = () => {
  const player = usePlayer();
  const s = usePlayerState();
  return (
    <div className="group/vol flex items-center">
      <IconButton label={s.muted ? 'Quitar silencio' : 'Silenciar'} onClick={() => player.setMuted(!s.muted)}>
        {s.muted || s.volume === 0 ? <IconMute /> : <IconVolume />}
      </IconButton>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={s.muted ? 0 : s.volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        className="w-0 opacity-0 group-hover/vol:w-[88px] group-hover/vol:opacity-100 group-focus-within/vol:w-[88px] group-focus-within/vol:opacity-100 transition-all duration-[var(--dur-2)] ease-glide"
        style={{ accentColor: 'var(--tint)' }}
        aria-label="Volumen"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dock: barra de reproducción flotante (lente) con "display" central tipo LCD
// ---------------------------------------------------------------------------

export const NowPlayingBar: React.FC<{ onOpen: () => void; queueOpen: boolean }> = ({ onOpen, queueOpen }) => {
  const s = usePlayerState();
  const dockRef = useRef<HTMLElement>(null);
  useLensFilter(dockRef, { id: 'lens-dock', radius: 999, bezel: 22, scale: 80 });
  const t = s.current;
  // En el teléfono el dock es un mini reproductor: carátula, título y play. El resto está en "Reproduciendo".
  const mobile = useIsMobile();

  return (
    <footer
      ref={dockRef}
      className={`glass-lens fixed z-40 grid items-center px-3 ${
        mobile ? 'h-[64px] grid-cols-[minmax(0,1fr)_auto] gap-2' : 'h-[68px] grid-cols-[auto_minmax(0,1fr)_auto] gap-3'
      }`}
      style={{ bottom: 'var(--dock-bottom)', left: 'var(--chrome-left)', right: 'var(--gutter)', marginInline: 'auto', maxWidth: 1040 }}
    >
      {mobile ? null : (
        <div className={t ? '' : 'opacity-40'}>
          <TransportMini />
        </div>
      )}

      <div className={`relative rounded-full bg-fill-display overflow-hidden flex items-center h-[52px]`}>
        <button
          type="button"
          onClick={onOpen}
          disabled={!t}
          aria-label="Abrir pantalla Reproduciendo"
          className="flex-1 min-w-0 h-full flex items-center gap-3 pl-2 pr-3 text-left disabled:cursor-default"
        >
          <Cover src={t?.coverUrl} seed={t ? `${t.album}|${t.artist}` : undefined} className="w-10 h-10 rounded-lg shadow-cover" />
          <div className="min-w-0 flex-1">
            <div className="text-headline truncate">{t ? t.title : 'Nada reproduciendo'}</div>
            {s.error ? (
              <div className="text-caption text-danger truncate" title={s.error}>Error: {s.error}</div>
            ) : (
              <div className="text-caption text-fg-2 truncate">{t ? `${t.artist} — ${t.album}` : 'Elige algo para empezar'}</div>
            )}
          </div>
          {t && !mobile ? <QualitySeal track={t} /> : null}
        </button>
        {t && !mobile ? (
          <div className="flex items-center pr-2 gap-0.5">
            <ShuffleRepeat />
          </div>
        ) : null}
        {t ? <SeekBar variant="inline" /> : null}
      </div>

      {mobile ? (
        <div className={t ? '' : 'opacity-40'}>
          <PlayButton size={44} />
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          <VolumeControl />
          <IconButton label="Cola de reproducción" active={queueOpen} onClick={onOpen}>
            <IconQueue />
          </IconButton>
        </div>
      )}
    </footer>
  );
};
