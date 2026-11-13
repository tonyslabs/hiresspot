import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePlatform } from './platform';

export type ThemeChoice = 'system' | 'dark' | 'light';

export type AutoOrReduced = 'auto' | 'reduced';

/** Colores personalizables (hexadecimal #rrggbb). Cada modo (oscuro/claro) guarda los suyos. */
export type ColorKey = 'accent' | 'bg' | 'surface' | 'fg' | 'gold';
export type Colors = Partial<Record<ColorKey, string>>;
export type EffectiveMode = 'dark' | 'light';

export const COLOR_LABELS: Record<ColorKey, { label: string; hint: string }> = {
  accent: { label: 'Acento', hint: 'Botones, selección y controles. Sustituye al color que sale de la carátula.' },
  bg: { label: 'Fondo', hint: 'Color base de la ventana.' },
  surface: { label: 'Superficies', hint: 'Paneles y tarjetas.' },
  fg: { label: 'Texto', hint: 'Color principal del texto.' },
  gold: { label: 'Sello Hi-Res', hint: 'Color de la insignia de alta resolución.' }
};

/** Acepta #rgb o #rrggbb (con o sin #). Devuelve #rrggbb en minúsculas o null. */
export const parseHex = (input: string): string | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Tinta legible (casi negra o blanca) sobre un color de fondo. */
export const inkOn = (hex: string): string => (luminance(hex) > 0.4 ? '#14110a' : '#ffffff');

const COLOR_VARS = ['--accent', '--accent-fg', '--gold-fg', '--tint', '--tint-fg', '--bg', '--surface', '--surface-2', '--fg', '--muted', '--line'];

const systemMode = (): EffectiveMode => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

/** Aplica los colores personalizados como variables inline (ganan a las hojas de estilo). */
const applyColors = (c: Colors) => {
  const root = document.documentElement.style;
  for (const v of COLOR_VARS) root.removeProperty(v);
  if (c.accent) {
    root.setProperty('--tint', c.accent);
    root.setProperty('--tint-fg', inkOn(c.accent));
  }
  if (c.gold) {
    root.setProperty('--accent', c.gold);
    root.setProperty('--accent-fg', inkOn(c.gold));
    root.setProperty('--gold-fg', inkOn(c.gold));
  }
  if (c.bg) root.setProperty('--bg', c.bg);
  if (c.surface) {
    root.setProperty('--surface', c.surface);
    root.setProperty('--surface-2', `color-mix(in oklab, ${c.surface} 92%, var(--fg))`);
  }
  if (c.fg) {
    root.setProperty('--fg', c.fg);
    root.setProperty('--muted', `color-mix(in oklab, ${c.fg} 62%, var(--bg))`);
    root.setProperty('--line', `color-mix(in oklab, ${c.fg} 16%, var(--bg))`);
  }
};

interface ThemeApi {
  theme: ThemeChoice;
  /** Transparencia del vidrio: 'reduced' = superficies sólidas. */
  glass: AutoOrReduced;
  setGlass(v: AutoOrReduced): void;
  /** Movimiento: 'reduced' = sin animaciones. */
  motion: AutoOrReduced;
  setMotion(v: AutoOrReduced): void;
  /** Fondo ambiental teñido por la carátula. */
  ambient: boolean;
  setAmbient(v: boolean): void;
  /** Alterna entre sistema → oscuro → claro. */
  cycle(): void;
  setTheme(theme: ThemeChoice): void;
  /** Modo en uso (oscuro/claro), resolviendo "sistema". */
  mode: EffectiveMode;
  /** Colores personalizados del modo en uso. */
  colors: Colors;
  /** Fija un color (hex) del modo en uso; null lo restablece. */
  setColor(key: ColorKey, hex: string | null): void;
  resetColors(): void;
}

const ThemeContext = createContext<ThemeApi | null>(null);
const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'dark', dark: 'light', light: 'system' };

