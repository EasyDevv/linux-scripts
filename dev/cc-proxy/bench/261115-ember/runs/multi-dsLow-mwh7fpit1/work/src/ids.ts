/** Order ids: prefix + zero-padded 6-digit sequence. */
export const orderId = (n: number) => "ORD-" + String(n).padStart(6, "0");
