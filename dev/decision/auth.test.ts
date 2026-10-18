import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFileValue, PiAuthStore } from "./auth.ts";

describe("env keys", () => {
	test("one NAME=value line is read; quotes and export are tolerated", () => {
		const text = "A=1\n# c\nexport OPENROUTER_API_KEY='sk-or-x'\nB=2\n";
		expect(envFileValue(text, "OPENROUTER_API_KEY")).toBe("sk-or-x");
		expect(envFileValue(text, "MISSING")).toBeUndefined();
	});

	test("env wins over the env file, the file over auth.json", async () => {
		const dir = mkdtempSync(join(tmpdir(), "decision-auth-"));
		const envFile = join(dir, ".env");
		const authFile = join(dir, "auth.json");
		writeFileSync(envFile, "OPENROUTER_API_KEY=from-file\n");
		writeFileSync(authFile, JSON.stringify({ openrouter: { type: "api_key", key: "from-auth" } }));
		const fromFile = new PiAuthStore(authFile, {}, envFile, {});
		expect(await fromFile.read("openrouter")).toEqual({ type: "api_key", key: "from-file" } as never);
		expect(fromFile.origin("openrouter")).toBe(`${envFile}:OPENROUTER_API_KEY`);
		const fromEnv = new PiAuthStore(authFile, {}, envFile, { OPENROUTER_API_KEY: "from-env" });
		expect(fromEnv.origin("openrouter")).toBe("env:OPENROUTER_API_KEY");
		const fromAuth = new PiAuthStore(authFile, {}, join(dir, "none"), {});
		expect(await fromAuth.read("openrouter")).toEqual({ type: "api_key", key: "from-auth" } as never);
	});
});
