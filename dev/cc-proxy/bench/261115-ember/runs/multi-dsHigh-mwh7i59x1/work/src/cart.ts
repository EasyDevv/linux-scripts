import { applyDiscount } from "./discount";
import { taxFor } from "./tax";
export type Line = { sku: string; qty: number; unit: number; region: string };
/** Subtotal in cents, after per-line discount, before tax. */
export function subtotal(lines: Line[]): number {
  return lines.reduce((s, l) => s + applyDiscount(l.unit, l.qty) * l.qty, 0);
}
/** Total in cents including tax, rounded half up per line. */
export function total(lines: Line[]): number {
  return lines.reduce((s, l) => { const net = applyDiscount(l.unit, l.qty) * l.qty; return s + net + Math.round(net * taxFor(l.region)); }, 0);
}
