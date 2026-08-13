#!/usr/bin/env bun

import { main as openMain } from "./open.ts";
import { main as closeMain } from "./close.ts";
import { main as minimizeMain } from "./minimize.ts";
import { main as openExtensionMain } from "./open-extension.ts";
import { browserReachable, resolvePortState } from "./browser-state.ts";
import { listTabs } from "./cdp.ts";
import { resolveBinary, clearLaunchInfo } from "./chrome-instance.ts";
import { DEFAULT_BINARY } from "./config.ts";

const HELP = `control-chrome — Control Chromium for development

Usage: control-chrome <command> [options]

Commands:
  open                          Launch Chromium with remote debugging (default: normal)
  close                         Stop Chromium launched by control-chrome
  status                        Show port/lock status
  minimize                      Minimize Chromium window on a given port
  tabs                          List open tabs
  cdp <method> [params-json]    Send raw CDP command
  open-extension <pattern>      Open an extension page by name

Examples:
  control-chrome open --port 9222
  control-chrome open --port 9222 --url http://localhost:5180 --minimize
  control-chrome close --port 9222
  control-chrome status --port 9222
  control-chrome minimize --port 9222
  control-chrome open-extension "My Extension"
  control-chrome tabs --port 9222
  control-chrome cdp --port 9222 Browser.getVersion

Options:
  --help, -h            Show this help

Environment:
  CONTROL_CHROME_BIN        Override browser binary (default: ${DEFAULT_BINARY})
  CONTROL_CHROME_LOCALE     Locale used when --locale is not passed (default: en-US)`;

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

async function cmdStatus(argv: string[]): Promise<void> {
	let port = 0;
	let json = false;

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				port = +(argv[++i] ?? 0);
				break;
			case "--json":
				json = true;
				break;
		}
	}

	if (!port) port = 0;

	const states: Array<{ port: number; browser: string; lock: string }> = [];
	const portsToCheck = port ? [port] : [9222, 39225, 9220];

	for (const p of portsToCheck) {
		const state = await resolvePortState(p);
		const reachable = await browserReachable(p);
		states.push({
			port: p,
			browser: reachable ? "reachable" : "unreachable",
			lock: state.lock ? `locked (${state.lock.owner})` : "free",
		});
	}

	if (json) {
		console.log(JSON.stringify(states, null, 2));
		return;
	}

	console.log("Chrome port status:");
	for (const s of states) {
		console.log(`  port ${s.port}: ${s.browser}, lock: ${s.lock}`);
	}
}

async function cmdTabs(argv: string[]): Promise<void> {
	let port = 0;
	let json = false;

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				port = +(argv[++i] ?? 0);
				break;
			case "--json":
				json = true;
				break;
		}
	}

	if (!port) die("Usage: control-chrome tabs --port <port>");

	const tabs = await listTabs(port);
	const pages = tabs.filter((t) => t.type === "page");

	if (json) {
		console.log(JSON.stringify(pages, null, 2));
		return;
	}

	pages.forEach((t, i) => console.log(`[${i}] ${t.title}\n    ${t.url}`));
}

async function cmdCdp(argv: string[]): Promise<void> {
	let port = 0;
	const methodArgs: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				port = +(argv[++i] ?? 0);
				break;
			default:
				methodArgs.push(argv[i]);
		}
	}

	if (!port)
		die("Usage: control-chrome cdp --port <port> <method> [params-json]");
	if (methodArgs.length < 1)
		die("Usage: control-chrome cdp --port <port> <method> [params-json]");

	const method = methodArgs[0];
	const params = methodArgs[1] ? JSON.parse(methodArgs[1]) : {};

	const { CDP, getBrowserWsUrl } = await import("./cdp.ts");
	const wsUrl = await getBrowserWsUrl(port);
	if (!wsUrl) die(`Cannot connect to Chrome on port ${port}`);

	const cdp = await CDP.connect(wsUrl);
	try {
		const result = await cdp.send(method, params);
		console.log(JSON.stringify(result, null, 2));
	} finally {
		cdp.close();
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (!args.length || args[0] === "--help" || args[0] === "-h") {
		console.log(HELP);
		return;
	}

	const [cmd, ...rest] = args;

	switch (cmd) {
		case "open":
			await openMain(rest);
			break;
		case "close":
			await closeMain(rest);
			break;
		case "status":
			await cmdStatus(rest);
			break;
		case "minimize":
			await minimizeMain(rest);
			break;
		case "tabs":
			await cmdTabs(rest);
			break;
		case "cdp":
			await cmdCdp(rest);
			break;
		case "open-extension":
			await openExtensionMain(rest);
			break;
		default:
			console.error(`control-chrome: unknown command "${cmd}"`);
			console.log(HELP);
			process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((err) => {
		die(err instanceof Error ? err.message : String(err));
	});
}
