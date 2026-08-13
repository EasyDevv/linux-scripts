#!/usr/bin/env bun
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
	CDP,
	createTab,
	waitForLoad,
	listTabs,
} from "/home/easydev/.agents/skills/bun-webview/scripts/cdp.ts";
import { WXTU_CONFIG } from "./config.mjs";

const CHROME_EDIT_URL =
	"https://chrome.google.com/u/0/webstore/devconsole/eff9b0f1-7bdd-43d4-af17-d1ca3858a1e0/ldbgfnalchcfhaakaihnbochioehjfic/edit";
const DEFAULT_LOCALE = "en-us";
const TARGET_NAME = "scroll-detox";
const CHROME_LOCALE_MAP = {
	en: "en-us",
	de: "de",
	es: "es-es",
	ja: "ja",
	"zh-CN": "zh-cn",
	"zh-TW": "zh-tw",
	"pt-BR": "pt-br",
	fr: "fr",
	ko: "ko",
};
const SESSION_PLATFORM = "wxtu-chrome-listing";
const SESSION_BASE_DIR = WXTU_CONFIG.paths.sessionsDir;
const SESSION_DIR_SUFFIX = "chrome-detox";
const CHROME_ASSET_SELECTORS = {
	localizedScreenshots: '[data-image-upload-type="4"]:not([data-is-global])',
	commonScreenshots: '[data-image-upload-type="4"][data-is-global="true"]',
	smallTile: '[data-image-upload-type="1"][data-is-global="true"]',
	marqueeTile: '[data-image-upload-type="3"][data-is-global="true"]',
};

let activeSession = null;

function findWorkspaceRoot(startDir, relativeScriptPath) {
	let currentDir = resolve(startDir);
	while (true) {
		const candidate = join(currentDir, relativeScriptPath);
		if (existsSync(candidate)) {
			return currentDir;
		}
		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}
	throw new Error(
		`Could not find ${relativeScriptPath} from ${startDir} or any parent directory.`,
	);
}

function parseDescriptionXml(xmlPath) {
	const xml = readFileSync(xmlPath, "utf8");
	const title = xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || "";
	const summary =
		xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || "";
	const description =
		xml.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() || "";
	return { title, summary, description };
}

function findScreenshots(outputDir, locale) {
	const localeDir = join(outputDir, locale);
	const files = readdirSync(localeDir);
	const screenshots = [];
	for (let i = 1; i <= 5; i++) {
		const prefix = String(i).padStart(2, "0");
		const file = files.find((f) => f.startsWith(prefix) && f.endsWith(".png"));
		if (file) {
			screenshots.push(resolve(localeDir, file));
		}
	}
	return screenshots;
}

function ensureFileExists(filePath) {
	if (!existsSync(filePath)) {
		throw new Error(`Required file not found: ${filePath}`);
	}
}

function toChromeLocale(locale) {
	for (const [chromeLocale, outputLocale] of Object.entries(
		CHROME_LOCALE_MAP,
	)) {
		if (outputLocale === locale) {
			return chromeLocale;
		}
	}
	throw new Error(`Unsupported Chrome locale mapping: ${locale}`);
}

function getStableEditUrl() {
	return CHROME_EDIT_URL;
}

function getAssetSelector(kind) {
	const selector = CHROME_ASSET_SELECTORS[kind];
	if (!selector) {
		throw new Error(`Unknown Chrome asset kind: ${kind}`);
	}
	return selector;
}

function formatSessionTimestamp(date) {
	return [
		String(date.getFullYear()),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
		"-",
		String(date.getHours()).padStart(2, "0"),
		String(date.getMinutes()).padStart(2, "0"),
		String(date.getSeconds()).padStart(2, "0"),
	].join("");
}

