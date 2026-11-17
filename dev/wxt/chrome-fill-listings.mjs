#!/usr/bin/env bun
// Fill a Chrome Web Store listing (description, screenshots, promo tiles) from
// .marketing/output over CDP, then click "Save draft". It never submits for review.
import { join } from "node:path";

import {
	connectTab,
	createSession,
	diffLabel,
	ensureFile,
	findMarketing,
	findScreenshots,
	listLocales,
	navigate,
	pageEval,
	parseArgs,
	parseDescriptionXml,
	setInputFile,
	waitFor,
	waitForPage,
} from "./listing-lib.mjs";

const USAGE = `Usage: wxtu listing chrome [options]
  --url <editUrl>     Developer Dashboard edit URL (default: listing.json chrome.editUrl)
  --port <n>          CDP port of the logged-in browser (default 9222)
  --locale <a,b>      Only these marketing locales (default: all in output/)
  --only text|media   Skip the other half
  --dir <path>        Marketing dir holding output/ (default: nearest .marketing)
  --dry-run           Compare only; change nothing`;

const SCREENSHOT_MAX = 5;
// Product details textarea, Save draft, delete-image labels: Korean and English dashboard UI.
const DETAILS_RE = "제품 세부정보|Product details";
const SAVE_RE = "^(임시저장|Save draft)$";
const DELETE_IMAGE_SEL = '[aria-label^="이미지 삭제"], [aria-label^="Delete image"], [aria-label^="Remove image"]';
const CONFIRM_DELETE_RE = "^(삭제|Delete|Remove)$";
const ASSETS = {
	localizedScreenshots: '[data-image-upload-type="4"]:not([data-is-global])',
	commonScreenshots: '[data-image-upload-type="4"][data-is-global="true"]',
	smallTile: '[data-image-upload-type="1"][data-is-global="true"]',
	marqueeTile: '[data-image-upload-type="3"][data-is-global="true"]',
};

// In-page helpers, injected into each evaluate call.
const PAGE_LIB = `
	const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
	const langSection = () => Array.from(document.querySelectorAll('section')).find((s) =>
		Array.from(s.querySelectorAll('li[role="option"][data-value]')).some((o) => /^[a-z]{2,3}(-[A-Z]{2})?$/.test(o.dataset.value)));
	const langOptions = () => Array.from(langSection()?.querySelectorAll('li[role="option"][data-value]') ?? []);
	const descField = () => {
		const re = new RegExp(${JSON.stringify(DETAILS_RE)});
		const section = Array.from(document.querySelectorAll('section')).find((s) => re.test(s.innerText || '') && s.querySelector('textarea'));
		return Array.from(section?.querySelectorAll('textarea') ?? []).find((t) => !t.disabled && visible(t)) ?? null;
	};
	const assetCount = (sel) => {
		const block = document.querySelector(sel);
		if (!block) throw new Error('Asset block not found: ' + sel);
		return Array.from(block.querySelectorAll(${JSON.stringify(DELETE_IMAGE_SEL)})).filter((b) => {
			const box = b.closest('[jsname="P3Vluc"]') ?? b.parentElement;
			return box && getComputedStyle(box).display !== 'none' && getComputedStyle(box).visibility !== 'hidden';
		}).length;
	};
`;
const inPage = (body) => `(() => { ${PAGE_LIB} ${body} })()`;

async function ensureReady(cdp) {
	await waitForPage(
		cdp,
		inPage(`return langOptions().length > 0 && !!descField();`),
		20000,
		"listing editor (language picker + description). Is the tab logged in on the Store listing page?",
	);
}

async function availableLocales(cdp) {
	return pageEval(cdp, inPage(`return langOptions().map((o) => o.dataset.value);`));
}

function resolveChromeLocale(locale, available, localeMap = {}) {
	const [lang, region] = locale.split("-");
	const candidates = [localeMap[locale], region ? `${lang}-${region.toUpperCase()}` : null, lang].filter(Boolean);
	const hit = candidates.find((c) => available.includes(c));
	if (!hit) {
		throw new Error(
			`Language ${locale} is not on this listing (have: ${available.join(", ")}). Add it in the dashboard language picker first, or map it in listing.json chrome.localeMap.`,
		);
	}
	return hit;
}

