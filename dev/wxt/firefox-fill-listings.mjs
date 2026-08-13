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
} from "/home/easydev/.local/share/scripts/dev/control-chrome/cdp.ts";
import { WXTU_CONFIG } from "./config.mjs";

const FIREFOX_NAME_MAX_LENGTH = 50;
const SESSION_PLATFORM = "wxtu-firefox-listing";
const SESSION_BASE_DIR = WXTU_CONFIG.paths.sessionsDir;
const SESSION_DIR_SUFFIX = "firefox-detox";

let activeSession = null;

// ── Workspace discovery ───────────────────────────────────────────────────

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

// ── description.xml parsing ───────────────────────────────────────────────

function parseDescriptionXml(xmlPath) {
	const xml = readFileSync(xmlPath, "utf8");
	const title = xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || "";
	const summary =
		xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() || "";
	const description =
		xml.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.trim() || "";
	return { title, summary, description };
}

// ── Screenshot discovery ──────────────────────────────────────────────────

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

// ── Locale helpers ────────────────────────────────────────────────────────

function toAmoLocale(locale) {
	const parts = locale.split("-");
	if (parts.length === 2) {
		return `${parts[0]}-${parts[1].toUpperCase()}`;
	}
	return locale;
}

function getStableEditUrl(addonSlug) {
	return `https://addons.mozilla.org/en-US/developers/addon/${addonSlug}/edit`;
}

// ── Session logging ─────────────────────────────────────────────────────────

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

function activateSession(_workspaceRoot, addonSlug, locales) {
	const now = new Date();
	mkdirSync(SESSION_BASE_DIR, { recursive: true });
	const sessionId = `${formatSessionTimestamp(now)}-${sanitizeSessionSegment(addonSlug)}-${SESSION_DIR_SUFFIX}`;
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
		addonSlug,
		locales,
		cwd: process.cwd(),
		timestamp: now.toISOString(),
	});
	appendSessionLog("session-start", { addonSlug, locales });
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

// ── CDP helpers ───────────────────────────────────────────────────────────

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

async function pageClick(cdp, selector) {
	const t0 = Date.now();
	const coords = await pageEval(
		cdp,
		`
		(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})()
	`,
	);
	if (!coords) throw new Error(`Element not found: ${selector}`);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: coords.x,
		y: coords.y,
		button: "none",
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: coords.x,
		y: coords.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: coords.x,
		y: coords.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	appendSessionLog("click", { selector, durationMs: Date.now() - t0 });
}

async function fillField(cdp, selector, value) {
	const result = await pageEval(
		cdp,
		`
		(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) throw new Error('Field not found: ' + ${JSON.stringify(selector)});
		const tag = el.tagName.toLowerCase();
		el.focus();
		el.value = '';
		el.value = ${JSON.stringify(value)};
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
		return el.value;
		})()
	`,
	);
	if (result !== value) {
		// Fallback: native CDP Input.insertText
		await cdp.send("Input.insertText", { text: value });
	}
}

async function getFieldValue(cdp, selector) {
	return await pageEval(
		cdp,
		`
		(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		return el ? el.value : '';
		})()
	`,
	);
}

async function fillVisibleFieldInContainer(cdp, containerSelector, value) {
	const t0 = Date.now();
	await pageEval(
		cdp,
		`
		(() => {
		const root = document.querySelector(${JSON.stringify(containerSelector)});
		if (!root) throw new Error('Container not found: ' + ${JSON.stringify(containerSelector)});
		const fields = Array.from(root.querySelectorAll('input, textarea')).filter((el) => {
			if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
			if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
			if (el.disabled) return false;
			const style = getComputedStyle(el);
			return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
		});
		const el = fields[0];
		if (!el) throw new Error('Visible field not found in: ' + ${JSON.stringify(containerSelector)});
		el.focus();
		el.value = '';
		el.value = ${JSON.stringify(value)};
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
		return el.value;
		})()
	`,
	);
	appendSessionLog("fill", {
		containerSelector,
		valueLength: value.length,
		durationMs: Date.now() - t0,
	});
}

