export function buildLensMap(w: number, h: number, radius: number, bezel: number): Uint8ClampedArray {
  if (w <= 0 || h <= 0) return new Uint8ClampedArray();

  const map = new Uint8ClampedArray(w * h * 4);
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.max(0, Math.min(radius, halfW, halfH));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const offset = (y * w + x) * 4;
      let nx = 0;
      let ny = 0;
      let m = 0;

      if (bezel > 0) {
        const px = x + 0.5 - halfW;
        const py = y + 0.5 - halfH;
        const qx = Math.abs(px) - (halfW - r);
        const qy = Math.abs(py) - (halfH - r);
        const ox = Math.max(qx, 0);
        const oy = Math.max(qy, 0);
        const length = Math.hypot(ox, oy);
        // SDF positiva hacia dentro; los puntos exteriores usan distancia cero.
        const d = Math.max(0, r - length - Math.min(Math.max(qx, qy), 0));

        if (length > 0) {
          nx = -Math.sign(px) * ox / length;
          ny = -Math.sign(py) * oy / length;
        } else if (qx > qy) {
          nx = -Math.sign(px);
        } else if (qy > qx) {
          ny = -Math.sign(py);
        }
        // En empates del eje medial el gradiente no está definido: normal cero.
        m = d < bezel ? (1 - d / bezel) ** 3 : 0;
      }

      map[offset] = 128 + Math.round(127 * nx * m);
      map[offset + 1] = 128 + Math.round(127 * ny * m);
      map[offset + 2] = 128;
      map[offset + 3] = 255;
    }
  }
  return map;
}
