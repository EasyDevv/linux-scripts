#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
	dev: {
		usage:
			"wxtu dev chrome|firefox [wxt flags] [--sample react|svelte] [-- <control-chrome flags>]",
		sub: {
			chrome: { script: "dev-chrome.mjs", passArgs: true },
			firefox: { script: "dev-firefox.mjs", passArgs: true },
		},
	},
	sample: {
		usage: "wxtu sample react|svelte",
		script: "sample-server.mjs",
		passArgs: true,
	},
	build: { script: "run-wxt-targets.mjs", args: ["build"] },
	zip: {
		usage: "wxtu zip [chrome|firefox]",
		sub: {
			chrome: { script: "zip-version.mjs", args: ["--browser", "chrome"] },
			firefox: { script: "zip-version.mjs", args: ["--browser", "firefox"] },
		},
		default: { script: "zip-version.mjs", args: [] },
	},
	version: { script: "zip-version.mjs", passArgs: true },
	submit: { script: "wxt-submit.mjs", passArgs: true },
	minimize: {
		usage: "wxtu minimize cdp|kwin",
		sub: {
			cdp: { script: "cdp-minimize.mjs", passArgs: true },
			kwin: { script: "kwin-minimize.mjs", passArgs: true },
		},
	},
	listing: {
		usage: "wxtu listing chrome|firefox",
		sub: {
			chrome: { script: "chrome-fill-listings.mjs", passArgs: true },
			firefox: {
				script: "firefox-fill-listings.mjs",
				passArgs: true,
				runtime: "bun",
			},
		},
	},
	android: {
		usage: "wxtu android emulator|stop|firefox",
		sub: {
			emulator: {
				script: "android-emu.mjs",
				passArgs: true,
			},
			stop: {
				script: "android-stop.mjs",
				passArgs: true,
			},
			firefox: {
				script: "android-firefox.mjs",
				passArgs: true,
			},
		},
	},
	open: {
		usage: "wxtu open <NAME_PATTERN> [CDP_PORT] [PAGE]",
		script: "open-extension.mjs",
		passArgs: true,
	},
};

function printHelp() {
	const lines = [
		"Usage: wxtu <command> [args]",
		"",
		"Commands:",
		"  dev chrome|firefox      Start WXT dev server (chrome defaults detached)",
		"    Unknown chrome flags are forwarded to control-chrome open",
		"    Use -- to force-pass overlapping flags like --port to control-chrome",
		"    --sample react|svelte Start a sample app as the initial page",
		"  sample react|svelte     Start a standalone sample dev server",
		"  build                   Build chrome + firefox in parallel",
		"  zip [chrome|firefox]    Version prompt then zip target(s)",
		"  version [action]        Bump version, zip, and prompt to submit",
		"  submit [--store]        Submit to Chrome/Firefox/Edge stores",
		"  minimize cdp|kwin       Minimize browser window via CDP or KWin",
		"  listing chrome|firefox   Auto-fill store listings",
		"  android emulator        Start Android emulator with stable defaults",
		"  android stop [DEVICE]   Stop connected Android emulator(s)",
		"  android firefox install Build and reinstall on Firefox Android",
		"  android firefox manager Open Firefox Android add-ons/settings surface",
		"  open <NAME> [PORT] [PAGE]  Open extension page by name pattern",
		"",
		"  help                    Show this message",
	];
	console.log(lines.join("\n"));
}

function runScript(scriptPath, scriptArgs, runtime = "node") {
	const command =
		runtime === "bash" ? "bash" : runtime === "bun" ? "bun" : process.execPath;
	const args = [scriptPath, ...scriptArgs];

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
			stdio: "inherit",
			env: process.env,
		});
		child.on("error", reject);
		child.on("close", (code, signal) => {
			if (signal) {
				process.kill(process.pid, signal);
				return;
			}
			resolve(code ?? 0);
		});
	});
}

async function runEntry(entry, args, index) {
	if (entry.sub) {
		const sub = args[index];

		if (
			entry.default &&
			(!sub || sub === "help" || sub === "--help" || sub === "-h")
		) {
			await runEntry(entry.default, args, index);
			return;
		}

		if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
			console.error(`Usage: ${entry.usage}`);
			process.exit(1);
		}

		const subEntry = entry.sub[sub];
		if (!subEntry) {
			console.error(`wxtu: unknown target "${sub}"`);
			console.error(`Usage: ${entry.usage}`);
			process.exit(1);
		}

		await runEntry(subEntry, args, index + 1);
		return;
	}

	const scriptPath = path.join(__dirname, entry.script);
	const scriptArgs = entry.passArgs ? args.slice(index) : (entry.args ?? []);
	const code = await runScript(scriptPath, scriptArgs, entry.runtime);
	process.exit(code);
}

async function main() {
	const args = process.argv.slice(2);
	const cmd = args[0];

	if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
		printHelp();
		process.exit(cmd ? 0 : 1);
	}

	const entry = COMMANDS[cmd];
	if (!entry) {
		console.error(`wxtu: unknown command "${cmd}"`);
		console.error("Run 'wxtu help' for usage.");
		process.exit(1);
	}

	await runEntry(entry, args, 1);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
