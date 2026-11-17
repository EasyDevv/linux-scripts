// Shared helpers for `wxtu listing chrome|firefox`.
// Reads `<project>/.marketing/output` (or legacy `marketing/output`) and the
// optional `<marketing>/listing.json`, then drives a store edit page over CDP.
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
	CDP,
	createTab,
	listTabs,
	waitForLoad,
} from "/home/easydev/.local/share/scripts/dev/browser/cdp.ts";
import { WXTU_CONFIG } from "./config.mjs";

const MARKETING_DIRS = [".marketing", "marketing"];

// ── Args ────────────────────────────────────────────────────────────────

// spec: { flagName: "string" | "number" | "boolean" }; positionals collected.
export function parseArgs(argv, spec, usage) {
	const opts = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			console.log(usage);
			process.exit(0);
		}
		if (!arg.startsWith("--")) {
			opts._.push(arg);
			continue;
		}
		const [rawKey, inline] = arg.slice(2).split(/=(.*)/s);
		const type = spec[rawKey];
		if (!type) {
			console.error(`Unknown flag: ${arg}\n${usage}`);
			process.exit(1);
		}
		const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
		if (type === "boolean") {
			opts[key] = true;
			continue;
		}
		const value = inline ?? argv[++i];
		if (value === undefined) {
			console.error(`Missing value for ${arg}\n${usage}`);
			process.exit(1);
		}
		opts[key] = type === "number" ? Number.parseInt(value, 10) : value;
	}
	return opts;
}

// ── Workspace ───────────────────────────────────────────────────────────

export function findMarketing(startDir, explicitDir) {
	if (explicitDir) {
		const marketingDir = resolve(explicitDir);
		const outputDir = join(marketingDir, "output");
		if (!existsSync(outputDir)) {
			throw new Error(`No output/ under ${marketingDir}`);
		}
		return { marketingDir, outputDir, config: loadListingConfig(marketingDir) };
	}
	let dir = resolve(startDir);
	while (true) {
		for (const name of MARKETING_DIRS) {
			const marketingDir = join(dir, name);
			if (existsSync(join(marketingDir, "output"))) {
				return {
					marketingDir,
					outputDir: join(marketingDir, "output"),
					config: loadListingConfig(marketingDir),
				};
			}
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		`No .marketing/output (or marketing/output) found from ${startDir} upward.`,
	);
}

function loadListingConfig(marketingDir) {
	const path = join(marketingDir, "listing.json");
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf8"));
}

// ── Copy and media files ────────────────────────────────────────────────

export function decodeXml(text) {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&amp;/g, "&");
}

export function parseDescriptionXml(xmlPath) {
	const xml = readFileSync(xmlPath, "utf8");
	const pick = (tag) =>
		decodeXml(
			xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "",
		);
	return {
		title: pick("title"),
		summary: pick("summary"),
		description: pick("description"),
	};
}

// `NN-*.png` in name order (01-…, 02-…), capped at `max`.
export function findScreenshots(outputDir, locale, max = 10) {
	const dir = join(outputDir, locale);
	return readdirSync(dir)
		.filter((f) => /^\d{2}-.*\.png$/.test(f))
		.sort()
		.slice(0, max)
		.map((f) => resolve(dir, f));
}

export function listLocales(outputDir, requested, defaultLocale) {
	let locales = readdirSync(outputDir).filter((d) =>
		existsSync(join(outputDir, d, "description.xml")),
	);
	if (requested) {
		const wanted = requested.split(",").map((s) => s.trim().toLowerCase());
		const missing = wanted.filter((l) => !locales.includes(l));
		if (missing.length) {
			throw new Error(`Locale(s) not in ${outputDir}: ${missing.join(", ")}`);
		}
		locales = wanted;
	}
	return locales.sort((a, b) =>
		a === defaultLocale ? -1 : b === defaultLocale ? 1 : a.localeCompare(b),
	);
}

export function ensureFile(path) {
	if (!existsSync(path)) throw new Error(`Required file not found: ${path}`);
	return path;
}