function sanitizeSessionSegment(value) {
	return String(value)
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function activateSession(_workspaceRoot, targetName, locales) {
	const now = new Date();
	mkdirSync(SESSION_BASE_DIR, { recursive: true });
	const sessionId = `${formatSessionTimestamp(now)}-${sanitizeSessionSegment(targetName)}-${SESSION_DIR_SUFFIX}`;
	const dir = join(SESSION_BASE_DIR, sessionId);
	mkdirSync(dir, { recursive: true });
	activeSession = {
		id: sessionId,
		dir,
		startedAt: Date.now(),
		step: 0,
	};
	writeSessionJson("meta.json", {
		sessionId,
		platform: SESSION_PLATFORM,
		targetName,
		locales,
		cwd: process.cwd(),
		timestamp: now.toISOString(),
		editUrl: CHROME_EDIT_URL,
	});
	appendSessionLog("session-start", { targetName, locales });
	return activeSession;
}

function deactivateSession() {
	activeSession = null;
}

function appendSessionLog(action, detail = {}) {
	if (!activeSession) return;
	try {
		appendFileSync(
			join(activeSession.dir, "log.jsonl"),
			JSON.stringify({
				type: "action",
				ts: new Date().toISOString(),
				step: activeSession.step,
				action,
				...detail,
			}) + "\n",
		);
	} catch {
		// best effort only
	}
}

function writeSessionJson(fileName, value) {
	if (!activeSession) return;
	return Bun.write(
		join(activeSession.dir, fileName),
		JSON.stringify(value, null, 2),
	);
}

async function captureSessionStep(cdp, label, detail = {}) {
	if (!activeSession) return;
	const snapshot = await pageEval(
		cdp,
		`(() => ({ href: location.href, title: document.title, readyState: document.readyState }))()`,
	).catch(() => ({ href: "", title: "", readyState: "unknown" }));
	const tag = `${String(activeSession.step).padStart(3, "0")}-${sanitizeSessionSegment(label) || "step"}`;
	await writeSessionJson(`${tag}.json`, {
		label,
		detail,
		capturedAt: new Date().toISOString(),
		...snapshot,
	});
	appendSessionLog("step", {
		label,
		...detail,
		url: snapshot.href,
		title: snapshot.title,
	});
	activeSession.step += 1;
}

async function writeSessionResult(result) {
	if (!activeSession) return;
	await writeSessionJson("result.json", {
		...result,
		sessionId: activeSession.id,
		durationMs: Date.now() - activeSession.startedAt,
		totalSteps: activeSession.step,
		timestamp: new Date().toISOString(),
	});
}

async function captureSessionFailure(cdp, error) {
	if (!activeSession) return;
	const snapshot = await pageEval(
		cdp,
		`(() => ({ href: location.href, title: document.title, html: document.documentElement.outerHTML }))()`,
	).catch(() => null);
	if (snapshot) {
		await writeSessionJson("error-snapshot.json", snapshot);
	}
	await Bun.write(
		join(activeSession.dir, "error.txt"),
		`${error?.stack ?? error?.message ?? String(error)}\n`,
	);
	appendSessionLog("failure", { message: error?.message ?? String(error) });
}

async function waitForChromeCustom(port, timeout = 10000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
				signal: AbortSignal.timeout(750),
			});
			if (response.ok) return;
		} catch {}
		await Bun.sleep(100);
	}
	throw new Error(`Timed out waiting for Chrome on port ${port}`);
}

async function pageEval(cdp, script) {
	const result = await cdp.send("Runtime.evaluate", {
		expression: script,
		returnByValue: true,
		awaitPromise: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ||
				result.exceptionDetails.text,
		);
	}
	return result.result?.value;
}

async function waitForPageCondition(
	cdp,
	script,
	timeout = 10000,
	interval = 100,
) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const value = await pageEval(cdp, script);
			if (value) return value;
		} catch {}
		await Bun.sleep(interval);
	}
	throw new Error(`Timed out waiting for page condition: ${script}`);
}

async function pageSetFileInputFiles(cdp, selector, filePath) {
	const t0 = Date.now();
	await pageEval(
		cdp,
		`
		(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (el) {
			const trigger = el.parentElement?.querySelector('[role="button"]');
			if (trigger instanceof HTMLElement) {
				trigger.click();
			}
			el.style.display = 'block';
			el.style.visibility = 'visible';
			el.style.opacity = '1';
			el.style.position = 'fixed';
			el.style.top = '0';
			el.style.left = '0';
			el.style.zIndex = '99999';
			el.removeAttribute('disabled');
		}
		})()
	`,
	);
	await cdp.send("DOM.enable");
	const { root } = await cdp.send("DOM.getDocument", { depth: 1 });
	const { nodeId } = await cdp.send("DOM.querySelector", {
		nodeId: root.nodeId,
		selector,
	});
	if (!nodeId) throw new Error(`File input not found: ${selector}`);
	const { node } = await cdp.send("DOM.describeNode", { nodeId });
	await cdp.send("DOM.setFileInputFiles", {
		backendNodeId: node.backendNodeId,
		files: [filePath],
	});
	await pageEval(
		cdp,
		`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!(el instanceof HTMLInputElement)) {
			throw new Error('File input not found after upload: ' + ${JSON.stringify(selector)});
		}
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	})()`,
	);
	appendSessionLog("upload-file", {
		selector,
		filePath,
		durationMs: Date.now() - t0,
	});
}

