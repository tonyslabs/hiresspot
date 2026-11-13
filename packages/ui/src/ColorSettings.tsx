import React, { useEffect, useState } from 'react';
import { COLOR_LABELS, parseHex, useTheme, type ColorKey } from './theme';

/** Valores de partida que se muestran cuando no hay color personalizado (los del tema). */
const readCssColor = (name: string, fallback: string): string => {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : fallback;
};

const VAR_OF: Record<ColorKey, string> = { accent: '--tint', bg: '--bg', surface: '--surface', fg: '--fg', gold: '--accent' };

const ColorRow: React.FC<{ k: ColorKey }> = ({ k }) => {
  const { colors, setColor, mode } = useTheme();
  const custom = colors[k];
  const [shown, setShown] = useState('#808080');
  const [text, setText] = useState('');

  // El color mostrado es el personalizado o, si no hay, el que el tema tiene ahora
  useEffect(() => {
    const v = custom ?? readCssColor(VAR_OF[k], '#808080');
    setShown(v);
    setText(v);
  }, [custom, k, mode]);

  const commit = (raw: string) => {
    const hex = parseHex(raw);
    if (hex) setColor(k, hex);
    else setText(shown);
  };

  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3 min-h-[56px]">
      <div className="min-w-0">
        <div className="text-body font-medium">{COLOR_LABELS[k].label}</div>
        <div className="text-callout text-muted">{COLOR_LABELS[k].hint}</div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <input
          type="color"
          value={shown}
          aria-label={`Elegir color de ${COLOR_LABELS[k].label}`}
          onChange={(e) => {
            setShown(e.target.value);
            setText(e.target.value);
            setColor(k, e.target.value);
          }}
          className="w-9 h-9 rounded-ctl border border-line bg-transparent cursor-pointer p-0.5"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
          spellCheck={false}
          maxLength={7}
          placeholder="#rrggbb"
          aria-label={`Hexadecimal de ${COLOR_LABELS[k].label}`}
          className="ctl-input w-[92px] h-9 px-3 rounded-ctl text-callout font-mono"
        />
        <button
          type="button"
          disabled={!custom}
          onClick={() => setColor(k, null)}
          className="h-9 px-3 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout disabled:opacity-40"
        >
          Restablecer
        </button>
      </div>
    </div>
  );
};

/** Colores de la app en hexadecimal, por modo (oscuro/claro). */
export const ColorSettings: React.FC = () => {
  const { mode, resetColors, colors } = useTheme();
  return (
    <>
      <div className="px-4 py-3 text-callout text-muted">
        Estás editando los colores del modo {mode === 'dark' ? 'oscuro' : 'claro'}; el otro modo guarda los suyos. Escribe un hexadecimal (#rrggbb) o usa el selector.
      </div>
      {(Object.keys(COLOR_LABELS) as ColorKey[]).map((k) => (
        <ColorRow key={k} k={k} />
      ))}
      <div className="px-4 py-3 flex justify-end">
        <button type="button" disabled={Object.keys(colors).length === 0} onClick={resetColors} className="h-9 px-3.5 rounded-ctl bg-fill-2 hover:bg-fill-3 text-callout disabled:opacity-40">
          Restablecer todos los colores
        </button>
      </div>
    </>
  );
};
