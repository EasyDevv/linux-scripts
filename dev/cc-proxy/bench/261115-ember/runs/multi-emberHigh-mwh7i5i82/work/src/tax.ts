const RATES: Record<string, number> = { CA: 0.0725, NY: 0.04, OR: 0, TX: 0.0625 };
/** Tax rate by region code, case-insensitive; unknown regions throw. */
export function taxFor(region: string): number {
  const r = RATES[region.toUpperCase()];
  if (r === undefined) throw new Error("unknown region " + region);
  return r;
}