async function getCurrentLocaleCode(cdp) {
	return await pageEval(
		cdp,
		`(() => {
		const section = Array.from(document.querySelectorAll('section')).find((el) =>
			(el.innerText || '').includes('현재 수정 중인 언어'),
		);
		if (!section) return null;
		const selected = section.querySelector('li[role="option"][aria-selected="true"]');
		if (selected instanceof HTMLElement) {
			return selected.getAttribute('data-value');
		}
		const display = section.querySelector('[role="combobox"] .VfPpkd-uusGie-fmcmS span');
		const match = (display?.textContent || '').match(/([a-z]{2}(?:-[A-Z]{2})?)$/);
		return match ? match[1] : null;
	})()`,
	);
}

async function switchLocale(cdp, locale) {
	const targetLocale = toChromeLocale(locale);
	const currentLocale = await getCurrentLocaleCode(cdp);
	if (currentLocale === targetLocale) {
		return;
	}
	await pageEval(
		cdp,
		`(() => {
		const targetLocale = ${JSON.stringify(targetLocale)};
		const section = Array.from(document.querySelectorAll('section')).find((el) =>
			(el.innerText || '').includes('현재 수정 중인 언어'),
		);
		if (!section) throw new Error('Language section not found');
		const combobox = section.querySelector('[role="combobox"]');
		if (!(combobox instanceof HTMLElement)) {
			throw new Error('Language combobox not found');
		}
		combobox.click();
		const option = section.querySelector('li[role="option"][data-value="' + targetLocale + '"]');
		if (!(option instanceof HTMLElement)) {
			throw new Error('Language option not found: ' + targetLocale);
		}
		option.click();
		return true;
	})()`,
	);
	await waitForPageCondition(
		cdp,
		`(() => {
			const section = Array.from(document.querySelectorAll('section')).find((el) =>
				(el.innerText || '').includes('현재 수정 중인 언어'),
			);
			if (!section) return false;
			const selected = section.querySelector('li[role="option"][aria-selected="true"]');
			if (!(selected instanceof HTMLElement)) return false;
			const description = Array.from(document.querySelectorAll('section')).find((el) =>
				(el.innerText || '').includes('제품 세부정보'),
			);
			return selected.getAttribute('data-value') === ${JSON.stringify(targetLocale)} && !!description?.querySelector('textarea');
		})()`,
		10000,
	);
	appendSessionLog("switch-locale", { locale, chromeLocale: targetLocale });
}

async function ensureEditPageReady(cdp) {
	await waitForPageCondition(
		cdp,
		`(() => {
			const hasLanguage = Array.from(document.querySelectorAll('section')).some((el) =>
				(el.innerText || '').includes('현재 수정 중인 언어'),
			);
			const hasDescription = Array.from(document.querySelectorAll('section')).some((el) =>
				(el.innerText || '').includes('제품 세부정보') && !!el.querySelector('textarea'),
			);
			return hasLanguage && hasDescription;
		})()`,
		15000,
	);
}

async function navigateAndWait(cdp, url, timeout = 30000) {
	const t0 = Date.now();
	await cdp.send("Page.navigate", { url });
	await waitForLoad(cdp, timeout);
	await waitForPageCondition(
		cdp,
		`(() => document.readyState === "complete")()`,
		timeout,
	);
	await ensureEditPageReady(cdp);
	appendSessionLog("navigate", { url, durationMs: Date.now() - t0 });
}

