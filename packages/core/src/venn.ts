/** Área compartida por dos círculos; contempla separación y contención. */
export function areaLens(rA: number, rB: number, d: number): number {
  rA = Math.max(0, rA);
  rB = Math.max(0, rB);
  d = Math.max(0, d);
  if (rA === 0 || rB === 0 || d >= rA + rB) return 0;
  if (d <= Math.abs(rA - rB)) return Math.PI * Math.min(rA, rB) ** 2;
  const clampCos = (value: number): number => Math.max(-1, Math.min(1, value));
  const angleA = Math.acos(clampCos((d * d + rA * rA - rB * rB) / (2 * d * rA)));
  const angleB = Math.acos(clampCos((d * d + rB * rB - rA * rA) / (2 * d * rB)));
  const product = (-d + rA + rB) * (d + rA - rB) * (d - rA + rB) * (d + rA + rB);
  return Math.max(0, rA * rA * angleA + rB * rB * angleB - Math.sqrt(Math.max(0, product)) / 2);
}

export function vennLayout(a: number, b: number, both: number): { rA: number; rB: number; d: number } {
  a = Math.max(0, a);
  b = Math.max(0, b);
  both = Math.max(0, Math.min(both, a, b));
  const rA = Math.sqrt(a / Math.PI);
  const rB = Math.sqrt(b / Math.PI);
  if (both === 0) return { rA, rB, d: rA + rB };
  if (both === Math.min(a, b)) return { rA, rB, d: Math.abs(rA - rB) };
  let low = Math.abs(rA - rB);
  let high = rA + rB;
  // La lente disminuye de forma monótona al separar los centros.
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (areaLens(rA, rB, mid) > both) low = mid;
    else high = mid;
  }
  return { rA, rB, d: (low + high) / 2 };
}
