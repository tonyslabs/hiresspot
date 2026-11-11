import React from 'react';
import { EQ_BANDS, EQ_MAX_DB, EQ_PRESETS } from '@hiresspot/core';
import { usePlayer, usePlayerState, useEqualizerActions } from './player';

const selectCls = 'ctl-select h-9 pl-3 pr-9 rounded-ctl text-callout';
const label = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Velocidad de reproducción (mantiene el tono). */
export const RateSelect: React.FC = () => {
  const player = usePlayer();
  const { rate } = usePlayerState();
  return (
    <select className={selectCls} value={rate} aria-label="Velocidad de reproducción" onChange={(e) => player.setPlaybackRate(Number(e.target.value))}>
      {RATES.map((r) => (
        <option key={r} value={r}>
          {r === 1 ? 'Normal' : `${r}×`}
        </option>
      ))}
    </select>
  );
};

/** Ecualizador de 10 bandas con preamp y preajustes. */
export const EqualizerPanel: React.FC = () => {
  const { equalizer: eq } = usePlayerState();
  const apply = useEqualizerActions();
  const presetName = Object.entries(EQ_PRESETS).find(([, g]) => g.every((v, i) => v === eq.gains[i]))?.[0] ?? 'custom';

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="text-body font-medium">Ecualizador</div>
          <div className="text-callout text-muted">
            Al activarlo, el audio pasa por el mezclador del sistema (deja de ser bit-perfect). Desactivado, la señal no se toca.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className={selectCls}
            value={presetName}
            aria-label="Preajuste del ecualizador"
            onChange={(e) => EQ_PRESETS[e.target.value] && apply({ gains: EQ_PRESETS[e.target.value] })}
          >
            {presetName === 'custom' ? <option value="custom">Personalizado</option> : null}
            {Object.keys(EQ_PRESETS).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <select className={selectCls} value={eq.enabled ? 'on' : 'off'} aria-label="Ecualizador" onChange={(e) => apply({ enabled: e.target.value === 'on' })}>
            <option value="off">Desactivado</option>
            <option value="on">Activado</option>
          </select>
        </div>
      </div>

      <div className={`flex items-end gap-3 justify-between ${eq.enabled ? '' : 'opacity-50'}`}>
        <Band name="Pre" value={eq.preamp} onChange={(v) => apply({ preamp: v })} />
        <div className="w-px self-stretch bg-line-soft" />
        {EQ_BANDS.map((hz, i) => (
          <Band
            key={hz}
            name={label(hz)}
            value={eq.gains[i]}
            onChange={(v) => apply({ gains: eq.gains.map((g, j) => (j === i ? v : g)) })}
          />
        ))}
      </div>
    </div>
  );
};

const Band: React.FC<{ name: string; value: number; onChange(v: number): void }> = ({ name, value, onChange }) => (
  <label className="flex flex-col items-center gap-2 flex-1 min-w-0">
    <span className="text-micro text-muted tabular-nums">{value > 0 ? `+${value}` : value} dB</span>
    <input
      type="range"
      min={-EQ_MAX_DB}
      max={EQ_MAX_DB}
      step={0.5}
      value={value}
      aria-label={`Banda ${name}`}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={() => onChange(0)}
      className="h-32 w-6 accent-[var(--tint)]"
      style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
    />
    <span className="text-micro text-muted">{name}</span>
  </label>
);

const KEYS: [string, string][] = [
  ['Espacio', 'Reproducir / pausar'],
  ['← / →', 'Retroceder / adelantar 10 s'],
  ['↑ / ↓', 'Subir / bajar volumen'],
  ['N / P', 'Siguiente / anterior'],
  ['M', 'Silenciar'],
  ['S', 'Aleatorio'],
  ['R', 'Repetir (no, todas, una)'],
  ['Ctrl + K', 'Buscar en todo']
];

export const ShortcutList: React.FC = () => (
  <>
    {KEYS.map(([k, d]) => (
      <div key={k} className="flex items-center justify-between gap-6 px-4 py-3 min-h-[48px]">
        <span className="text-body">{d}</span>
        <kbd className="px-2 py-1 rounded-ctl bg-fill-2 text-callout font-mono">{k}</kbd>
      </div>
    ))}
  </>
);
