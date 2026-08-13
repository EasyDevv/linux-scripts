#!/usr/bin/env node
import { parseCommonDevArgs, runWxtDevServer } from "./dev-wxt-utils.mjs";

async function main() {
	const inlineConfig = parseCommonDevArgs(process.argv.slice(2), "firefox");
	const startUrl = process.env.WXT_START_URL || process.env.URL || "";

	await runWxtDevServer({
		...inlineConfig,
		browser: "firefox",
		webExt: startUrl ? { startUrls: [startUrl] } : undefined,
	});
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
