export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  const sign = total < 0 ? -1 : 1;
  const a = Math.abs(total);
  const base = Math.floor(a / parts);
  const remainder = a % parts;
  const out = Array.from({ length: parts }, (_, i) =>
    sign * (base + (i < remainder ? 1 : 0)),
  );
  return out;
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return sign + "$" + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}
