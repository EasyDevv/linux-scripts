#!/usr/bin/env bun
/**
 * Gate for themes/<slug>/design.json + chrome.json: token names only, no color literals.
 */
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = Bun.argv.slice(2);
const themeFlag = args.indexOf("--theme");
const themeDir = themeFlag >= 0 ? resolve(args[themeFlag + 1] ?? "") : "";
if (!themeDir) {
	console.error("usage: check-theme-chrome.ts --theme <themes/<slug>>");
	process.exit(2);
}

const COLOR_RE =
	/#(?:[0-9a-fA-F]{3,8})\b|\b(?:rgb|rgba|hsl|hsla|lch|oklch|lab)\s*\(/g;
const TOKEN_DECL = /(--[a-z][a-z0-9-]*)\s*:/g;
const TOKEN_USE = /--[a-z][a-z0-9-]*/g;
const COLOR_KEY =
	/^(color|bg|fill|idle|active|ink|border|shadow|canvas|panel|well|hairline|navActive)$/i;

const errors: string[] = [];

async function exists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function walkColors(value: unknown, path: string) {
	if (typeof value === "string") {
		const leaf = path.split(".").pop() ?? "";
		if (COLOR_RE.test(value)) {
			errors.push(`${path}: color literal ${value}`);
		} else if (COLOR_KEY.test(leaf) && !value.startsWith("--")) {
			errors.push(`${path}: expected token name, got ${JSON.stringify(value)}`);
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => walkColors(item, `${path}[${index}]`));
		return;
	}
	if (value && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			walkColors(child, path ? `${path}.${key}` : key);
		}
	}
}

function checkJson(label: string, data: unknown, declared: Set<string>) {
	walkColors(data, label);
	const blob = JSON.stringify(data);
	if (COLOR_RE.test(blob)) {
		const hits = blob.match(COLOR_RE) ?? [];
		errors.push(`${label}: color literals ${[...new Set(hits)].join(", ")}`);
	}
	for (const token of new Set(blob.match(TOKEN_USE) ?? [])) {
		if (!declared.has(token)) errors.push(`${label}: unknown token ${token}`);
	}
}

const cssPath = join(themeDir, "layout.css");
const designPath = join(themeDir, "design.json");
const chromePath = join(themeDir, "chrome.json");

for (const stale of ["DESIGN.md", "design.md"]) {
	if (await exists(join(themeDir, stale))) {
		errors.push(`${stale} exists; use design.json`);
	}
}

if (!(await exists(cssPath))) {
	console.error(`missing ${cssPath}`);
	process.exit(2);
}

const css = await readFile(cssPath, "utf8");
const declared = new Set<string>();
for (const match of css.matchAll(TOKEN_DECL)) declared.add(match[1]);

const hasDesign = await exists(designPath);
const hasChrome = await exists(chromePath);

if (hasChrome && !hasDesign) {
	errors.push("chrome.json present without design.json");
}

if (hasDesign) {
	checkJson(
		"design.json",
		JSON.parse(await readFile(designPath, "utf8")) as unknown,
		declared,
	);
}

if (hasChrome) {
	checkJson(
		"chrome.json",
		JSON.parse(await readFile(chromePath, "utf8")) as unknown,
		declared,
	);
}

if (errors.length) {
	for (const error of errors) console.error(error);
	process.exit(1);
}

console.log(`ok ${themeDir}`);
