// ---------------------------------------------------------------------------
// Saneado de cabeceras FLAC.
// Muchos FLAC etiquetados con herramientas antiguas traen un bloque PICTURE con el tipo MIME
// mal formado ("Could not read mimetype from an attached picture"). ffmpeg lo tolera, pero el
// demuxer de Chromium se niega a abrir el archivo (DEMUXER_ERROR_COULD_NOT_OPEN) y el <audio>
// falla con "no supported source". Quitar los bloques PICTURE no toca el audio: los frames
// siguen byte a byte igual (la portada se pide aparte con getCoverArt).
// ---------------------------------------------------------------------------

/** Lee el rango [start, endInclusive] del archivo original. */
export type RangeReader = (start: number, endInclusive: number) => Promise<Uint8Array>;

export interface FlacLayout {
  /** `fLaC` + bloques de metadatos sin PICTURE (con el flag "último" corregido). */
  header: Uint8Array;
  /** Offset, en el archivo original, donde empiezan los frames de audio. */
  audioStart: number;
  /** Bytes eliminados del original (0 = el archivo ya estaba limpio). */
  removed: number;
}

const BLOCK_PICTURE = 6;
const MAX_KEPT_BLOCK = 16 * 1024 * 1024;
const MAX_BLOCKS = 512;

/** Devuelve la cabecera saneada, o null si el archivo no parece un FLAC (se reproduce tal cual). */
export const buildFlacLayout = async (read: RangeReader): Promise<FlacLayout | null> => {
  const magic = await read(0, 3);
  if (magic.length < 4 || magic[0] !== 0x66 || magic[1] !== 0x4c || magic[2] !== 0x61 || magic[3] !== 0x43) return null;

  const kept: Uint8Array[] = [];
  let pos = 4;
  let removed = 0;
  let sawLast = false;

  for (let i = 0; i < MAX_BLOCKS && !sawLast; i++) {
    const head = await read(pos, pos + 3);
    if (head.length < 4) return null;
    const last = (head[0] & 0x80) !== 0;
    const type = head[0] & 0x7f;
    const len = (head[1] << 16) | (head[2] << 8) | head[3];
    if (type === 127) return null; // inválido
    sawLast = last;

    if (type === BLOCK_PICTURE) {
      removed += 4 + len;
    } else {
      if (len > MAX_KEPT_BLOCK) return null;
      const body = len > 0 ? await read(pos + 4, pos + 3 + len) : new Uint8Array(0);
      if (body.length !== len) return null;
      const block = new Uint8Array(4 + len);
      block.set(head, 0);
      block.set(body, 4);
      kept.push(block);
    }
    pos += 4 + len;
  }
  if (!sawLast || kept.length === 0) return null;

  // Exactamente un bloque "último": el final de los que se conservan
  kept.forEach((b, i) => {
    b[0] = i === kept.length - 1 ? b[0] | 0x80 : b[0] & 0x7f;
  });

  const header = new Uint8Array(4 + kept.reduce((n, b) => n + b.length, 0));
  header.set(magic, 0);
  let o = 4;
  for (const b of kept) {
    header.set(b, o);
    o += b.length;
  }
  return { header, audioStart: pos, removed };
};

export interface ByteRange {
  start: number;
  end: number; // inclusivo
}

/** Interpreta `Range: bytes=a-b` / `bytes=a-` / `bytes=-n` sobre un recurso de `length` bytes. */
export const parseRange = (header: string | null, length: number): ByteRange | 'full' | 'invalid' => {
  if (!header) return 'full';
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    start = Math.max(0, length - n);
    end = length - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? length - 1 : Math.min(Number(m[2]), length - 1);
  }
  if (start >= length || start > end) return 'invalid';
  return { start, end };
};

export interface FlacSlicePlan {
  /** Bytes de la cabecera saneada a enviar primero (puede estar vacío). */
  headerStart: number;
  headerEnd: number; // exclusivo
  /** Rango a pedir al servidor para el audio; null si el rango cae entero en la cabecera. */
  upstream: ByteRange | null;
}

/** Traduce un rango del archivo virtual (cabecera saneada + audio) a trozos del original. */
export const planFlacSlice = (layout: FlacLayout, range: ByteRange): FlacSlicePlan => {
  const h = layout.header.length;
  const headerStart = Math.min(range.start, h);
  const headerEnd = Math.min(range.end + 1, h);
  const upstream =
    range.end >= h
      ? { start: layout.audioStart + Math.max(0, range.start - h), end: layout.audioStart + (range.end - h) }
      : null;
  return { headerStart, headerEnd, upstream };
};
