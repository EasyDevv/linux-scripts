import { describe, expect, test } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CentralCatalog, defaultCatalogPath } from "./central-catalog.ts";

function file(content: string) {
	const path = join(mkdtempSync(join(tmpdir(), "catalog-")), "catalog.json");
	writeFileSync(path, content);
	return path;
}

describe("CentralCatalog", () => {
	test("path follows an absolute XDG_CONFIG_HOME, else ~/.config", () => {
		expect(defaultCatalogPath({ XDG_CONFIG_HOME: "/x" })).toBe("/x/models/catalog.json");
		expect(defaultCatalogPath({ XDG_CONFIG_HOME: "rel" }).endsWith("/.config/models/catalog.json")).toBe(true);
	});

	test("a missing file is empty, not an error", () => {
		const catalog = new CentralCatalog("/nonexistent/catalog.json");
		expect(catalog.models("openrouter")).toEqual([]);
		expect(catalog.lastError).toBeUndefined();
	});

	test("models filters by type and treats no type as chat", () => {
		const catalog = new CentralCatalog(
			file(JSON.stringify({ openrouter: { models: [{ id: "a" }, { id: "b", type: "classifier" }] } })),
		);
		expect(catalog.models("openrouter", "chat").map((m) => m.id)).toEqual(["a"]);
		expect(catalog.model("openrouter", "b", "classifier")?.id).toBe("b");
		expect(catalog.model("openrouter", "b", "chat")).toBeUndefined();
	});

	test("a damaged rewrite keeps the last good view and reports why", () => {
		const path = file(JSON.stringify({ xai: { models: [{ id: "grok" }] } }));
		const catalog = new CentralCatalog(path);
		expect(catalog.models("xai")).toHaveLength(1);
		writeFileSync(path, "{");
		utimesSync(path, new Date(), new Date(Date.now() + 5000));
		expect(catalog.models("xai")).toHaveLength(1);
		expect(catalog.lastError).toBeDefined();
	});

	test("ageSec reads checkedAt", () => {
		const catalog = new CentralCatalog(file(JSON.stringify({ openrouter: { models: [], checkedAt: 1000 } })));
		expect(catalog.ageSec("openrouter", 61_000)).toBe(60);
		expect(catalog.ageSec("xai")).toBeUndefined();
	});
});
