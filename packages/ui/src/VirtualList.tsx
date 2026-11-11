import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface Props<T> {
  items: T[];
  rowHeight: number;
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
  /** Índice a mostrar al montar (p. ej. la pista actual de la cola). */
  initialIndex?: number;
  /** Espacio al inicio/final DENTRO del scroll (para que las filas pasen bajo el cromo flotante). */
  padStart?: number;
  padEnd?: number;
}

/** Lista de filas de alto fijo: solo monta las visibles, así que aguanta bibliotecas de miles de pistas. */
export function VirtualList<T>({ items, rowHeight, getKey, renderRow, className = '', initialIndex, padStart = 0, padEnd = 0 }: Props<T>) {
  const parent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    paddingStart: padStart,
    paddingEnd: padEnd,
    scrollPaddingStart: padStart,
    scrollPaddingEnd: padEnd,
    initialOffset: initialIndex && initialIndex > 0 ? Math.max(0, initialIndex - 2) * rowHeight : 0
  });

  return (
    <div ref={parent} className={`vlist overflow-auto ${className}`}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((v) => (
          <div
            key={getKey(items[v.index], v.index)}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}
          >
            {renderRow(items[v.index], v.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
