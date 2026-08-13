import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	bumpVersion,
	isInvokedAsMainModule,
	normalizeAction,
	normalizeCustomChoice,
	normalizeExplicitVersion,
	parseSelectionValue,
	resolveExplicitSelection,
} from "./zip-version.mjs";

describe("zip-version", () => {
	test("uses semver-standard action names and keeps legacy keep alias", () => {
		expect(normalizeAction("1")).toBe("patch");
		expect(normalizeAction("2")).toBe("minor");
		expect(normalizeAction("3")).toBe("major");
		expect(normalizeAction("4")).toBe("keep");
		expect(normalizeAction("pass")).toBe("keep");
	});

	test("accepts custom choice aliases and explicit versions", () => {
		expect(normalizeCustomChoice("5")).toBe(true);
		expect(normalizeCustomChoice("custom")).toBe(true);
		expect(normalizeCustomChoice("direct")).toBe(true);
		expect(normalizeExplicitVersion("1.2.3")).toBe("1.2.3");
		expect(normalizeExplicitVersion("1.2")).toBeNull();
	});

	test("parses action selections and typed versions", () => {
		expect(parseSelectionValue("minor")).toEqual({
			kind: "action",
			value: "minor",
		});
		expect(parseSelectionValue("1.4.2")).toEqual({
			kind: "version",
			value: "1.4.2",
		});
	});

	test("resolves explicit CLI selections", () => {
		expect(resolveExplicitSelection(["major"])).toEqual({
			kind: "action",
			value: "major",
		});
		expect(resolveExplicitSelection(["patch"])).toEqual({
			kind: "action",
			value: "patch",
		});
		expect(resolveExplicitSelection(["keep"])).toEqual({
			kind: "action",
			value: "keep",
		});
		expect(resolveExplicitSelection(["1.5.0"])).toEqual({
			kind: "version",
			value: "1.5.0",
		});
		expect(resolveExplicitSelection(["custom", "2.0.0"])).toEqual({
			kind: "version",
			value: "2.0.0",
		});
	});

	test("supports major, minor, patch, and keep bump behavior", () => {
		expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
		expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
		expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
		expect(bumpVersion("1.2.3", "keep")).toBe("1.2.3");
	});

	test("treats a symlinked entrypoint as the main module", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "zip-version-"));
		try {
			const scriptUrl = new URL("./zip-version.mjs", import.meta.url);
			const realScriptPath = fileURLToPath(scriptUrl);
			const symlinkPath = path.join(tempDir, "wxt-zip-version");
			await symlink(realScriptPath, symlinkPath);

			expect(isInvokedAsMainModule(symlinkPath, scriptUrl.href)).toBe(true);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
