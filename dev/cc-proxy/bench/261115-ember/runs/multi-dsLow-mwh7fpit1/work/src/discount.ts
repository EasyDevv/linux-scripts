/** Unit price after bulk discount: 10+ units 5% off, 50+ units 10% off. Result rounded down to whole cents. */
export function applyDiscount(unit: number, qty: number): number {
  if (qty >= 50) return Math.floor(unit * 0.9);
  if (qty >= 10) return Math.floor(unit * 0.95);
  return unit;
}
