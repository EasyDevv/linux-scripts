import { printHelp } from "./ui.ts";
import { chmod } from "node:fs/promises";

import { findAvailablePort } from "./browser-state.ts";
import { readSession, sessionCookiesPath, sessionDir } from "./session.ts";

/** obscura CDP ports stay clear of Chromium (9201, 9222, 39225). */
export const OBSCURA_PORT_BASE = 9300;

const FETCH_HELP = `browser fetch — read a page with obscura (headless, --stealth, no paint)

Usage
  browser fetch <url> [options]

Options
  --dump <kind>        text | markdown | html | links | assets | original (default: text)
  --eval <js>          print one JS value instead of a dump
  --session <name>     send that session's cookies (see: browser login)
  --selector <css>     wait for a selector
  --wait <s>           settle seconds after load (default: 5)
  --wait-until <ev>    load | domcontentloaded | networkidle0
  --timeout <s>        navigation timeout (default: 30)
  --proxy <url>        HTTP or SOCKS5 proxy (e.g. socks5://127.0.0.1:1080)
  --output <file>      write instead of stdout
  --no-stealth         drop --stealth
  --verbose            keep obscura progress lines

Examples
  browser fetch example.com --dump markdown
  browser fetch site.example/me --session 9222     # signed in

Notes
  localhost and LAN URLs get --allow-private-network on their own.
  No screenshots, layout, or clicks: open Chromium and use bun-webview.`;

const SERVE_HELP = `browser serve — obscura CDP server for Playwright/Puppeteer clients

Usage
  browser serve [options]

Options
  --port <N>           listen port (default: first free from ${OBSCURA_PORT_BASE})
  --session <name>     load and write back that session's cookies
  --private            allow localhost and LAN targets
  --no-stealth         drop --stealth

Notes
  Runs in the foreground; stop with Ctrl-C or browser list.
  No screenshots or PDFs: obscura has no paint engine.`;

const PASS_WITH_VALUE = new Set([
	"--dump",
	"--eval",
	"--selector",
	"--proxy",
	"--wait",
	"--wait-until",
	"--timeout",
	"--user-agent",
	"--proxy",
	"--output",
]);

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

export function isPrivateUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
		return (
			host === "localhost" ||
			host.endsWith(".localhost") ||
			host === "::1" ||
			/^127\./.test(host) ||
			/^10\./.test(host) ||
			/^192\.168\./.test(host) ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
			/^169\.254\./.test(host)
		);
	} catch {
		return false;
	}
}

async function requireSession(name: string): Promise<string> {
	if (!(await readSession(name)))
		die(`No session "${name}". Create it: browser login <url> --session ${name}`);
	return sessionDir(name);
}

export function buildFetchArgs(opts: {
	url: string;
	pass: string[];
	stealth: boolean;
	storageDir?: string;
	verbose: boolean;
}): string[] {
	const args = ["fetch", opts.url];
	if (!opts.pass.includes("--dump") && !opts.pass.includes("--eval"))
		args.push("--dump", "text");
	args.push(...opts.pass);
	if (opts.stealth) args.push("--stealth");
	if (opts.storageDir) args.push("--storage-dir", opts.storageDir);
	if (isPrivateUrl(opts.url)) args.push("--allow-private-network");
	if (!opts.verbose) args.push("--quiet");
	return args;
}

export async function fetchMain(argv: string[]): Promise<void> {
	if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
		printHelp(FETCH_HELP);
		return;
	}
	let url = "";
	let stealth = true;
	let verbose = false;
	let session: string | undefined;
	const pass: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--session") session = argv[++i] ?? die("Usage: --session <name>");
		else if (arg === "--no-stealth") stealth = false;
		else if (arg === "--stealth") stealth = true;
		else if (arg === "--verbose" || arg === "-v") verbose = true;
		else if (PASS_WITH_VALUE.has(arg))
			pass.push(arg, argv[++i] ?? die(`Usage: ${arg} <value>`));
		else if (arg.startsWith("--")) die(`Unknown option: ${arg}`);
		else if (!url) url = arg;
		else die(`Unexpected argument: ${arg}`);
	}
	if (!url) die("Usage: browser fetch <url>");
	if (!/^[a-z]+:/i.test(url)) url = `https://${url}`;

	const storageDir = session ? await requireSession(session) : undefined;
	const proc = Bun.spawn({
		cmd: ["obscura", ...buildFetchArgs({ url, pass, stealth, storageDir, verbose })],
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	// obscura rewrites cookies.json with its own mode.
	if (session) await chmod(sessionCookiesPath(session), 0o600).catch(() => {});
	process.exit(code);
}

export async function serveMain(argv: string[]): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h")) {
		printHelp(SERVE_HELP);
		return;
	}
	let port = 0;
	let stealth = true;
	let priv = false;
	let session: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") port = +(argv[++i] ?? 0);
		else if (arg === "--session") session = argv[++i] ?? die("Usage: --session <name>");
		else if (arg === "--no-stealth") stealth = false;
		else if (arg === "--private") priv = true;
		else die(`Unknown option: ${arg}`);
	}
	if (!port) port = await findAvailablePort(OBSCURA_PORT_BASE);
	if (port === 9201 || port === 9222) die(`Port ${port} belongs to Chromium`);

	const args = ["serve", "--port", String(port)];
	if (stealth) args.push("--stealth");
	if (priv) args.push("--allow-private-network");
	if (session) args.push("--storage-dir", await requireSession(session));
	console.log(`✓ obscura CDP http://127.0.0.1:${port}${session ? ` · session ${session}` : ""}`);
	const proc = Bun.spawn({
		cmd: ["obscura", ...args],
		stdout: "inherit",
		stderr: "inherit",
	});
	process.exit(await proc.exited);
}
