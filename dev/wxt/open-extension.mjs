#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { WXTU_CONFIG } from "./config.mjs";

const DEFAULT_CDP_PORT = WXTU_CONFIG.chrome.defaultCdpPort;
const DEFAULT_PAGE = WXTU_CONFIG.chrome.defaultOpenPage;

function usage() {
	console.error("Usage: wxtu open <NAME_PATTERN> [CDP_PORT] [PAGE]");
	console.error("");
	console.error(
		"  NAME_PATTERN  Substring matched against extension names (required)",
	);
	console.error(
		`  CDP_PORT      CDP debug port (default: $WXT_CHROME_DEBUG_PORT or ${DEFAULT_CDP_PORT})`,
	);
	console.error(
		`  PAGE          Extension page to open (default: ${DEFAULT_PAGE})`,
	);
	console.error("");
	console.error("Examples:");
	console.error('  wxtu open "Scroll Detox"');
	console.error(`  wxtu open "Scroll Detox" ${DEFAULT_CDP_PORT} options.html`);
	console.error('  EXTENSION_NAME="My Ext" wxtu open');
}

async function main() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}

	let namePattern = process.env.EXTENSION_NAME || args[0];
	const portArg = args[1];
	const pageArg = args[2] || DEFAULT_PAGE;
	const port =
		portArg && !isNaN(parseInt(portArg, 10))
			? parseInt(portArg, 10)
			: parseInt(
					process.env.WXT_CHROME_DEBUG_PORT || String(DEFAULT_CDP_PORT),
					10,
				);

	if (!namePattern) {
		console.error("Error: NAME_PATTERN is required");
		usage();
		process.exit(1);
	}

	const ctrlArgs = [
		"open-extension",
		namePattern,
		"--port",
		String(port),
		"--page",
		pageArg,
	];

	try {
		execFileSync("control-chrome", ctrlArgs, {
			encoding: "utf-8",
			stdio: "inherit",
			timeout: 30000,
		});
	} catch (error) {
		if (error.status) process.exit(error.status);
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

main();
