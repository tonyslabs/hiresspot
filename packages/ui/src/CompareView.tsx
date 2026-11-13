import React, { useEffect, useMemo, useRef, useState } from 'react';
import { compareLibraries, comparisonToCsv, vennLayout, type Comparison, type SourceKind, type Track } from '@hiresspot/core';
import { Cover, QualitySeal, SourceChip } from './components';
import { usePlatform } from './platform';

export interface CompareSource {
  id: string;
  label: string;
  tracks: Track[];
}

type Tab = 'both' | 'onlyA' | 'onlyB' | 'albums';

const MAX_ROWS = 300;
const MATCH_LABEL = { isrc: 'ISRC', mbid: 'MusicBrainz', metadata: 'Metadatos' } as const;
const color = (id: string) => `var(--src-${id})`;
const isSource = (id: string): id is SourceKind => id === 'local' || id === 'navidrome' || id === 'spotify';

const Row: React.FC<{ track: Track; extra?: string }> = ({ track, extra }) => (
  <li className="flex items-center gap-3 px-3 h-14 rounded-ctl hover:bg-fill-1 transition-colors duration-[var(--dur-1)]">
    <Cover src={track.coverUrl} seed={`${track.album}|${track.artist}`} className="w-10 h-10 rounded-lg shadow-cover" />
    <div className="flex-1 min-w-0">
      <div className="text-headline truncate" title={track.title}>{track.title}</div>
      <div className="text-callout text-muted truncate">{track.artist} • {track.album}</div>
    </div>
    {extra ? <span className="text-micro uppercase text-fg-2 bg-fill-1 rounded-chip px-1.5 py-1">{extra}</span> : null}
    <QualitySeal track={track} />
    {isSource(track.source) ? <SourceChip source={track.source} dot /> : null}
  </li>
);

