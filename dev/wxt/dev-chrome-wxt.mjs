#!/usr/bin/env node
import { parseCommonDevArgs, runWxtDevServer } from "./dev-wxt-utils.mjs";

async function main() {
	const inlineConfig = parseCommonDevArgs(process.argv.slice(2), "chrome");
	await runWxtDevServer({
		...inlineConfig,
		browser: "chrome",
		webExt: { disabled: true },
	});
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
