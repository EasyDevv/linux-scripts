#!/usr/bin/env bun

import { printHelp } from "./ui.ts";
import { main as openMain } from "./open.ts";
import { main as closeMain } from "./close.ts";
import { main as minimizeMain } from "./minimize.ts";
import { main as openExtensionMain } from "./open-extension.ts";
import { main as listMain } from "./list.ts";
import { main as loginMain } from "./login.ts";
import { fetchMain, OBSCURA_PORT_BASE, serveMain } from "./fetch.ts";
import {
	listSessions,
	removeSession,
	saveSessionFromPort,
	sessionNameForProfile,
	summarizeCookies,
} from "./session.ts";
import { resolveDefaultProfileDir } from "./chrome-instance.ts";
import { applyPortTheme } from "./port-identity.ts";
import { browserReachable, resolvePortState } from "./browser-state.ts";
import { listTabs } from "./cdp.ts";

const HELP = `browser — obscura reads pages; Chromium shows them and lets a human sign in

Read · obscura --stealth, headless, no paint
  fetch <url>             text, markdown, html, links, or one --eval value
  serve                   obscura CDP server for Playwright (ports ${OBSCURA_PORT_BASE}+)

Sign in · a human, on Chromium
  login <url>             wait for sign-in, save the session for fetch --session
  session list|save|rm    saved cookie sessions (values never printed)

Chromium · render, measure, capture, extensions
  open                    launch or attach (9222 = global profile)
  close                   stop it (9222 saves its session first; ends recording)
  list                    every obscura and Chromium browser; pick and close
  tabs                    page tabs of one port
  status                  reachability and locks of known ports
  minimize | cdp | open-extension | identity

More
  browser <command> --help
  clicks, typing, snapshots: the bun-webview skill`;

const SUB_HELP: Record<string, string> = {
	list: `browser list — every obscura and Chromium browser on this machine

Usage
  browser list            pick a row; x closes it (TTY)
  browser list --plain    one line per browser
  browser list --json

Keys
  ↑ ↓ j k   move
  g G       first, last
  x d       close the row (asks; default No)
  enter     print its tabs and exit
  q esc     quit

Notes
  Engine column: chromium or obscura. Service-owned rows (9201) stop their
  systemd unit. Without a TTY it prints the plain list.`,
	tabs: `browser tabs — page tabs of one Chromium

Usage
  browser tabs --port <N> [--json]`,
	status: `browser status — reachability and lock of known ports

Usage
  browser status [--port <N>] [--json]   # default: 9222, 39225, 9220`,
	cdp: `browser cdp — send one browser-level CDP command

Usage
  browser cdp --port <N> <Method> [params-json]

Examples
  browser cdp --port 9222 Browser.getVersion
  browser cdp --port 9222 Target.getTargets`,
	minimize: `browser minimize — minimize a Chromium window (KDE Wayland)

Usage
  browser minimize --port <N> [--timeout-ms <ms>] [--silent]`,
	identity: `browser identity — apply the per-port theme color and start page name

Usage
  browser identity --port <N> --user-data <dir>`,
};

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

	if (!port) die("Usage: browser tabs --port <port>");

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
		die("Usage: browser cdp --port <port> <method> [params-json]");
	if (methodArgs.length < 1)
		die("Usage: browser cdp --port <port> <method> [params-json]");

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

const SESSION_HELP = `browser session — saved cookie sessions (obscura --storage-dir format)

Usage
  browser session list                                 name, cookie and site counts
  browser session save --port <N> [--session <name>]   copy a running Chromium's cookies
  browser session rm <name>

Notes
  Store: ~/.local/share/browser/sessions/<name>/cookies.json (0600)
  Global profiles name their session after the port (9222, 9201).`;

async function cmdSession(argv: string[]): Promise<void> {
	const [sub, ...rest] = argv;
	if (!sub || sub === "--help" || sub === "-h") {
		printHelp(SESSION_HELP);
		return;
	}
	if (sub === "list") {
		const rows = await listSessions();
		if (!rows.length) console.log("(no sessions)");
		for (const r of rows)
			console.log(
				`${r.name} · ${r.cookies} cookies · ${r.domains} sites · ${r.updated.toLocaleString("sv-SE").slice(0, 16)}`,
			);
		return;
	}
	if (sub === "rm") {
		const name = rest[0] ?? die("Usage: browser session rm <name>");
		console.log((await removeSession(name)) ? `✓ removed ${name}` : `(no session ${name})`);
		return;
	}
	if (sub === "save") {
		const port = +(rest[rest.indexOf("--port") + 1] ?? 0);
		if (!rest.includes("--port") || !port) die("Usage: browser session save --port <N> [--session <name>]");
		const name =
			(rest.includes("--session") ? rest[rest.indexOf("--session") + 1] : undefined) ??
			sessionNameForProfile(resolveDefaultProfileDir(port)) ??
			die(`Port ${port} uses a project profile: pass --session <name>`);
		const { path, cookies } = await saveSessionFromPort(port, name);
		const s = summarizeCookies(cookies);
		console.log(`✓ session ${name} · ${s.total} cookies · ${s.sites} sites · ${path}`);
		return;
	}
	die(`Unknown session command: ${sub}`);
}

async function main() {
	const args = process.argv.slice(2);

	if (!args.length || args[0] === "--help" || args[0] === "-h") {
		printHelp(HELP);
		return;
	}

	const [cmd, ...rest] = args;
	if (SUB_HELP[cmd] && (rest.includes("--help") || rest.includes("-h"))) {
		printHelp(SUB_HELP[cmd]);
		return;
	}

	switch (cmd) {
		case "fetch":
			await fetchMain(rest);
			break;
		case "serve":
			await serveMain(rest);
			break;
		case "login":
			await loginMain(rest);
			break;
		case "session":
			await cmdSession(rest);
			break;
		case "open":
			await openMain(rest);
			break;
		case "close":
			await closeMain(rest);
			break;
		case "list":
			await listMain(rest);
			break;
		case "identity": {
			const port = +(rest[rest.indexOf("--port") + 1] ?? 0);
			const dir = rest[rest.indexOf("--user-data") + 1];
			if (!port || !dir)
				die("Usage: browser identity --port <N> --user-data <dir>");
			await applyPortTheme(dir, port);
			break;
		}
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
			console.error(`browser: unknown command "${cmd}"`);
			printHelp(HELP);
			process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((err) => {
		die(err instanceof Error ? err.message : String(err));
	});
}
