import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CentralCatalog } from "../models-catalog/central-catalog.ts";
import { CentralAuthStore } from "./auth.ts";
import { BackendLadder, latestJev, PiModels } from "./backends.ts";

function catalogOf(models: object[]) {
	const path = join(mkdtempSync(join(tmpdir(), "backends-")), "catalog.json");
	writeFileSync(path, JSON.stringify({ openrouter: { models } }));
	return new CentralCatalog(path);
}

const PPLX = {
	type: "classifier",
	id: "perplexity/pplx-decider-v1.3:free",
	name: "Perplexity: Decider V1.3 (free)",
	api: "typesafe-system-one",
	provider: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 262144,
};

describe("central catalog", () => {
	test("a classifier only the central catalog lists is found, free", () => {
		const models = new PiModels(new CentralAuthStore(), catalogOf([PPLX]));
		expect(models.inputPrice("openrouter/perplexity/pplx-decider-v1.3:free")).toBe(0);
		expect(models.inputPrice("openrouter/perplexity/not-listed")).toBeUndefined();
	});

	test("the default ladder follows the central classifiers: newest Jev, free first", () => {
		const catalog = catalogOf([
			{ ...PPLX },
			{ ...PPLX, id: "typesafe/jev-1.13" },
			{ ...PPLX, id: "typesafe/jev-1.15" },
			{ ...PPLX, id: "typesafe/jev-1.15-free" },
		]);
		expect(new BackendLadder(undefined, catalog).list().map((b) => b.model)).toEqual([
			"openrouter/typesafe/jev-1.15-free",
			"openrouter/typesafe/jev-1.15",
		]);
	});

	test("a pinned ladder is used as written", () => {
		const pinned = [{ kind: "classifier" as const, model: "openrouter/perplexity/pplx-decider-v1.3:free" }];
		expect(new BackendLadder(pinned, catalogOf([])).list()).toEqual(pinned);
	});
});

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
