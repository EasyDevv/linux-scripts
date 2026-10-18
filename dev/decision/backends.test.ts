import { describe, expect, test } from "bun:test";
import { latestJev } from "./backends.ts";

describe("latestJev", () => {
	test("newest version wins, free SKU first", () => {
		expect(latestJev(["jev-1.13-free", "jev-1.13", "jev-1.14", "jev-1.14-free", "gpt-x"])).toEqual([
			"jev-1.14-free",
			"jev-1.14",
		]);
	});

	test("a paid-only newest version keeps no older free SKU", () => {
		expect(latestJev(["jev-1.13-free", "jev-1.14"])).toEqual(["jev-1.14"]);
	});

	test("minor versions compare numerically", () => {
		expect(latestJev(["jev-1.9-free", "jev-1.10-free"])).toEqual(["jev-1.10-free"]);
	});

	test("OpenRouter ids carry a typesafe/ prefix", () => {
		expect(
			latestJev(["typesafe/jev-1.13", "typesafe/jev-1.14", "~typesafe/jev-latest", "typesafe/jev-router"]),
		).toEqual(["typesafe/jev-1.14"]);
	});

	test("no Jev ids → empty", () => {
		expect(latestJev(["clef"])).toEqual([]);
	});
});
