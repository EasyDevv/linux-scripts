export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error("parts must be a positive integer");
  }
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  const out = Array(parts).fill(base);
  // Distribute the remainder so larger parts come first.
  for (let i = 0; i < remainder; i++) out[i] = base + 1;
  return out;
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.round(Math.abs(c));
  const dollars = Math.floor(a / 100);
  const cents = a % 100;
  return sign + "$" + dollars + "." + String(cents).padStart(2, "0");
}
