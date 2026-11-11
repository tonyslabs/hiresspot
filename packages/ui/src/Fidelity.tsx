import React from 'react';
import { fidelity, formatSpec, type Track } from '@hiresspot/core';

/**
 * Anillo de fidelidad: tres arcos de 270° — exterior = frecuencia de muestreo, medio = profundidad de bits,
 * interior = integridad (sin pérdida = lleno). Dorado si es alta resolución. Describe la FUENTE; no promete
 * salida bit-perfect (la reproducción pasa por el mezclador del sistema).
 */
export const FidelityRing: React.FC<{ track: Track; size?: number }> = ({ track, size = 44 }) => {
  const f = fidelity(track);
  const gold = f.tier === 'hires';
  const stroke = gold ? 'var(--accent)' : 'var(--fg-2)';
  const arcs = [
    { r: 19, v: f.rate, label: 'frecuencia de muestreo' },
    { r: 14, v: f.depth, label: 'profundidad de bits' },
    { r: 9, v: f.integrity, label: 'integridad' }
  ];
  const label = `Fidelidad de la fuente: ${formatSpec(track) || 'sin datos'}`;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" role="img" aria-label={label}>
      <title>{label}</title>
      {arcs.map(({ r, v }) => {
        const c = 2 * Math.PI * r;
        const sweep = 0.75 * c;
        return (
          <g key={r} transform="rotate(135 22 22)" fill="none" strokeWidth={3} strokeLinecap="round">
            <circle cx={22} cy={22} r={r} stroke="var(--fill-3)" strokeDasharray={`${sweep} ${c}`} />
            {v > 0 ? <circle cx={22} cy={22} r={r} stroke={stroke} strokeDasharray={`${Math.max(0.5, sweep * Math.min(1, v))} ${c}`} /> : null}
          </g>
        );
      })}
    </svg>
  );
};
