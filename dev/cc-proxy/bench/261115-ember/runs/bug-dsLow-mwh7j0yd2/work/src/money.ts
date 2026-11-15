export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  if (!Number.isInteger(total) || !Number.isInteger(parts) || parts <= 0) {
    throw new RangeError("total and parts must be integers with parts > 0");
  }
  const sign = total < 0 ? -1 : 1;
  const a = Math.abs(total);
  const base = Math.floor(a / parts);
  const remainder = a - base * parts;
  const out = Array.from({ length: parts }, (_, i) =>
    sign * (base + (i < remainder ? 1 : 0)),
  );
  return out;
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(Math.round(c));
  const cents = String(a % 100).padStart(2, "0");
  return sign + "$" + Math.floor(a / 100) + "." + cents;
}