// ── Session log (/tmp/wxtu/sessions/<ts>-<name>) ────────────────────────

export function createSession(name, meta) {
	const now = new Date();
	const p = (n) => String(n).padStart(2, "0");
	const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
	const dir = join(WXTU_CONFIG.paths.sessionsDir, `${stamp}-${name}`);
	mkdirSync(dir, { recursive: true });
	const startedAt = Date.now();
	writeFileSync(join(dir, "meta.json"), JSON.stringify({ ...meta, timestamp: now.toISOString() }, null, 2));
	return {
		dir,
		log(action, detail = {}) {
			try {
				appendFileSync(
					join(dir, "log.jsonl"),
					`${JSON.stringify({ ts: new Date().toISOString(), action, ...detail })}\n`,
				);
			} catch {}
		},
		async fail(cdp, error) {
			const snap = await pageEval(
				cdp,
				`({ href: location.href, html: document.documentElement.outerHTML })`,
			).catch(() => null);
			if (snap) writeFileSync(join(dir, "error-snapshot.json"), JSON.stringify(snap));
			writeFileSync(join(dir, "error.txt"), `${error?.stack ?? error}\n`);
		},
		result(value) {
			writeFileSync(
				join(dir, "result.json"),
				JSON.stringify({ ...value, durationMs: Date.now() - startedAt }, null, 2),
			);
		},
	};
}

// ── CDP ─────────────────────────────────────────────────────────────────

export async function waitForCdp(port, timeout = 10000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
				signal: AbortSignal.timeout(750),
			});
			if (res.ok) return;
		} catch {}
		await Bun.sleep(100);
	}
	throw new Error(`No CDP browser on port ${port}. Start one with: browser open --port ${port}`);
}

// Reuse a page tab whose URL contains `match`; open `url` in a new tab otherwise.
// Never falls back to an unrelated tab.
export async function connectTab(port, match, url) {
	await waitForCdp(port);
	const tabs = await listTabs(port);
	let tab = tabs.find((t) => t.type === "page" && t.url.includes(match));
	if (!tab) tab = await createTab(port, url);
	return CDP.connect(tab.webSocketDebuggerUrl);
}

export async function pageEval(cdp, expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
		);
	}
	return result.result?.value;
}

export async function waitFor(check, timeout = 10000, interval = 200) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const value = await check();
			if (value) return value;
		} catch {}
		await Bun.sleep(interval);
	}
	return false;
}

export async function waitForPage(cdp, expression, timeout = 10000, label) {
	const ok = await waitFor(() => pageEval(cdp, expression), timeout, 150);
	if (!ok) throw new Error(`Timed out waiting for ${label ?? expression}`);
	return ok;
}

export async function navigate(cdp, url, timeout = 30000) {
	const loaded = waitForLoad(cdp, timeout);
	await cdp.send("Page.navigate", { url });
	await loaded;
	await waitForPage(cdp, `document.readyState === "complete"`, timeout, "page load");
}

// Unhide a file input, then hand it a local file through DOM.setFileInputFiles.
export async function setInputFile(cdp, selector, filePath) {
	await pageEval(
		cdp,
		`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return false;
			Object.assign(el.style, { display: 'block', visibility: 'visible', opacity: '1', position: 'fixed', top: '0', left: '0', zIndex: '99999' });
			el.removeAttribute('disabled');
			return true;
		})()`,
	);
	await cdp.send("DOM.enable");
	const { root } = await cdp.send("DOM.getDocument", { depth: 1 });
	const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
	if (!nodeId) throw new Error(`File input not found: ${selector}`);
	const { node } = await cdp.send("DOM.describeNode", { nodeId });
	await cdp.send("DOM.setFileInputFiles", {
		backendNodeId: node.backendNodeId,
		files: [filePath],
	});
}

// ── Reporting ───────────────────────────────────────────────────────────

export function diffLabel(current, next) {
	if (current === next) return "same";
	const a = [...(current ?? "")].length;
	const b = [...next].length;
	return `changed (${a} → ${b} chars)`;
}
