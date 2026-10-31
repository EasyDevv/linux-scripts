import { printHelp } from "./ui.ts";
import { browserReachable } from "./browser-state.ts";
import { CDP, closeTabById, createTab, getBrowserWsUrl, listTabs } from "./cdp.ts";
import { main as closeMain } from "./close.ts";
import { resolveDefaultProfileDir } from "./chrome-instance.ts";
import { DEFAULT_PORT } from "./config.ts";
import { main as openMain } from "./open.ts";
import {
	type CdpCookie,
	cookieMatchesHost,
	readBrowserCookies,
	saveSessionFromPort,
	sessionNameForProfile,
	summarizeCookies,
} from "./session.ts";

export const LOGIN_DEFAULTS = Object.freeze({ timeoutS: 300, intervalS: 3 });

const HELP = `browser login — a human signs in on Chromium; the session is saved for fetch --session

Usage
  browser login <url> [options]

Options
  --port <N>           Chromium port (default: ${DEFAULT_PORT})
  --session <name>     session name (default: the port's global profile)
  --cookie <name>      done when this cookie exists for the site
  --url-match <re>     done when a tab URL matches
  --timeout <s>        give up after (default: ${LOGIN_DEFAULTS.timeoutS})
  --interval <s>       poll cadence (default: ${LOGIN_DEFAULTS.intervalS})

Done when
  a cookie name absent when the page opened appears: httpOnly, or auth-named and
  persistent ≥ 1h (tracker, csrf, consent names ignored), and the login tab has left
  the login or challenge URL. Already signed in, or the site rotates one cookie
  on sign-in: pass --cookie <name>.

After saving
  closes the Chromium it launched, or only its tab if Chromium was already running.

Exit
  0   saved
  2   timeout
  1   error            # cookie values are never printed`;

type LoginOptions = {
	url: string;
	port: number;
	session?: string;
	cookie?: string;
	urlMatch?: RegExp;
	timeoutS: number;
	intervalS: number;
};

function die(msg: string, code = 1): never {
	console.error(`✗ ${msg}`);
	process.exit(code);
}

function parseArgs(argv: string[]): LoginOptions {
	const opts: LoginOptions = {
		url: "",
		port: DEFAULT_PORT,
		timeoutS: LOGIN_DEFAULTS.timeoutS,
		intervalS: LOGIN_DEFAULTS.intervalS,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => argv[++i] ?? die(`Usage: ${arg} <value>`);
		switch (arg) {
			case "--port":
				opts.port = +value();
				break;
			case "--session":
				opts.session = value();
				break;
			case "--cookie":
				opts.cookie = value();
				break;
			case "--url-match":
				opts.urlMatch = new RegExp(value());
				break;
			case "--timeout":
				opts.timeoutS = +value();
				break;
			case "--interval":
				opts.intervalS = +value();
				break;
			default:
				if (arg.startsWith("--")) die(`Unknown option: ${arg}`);
				if (opts.url) die(`Unexpected argument: ${arg}`);
				opts.url = arg;
		}
	}
	if (!opts.url) die("Usage: browser login <url>");
	if (!/^[a-z]+:/i.test(opts.url)) opts.url = `https://${opts.url}`;
	if (!(opts.timeoutS > 0) || !(opts.intervalS > 0))
		die("--timeout and --interval must be positive seconds");
	return opts;
}

const AUTH_NAME = /sess|auth|token|login|sid|jwt|remember|user|account|member|access/i;
// Anonymous bookkeeping that bot challenges and consent banners set mid-page.
const NOISE_NAME = /track|csrf|xsrf|consent|bucket|^_ga|^_gid|ads|challenge|^cf_|^__cf/i;
const LOGIN_PATH = /log-?in|sign-?in|sign_in|\/auth\b|\/sso\b|challenge/i;
const MIN_LIFETIME_S = 3600;

/** A cookie that appeared since the baseline and looks like a sign-in. */
export function detectLogin(
	baseline: CdpCookie[],
	current: CdpCookie[],
	host: string,
	nowS = Date.now() / 1000,
): CdpCookie | null {
	const key = (c: CdpCookie) => `${c.domain}|${c.path}|${c.name}`;
	const before = new Set(baseline.map(key));
	for (const c of current) {
		if (!cookieMatchesHost(c, host)) continue;
		// Only new names: anonymous tokens (reddit token_v2) rotate in place.
		if (before.has(key(c))) continue;
		if (NOISE_NAME.test(c.name)) continue;
		const sessionScoped = c.session || c.expires < 0;
		if (!sessionScoped && c.expires - nowS < MIN_LIFETIME_S) continue;
		if (c.httpOnly) return c;
		// Script-readable cookies count only when named like auth and persistent.
		if (!sessionScoped && AUTH_NAME.test(c.name)) return c;
	}
	return null;
}

