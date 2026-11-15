export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  const out = Array(parts).fill(base);
  for (let i = 0; i < remainder; i++) out[i]++;
  return out;
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return sign + "$" + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}