async function getDescriptionValue(cdp) {
	return await pageEval(
		cdp,
		`(() => {
		const section = Array.from(document.querySelectorAll('section')).find((el) =>
			(el.innerText || '').includes('제품 세부정보'),
		);
		if (!section) throw new Error('Description section not found');
		const field = Array.from(section.querySelectorAll('textarea')).find((el) => {
			if (!(el instanceof HTMLTextAreaElement) || el.disabled) return false;
			const style = getComputedStyle(el);
			return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
		});
		if (!(field instanceof HTMLTextAreaElement)) {
			throw new Error('Description textarea not found');
		}
		return field.value || '';
	})()`,
	);
}

async function fillDescription(cdp, value) {
	const t0 = Date.now();
	await pageEval(
		cdp,
		`(() => {
		const section = Array.from(document.querySelectorAll('section')).find((el) =>
			(el.innerText || '').includes('제품 세부정보'),
		);
		if (!section) throw new Error('Description section not found');
		const field = Array.from(section.querySelectorAll('textarea')).find((el) => {
			if (!(el instanceof HTMLTextAreaElement) || el.disabled) return false;
			const style = getComputedStyle(el);
			return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
		});
		if (!(field instanceof HTMLTextAreaElement)) {
			throw new Error('Description textarea not found');
		}
		field.focus();
		field.value = '';
		field.value = ${JSON.stringify(value)};
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('change', { bubbles: true }));
		return field.value;
	})()`,
	);
	appendSessionLog("fill-description", {
		valueLength: value.length,
		durationMs: Date.now() - t0,
	});
}

async function countAssetItems(cdp, blockSelector) {
	return await pageEval(
		cdp,
		`(() => {
		const block = document.querySelector(${JSON.stringify(blockSelector)});
		if (!block) throw new Error('Asset block not found: ' + ${JSON.stringify(blockSelector)});
		return Array.from(block.querySelectorAll('[aria-label^="이미지 삭제"]')).filter((button) => {
			if (!(button instanceof HTMLElement)) return false;
			const container = button.closest('[jsname="P3Vluc"]') ?? button.parentElement;
			if (!(container instanceof HTMLElement)) return false;
			const style = getComputedStyle(container);
			return style.display !== 'none' && style.visibility !== 'hidden';
		}).length;
	})()`,
	);
}

async function clearAssetBlock(cdp, blockSelector) {
	const initialCount = await countAssetItems(cdp, blockSelector);
	for (let remaining = initialCount; remaining > 0; remaining -= 1) {
		const clicked = await pageEval(
			cdp,
			`(() => {
			const block = document.querySelector(${JSON.stringify(blockSelector)});
			if (!block) throw new Error('Asset block not found: ' + ${JSON.stringify(blockSelector)});
			const button = block.querySelector('[aria-label^="이미지 삭제"]');
			if (!(button instanceof HTMLElement)) return false;
			button.click();
			return true;
		})()`,
		);
		if (!clicked) {
			break;
		}
		await waitForPageCondition(
			cdp,
			`(() => Array.from(document.querySelectorAll('[role="dialog"] button')).some((el) =>
				(el.innerText || '').trim() === '삭제',
			))()`,
			5000,
		);
		await pageEval(
			cdp,
			`(() => {
			const buttons = Array.from(document.querySelectorAll('[role="dialog"] button')).filter((el) =>
				(el.innerText || '').trim() === '삭제',
			);
			const button = buttons[buttons.length - 1];
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error('Delete confirmation button not found');
			}
			button.click();
			return true;
		})()`,
		);
		const removed = await waitForVerification(
			async () => (await countAssetItems(cdp, blockSelector)) === remaining - 1,
			10000,
			200,
		);
		if (!removed) {
			throw new Error(`Timed out deleting asset from ${blockSelector}`);
		}
	}
	appendSessionLog("clear-asset-block", {
		blockSelector,
		removed: initialCount,
	});
	return initialCount;
}

async function uploadAssetFiles(cdp, blockSelector, filePaths) {
	for (const filePath of filePaths) {
		const beforeCount = await countAssetItems(cdp, blockSelector);
		await pageSetFileInputFiles(
			cdp,
			`${blockSelector} input[type=file]`,
			filePath,
		);
		const uploaded = await waitForVerification(
			async () =>
				(await countAssetItems(cdp, blockSelector)) >= beforeCount + 1,
			20000,
			200,
		);
		if (!uploaded) {
			throw new Error(
				`Upload did not appear in ${blockSelector} for ${filePath}`,
			);
		}
	}
	appendSessionLog("upload-asset-files", {
		blockSelector,
		count: filePaths.length,
	});
}

