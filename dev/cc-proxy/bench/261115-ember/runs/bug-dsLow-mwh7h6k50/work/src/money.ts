export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  const out = Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
  return out;
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  const cents = (a % 100).toString().padStart(2, "0");
  return sign + "$" + Math.floor(a / 100) + "." + cents;
}