async function getVisibleFieldValueInContainer(cdp, containerSelector) {
	return await pageEval(
		cdp,
		`
		(() => {
		const root = document.querySelector(${JSON.stringify(containerSelector)});
		if (!root) throw new Error('Container not found: ' + ${JSON.stringify(containerSelector)});
		const fields = Array.from(root.querySelectorAll('input, textarea')).filter((el) => {
			if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
			if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
			if (el.disabled) return false;
			const style = getComputedStyle(el);
			return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
		});
		const el = fields[0];
		if (!el) throw new Error('Visible field not found in: ' + ${JSON.stringify(containerSelector)});
		return el.value ?? '';
		})()
	`,
	);
}

async function pageUploadFile(cdp, selector, filePath) {
	await pageEval(
		cdp,
		`
		(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (el) {
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
}

async function uploadPreviewFile(cdp, selector, filePath) {
	const t0 = Date.now();
	await pageEval(
		cdp,
		`
		(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (el) {
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

	const result = await pageEval(
		cdp,
		`
		(async () => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!(input instanceof HTMLInputElement) || !input.files?.length) {
			throw new Error('Upload input has no files');
		}
		const csrf = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value ?? '';
		const fd = new FormData();
		fd.append('csrfmiddlewaretoken', csrf);
		fd.append('upload_image', input.files[0]);
		const response = await fetch(input.dataset.uploadUrl, {
			method: 'POST',
			body: fd,
			credentials: 'same-origin',
			headers: {
				'X-Requested-With': 'XMLHttpRequest',
				'X-CSRFToken': csrf,
			},
		});
		const payload = await response.json();
		return payload;
		})()
	`,
	);
	if (!result || result.errors?.length || !result.upload_hash) {
		throw new Error(
			`Preview upload failed for ${filePath}: ${JSON.stringify(result?.errors ?? result)}`,
		);
	}
	appendSessionLog("upload-preview", {
		selector,
		filePath,
		durationMs: Date.now() - t0,
	});
	return result.upload_hash;
}

// ── Firefox-specific helpers ─────────────────────────────────────────────

function getDescribeFieldSelectors() {
	return {
		name: "#trans-name",
		summary: "#trans-summary",
		description: "#trans-description",
	};
}

async function getCurrentLocale(cdp) {
	return await pageEval(
		cdp,
		`(() => {
		const hashLocale = window.location.hash.replace(/^#/, '').trim().toLowerCase();
		if (hashLocale) return hashLocale;
		return document.querySelector('#l10n-menu')?.getAttribute('data-default')?.toLowerCase() ?? null;
	})()`,
	);
}

async function getCurrentUrl(cdp) {
	return await pageEval(cdp, `(() => location.href)()`);
}

async function readMediaEditUrlFromCurrentPage(cdp) {
	const relativeUrl = await pageEval(
		cdp,
		`(() => document.querySelector('a[data-editurl*="edit_media/edit"]')?.getAttribute('data-editurl') ?? null)()`,
	);
	if (!relativeUrl) {
		return null;
	}
	return new URL(relativeUrl, "https://addons.mozilla.org/").toString();
}

async function switchLocale(cdp, locale, options = {}) {
	const targetLocale = locale.toLowerCase();
	const waitForDescribeFields = options.waitForDescribeFields ?? false;
	const currentLocale = await getCurrentLocale(cdp);
	if (currentLocale === targetLocale) {
		return;
	}

	await pageEval(
		cdp,
		`
		(() => {
		const locale = ${JSON.stringify(targetLocale)};
		const trigger = document.querySelector('#change-locale');
		const popup = document.querySelector('#locale-popup');
		if (trigger instanceof HTMLElement) {
			trigger.click();
		}
		if (!(popup instanceof HTMLElement)) {
			throw new Error('Locale popup not found');
		}
		popup.classList.remove('hidden');
		popup.style.display = 'block';
		const link = popup.querySelector('a[href="#' + locale + '"]');
		if (!(link instanceof HTMLAnchorElement)) {
			throw new Error('Locale link not found: ' + locale);
		}
		link.click();
		if (window.location.hash.replace(/^#/, '').trim().toLowerCase() !== locale) {
			window.location.hash = '#' + locale;
		}
		return true;
		})()
	`,
	);

	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const applied = await pageEval(
			cdp,
			`
			(() => {
			const locale = ${JSON.stringify(targetLocale)};
			const current = window.location.hash.replace(/^#/, '').trim().toLowerCase() ||
				document.querySelector('#l10n-menu')?.getAttribute('data-default')?.toLowerCase() || '';
			const hasVisibleNameField = (() => {
				const root = document.querySelector('#trans-name');
				if (!root) return false;
				return Array.from(root.querySelectorAll('input')).some((el) => {
					if (!(el instanceof HTMLInputElement) || el.type === 'hidden' || el.disabled) return false;
					const style = getComputedStyle(el);
					return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
				});
			})();
			return current === locale && (${waitForDescribeFields ? "hasVisibleNameField" : "true"});
			})()
		`,
		);
		if (applied) {
			return;
		}
		await Bun.sleep(250);
	}

	throw new Error(`Timed out switching locale to ${locale}`);
}

async function ensureDescribeOpen(cdp) {
	const isOpen = await pageEval(
		cdp,
		`(() => !!document.querySelector('#addon-edit-describe .listing-footer button[type="submit"]'))()`,
	);
	if (isOpen) return;
	await pageClick(cdp, "#addon-edit-describe > h3 > a.button");
	await waitForPageCondition(
		cdp,
		`(() => !!document.querySelector('#addon-edit-describe .listing-footer button[type="submit"]'))()`,
	);
}

async function submitButtonForm(cdp, buttonSelector, timeout = 5000) {
	const t0 = Date.now();
	const waitForSubmit = waitForLoad(cdp, timeout);
	const submitted = await pageEval(
		cdp,
		`
		(() => {
		const button = document.querySelector(${JSON.stringify(buttonSelector)});
		if (!(button instanceof HTMLButtonElement)) return false;
		const form = button.form;
		if (!form) return false;
		form.requestSubmit(button);
		return true;
		})()
	`,
	);
	if (!submitted) {
		throw new Error(
			`Submit button not found or has no form: ${buttonSelector}`,
		);
	}
	await waitForSubmit;
	await waitForPageCondition(
		cdp,
		`(() => document.readyState === "complete")()`,
		timeout,
	);
	appendSessionLog("submit", {
		buttonSelector,
		durationMs: Date.now() - t0,
	});
}

async function markAllScreenshotsForDelete(cdp) {
	const count = await pageEval(
		cdp,
		`
		(() => {
		const checkboxes = document.querySelectorAll('#file-list > div.preview input[id$="-DELETE"]');
		for (const el of checkboxes) {
			el.checked = true;
			el.dispatchEvent(new Event('change', { bubbles: true }));
		}
		return checkboxes.length;
		})()
	`,
	);
	appendSessionLog("mark-screenshots-delete", { count });
	return count;
}

async function countScreenshots(cdp) {
	return await pageEval(
		cdp,
		`(() => Array.from(document.querySelectorAll('#file-list > div.preview')).filter((preview) => {
			const idValue = preview.querySelector('input[name$="-id"]')?.value?.trim() ?? '';
			const uploadHash = preview.querySelector('input[name$="-upload_hash"]')?.value?.trim() ?? '';
			const thumb = preview.querySelector('.preview-thumb');
			const bg = thumb ? getComputedStyle(thumb).backgroundImage : 'none';
			return Boolean(idValue || uploadHash || (bg && bg !== 'none'));
		}).length)()`,
	);
}

async function clickAddScreenshotButton(cdp) {
	await pageClick(cdp, ".invisible-upload > a.button");
	await waitForPageCondition(
		cdp,
		`(() => !!document.querySelector('#screenshot_upload'))()`,
	);
	appendSessionLog("add-screenshot-row");
}

async function populateScreenshotRows(cdp, uploadHashes) {
	await pageEval(
		cdp,
		`
		(() => {
		const hashes = ${JSON.stringify(uploadHashes)};
		const fileList = document.querySelector('#file-list');
		const totalForms = document.querySelector('#id_files-TOTAL_FORMS');
		if (!(fileList instanceof HTMLElement) || !(totalForms instanceof HTMLInputElement)) {
			throw new Error('Media formset elements not found');
		}
		const template = fileList.querySelector('div.preview');
		if (!(template instanceof HTMLElement)) {
			throw new Error('Media preview template row not found');
		}
		const templateHtml = template.outerHTML;
		fileList.innerHTML = '';
		totalForms.value = String(hashes.length);
		for (let index = 0; index < hashes.length; index += 1) {
			const html = templateHtml
				.replace(/files-0-/g, 'files-' + index + '-')
				.replace(/id_files-0-/g, 'id_files-' + index + '-')
				.replace(/value="0"/g, 'value="' + index + '"');
			fileList.insertAdjacentHTML('beforeend', html);
			const preview = fileList.lastElementChild;
			if (!(preview instanceof HTMLElement)) continue;
			const idInput = preview.querySelector('input[name="files-' + index + '-id"]');
			const deleteInput = preview.querySelector('input[name="files-' + index + '-DELETE"]');
			const captionInit = preview.querySelector('#id_files-' + index + '-caption');
			const uploadHashInput = preview.querySelector('input[name="files-' + index + '-upload_hash"]');
			const positionInput = preview.querySelector('input[name="files-' + index + '-position"]');
			if (idInput instanceof HTMLInputElement) idInput.value = '';
			if (deleteInput instanceof HTMLInputElement) deleteInput.checked = false;
			if (captionInit instanceof HTMLTextAreaElement) captionInit.value = '';
			if (uploadHashInput instanceof HTMLInputElement) uploadHashInput.value = hashes[index];
			if (positionInput instanceof HTMLInputElement) positionInput.value = String(index);
		}
		return true;
		})()
	`,
	);
	appendSessionLog("populate-screenshot-rows", { count: uploadHashes.length });
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
	appendSessionLog("navigate", { url, durationMs: Date.now() - t0 });
}

async function verifyDescribeValues(cdp, addonSlug, locale, expected) {
	const editUrl = getStableEditUrl(addonSlug);
	await navigateAndWait(cdp, editUrl);
	await ensureDescribeOpen(cdp);
	await switchLocale(cdp, locale, { waitForDescribeFields: true });
	const selectors = getDescribeFieldSelectors();
	const actual = {
		name: await getVisibleFieldValueInContainer(cdp, selectors.name),
		summary: await getVisibleFieldValueInContainer(cdp, selectors.summary),
		description: await getVisibleFieldValueInContainer(
			cdp,
			selectors.description,
		),
	};
	appendSessionLog("verify-describe", {
		locale,
		matchedTitle: actual.name === expected.title,
	});
	if (expected.title === "") {
		return (
			actual.summary === expected.summary &&
			actual.description === expected.description
		);
	}
	return (
		actual.name === expected.title &&
		actual.summary === expected.summary &&
		actual.description === expected.description
	);
}

async function verifyMediaValues(cdp, mediaUrl, locale, expectedCount) {
	await navigateAndWait(cdp, mediaUrl);
	const count = await countScreenshots(cdp);
	appendSessionLog("verify-media", { locale, count, expectedCount });
	return count === expectedCount;
}

async function resolveMediaEditUrl(cdp, addonSlug, locale) {
	const currentUrl = await getCurrentUrl(cdp).catch(() => "");
	if (
		currentUrl.includes("/developers/addon/") &&
		currentUrl.includes("/edit")
	) {
		await switchLocale(cdp, locale);
		const currentPageUrl = await readMediaEditUrlFromCurrentPage(cdp);
		if (currentPageUrl) {
			return currentPageUrl;
		}
	}

	const editUrl = getStableEditUrl(addonSlug);
	await navigateAndWait(cdp, editUrl);
	await switchLocale(cdp, locale);
	const mediaUrl = await readMediaEditUrlFromCurrentPage(cdp);
	if (!mediaUrl) {
		throw new Error(
			`Media edit URL not found after switching locale to ${locale}`,
		);
	}
	return mediaUrl;
}

// ── Main workflow ─────────────────────────────────────────────────────────

async function processLocaleDescribe(cdp, addonSlug, locale, outputDir) {
	const editUrl = getStableEditUrl(addonSlug);

	console.log(`\n[${locale}] Editing describe...`);
	appendSessionLog("locale-describe-start", { locale });
	await navigateAndWait(cdp, editUrl);
	await ensureDescribeOpen(cdp);
	await switchLocale(cdp, locale, { waitForDescribeFields: true });
	await captureSessionStep(cdp, `describe-${locale}-opened`, { locale });

	// Parse XML
	const xmlPath = join(outputDir, locale, "description.xml");
	const { title, summary, description } = parseDescriptionXml(xmlPath);
	const titleForSave = title.length > FIREFOX_NAME_MAX_LENGTH ? "" : title;
	const titleBlanked = titleForSave === "" && title.length > 0;
	if (titleBlanked) {
		console.log(
			`  Title exceeds ${FIREFOX_NAME_MAX_LENGTH} chars (${title.length}); saving blank title`,
		);
	}
	const selectors = getDescribeFieldSelectors();
	let changed = false;

	// Name field
	try {
		const currentName = await getVisibleFieldValueInContainer(
			cdp,
			selectors.name,
		);
		if (currentName !== titleForSave) {
			console.log(`  Name differs, updating...`);
			await fillVisibleFieldInContainer(cdp, selectors.name, titleForSave);
			changed = true;
		} else {
			console.log(`  Name unchanged, skipping`);
		}
	} catch (e) {
		console.log(`  Name check failed: ${e.message}`);
	}

	// Summary field
	try {
		const currentSummary = await getVisibleFieldValueInContainer(
			cdp,
			selectors.summary,
		);
		if (currentSummary !== summary) {
			console.log(`  Summary differs, updating...`);
			await fillVisibleFieldInContainer(cdp, selectors.summary, summary);
			changed = true;
		} else {
			console.log(`  Summary unchanged, skipping`);
		}
	} catch (e) {
		console.log(`  Summary check failed: ${e.message}`);
	}

	// Description field
	try {
		const currentDescription = await getVisibleFieldValueInContainer(
			cdp,
			selectors.description,
		);
		if (currentDescription !== description) {
			console.log(`  Description differs, updating...`);
			await fillVisibleFieldInContainer(
				cdp,
				selectors.description,
				description,
			);
			changed = true;
		} else {
			console.log(`  Description unchanged, skipping`);
		}
	} catch (e) {
		console.log(`  Description check failed: ${e.message}`);
	}

	if (!changed) {
		console.log(`  No describe changes to save`);
		await captureSessionStep(cdp, `describe-${locale}-unchanged`, { locale });
		return { titleBlanked };
	}

	console.log(`  Saving describe changes...`);
	await submitButtonForm(
		cdp,
		"#addon-edit-describe .listing-footer button[type=submit]",
		7000,
	);
	const verified = await verifyDescribeValues(cdp, addonSlug, locale, {
		title: titleForSave,
		summary,
		description,
	});
	if (!verified) {
		throw new Error(`Describe save verification failed for ${locale}`);
	}
	console.log(`  Describe changes saved and verified`);
	await captureSessionStep(cdp, `describe-${locale}-saved`, { locale });
	return { titleBlanked };
}

async function processLocaleMedia(cdp, addonSlug, locale, outputDir) {
	const mediaUrl = await resolveMediaEditUrl(cdp, addonSlug, locale);

	console.log(`\n[${locale}] Editing media...`);
	appendSessionLog("locale-media-start", { locale, mediaUrl });

	// Navigate to media edit page
	await navigateAndWait(cdp, mediaUrl);
	await captureSessionStep(cdp, `media-${locale}-opened`, { locale });

	// Stage 1: remove existing screenshots, save, and verify.
	const existingCount = await countScreenshots(cdp);
	if (existingCount > 0) {
		const removed = await markAllScreenshotsForDelete(cdp);
		console.log(`  Marked ${removed} existing screenshot(s) for deletion`);
		console.log(`  Saving screenshot deletions...`);
		await submitButtonForm(
			cdp,
			".listing-footer button[type=submit], .listing-footer button",
			7000,
		);
		const deleteVerified = await verifyMediaValues(cdp, mediaUrl, locale, 0);
		if (!deleteVerified) {
			throw new Error(`Media delete verification failed for ${locale}`);
		}
		console.log(`  Existing screenshots removed and verified`);
		await captureSessionStep(cdp, `media-${locale}-cleared`, {
			locale,
			removed,
		});
	} else {
		console.log(`  No existing screenshots to remove`);
	}

	// Stage 2: upload new screenshots, save, and verify.
	const screenshots = findScreenshots(outputDir, locale);
	console.log(`  Uploading ${screenshots.length} screenshot(s)`);
	await clickAddScreenshotButton(cdp);
	const uploadHashes = [];
	for (const screenshot of screenshots) {
		console.log(`  Preparing ${screenshot}...`);
		uploadHashes.push(
			await uploadPreviewFile(cdp, "#screenshot_upload", screenshot),
		);
	}
	await populateScreenshotRows(cdp, uploadHashes);

	console.log(`  Saving uploaded screenshots...`);
	await submitButtonForm(
		cdp,
		".listing-footer button[type=submit], .listing-footer button",
		7000,
	);
	const verified = await verifyMediaValues(
		cdp,
		mediaUrl,
		locale,
		screenshots.length,
	);
	if (!verified) {
		throw new Error(`Media save verification failed for ${locale}`);
	}
	console.log(`  Media changes saved and verified`);
	await captureSessionStep(cdp, `media-${locale}-saved`, {
		locale,
		screenshotCount: screenshots.length,
	});
}

async function main() {
	const args = process.argv.slice(2);
	const addonSlug = args[0];
	if (!addonSlug) {
		console.error(
			"Usage: wxtu listing firefox <addon-slug> [--port <port>] [--locale <locale>]",
		);
		process.exit(1);
	}

	let port = 9222;
	let requestedLocale = null;
	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--port" && i + 1 < args.length) {
			port = parseInt(args[i + 1], 10);
			i++;
		} else if (args[i] === "--locale" && i + 1 < args.length) {
			requestedLocale = args[i + 1];
			i++;
		}
	}

	// Find workspace root
	const workspaceRoot = findWorkspaceRoot(process.cwd(), "marketing/output");
	const outputDir = join(workspaceRoot, "marketing/output");

	// Scan locales
	let locales = readdirSync(outputDir).filter((dir) => {
		return existsSync(join(outputDir, dir, "description.xml"));
	});
	if (requestedLocale) {
		locales = locales.filter((locale) => locale === requestedLocale);
		if (locales.length === 0) {
			throw new Error(
				`Locale not found in marketing/output: ${requestedLocale}`,
			);
		}
	}

	console.log(`Found ${locales.length} locales: ${locales.join(", ")}`);
	const session = activateSession(workspaceRoot, addonSlug, locales);
	console.log(`Session log: ${session.dir}`);

	// Connect to CDP
	console.log(`Connecting to Chrome on port ${port}...`);
	await waitForChromeCustom(port, 10000);
	const tabs = await listTabs(port);
	let tab = tabs.find((t) => t.type === "page");
	if (!tab) {
		tab = await createTab(port, "about:blank");
	}
	const cdp = await CDP.connect(tab.webSocketDebuggerUrl);
	const blankedTitleLocales = [];
	let hadErrors = false;

	try {
		await captureSessionStep(cdp, "run-start", { addonSlug, locales });
		for (const locale of locales) {
			try {
				const describeResult = await processLocaleDescribe(
					cdp,
					addonSlug,
					locale,
					outputDir,
				);
				if (describeResult?.titleBlanked) {
					blankedTitleLocales.push(locale);
				}
				await processLocaleMedia(cdp, addonSlug, locale, outputDir);
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
		await writeSessionResult({
			success: !hadErrors,
			blankedTitleLocales,
		});
	} catch (error) {
		await captureSessionFailure(cdp, error);
		await writeSessionResult({
			success: false,
			error: error.message,
			blankedTitleLocales,
		});
		throw error;
	} finally {
		cdp.close();
		deactivateSession();
	}
	if (blankedTitleLocales.length > 0) {
		console.log(
			`Title cleared due to ${FIREFOX_NAME_MAX_LENGTH}-char limit: ${blankedTitleLocales.join(", ")}`,
		);
	}

	console.log("\nDone!");
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
