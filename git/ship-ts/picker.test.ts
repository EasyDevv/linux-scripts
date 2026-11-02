import { describe, expect, test } from "bun:test";
import { classifyKey, move, splitKeys } from "./picker.ts";

describe("classifyKey", () => {
	test("arrows and vim keys move", () => {
		expect(classifyKey("\x1b[A")).toBe("up");
		expect(classifyKey("k")).toBe("up");
		expect(classifyKey("\x1b[B")).toBe("down");
		expect(classifyKey("j")).toBe("down");
		expect(classifyKey("g")).toBe("first");
		expect(classifyKey("G")).toBe("last");
	});

	test("enter selects; q, Esc, Ctrl-C abort", () => {
		expect(classifyKey("\r")).toBe("select");
		expect(classifyKey("q")).toBe("abort");
		expect(classifyKey("\x1b")).toBe("abort");
		expect(classifyKey("\x03")).toBe("abort");
	});

	test("Alt chords and digits are ignored", () => {
		expect(classifyKey("\x1bj")).toBeNull();
		expect(classifyKey("2")).toBeNull();
	});
});

describe("move", () => {
	test("clamps at both ends", () => {
		expect(move(0, "up", 2)).toBe(0);
		expect(move(1, "down", 2)).toBe(1);
		expect(move(0, "down", 2)).toBe(1);
		expect(move(1, "first", 2)).toBe(0);
		expect(move(0, "last", 2)).toBe(1);
	});
});

describe("splitKeys", () => {
	test("splits a combined read into keys", () => {
		expect(splitKeys("j\r")).toEqual(["j", "\r"]);
		expect(splitKeys("\x1b[B\x1b[A\r")).toEqual(["\x1b[B", "\x1b[A", "\r"]);
		expect(splitKeys("\x1b[4~")).toEqual(["\x1b[4~"]);
		expect(splitKeys("\x1b")).toEqual(["\x1b"]);
	});
});
