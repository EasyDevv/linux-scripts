import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CentralAuth } from "./central-auth.ts";

const NOW = 5_000_000;

function setup(credentials: Record<string, unknown>, version = 1) {
	const dir = mkdtempSync(join(tmpdir(), "central-auth-"));
	const path = join(dir, "credentials.json");
	writeFileSync(path, JSON.stringify({ version, credentials }));
	return { dir, path };
}

/** A stand-in for the Go tool: counts its calls and writes a fresh token, as `auth refresh` would. */
function fakeBin(dir: string, path: string, expires: number) {
	const bin = join(dir, "auth");
	const counter = join(dir, "calls");
	writeFileSync(
		bin,
		`#!/bin/sh\necho x >> "${counter}"\nprintf '%s' '${JSON.stringify({ version: 1, credentials: { xai: { type: "oauth", access: "fresh", refresh: "r2", expires } } })}' > "${path}.tmp" && mv "${path}.tmp" "${path}"\n`,
	);
	chmodSync(bin, 0o755);
	return { bin, calls: () => (existsSync(counter) ? readFileSync(counter, "utf8").trim().split("\n").length : 0) };
}

describe("CentralAuth", () => {
	test("reads keys and lists them without secrets", async () => {
		const { path } = setup({ openrouter: { type: "api_key", key: "sk-1" } });
		const auth = new CentralAuth({ path, now: () => NOW });
		expect(await auth.get("openrouter")).toEqual({ type: "api_key", key: "sk-1" });
		expect(auth.list()).toEqual([{ providerId: "openrouter", type: "api_key" }]);
		expect(auth.has("nope")).toBe(false);
	});

	test("a missing file is empty, not an error", () => {
		const auth = new CentralAuth({ path: join(tmpdir(), "central-auth-missing", "x.json") });
		expect(auth.list()).toEqual([]);
		expect(auth.lastError).toBeUndefined();
	});

	test("a broken or newer-format file keeps the last good view", () => {
		const { path } = setup({ a: { type: "api_key", key: "k" } });
		const auth = new CentralAuth({ path });
		expect(auth.has("a")).toBe(true);
		writeFileSync(path, "{");
		expect(auth.has("a")).toBe(true);
		expect(auth.lastError).toContain("credentials.json");
		writeFileSync(path, JSON.stringify({ version: 2, credentials: {} }));
		expect(auth.has("a")).toBe(true);
		expect(auth.lastError).toContain("version");
	});

	test("an expired OAuth token is refreshed once for concurrent callers", async () => {
		const { dir, path } = setup({ xai: { type: "oauth", access: "old", refresh: "r", expires: NOW - 1 } });
		const { bin, calls } = fakeBin(dir, path, NOW + 3_600_000);
		const auth = new CentralAuth({ path, bin, now: () => NOW });
		const results = await Promise.all([auth.get("xai"), auth.get("xai"), auth.get("xai")]);
		expect(results.map((c) => (c?.type === "oauth" ? c.access : undefined))).toEqual(["fresh", "fresh", "fresh"]);
		expect(calls()).toBe(1);
		// Now valid: no further call.
		await auth.get("xai");
		expect(calls()).toBe(1);
	});

	test("a valid OAuth token is returned without running the tool", async () => {
		const { path } = setup({ xai: { type: "oauth", access: "ok", refresh: "r", expires: NOW + 1000 } });
		const auth = new CentralAuth({ path, bin: "/nonexistent/auth", now: () => NOW });
		expect((await auth.get("xai"))?.type).toBe("oauth");
	});

	test("a missing tool is reported with how to build it", async () => {
		const { path } = setup({ xai: { type: "oauth", access: "old", refresh: "r", expires: NOW - 1 } });
		const auth = new CentralAuth({ path, bin: "/nonexistent/auth", now: () => NOW });
		await expect(auth.get("xai")).rejects.toThrow("dev/auth.sh");
	});

	test("still expired after refresh is an error", async () => {
		const { dir, path } = setup({ xai: { type: "oauth", access: "old", refresh: "r", expires: NOW - 1 } });
		const { bin } = fakeBin(dir, path, NOW - 1);
		await expect(new CentralAuth({ path, bin, now: () => NOW }).get("xai")).rejects.toThrow("still expired");
	});
});