/** Órbitas: un orbe por fuente (área ∝ nº de pistas) unidos por puentes cuyo grosor es lo que comparten. */
const Orbits: React.FC<{ sources: CompareSource[]; cmps: Record<string, Comparison>; pair: [number, number]; onPair: (p: [number, number]) => void }> = ({ sources, cmps, pair, onPair }) => {
  const W = 600;
  const H = sources.length === 3 ? 270 : 220;
  const spots: [number, number][] = sources.length === 3 ? [[130, 175], [470, 175], [300, 70]] : [[170, 100], [430, 100]];
  const max = Math.max(...sources.map((s) => s.tracks.length));
  const radius = (n: number) => Math.max(20, 68 * Math.sqrt(n / max));

  const pairs: [number, number][] = [];
  for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) pairs.push([i, j]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[340px]" role="group" aria-label="Órbitas de bibliotecas">
      {pairs.map(([i, j]) => {
        const c = cmps[`${i}-${j}`];
        const small = Math.min(sources[i].tracks.length, sources[j].tracks.length);
        const share = c && small > 0 ? c.both.length / small : 0;
        const [cx1, cy1] = spots[i];
        const [cx2, cy2] = spots[j];
        const len = Math.hypot(cx2 - cx1, cy2 - cy1) || 1;
        const ux = (cx2 - cx1) / len;
        const uy = (cy2 - cy1) / len;
        const r1 = radius(sources[i].tracks.length) + 4;
        const r2 = radius(sources[j].tracks.length) + 4;
        const [x1, y1] = [cx1 + ux * r1, cy1 + uy * r1];
        const [x2, y2] = [cx2 - ux * r2, cy2 - uy * r2];
        const active = pair[0] === i && pair[1] === j;
        return (
          <g
            key={`${i}-${j}`}
            role="button"
            tabIndex={0}
            aria-label={`Comparar ${sources[i].label} con ${sources[j].label}`}
            aria-pressed={active}
            className="cursor-pointer outline-none"
            onClick={() => onPair([i, j])}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPair([i, j]))}
          >
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={28} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" strokeWidth={3 + 16 * share} style={{ stroke: active ? 'var(--tint)' : 'var(--fill-3)', transition: 'stroke var(--dur-2)' }} />
            <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 12} textAnchor="middle" className="fill-current" style={{ fontSize: 12, fontWeight: 600, opacity: c ? 1 : 0.4 }}>
              {c ? `${Math.round(share * 100)}%` : '…'}
            </text>
          </g>
        );
      })}
      {sources.map((s, i) => {
        const [x, y] = spots[i];
        const r = radius(s.tracks.length);
        const inPair = pair[0] === i || pair[1] === i;
        return (
          <g key={s.id} pointerEvents="none">
            <circle cx={x} cy={y} r={r} style={{ fill: color(s.id), fillOpacity: inPair ? 0.55 : 0.28, stroke: color(s.id), strokeWidth: 1.5 }} />
            <text x={x} y={y - 2} textAnchor="middle" className="fill-current" style={{ fontSize: 18, fontWeight: 700 }}>{s.tracks.length}</text>
            <text x={x} y={y + 14} textAnchor="middle" className="fill-current" style={{ fontSize: 11, opacity: 0.85 }}>{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
};

/** Venn de dos círculos con áreas proporcionales: las tres regiones son los botones de filtro. */
const Venn: React.FC<{ a: CompareSource; b: CompareSource; cmp: Comparison; tab: Tab; onTab: (t: Tab) => void }> = ({ a, b, cmp, tab, onTab }) => {
  const nA = a.tracks.length;
  const nB = b.tracks.length;
  const both = cmp.both.length;
  const { rA, rB, d } = vennLayout(nA, nB, both);
  const W = 560;
  const H = 262;
  const k = Math.min(500 / Math.max(1e-6, rA + d + rB), 105 / Math.max(1e-6, Math.max(rA, rB)));
  const ra = rA * k;
  const rb = rB * k;
  const dd = d * k;
  const total = ra + dd + rb;
  const xA = (W - total) / 2 + ra;
  const xB = xA + dd;
  const cy = 118;
  const lensL = xB - rb;
  const lensR = xA + ra;
  const left = xA - ra;
  const right = xB + rb;
  const place = (from: number, to: number) => (to - from > 34 ? (from + to) / 2 : null);
  const xOnlyA = place(left, Math.max(left, lensL));
  const xBoth = place(Math.max(lensL, left), Math.min(lensR, right));
  const xOnlyB = place(Math.min(lensR, right), right);
  const active = (t: Tab) => tab === t;
  const region = (t: Tab, label: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': active(t),
    className: 'cursor-pointer outline-none',
    onClick: () => onTab(t),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onTab(t))
  });
  const num = (x: number | null, v: number, width: number) =>
    x === null ? null : (
      <text x={x} y={cy + 7} textAnchor="middle" className="fill-current" pointerEvents="none" style={{ fontSize: Math.max(13, Math.min(26, width / 3.2)), fontWeight: 700 }}>{v}</text>
    );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[520px]" role="group" aria-label={`Diagrama de ${a.label} y ${b.label}`}>
      <defs>
        <clipPath id="venn-clip-b"><circle cx={xB} cy={cy} r={rb} /></clipPath>
      </defs>
      <g {...region('onlyA', `Solo en ${a.label}: ${cmp.onlyA.length}`)}>
        <circle className="venn-blend" cx={xA} cy={cy} r={ra} style={{ fill: color(a.id), fillOpacity: active('onlyA') ? 0.6 : 0.32, stroke: color(a.id), strokeWidth: active('onlyA') ? 3 : 1.5 }} />
      </g>
      <g {...region('onlyB', `Solo en ${b.label}: ${cmp.onlyB.length}`)}>
        <circle className="venn-blend" cx={xB} cy={cy} r={rb} style={{ fill: color(b.id), fillOpacity: active('onlyB') ? 0.6 : 0.32, stroke: color(b.id), strokeWidth: active('onlyB') ? 3 : 1.5 }} />
      </g>
      <g {...region('both', `En ambas: ${both}`)} clipPath="url(#venn-clip-b)">
        <circle cx={xA} cy={cy} r={ra} style={{ fill: 'var(--tint)', fillOpacity: active('both') ? 0.7 : 0.35, stroke: 'var(--tint)', strokeWidth: active('both') ? 3 : 1.5 }} />
      </g>
      {num(xOnlyA, cmp.onlyA.length, Math.max(left, lensL) - left)}
      {num(xBoth, both, Math.min(lensR, right) - Math.max(lensL, left))}
      {num(xOnlyB, cmp.onlyB.length, right - Math.min(lensR, right))}
      <text x={xA} y={H - 8} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: color(a.id) }}>● {a.label}</text>
      <text x={xB} y={H - 8} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: color(b.id) }}>● {b.label}</text>
    </svg>
  );
};

