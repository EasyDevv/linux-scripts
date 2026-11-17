#!/usr/bin/env bun
// Fill an addons.mozilla.org listing (name, summary, description per locale;
// screenshots once) from .marketing/output over CDP. AMO saves go live at once.
import { join } from "node:path";

import {
	connectTab,
	createSession,
	diffLabel,
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

const USAGE = `Usage: wxtu listing firefox [slug] [options]
  slug                AMO add-on slug (default: listing.json firefox.slug)
  --port <n>          CDP port of the logged-in browser (default 9222)
  --locale <a,b>      Only these marketing locales (default: all in output/)
  --only text|media   Skip the other half
  --dir <path>        Marketing dir holding output/ (default: nearest .marketing)
  --dry-run           Compare only; change nothing`;

const NAME_MAX = 50;
const SUMMARY_MAX = 250;
const SCREENSHOT_MAX = 10;
const FIELDS = { name: "#trans-name", summary: "#trans-summary", description: "#trans-description" };
const DESCRIBE_SUBMIT = "#addon-edit-describe .listing-footer button[type=submit]";
const MEDIA_SUBMIT = ".listing-footer button[type=submit], .listing-footer button";

const editUrl = (slug) => `https://addons.mozilla.org/en-US/developers/addon/${slug}/edit`;
const mediaUrl = (slug) => `https://addons.mozilla.org/en-US/developers/addon/${slug}/edit_media/edit`;

const VISIBLE_FIELD = (container) => `(() => {
	const root = document.querySelector(${JSON.stringify(container)});
	if (!root) throw new Error('Container not found: ${container}');
	return Array.from(root.querySelectorAll('input, textarea')).find((el) => {
		if (el.type === 'hidden' || el.disabled) return false;
		const s = getComputedStyle(el);
		return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
	}) ?? null;
})()`;

const getField = (cdp, container) => pageEval(cdp, `${VISIBLE_FIELD(container)}?.value ?? null`);

async function setField(cdp, container, value) {
	const ok = await pageEval(
		cdp,
		`(() => {
			const el = ${VISIBLE_FIELD(container)};
			if (!el) return false;
			el.focus();
			el.value = ${JSON.stringify(value)};
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			return el.value === ${JSON.stringify(value)};
		})()`,
	);
	if (!ok) throw new Error(`Field ${container} did not take the new value`);
}

async function openDescribe(cdp, slug, locale) {
	await navigate(cdp, editUrl(slug));
	const open = `!!document.querySelector(${JSON.stringify(DESCRIBE_SUBMIT)})`;
	if (!(await pageEval(cdp, open))) {
		await pageEval(cdp, `document.querySelector('#addon-edit-describe > h3 > a.button')?.click()`);
		await waitForPage(cdp, open, 10000, "describe edit form (logged in as an add-on author?)");
	}
	await pageEval(
		cdp,
		`(() => {
			const loc = ${JSON.stringify(locale)};
			document.querySelector('#change-locale')?.click();
			const link = document.querySelector('#locale-popup a[href="#' + loc + '"]');
			if (!link) throw new Error('AMO locale not offered: ' + loc);
			link.click();
			if (location.hash.slice(1).toLowerCase() !== loc) location.hash = '#' + loc;
			return true;
		})()`,
	);
	await waitForPage(
		cdp,
		`location.hash.slice(1).toLowerCase() === ${JSON.stringify(locale)} && !!${VISIBLE_FIELD(FIELDS.name)}`,
		10000,
		`locale switch to ${locale}`,
	);
}

async function submitForm(cdp, buttonSelector) {
	const ok = await pageEval(
		cdp,
		`(() => {
			const b = document.querySelector(${JSON.stringify(buttonSelector)});
			if (!b?.form) return false;
			b.form.requestSubmit(b);
			return true;
		})()`,
	);
	if (!ok) throw new Error(`Submit button not found: ${buttonSelector}`);
	await Bun.sleep(1500);
	await waitForPage(cdp, `document.readyState === "complete"`, 15000, "save");
	const errors = await pageEval(
		cdp,
		`Array.from(document.querySelectorAll('.errorlist li, .notification-box.error')).map((e) => e.innerText.trim()).filter(Boolean)`,
	);
	if (errors?.length) throw new Error(`AMO rejected the form: ${errors.join(" | ")}`);
}

function plannedName(title, locale, config, isDefault) {
	const override = config.firefox?.names?.[locale];
	if (override !== undefined) return { value: override };
	if ([...title].length <= NAME_MAX) return { value: title };
	return {
		value: null,
		note: `title is ${[...title].length} chars (> ${NAME_MAX}); name left as is${isDefault ? "" : " (blank falls back to the default locale)"}. Set listing.json firefox.names.${locale} to change it.`,
	};
}

async function processDescribe(cdp, ctx, locale) {
	const { slug, outputDir, dryRun, config, defaultLocale } = ctx;
	console.log(`\n[${locale}] describe`);
	await openDescribe(cdp, slug, locale);
	const { title, summary, description } = parseDescriptionXml(join(outputDir, locale, "description.xml"));
	if ([...summary].length > SUMMARY_MAX) throw new Error(`summary is ${[...summary].length} chars (> ${SUMMARY_MAX})`);
	const name = plannedName(title, locale, config, locale === defaultLocale);
	const plan = { summary, description };
	if (name.value !== null) plan.name = name.value;
	else console.log(`  name: ${name.note}`);

	const changes = {};
	for (const [key, value] of Object.entries(plan)) {
		const current = await getField(cdp, FIELDS[key]);
		console.log(`  ${key}: ${diffLabel(current, value)}`);
		if (current !== value) changes[key] = value;
	}
	if (dryRun || Object.keys(changes).length === 0) return;

	for (const [key, value] of Object.entries(changes)) await setField(cdp, FIELDS[key], value);
	await submitForm(cdp, DESCRIBE_SUBMIT);
	const verified = await waitFor(async () => {
		await openDescribe(cdp, slug, locale);
		for (const [key, value] of Object.entries(changes)) if ((await getField(cdp, FIELDS[key])) !== value) return false;
		return true;
	}, 30000, 1000);
	if (!verified) throw new Error(`Describe verification failed for ${locale}`);
	console.log("  saved and verified");
}

const countScreenshots = (cdp) =>
	pageEval(
		cdp,
		`Array.from(document.querySelectorAll('#file-list > div.preview')).filter((p) => {
			const id = p.querySelector('input[name$="-id"]')?.value?.trim();
			const hash = p.querySelector('input[name$="-upload_hash"]')?.value?.trim();
			const thumb = p.querySelector('.preview-thumb');
			const bg = thumb ? getComputedStyle(thumb).backgroundImage : 'none';
			return Boolean(id || hash || (bg && bg !== 'none'));
		}).length`,
	);

async function uploadPreview(cdp, filePath) {
	await setInputFile(cdp, "#screenshot_upload", filePath);
	const result = await pageEval(
		cdp,
		`(async () => {
			const input = document.querySelector('#screenshot_upload');
			if (!input?.files?.length) throw new Error('Upload input has no file');
			const csrf = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value ?? '';
			const fd = new FormData();
			fd.append('csrfmiddlewaretoken', csrf);
			fd.append('upload_image', input.files[0]);
			const res = await fetch(input.dataset.uploadUrl, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': csrf } });
			return res.json();
		})()`,
	);
	if (!result?.upload_hash || result.errors?.length) {
		throw new Error(`Preview upload failed for ${filePath}: ${JSON.stringify(result?.errors ?? result)}`);
	}
	return result.upload_hash;
}

// Replace the formset with one fresh row per uploaded hash.
async function fillScreenshotRows(cdp, hashes) {
	await pageEval(
		cdp,
		`(() => {
			const hashes = ${JSON.stringify(hashes)};
			const list = document.querySelector('#file-list');
			const total = document.querySelector('#id_files-TOTAL_FORMS');
			const template = list?.querySelector('div.preview');
			if (!list || !total || !template) throw new Error('Media formset not found');
			const html = template.outerHTML;
			list.innerHTML = '';
			total.value = String(hashes.length);
			hashes.forEach((hash, i) => {
				list.insertAdjacentHTML('beforeend', html.replace(/files-0-/g, 'files-' + i + '-').replace(/value="0"/g, 'value="' + i + '"'));
				const row = list.lastElementChild;
				const q = (s) => row.querySelector(s);
				if (q('input[name$="-id"]')) q('input[name$="-id"]').value = '';
				if (q('input[name$="-DELETE"]')) q('input[name$="-DELETE"]').checked = false;
				if (q('textarea[id$="-caption"]')) q('textarea[id$="-caption"]').value = '';
				if (q('input[name$="-upload_hash"]')) q('input[name$="-upload_hash"]').value = hash;
				if (q('input[name$="-position"]')) q('input[name$="-position"]').value = String(i);
			});
			return true;
		})()`,
	);
}

async function processMedia(cdp, ctx) {
	const { slug, outputDir, dryRun, mediaLocale } = ctx;
	const screenshots = findScreenshots(outputDir, mediaLocale, SCREENSHOT_MAX);
	console.log(`\n[media] screenshots are shared by every AMO locale; using ${mediaLocale}/`);
	await navigate(cdp, mediaUrl(slug));
	const existing = await countScreenshots(cdp);
	console.log(`  screenshots: ${existing} on store → ${screenshots.length} local`);
	if (dryRun) return;
	if (screenshots.length === 0) throw new Error(`No NN-*.png screenshots in ${mediaLocale}/`);

	if (existing > 0) {
		await pageEval(
			cdp,
			`(() => { const boxes = document.querySelectorAll('#file-list > div.preview input[id$="-DELETE"]'); boxes.forEach((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }); return boxes.length; })()`,
		);
		await submitForm(cdp, MEDIA_SUBMIT);
		await navigate(cdp, mediaUrl(slug));
		if ((await countScreenshots(cdp)) !== 0) throw new Error("Old screenshots were not removed");
		console.log(`  removed ${existing} old screenshot(s)`);
	}

	await pageEval(cdp, `document.querySelector('.invisible-upload > a.button')?.click()`);
	await waitForPage(cdp, `!!document.querySelector('#screenshot_upload')`, 10000, "screenshot upload input");
	const hashes = [];
	for (const file of screenshots) {
		console.log(`  uploading ${file.split("/").pop()}`);
		hashes.push(await uploadPreview(cdp, file));
	}
	await fillScreenshotRows(cdp, hashes);
	await submitForm(cdp, MEDIA_SUBMIT);
	const verified = await waitFor(async () => {
		await navigate(cdp, mediaUrl(slug));
		return (await countScreenshots(cdp)) === screenshots.length;
	}, 30000, 1000);
	if (!verified) throw new Error("Media verification failed");
	console.log("  saved and verified");
}

async function main() {
	const opts = parseArgs(
		process.argv.slice(2),
		{ port: "number", locale: "string", only: "string", dir: "string", "dry-run": "boolean" },
		USAGE,
	);
	if (opts.only && !["text", "media"].includes(opts.only)) throw new Error("--only must be text or media");
	const { marketingDir, outputDir, config } = findMarketing(process.cwd(), opts.dir);
	const slug = opts._[0] ?? config.firefox?.slug;
	if (!slug) throw new Error(`No add-on slug. Pass it or set firefox.slug in ${join(marketingDir, "listing.json")}`);
	const defaultLocale = config.defaultLocale ?? "en-us";
	const locales = listLocales(outputDir, opts.locale, defaultLocale);
	const port = opts.port ?? 9222;

	const session = createSession(`firefox-${slug}`, { slug, locales, outputDir, opts });
	console.log(`Marketing: ${outputDir}\nLocales: ${locales.join(", ")}${opts.dryRun ? "\nDRY RUN — nothing is changed" : ""}\nSession log: ${session.dir}`);

	const cdp = await connectTab(port, `/developers/addon/${slug}/`, editUrl(slug));
	const ctx = { slug, outputDir, config, defaultLocale, dryRun: opts.dryRun, mediaLocale: config.firefox?.mediaLocale ?? defaultLocale };
	const failed = [];
	const step = async (label, fn) => {
		try {
			await fn();
		} catch (error) {
			failed.push(label);
			session.log("failed", { label, message: error.message });
			console.error(`  ✗ ${label}: ${error.message}`);
			await session.fail(cdp, error);
		}
	};
	try {
		if (opts.only !== "media") for (const locale of locales) await step(locale, () => processDescribe(cdp, ctx, locale));
		if (opts.only !== "text") await step("media", () => processMedia(cdp, ctx));
	} finally {
		session.result({ success: failed.length === 0, failed });
		cdp.close();
	}
	if (failed.length) {
		console.error(`\nFailed: ${failed.join(", ")}`);
		process.exit(1);
	}
	console.log(opts.dryRun ? "\nDry run done." : "\nDone. AMO changes are live.");
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
