import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promoteVersion } from "./promote.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "decision-promote-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

describe("promoteVersion", () => {
	test("creates the config when missing and points the feature at the version", () => {
		const configPath = join(dir, "sub", "config.json");
		const result = promoteVersion("model_route", "v1", { configPath, evalDir: join(dir, "none") });
		expect(result.previous).toBeUndefined();
		expect(read(configPath)).toEqual({ prompts: { model_route: "v1" } });
		expect(result.warnings[0]).toContain("no eval report");
	});

	test("keeps every other key, including other features' pointers", () => {
		const configPath = join(dir, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify({ port: 1, dailyBudgetUsd: 2, prompts: { find_skill: "v3", model_route: "v0" } }),
		);
		const result = promoteVersion("model_route", "v1", { configPath, evalDir: dir });
		expect(result.previous).toBe("v0");
		expect(read(configPath)).toEqual({ port: 1, dailyBudgetUsd: 2, prompts: { find_skill: "v3", model_route: "v1" } });
	});

	test("refuses a missing prompt file, a bad version, an unknown feature, and a corrupt config without writing", () => {
		const configPath = join(dir, "config.json");
		expect(() => promoteVersion("model_route", "v99", { configPath })).toThrow("no prompt file");
		expect(() => promoteVersion("model_route", "latest", { configPath })).toThrow("must look like");
		expect(() => promoteVersion("nope", "v1", { configPath })).toThrow("unknown feature");
		writeFileSync(configPath, "{ not json");
		expect(() => promoteVersion("model_route", "v1", { configPath })).toThrow("not valid JSON");
		expect(readFileSync(configPath, "utf8")).toBe("{ not json");
	});

	test("a prompt file that does not parse is refused (custom prompts dir)", () => {
		const promptsDir = join(dir, "prompts");
		mkdirSync(join(promptsDir, "model_route"), { recursive: true });
		writeFileSync(join(promptsDir, "model_route", "v2.json"), "{ nope");
		expect(() => promoteVersion("model_route", "v2", { configPath: join(dir, "c.json"), promptsDir })).toThrow();
	});

	test("warns when the latest eval report for that version did not meet the rule", () => {
		const evalDir = join(dir, "eval");
		mkdirSync(evalDir);
		writeFileSync(
			join(evalDir, "261018-model_route-v1.json"),
			JSON.stringify({
				feature: "model_route",
				version: "v1",
				verdict: { holds: false, reasons: ["within1 0.800 < floor 0.9"] },
			}),
		);
		const result = promoteVersion("model_route", "v1", { configPath: join(dir, "c.json"), evalDir });
		expect(result.warnings[0]).toContain("did not meet");
	});
});
