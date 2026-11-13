export interface LyricLine {
  timeMs: number | null;
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lang?: string;
  lines: LyricLine[];
}

export const parseLrc = (text: string): Lyrics => {
  const lines: LyricLine[] = [];
  let offset = 0;
  for (const raw of text.split(/\r?\n/)) {
    const content = raw.replace(/\[offset:([+-]?\d+)\]/gi, (_, value: string) => {
      offset = Number(value);
      return '';
    }).replace(/\[[a-z]+:[^\]]*\]/gi, '').trim();
    const stamps = [...content.matchAll(/\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\]/g)];
    const value = content.replace(/\[\d+:[0-5]\d(?:\.\d{1,3})?\]/g, '').trim();
    if (stamps.length === 0) {
      if (value) lines.push({ timeMs: null, text: value });
      continue;
    }
    for (const stamp of stamps) {
      lines.push({
        timeMs: Number(stamp[1]) * 60000 + Number(stamp[2]) * 1000 + Number((stamp[3] ?? '').padEnd(3, '0')),
        text: value
      });
    }
  }
  // El desplazamiento es global, incluso si aparece al final del archivo.
  for (const line of lines) if (line.timeMs !== null) line.timeMs += offset;
  // Las líneas sin sincronía quedan al final y conservan su orden relativo.
  lines.sort((a, b) => (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity));
  return { synced: lines.some((line) => line.timeMs !== null), lines };
};

// Requiere líneas ordenadas por tiempo, con las no sincronizadas al final.
export const activeLineIndex = (lines: LyricLine[], positionMs: number): number => {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const time = lines[mid].timeMs;
    if (time !== null && time <= positionMs) low = mid + 1;
    else high = mid;
  }
  return low - 1;
};