async function switchLocale(cdp, chromeLocale) {
	const current = await pageEval(
		cdp,
		inPage(`return langOptions().find((o) => o.getAttribute('aria-selected') === 'true')?.dataset.value ?? null;`),
	);
	if (current === chromeLocale) return;
	await pageEval(
		cdp,
		inPage(`
			const section = langSection();
			section.querySelector('[role="combobox"]')?.click();
			const option = section.querySelector('li[role="option"][data-value="${chromeLocale}"]');
			if (!option) throw new Error('Language option not found: ${chromeLocale}');
			option.click();
			return true;`),
	);
	await waitForPage(
		cdp,
		inPage(`return langOptions().find((o) => o.getAttribute('aria-selected') === 'true')?.dataset.value === '${chromeLocale}' && !!descField();`),
		10000,
		`language switch to ${chromeLocale}`,
	);
}

async function openLocale(cdp, url, chromeLocale) {
	await navigate(cdp, url);
	await ensureReady(cdp);
	await switchLocale(cdp, chromeLocale);
}

const getDescription = (cdp) => pageEval(cdp, inPage(`return descField()?.value ?? null;`));

async function setDescription(cdp, value) {
	const ok = await pageEval(
		cdp,
		inPage(`
			const field = descField();
			if (!field) return false;
			field.focus();
			const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
			setter.call(field, ${JSON.stringify(value)});
			field.dispatchEvent(new Event('input', { bubbles: true }));
			field.dispatchEvent(new Event('change', { bubbles: true }));
			field.blur();
			return field.value === ${JSON.stringify(value)};`),
	);
	if (!ok) throw new Error("Description field did not take the new value");
}

const countAssets = (cdp, kind) => pageEval(cdp, inPage(`return assetCount(${JSON.stringify(ASSETS[kind])});`));

async function clearAssets(cdp, kind) {
	const sel = ASSETS[kind];
	for (let left = await countAssets(cdp, kind); left > 0; left--) {
		await pageEval(
			cdp,
			inPage(`
				const b = document.querySelector(${JSON.stringify(sel)})?.querySelector(${JSON.stringify(DELETE_IMAGE_SEL)});
				if (!b) throw new Error('Delete button not found in ${kind}');
				b.click();
				return true;`),
		);
		const confirm = `const re = new RegExp(${JSON.stringify(CONFIRM_DELETE_RE)}); const bs = Array.from(document.querySelectorAll('[role="dialog"] button')).filter((b) => re.test((b.innerText || '').trim()));`;
		await waitForPage(cdp, inPage(`${confirm} return bs.length > 0;`), 5000, "delete confirmation dialog");
		await pageEval(cdp, inPage(`${confirm} bs[bs.length - 1].click(); return true;`));
		const removed = await waitFor(async () => (await countAssets(cdp, kind)) === left - 1, 10000);
		if (!removed) throw new Error(`Timed out deleting an image from ${kind}`);
	}
}

