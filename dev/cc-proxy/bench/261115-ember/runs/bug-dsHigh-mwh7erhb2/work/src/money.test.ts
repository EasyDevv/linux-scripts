import { expect, test } from "bun:test";
import { splitCents, formatCents } from "./money";
test("split even", () => expect(splitCents(100, 4)).toEqual([25, 25, 25, 25]));
test("split remainder", () => expect(splitCents(100, 3)).toEqual([34, 33, 33]));
test("split small", () => expect(splitCents(2, 3)).toEqual([1, 1, 0]));
test("split sum", () => { for (const [t, p] of [[1001, 7], [5, 9], [999, 2]]) expect(splitCents(t, p).reduce((a, b) => a + b, 0)).toBe(t); });
test("format", () => { expect(formatCents(1205)).toBe("$12.05"); expect(formatCents(-7)).toBe("-$0.07"); expect(formatCents(100)).toBe("$1.00"); });