async function replaceAssetBlockFiles(cdp, kind, filePaths) {
	if (filePaths.length === 0) {
		throw new Error(`No files provided for ${kind}`);
	}
	const blockSelector = getAssetSelector(kind);
	const previousCount = await countAssetItems(cdp, blockSelector);
	if (previousCount > 0) {
		await clearAssetBlock(cdp, blockSelector);
	}
	await uploadAssetFiles(cdp, blockSelector, filePaths);
	return { blockSelector, expectedCount: filePaths.length, previousCount };
}

async function clickDraftSave(cdp) {
	const t0 = Date.now();
	await pageEval(
		cdp,
		`(() => {
		const button = Array.from(document.querySelectorAll('button')).find(
			(el) => (el.innerText || '').trim() === '임시저장',
		);
		if (!(button instanceof HTMLButtonElement)) {
			throw new Error('Draft save button not found');
		}
		button.click();
		return true;
	})()`,
	);
	await waitForPageCondition(
		cdp,
		`(() => {
			const button = Array.from(document.querySelectorAll('button')).find(
				(el) => (el.innerText || '').trim() === '임시저장',
			);
			const disabled = button instanceof HTMLButtonElement &&
				(button.disabled || button.getAttribute('aria-disabled') === 'true');
			const hasAlert = Array.from(document.querySelectorAll('[role="alert"], [role="status"]')).some(
				(el) => (el.innerText || '').trim().length > 0,
			);
			return disabled || hasAlert || document.readyState === 'complete';
		})()`,
		5000,
	).catch(() => null);
	appendSessionLog("save-draft", { durationMs: Date.now() - t0 });
}

async function verifyDescriptionValue(cdp, locale, expectedDescription) {
	await navigateAndWait(cdp, getStableEditUrl());
	await switchLocale(cdp, locale);
	return (await getDescriptionValue(cdp)) === expectedDescription;
}

async function verifyAssetCount(cdp, locale, kind, expectedCount) {
	await navigateAndWait(cdp, getStableEditUrl());
	await switchLocale(cdp, locale);
	const count = await countAssetItems(cdp, getAssetSelector(kind));
	appendSessionLog("verify-asset-count", {
		locale,
		kind,
		count,
		expectedCount,
	});
	return count === expectedCount;
}

async function waitForVerification(check, timeout = 30000, interval = 1000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			if (await check()) {
				return true;
			}
		} catch {}
		await Bun.sleep(interval);
	}
	return false;
}

async function processLocale(cdp, locale, outputDir) {
	console.log(`\n[${locale}] Editing Chrome listing...`);
	appendSessionLog("locale-start", { locale });
	await navigateAndWait(cdp, getStableEditUrl());
	await switchLocale(cdp, locale);
	await captureSessionStep(cdp, `locale-${locale}-opened`, { locale });

	const xmlPath = join(outputDir, locale, "description.xml");
	ensureFileExists(xmlPath);
	const { description } = parseDescriptionXml(xmlPath);
	const screenshots = findScreenshots(outputDir, locale);
	if (screenshots.length === 0) {
		throw new Error(`No screenshots found for locale ${locale}`);
	}

	let changed = false;
	const currentDescription = await getDescriptionValue(cdp);
	if (currentDescription !== description) {
		console.log("  Description differs, updating...");
		await fillDescription(cdp, description);
		changed = true;
	} else {
		console.log("  Description unchanged");
	}

	const screenshotKind =
		locale === DEFAULT_LOCALE ? "commonScreenshots" : "localizedScreenshots";
	console.log(
		`  Replacing ${screenshotKind} with ${screenshots.length} screenshot(s)...`,
	);
	await replaceAssetBlockFiles(cdp, screenshotKind, screenshots);
	changed = true;

	if (locale === DEFAULT_LOCALE) {
		const smallTilePath = join(outputDir, "tile-small.png");
		const marqueeTilePath = join(outputDir, "tile-marquee.png");
		ensureFileExists(smallTilePath);
		ensureFileExists(marqueeTilePath);
		console.log("  Replacing small promotion tile...");
		await replaceAssetBlockFiles(cdp, "smallTile", [smallTilePath]);
		console.log("  Replacing marquee promotion tile...");
		await replaceAssetBlockFiles(cdp, "marqueeTile", [marqueeTilePath]);
	}

	if (!changed) {
		await captureSessionStep(cdp, `locale-${locale}-unchanged`, { locale });
		return;
	}

	console.log("  Saving draft...");
	await clickDraftSave(cdp);

	const descriptionVerified = await waitForVerification(
		() => verifyDescriptionValue(cdp, locale, description),
		30000,
		1000,
	);
	if (!descriptionVerified) {
		throw new Error(`Description verification failed for ${locale}`);
	}

	const screenshotsVerified = await waitForVerification(
		() => verifyAssetCount(cdp, locale, screenshotKind, screenshots.length),
		30000,
		1000,
	);
	if (!screenshotsVerified) {
		throw new Error(`Screenshot verification failed for ${locale}`);
	}

	if (locale === DEFAULT_LOCALE) {
		const smallTileVerified = await waitForVerification(
			() => verifyAssetCount(cdp, locale, "smallTile", 1),
			30000,
			1000,
		);
		if (!smallTileVerified) {
			throw new Error("Small tile verification failed");
		}
		const marqueeTileVerified = await waitForVerification(
			() => verifyAssetCount(cdp, locale, "marqueeTile", 1),
			30000,
			1000,
		);
		if (!marqueeTileVerified) {
			throw new Error("Marquee tile verification failed");
		}
	}

	console.log("  Changes saved and verified");
	await captureSessionStep(cdp, `locale-${locale}-saved`, {
		locale,
		screenshotKind,
		screenshotCount: screenshots.length,
	});
}