async function uploadAssets(cdp, kind, files) {
	const sel = ASSETS[kind];
	for (const file of files) {
		const before = await countAssets(cdp, kind);
		// The dashboard wires its file input only after its own button is clicked;
		// the native chooser that click opens is intercepted (see main).
		await pageEval(
			cdp,
			`(() => { document.querySelector(${JSON.stringify(`${sel} input[type=file]`)})?.parentElement?.querySelector('[role="button"]')?.click(); return true; })()`,
		);
		await setInputFile(cdp, `${sel} input[type=file]`, file);
		await pageEval(
			cdp,
			`(() => { const el = document.querySelector(${JSON.stringify(`${sel} input[type=file]`)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
		);
		const up = await waitFor(async () => (await countAssets(cdp, kind)) >= before + 1, 30000);
		if (!up) throw new Error(`Upload did not appear in ${kind}: ${file}`);
	}
}

async function replaceAssets(cdp, kind, files) {
	await clearAssets(cdp, kind);
	await uploadAssets(cdp, kind, files);
}

async function saveDraft(cdp) {
	await pageEval(
		cdp,
		`(() => {
			const re = new RegExp(${JSON.stringify(SAVE_RE)});
			const b = Array.from(document.querySelectorAll('button')).find((el) => re.test((el.innerText || '').trim()));
			if (!b) throw new Error('Save draft button not found');
			b.click();
			return true;
		})()`,
	);
	await Bun.sleep(2500);
}

async function processLocale(cdp, ctx, locale) {
	const { url, outputDir, defaultLocale, only, dryRun, log } = ctx;
	const chromeLocale = resolveChromeLocale(locale, ctx.available, ctx.localeMap);
	const isDefault = locale === defaultLocale;
	console.log(`\n[${locale} → ${chromeLocale}]`);
	await openLocale(cdp, url, chromeLocale);

	const { description } = parseDescriptionXml(join(outputDir, locale, "description.xml"));
	const screenshots = findScreenshots(outputDir, locale, SCREENSHOT_MAX);
	const shotKind = isDefault ? "commonScreenshots" : "localizedScreenshots";
	const tiles = isDefault
		? { smallTile: ensureFile(join(outputDir, "tile-small.png")), marqueeTile: ensureFile(join(outputDir, "tile-marquee.png")) }
		: {};

	const current = await getDescription(cdp);
	const textChanged = only !== "media" && current !== description;
	console.log(`  description: ${only === "media" ? "skipped" : diffLabel(current, description)}`);
	if (only !== "text") {
		console.log(`  ${shotKind}: ${await countAssets(cdp, shotKind)} on store → ${screenshots.length} local`);
		for (const kind of Object.keys(tiles)) console.log(`  ${kind}: ${await countAssets(cdp, kind)} on store → 1 local`);
	}
	if (dryRun) return;
	if (only !== "text" && screenshots.length === 0) throw new Error(`No NN-*.png screenshots for ${locale}`);

	if (textChanged) await setDescription(cdp, description);
	if (only !== "text") {
		console.log(`  replacing ${screenshots.length} screenshot(s)...`);
		await replaceAssets(cdp, shotKind, screenshots);
		for (const [kind, file] of Object.entries(tiles)) {
			console.log(`  replacing ${kind}...`);
			await replaceAssets(cdp, kind, [file]);
		}
	}
	if (!textChanged && only === "text") return;

	console.log("  saving draft...");
	await saveDraft(cdp);
	log("saved", { locale });

	const verified = await waitFor(async () => {
		await openLocale(cdp, url, chromeLocale);
		if (only !== "media" && (await getDescription(cdp)) !== description) return false;
		if (only !== "text") {
			if ((await countAssets(cdp, shotKind)) !== screenshots.length) return false;
			for (const kind of Object.keys(tiles)) if ((await countAssets(cdp, kind)) !== 1) return false;
		}
		return true;
	}, 45000, 1000);
	if (!verified) throw new Error(`Verification after reload failed for ${locale}`);
	console.log("  saved and verified");
}

async function main() {
	const opts = parseArgs(
		process.argv.slice(2),
		{ url: "string", port: "number", locale: "string", only: "string", dir: "string", "dry-run": "boolean" },
		USAGE,
	);
	if (opts.only && !["text", "media"].includes(opts.only)) throw new Error("--only must be text or media");
	const { marketingDir, outputDir, config } = findMarketing(process.cwd(), opts.dir);
	const url = opts.url ?? config.chrome?.editUrl;
	if (!url) throw new Error(`No edit URL. Pass --url or set chrome.editUrl in ${join(marketingDir, "listing.json")}`);
	const defaultLocale = config.defaultLocale ?? "en-us";
	const locales = listLocales(outputDir, opts.locale, defaultLocale);
	const port = opts.port ?? 9222;
	const itemId = url.match(/\/([a-p]{32})\b/)?.[1] ?? "";

	const session = createSession(`chrome-${itemId || "listing"}`, { url, locales, outputDir, opts });
	console.log(`Marketing: ${outputDir}\nLocales: ${locales.join(", ")}${opts.dryRun ? "\nDRY RUN — nothing is changed" : ""}\nSession log: ${session.dir}`);

	const cdp = await connectTab(port, itemId ? `${itemId}/edit` : "webstore/devconsole", url);
	const failed = [];
	try {
		await cdp.send("Page.enable");
		await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {});
		await navigate(cdp, url);
		await ensureReady(cdp);
		const available = await availableLocales(cdp);
		const ctx = { url, outputDir, defaultLocale, available, localeMap: config.chrome?.localeMap, only: opts.only, dryRun: opts.dryRun, log: session.log };
		for (const locale of locales) {
			try {
				await processLocale(cdp, ctx, locale);
			} catch (error) {
				failed.push(locale);
				session.log("locale-failed", { locale, message: error.message });
				console.error(`  ✗ ${locale}: ${error.message}`);
				await session.fail(cdp, error);
			}
		}
	} finally {
		session.result({ success: failed.length === 0, failed });
		cdp.close();
	}
	if (failed.length) {
		console.error(`\nFailed: ${failed.join(", ")}`);
		process.exit(1);
	}
	console.log(opts.dryRun ? "\nDry run done." : "\nDone. Draft saved — review it and click “Submit for review” in the dashboard.");
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
