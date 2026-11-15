export type Stock = Map<string, number>;
/** Reserve qty of sku; returns false and leaves stock unchanged when not enough. */
export function reserve(stock: Stock, sku: string, qty: number): boolean {
  const have = stock.get(sku) ?? 0;
  if (have < qty) return false;
  stock.set(sku, have - qty);
  return true;
}
/** Release previously reserved qty. */
export function release(stock: Stock, sku: string, qty: number): void {
  stock.set(sku, (stock.get(sku) ?? 0) + qty);
}