const apply = (theme: ThemeChoice) => {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const platform = usePlatform();
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [glass, setGlassState] = useState<AutoOrReduced>('auto');
  const [motion, setMotionState] = useState<AutoOrReduced>('auto');
  const [ambient, setAmbientState] = useState(true);
  const [sys, setSys] = useState<EffectiveMode>(systemMode);
  const [palette, setPalette] = useState<Record<EffectiveMode, Colors>>({ dark: {}, light: {} });
  const mode: EffectiveMode = theme === 'system' ? sys : theme;

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const on = () => setSys(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    platform.settings
      .get<Record<EffectiveMode, Colors>>('colors')
      .then((v) => {
        if (!v || typeof v !== 'object') return;
        const clean = (c: unknown): Colors => {
          const out: Colors = {};
          for (const k of Object.keys(COLOR_LABELS) as ColorKey[]) {
            const hex = typeof (c as Colors | undefined)?.[k] === 'string' ? parseHex((c as Colors)[k]!) : null;
            if (hex) out[k] = hex;
          }
          return out;
        };
        setPalette({ dark: clean(v.dark), light: clean(v.light) });
      })
      .catch(() => {});
  }, [platform]);

  useEffect(() => applyColors(palette[mode]), [palette, mode]);

  const setColor = useCallback(
    (key: ColorKey, hex: string | null) => {
      setPalette((prev) => {
        const cur = { ...prev[mode] };
        if (hex) cur[key] = hex;
        else delete cur[key];
        const next = { ...prev, [mode]: cur };
        platform.settings.set('colors', next).catch(() => {});
        return next;
      });
    },
    [platform, mode]
  );
  const resetColors = useCallback(() => {
    setPalette((prev) => {
      const next = { ...prev, [mode]: {} };
      platform.settings.set('colors', next).catch(() => {});
      return next;
    });
  }, [platform, mode]);

  useEffect(() => {
    platform.settings
      .get<ThemeChoice>('theme')
      .then((saved) => {
        if (saved === 'dark' || saved === 'light' || saved === 'system') setTheme(saved);
      })
      .catch(() => {});
  }, [platform]);

  useEffect(() => {
    const load = <T,>(key: string, set: (v: T) => void, ok: (v: unknown) => boolean) =>
      platform.settings.get<T>(key).then((v) => ok(v) && set(v as T)).catch(() => {});
    load<AutoOrReduced>('glass', setGlassState, (v) => v === 'auto' || v === 'reduced');
    load<AutoOrReduced>('motion', setMotionState, (v) => v === 'auto' || v === 'reduced');
    load<boolean>('ambient', setAmbientState, (v) => typeof v === 'boolean');
  }, [platform]);

  useEffect(() => apply(theme), [theme]);
  useEffect(() => {
    const root = document.documentElement;
    if (glass === 'reduced') root.setAttribute('data-glass', 'solid');
    else root.removeAttribute('data-glass');
    if (motion === 'reduced') root.setAttribute('data-motion', 'reduced');
    else root.removeAttribute('data-motion');
    if (!ambient) root.setAttribute('data-ambient', 'off');
    else root.removeAttribute('data-ambient');
  }, [glass, motion, ambient]);

  const cycle = useCallback(() => {
    setTheme((prev) => {
      const next = NEXT[prev];
      platform.settings.set('theme', next).catch(() => {});
      return next;
    });
  }, [platform]);

  const choose = useCallback(
    (next: ThemeChoice) => {
      setTheme(next);
      platform.settings.set('theme', next).catch(() => {});
    },
    [platform]
  );

  const setGlass = useCallback((v: AutoOrReduced) => { setGlassState(v); platform.settings.set('glass', v).catch(() => {}); }, [platform]);
  const setMotion = useCallback((v: AutoOrReduced) => { setMotionState(v); platform.settings.set('motion', v).catch(() => {}); }, [platform]);
  const setAmbient = useCallback((v: boolean) => { setAmbientState(v); platform.settings.set('ambient', v).catch(() => {}); }, [platform]);

  const api = useMemo(
    () => ({ theme, cycle, setTheme: choose, glass, setGlass, motion, setMotion, ambient, setAmbient, mode, colors: palette[mode], setColor, resetColors }),
    [theme, cycle, choose, glass, setGlass, motion, setMotion, ambient, setAmbient, mode, palette, setColor, resetColors]
  );
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeApi => {
  const api = useContext(ThemeContext);
  if (!api) throw new Error('useTheme: falta <ThemeProvider>');
  return api;
};
