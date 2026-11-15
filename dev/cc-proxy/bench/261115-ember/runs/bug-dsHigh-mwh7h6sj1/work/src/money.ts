export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError("parts must be a positive integer");
  }
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => (i < remainder ? base + 1 : base));
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return sign + "$" + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}