function sortLocales(locales) {
	return [...locales].sort((a, b) => {
		if (a === DEFAULT_LOCALE) return -1;
		if (b === DEFAULT_LOCALE) return 1;
		return a.localeCompare(b);
	});
}

async function main() {
	const args = process.argv.slice(2);
	let port = 9222;
	let requestedLocale = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--port" && i + 1 < args.length) {
			port = parseInt(args[i + 1], 10);
			i += 1;
		} else if (args[i] === "--locale" && i + 1 < args.length) {
			requestedLocale = args[i + 1];
			i += 1;
		} else {
			console.error(
				"Usage: wxtu listing chrome [--port <port>] [--locale <locale>]",
			);
			process.exit(1);
		}
	}

	const workspaceRoot = findWorkspaceRoot(process.cwd(), "marketing/output");
	const outputDir = join(workspaceRoot, "marketing/output");
	let locales = readdirSync(outputDir).filter((dir) =>
		existsSync(join(outputDir, dir, "description.xml")),
	);
	if (requestedLocale) {
		locales = locales.filter((locale) => locale === requestedLocale);
		if (locales.length === 0) {
			throw new Error(
				`Locale not found in marketing/output: ${requestedLocale}`,
			);
		}
	}
	locales = sortLocales(locales);
	console.log(`Found ${locales.length} locales: ${locales.join(", ")}`);

	const session = activateSession(workspaceRoot, TARGET_NAME, locales);
	console.log(`Session log: ${session.dir}`);

	console.log(`Connecting to Chrome on port ${port}...`);
	await waitForChromeCustom(port, 10000);
	const tabs = await listTabs(port);
	let tab = tabs.find((t) => t.type === "page" && t.url === CHROME_EDIT_URL);
	if (!tab) {
		tab = tabs.find((t) => t.type === "page");
	}
	if (!tab) {
		tab = await createTab(port, CHROME_EDIT_URL);
	}
	const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
	let hadErrors = false;

	try {
		await captureSessionStep(cdp, "run-start", { locales });
		for (const locale of locales) {
			try {
				await processLocale(cdp, locale, outputDir);
				appendSessionLog("locale-complete", { locale, success: true });
			} catch (error) {
				hadErrors = true;
				appendSessionLog("locale-complete", {
					locale,
					success: false,
					message: error.message,
				});
				console.error(`Error processing locale ${locale}:`, error.message);
			}
		}
		await writeSessionResult({ success: !hadErrors });
	} catch (error) {
		await captureSessionFailure(cdp, error);
		await writeSessionResult({ success: false, error: error.message });
		throw error;
	} finally {
		cdp.close();
		deactivateSession();
	}

	console.log("\nDone!");
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