/** A tab on the site still sits on a sign-in or challenge URL: not done yet. */
export function isLoginUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return LOGIN_PATH.test(u.pathname) || /js_challenge|captcha/i.test(u.search);
	} catch {
		return false;
	}
}

/** The tab `login` opened still sits on a sign-in or challenge URL. A closed tab no longer blocks. */
async function stillOnLoginPage(port: number, tabId: string | undefined): Promise<boolean> {
	if (!tabId) return false;
	const tabs = await listTabs(port).catch(() => []);
	const tab = tabs.find((t) => t.id === tabId);
	return tab ? isLoginUrl(tab.url) : false;
}

async function bringToFront(port: number, targetId: string) {
	const wsUrl = await getBrowserWsUrl(port);
	if (!wsUrl) return;
	const cdp = await CDP.connect(wsUrl);
	try {
		const { windowId } = await cdp.send<{ windowId: number }>(
			"Browser.getWindowForTarget",
			{ targetId },
		);
		await cdp.send("Browser.setWindowBounds", {
			windowId,
			bounds: { windowState: "normal" },
		});
		await cdp.send("Target.activateTarget", { targetId });
	} catch {
		// Headless or window gone: polling still works.
	} finally {
		cdp.close();
	}
}

function notify(text: string) {
	if (!Bun.which("notify-send")) return;
	Bun.spawn({
		cmd: ["notify-send", "-a", "browser", "browser login", text],
		stdout: "ignore",
		stderr: "ignore",
	}).unref();
}

export async function main(argv: string[]): Promise<void> {
	if (argv.includes("--help") || argv.includes("-h") || !argv.length) {
		printHelp(HELP);
		return;
	}
	const opts = parseArgs(argv);
	const host = new URL(opts.url).hostname;
	const session =
		opts.session ?? sessionNameForProfile(resolveDefaultProfileDir(opts.port));
	if (!session)
		die(`Port ${opts.port} uses a project profile: pass --session <name>`);

	let loginTabId: string | undefined;
	const reused = await browserReachable(opts.port);
	if (reused) {
		const tab = await createTab(opts.port, opts.url);
		if (!tab) die(`Could not open a tab on port ${opts.port}`);
		loginTabId = tab.id;
		await bringToFront(opts.port, tab.id);
	} else {
		await openMain(["--port", String(opts.port), "--url", opts.url, "--normal"]);
		loginTabId = (await listTabs(opts.port)).find((t) => t.type === "page")?.id;
	}
	notify(`${host} 로그인 대기 (${opts.timeoutS}s)`);

	// Let the page set its anonymous cookies before taking the baseline.
	await Bun.sleep(2000);
	const baseline = await readBrowserCookies(opts.port);
	const deadline = Date.now() + opts.timeoutS * 1000;
	console.log(
		`… waiting for sign-in on ${host} (:${opts.port}, every ${opts.intervalS}s, ${opts.timeoutS}s max)`,
	);

	let reason: string | null = null;
	while (!reason) {
		let current: CdpCookie[];
		try {
			current = await readBrowserCookies(opts.port);
		} catch {
			die(`Chromium on :${opts.port} went away before sign-in finished`);
		}
		if (opts.cookie) {
			if (current.some((c) => c.name === opts.cookie && cookieMatchesHost(c, host)))
				reason = `cookie ${opts.cookie}`;
		} else if (!opts.urlMatch) {
			const hit = detectLogin(baseline, current, host);
			if (hit && !(await stillOnLoginPage(opts.port, loginTabId))) reason = `new cookie ${hit.name}`;
		}
		if (!reason && opts.urlMatch) {
			const tabs = await listTabs(opts.port).catch(() => []);
			const tab = tabs.find((t) => t.type === "page" && opts.urlMatch!.test(t.url));
			if (tab) reason = "url match";
		}
		if (reason) break;
		if (Date.now() >= deadline) {
			die(
				`login timeout after ${opts.timeoutS}s on ${host}: no ${opts.cookie ? `cookie ${opts.cookie}` : opts.urlMatch ? "matching URL" : "new auth cookie"} (already signed in? pass --cookie <name>)`,
				2,
			);
		}
		await Bun.sleep(opts.intervalS * 1000);
	}

	const { path, cookies } = await saveSessionFromPort(opts.port, session);
	const s = summarizeCookies(cookies, host);
	console.log(
		`✓ signed in (${reason}) · session ${session} · ${host} ${s.site} cookies · ${s.total} total · ${path}`,
	);
	notify(`${host} 로그인 저장됨`);

	// The sign-in window has done its job. Leave a browser someone else started running.
	if (reused) {
		if (loginTabId) await closeTabById(opts.port, loginTabId);
	} else {
		await closeMain(["--port", String(opts.port)]);
	}
}