export const CompareView: React.FC<{ sources: CompareSource[] }> = ({ sources }) => {
  const usable = useMemo(() => sources.filter((s) => s.tracks.length > 0), [sources]);
  const [pairIds, setPairIds] = useState<[string, string] | null>(null);
  const signature = usable.map((s) => `${s.id}:${s.tracks.length}`).join('|');
  const usableRef = useRef(usable);
  usableRef.current = usable;
  // Par por defecto: Navidrome vs Spotify si están ambas (es la comparación estrella); si no, las dos primeras
  const idx = (id: string) => usable.findIndex((u) => u.id === id);
  const defaultPair: [number, number] = idx('navidrome') >= 0 && idx('spotify') >= 0 ? [idx('navidrome'), idx('spotify')] : [0, 1];
  const chosen: [number, number] | null = pairIds && idx(pairIds[0]) >= 0 && idx(pairIds[1]) >= 0 && pairIds[0] !== pairIds[1] ? [idx(pairIds[0]), idx(pairIds[1])] : null;
  const pair: [number, number] = chosen ?? defaultPair;
  const [i, j] = pair;
  const platform = usePlatform();
  const [tolerance, setTolerance] = useState(3);
  const [tab, setTab] = useState<Tab>('onlyA');
  const [cmps, setCmps] = useState<Record<string, Comparison>>({});

  useEffect(() => {
    platform.settings
      .get<number>('compareTolerance')
      .then((v) => typeof v === 'number' && v >= 0 && v <= 10 && setTolerance(v))
      .catch(() => {});
  }, [platform]);

  // Las comparaciones por pares se calculan una a una, sin bloquear la interfaz
  useEffect(() => {
    setCmps({});
    let cancelled = false;
    const usable = usableRef.current;
    const jobs: [number, number][] = [];
    for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) jobs.push([i, j]);
    // El par seleccionado primero
    // El par seleccionado se calcula primero
    jobs.sort((x, y) => Number(y[0] === pair[0] && y[1] === pair[1]) - Number(x[0] === pair[0] && x[1] === pair[1]));
    const run = (n: number) => {
      if (cancelled || n >= jobs.length) return;
      const [i, j] = jobs[n];
      const c = compareLibraries(usable[i].tracks, usable[j].tracks, { durationToleranceSec: tolerance });
      setCmps((prev) => ({ ...prev, [`${i}-${j}`]: c }));
      setTimeout(() => run(n + 1), 0);
    };
    const t = setTimeout(() => run(0), 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `signature` (y no la identidad de `usable`) decide cuándo recalcular: si el padre recrea el array en cada
    // render, las comparaciones no deben reiniciarse mientras los datos no cambien.
  }, [signature, tolerance]);
  const a = usable[i];
  const b = usable[j];
  const cmp = cmps[`${i}-${j}`] ?? null;

  if (usable.length < 2) {
    return (
      <section className="max-w-xl">
        <h2 className="text-title-1 mb-2">Comparar bibliotecas</h2>
        <p className="text-muted">Hacen falta al menos dos bibliotecas con música para comparar. Agrega una carpeta local, conecta Navidrome o Spotify.</p>
      </section>
    );
  }

  const exportCsv = () => {
    if (!cmp) return;
    const blob = new Blob(['﻿' + comparisonToCsv(cmp, a.label, b.label)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `comparacion-${a.id}-vs-${b.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const total = cmp ? cmp.both.length + cmp.onlyA.length : 0;
  const pct = cmp && total > 0 ? Math.round((cmp.both.length / total) * 100) : 0;
  const incompleteA = cmp?.albumsA.filter((x) => x.status !== 'complete') ?? [];
  const count = !cmp ? 0 : tab === 'both' ? cmp.both.length : tab === 'onlyA' ? cmp.onlyA.length : tab === 'onlyB' ? cmp.onlyB.length : incompleteA.length;
  const chip = (t: Tab, label: string, n: number) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      aria-pressed={tab === t}
      className={`h-9 px-4 rounded-full text-callout transition-colors duration-[var(--dur-1)] ${tab === t ? 'bg-fill-3 text-fg font-semibold' : 'bg-fill-1 text-fg-2 hover:bg-fill-2'}`}
    >
      {label} <span className="tabular-nums opacity-80">{n}</span>
    </button>
  );

  return (
    <section>
      <h2 className="text-title-1 mb-1">Comparar bibliotecas</h2>
      <p className="text-callout text-muted mb-5">Elige un puente entre dos orbes para ver qué comparten. El tamaño de cada orbe es proporcional a su biblioteca.</p>

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 mb-4">
        <Orbits sources={usable} cmps={cmps} pair={[i, j]} onPair={(p) => { setPairIds([usable[p[0]].id, usable[p[1]].id]); setTab('onlyA'); }} />
        {cmp ? <Venn a={a} b={b} cmp={cmp} tab={tab} onTab={setTab} /> : <div className="skeleton w-[520px] max-w-full h-[262px]" aria-busy="true" />}
      </div>

      {cmp ? (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {chip('both', 'En ambas', cmp.both.length)}
            {chip('onlyA', `Solo en ${a.label}`, cmp.onlyA.length)}
            {chip('onlyB', `Solo en ${b.label}`, cmp.onlyB.length)}
            {chip('albums', `Álbumes incompletos`, incompleteA.length)}
            <button type="button" className="ml-auto h-9 px-4 rounded-full bg-fill-2 hover:bg-fill-3 text-callout" onClick={exportCsv}>Exportar CSV</button>
          </div>
          <p className="text-caption text-muted mb-4">
            El {pct}% de {a.label} está en {b.label}. Emparejado por ISRC, MusicBrainz o título + artista + duración (±{tolerance} s); las versiones en vivo, acústicas o remix no se confunden con la de estudio.
          </p>

          {tab === 'albums' ? (
            <ul>
              {incompleteA.slice(0, MAX_ROWS).map((x) => (
                <li key={x.album.key} className="flex items-center gap-3 px-3 h-14 rounded-ctl hover:bg-fill-1">
                  <Cover src={x.album.coverUrl} seed={x.album.album} className="w-10 h-10 rounded-lg shadow-cover" />
                  <div className="flex-1 min-w-0">
                    <div className="text-headline truncate">{x.album.album}</div>
                    <div className="text-callout text-muted truncate">{x.album.artist}</div>
                  </div>
                  <span className={`text-caption rounded-full px-2.5 py-1 ${x.status === 'missing' ? 'bg-danger/10 text-danger' : 'bg-fill-2 text-fg-2'}`}>
                    {x.status === 'missing' ? 'No está' : 'Parcial'} · {x.matched}/{x.total}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {tab === 'both' && cmp.both.slice(0, MAX_ROWS).map((m) => <Row key={m.a.id} track={m.a} extra={MATCH_LABEL[m.kind]} />)}
              {tab === 'onlyA' && cmp.onlyA.slice(0, MAX_ROWS).map((t) => <Row key={t.id} track={t} />)}
              {tab === 'onlyB' && cmp.onlyB.slice(0, MAX_ROWS).map((t) => <Row key={t.id} track={t} />)}
            </ul>
          )}
          {count > MAX_ROWS ? <p className="text-callout text-muted mt-3">Mostrando {MAX_ROWS} de {count}. Exporta el CSV para ver todo.</p> : null}
        </>
      ) : null}
    </section>
  );
};
