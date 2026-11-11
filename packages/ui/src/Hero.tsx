import React, { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { hslToCss, type Palette, type Track } from '@hiresspot/core';
import { loadPalette } from './ambient';
import { Cover } from './components';
import { usePlatform } from './platform';

/** Estilo que fija --tint / --tint-fg localmente con los colores de esta carátula (claro y oscuro con light-dark()). */
export const useTintStyle = (track?: Track): CSSProperties | undefined => {
  const platform = usePlatform();
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPalette(null);
    if (!track) return;
    loadPalette(track, platform.media.coverPixels).then((p) => !cancelled && setPalette(p));
    return () => {
      cancelled = true;
    };
  }, [track, platform]);
  if (!palette) return undefined;
  const ink = (l: number) => (l > 52 ? '#14110a' : '#ffffff');
  return {
    ['--tint' as string]: `light-dark(${hslToCss(palette.accent.light)}, ${hslToCss(palette.accent.dark)})`,
    ['--tint-fg' as string]: `light-dark(${ink(palette.accent.light.l)}, ${ink(palette.accent.dark.l)})`
  };
};

interface HeroProps {
  cover?: string;
  seed: string;
  kind: string;
  title: string;
  meta: ReactNode;
  /** Artistas: carátula circular. */
  round?: boolean;
  actions?: ReactNode;
  badges?: ReactNode;
}

/** Cabecera de álbum/artista/playlist: carátula grande sobre su propio reflejo difuminado, que sangra bajo el cromo. */
export const Hero: React.FC<HeroProps> = ({ cover, seed, kind, title, meta, round, actions, badges }) => (
  <>
    {cover ? (
      <div
        aria-hidden="true"
        className="absolute top-0 inset-x-0 h-[440px] overflow-hidden pointer-events-none"
        style={{ maskImage: 'linear-gradient(#000 40%, transparent)', WebkitMaskImage: 'linear-gradient(#000 40%, transparent)' }}
      >
        <img
          src={cover}
          alt=""
          className="absolute top-0 left-0 object-cover opacity-50"
          style={{ width: '12.5%', height: '12.5%', transformOrigin: '0 0', transform: 'scale(8)', filter: 'blur(10px) saturate(1.5)' }}
        />
      </div>
    ) : null}
    <div className="relative z-10 flex items-end gap-8 pt-6 pb-8">
      <Cover src={cover} seed={seed} className={`w-[232px] h-[232px] shadow-lift ${round ? 'rounded-full' : 'rounded-panel'}`} />
      <div className="min-w-0 flex-1">
        <div className="text-micro uppercase text-fg-2">{kind}</div>
        <h2 className="text-display line-clamp-2 [text-wrap:balance] mt-1" style={{ textShadow: '0 1px 12px rgb(0 0 0 / 0.25)' }}>{title}</h2>
        <div className="text-callout text-fg-2 mt-2">{meta}</div>
        {badges ? <div className="mt-3 flex items-center gap-2.5 flex-wrap">{badges}</div> : null}
        {actions ? <div className="mt-5 flex items-center gap-3 flex-wrap">{actions}</div> : null}
      </div>
    </div>
  </>
);
