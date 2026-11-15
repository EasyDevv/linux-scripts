export function splitCents(total: number, parts: number): number[] {
  // Split total cents into parts that differ by at most 1, larger parts first.
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("parts must be a positive integer");
  if (!Number.isInteger(total)) throw new Error("total must be an integer");
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  const out: number[] = [];
  for (let i = 0; i < parts; i++) {
    out.push(sign * (base + (i < remainder ? 1 : 0)));
  }
  return out;
}

export function formatCents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(Math.round(c));
  const cents = (a % 100).toString().padStart(2, "0");
  return sign + "$" + Math.floor(a / 100) + "." + cents;
}
