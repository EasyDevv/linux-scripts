import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CentralAuth } from "../auth/client/central-auth.ts";
import { CentralAuthStore } from "./auth.ts";

function store(credentials: Record<string, unknown>) {
	const path = join(mkdtempSync(join(tmpdir(), "decision-auth-")), "credentials.json");
	writeFileSync(path, JSON.stringify({ version: 1, credentials }));
	return new CentralAuthStore(new CentralAuth({ path }), { opencode: "opencode-go" });
}

describe("CentralAuthStore", () => {
	test("reads a stored key and reports where it came from, never the key", async () => {
		const auth = store({ openrouter: { type: "api_key", key: "sk-or" } });
		expect(await auth.read("openrouter")).toEqual({ type: "api_key", key: "sk-or" } as never);
		expect(auth.origin("openrouter")).toBe("auth:openrouter");
		expect(await auth.read("lithosai")).toBeUndefined();
		expect(auth.origin("lithosai")).toBeUndefined();
	});

	test("opencode borrows the opencode-go key unless it has its own", async () => {
		const borrowed = store({ "opencode-go": { type: "api_key", key: "go-key" } });
		expect(await borrowed.read("opencode")).toEqual({ type: "api_key", key: "go-key" } as never);
		expect(borrowed.origin("opencode")).toBe("auth:opencode-go");
		const own = store({ "opencode-go": { type: "api_key", key: "go-key" }, opencode: { type: "api_key", key: "zen-key" } });
		expect(await own.read("opencode")).toEqual({ type: "api_key", key: "zen-key" } as never);
	});

	test("list names providers and types only", async () => {
		const auth = store({ a: { type: "api_key", key: "secret" } });
		expect(await auth.list()).toEqual([{ providerId: "a", type: "api_key" }]);
	});

	test("modify never writes: it returns what is stored", async () => {
		const auth = store({ a: { type: "api_key", key: "k" } });
		expect(await auth.modify("a")).toEqual({ type: "api_key", key: "k" } as never);
	});
});
