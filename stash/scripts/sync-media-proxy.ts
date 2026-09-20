#!/usr/bin/env bun
/**
 * Sync `media-proxy.json` from the AdGuard VPN browser extension.
 *
 * Why this exists
 * ---------------
 * `[download] media_proxy_referer_hosts` routes every HLS job whose Referer is
 * `recordplay.biz` / `playrecord.biz` through the AdGuard HTTPS proxy in
 * `[download] media_proxy_file`. The extension rotates that proxy password
 * (it is a short-lived session credential). A stale password makes the proxy
 * answer HTTP 407 to CONNECT, which reqwest surfaces as a plain connection
 * error, so stash reports `media route connection failed`, classifies it as
 * transient and burns `[retry] max_retries` attempts before failing.
 *
 * This script reads the extension's live `chrome.storage.local.proxy_config`
 * over CDP and rewrites the JSON file when it changed, so the stash route can
 * be refreshed without hand-copying credentials.
 *
 * Usage
 * -----
 *   bun scripts/sync-media-proxy.ts                 # sync if needed
 *   bun scripts/sync-media-proxy.ts --check         # report only, no write
 *   bun scripts/sync-media-proxy.ts --verify        # sync, then CONNECT test
 *   bun scripts/sync-media-proxy.ts --json          # machine readable summary
 *
 * Options
 * -------
 *   --config <path>       stash config (default ~/.config/stash/config.toml)
 *   --target <path>       media proxy json (default from config)
 *   --cdp-port <n>        Chrome CDP port (default from browser_hls.worker_cdp_url)
 *   --profile <dir>       Chrome user-data-dir used for extension discovery
 *   --extension-id <id>   skip extension discovery
 *   --keep-host           keep the existing host, update credentials only
 *   --check               do not write
 *   --verify              verify the new credentials against the proxy
 *   --quiet               stay silent when nothing changed
 *   --json                print a JSON summary on stdout
 *
 * Exit codes: 0 ok (synced / unchanged), 1 error (or --verify failed).
 * Secrets are never printed; only sha256 prefixes and lengths are reported.
 */

import { readFile, readdir, rename, chmod, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "stash", "config.toml");
export const DEFAULT_MEDIA_PROXY_PATH = join(homedir(), ".config", "stash", "media-proxy.json");
export const DEFAULT_PROFILE_DIR = join(homedir(), "dev", "tampermonkey", ".user-data", "chrome-tampermonkey");
export const DEFAULT_CDP_PORT = 12345;
export const EXTENSION_NAME_PATTERN = /adguard\s*vpn/i;
export const VERIFY_URL = "https://ifconfig.me/ip";

export type MediaProxyConfig = {
	url: string;
	username: string;
	password: string;
};

export type StashSettings = {
	workerCdpUrl: string | null;
	mediaProxyFile: string | null;
	mediaProxyRefererHosts: string[];
};

export type Args = {
	config: string;
	target: string | null;
	cdpPort: number | null;
	profile: string;
	extensionId: string | null;
	keepHost: boolean;
	check: boolean;
	verify: boolean;
	quiet: boolean;
	json: boolean;
};

export type SyncStatus = "unchanged" | "synced" | "needs-update" | "dry-run";

export type SyncSummary = {
	status: SyncStatus;
	target: string;
	source: string;
	host: string;
	scheme: string;
	port: number;
	usernameFingerprint: string;
	passwordFingerprint: string;
	previousPasswordFingerprint: string | null;
	hostChanged: boolean;
	verifyStatus: number | null;
	verifyError: string | null;
};

// ── pure helpers ─────────────────────────────────────────────

export function parseArgs(argv: string[]): Args {
	const args: Args = {
		config: DEFAULT_CONFIG_PATH,
		target: null,
		cdpPort: null,
		profile: process.env.STASH_CHROME_PROFILE ?? DEFAULT_PROFILE_DIR,
		extensionId: null,
		keepHost: false,
		check: false,
		verify: false,
		quiet: false,
		json: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = () => {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) {
				throw new Error(`missing value for ${flag}`);
			}
			index += 1;
			return next;
		};
		switch (flag) {
			case "--config":
				args.config = expandHome(value());
				break;
			case "--target":
				args.target = expandHome(value());
				break;
			case "--cdp-port":
				args.cdpPort = Number(value());
				break;
			case "--profile":
				args.profile = expandHome(value());
				break;
			case "--extension-id":
				args.extensionId = value();
				break;
			case "--keep-host":
				args.keepHost = true;
				break;
			case "--check":
				args.check = true;
				break;
			case "--verify":
				args.verify = true;
				break;
			case "--quiet":
				args.quiet = true;
				break;
			case "--json":
				args.json = true;
				break;
			case "--help":
			case "-h":
				throw new UsageError();
			default:
				throw new Error(`unknown option: ${flag}`);
		}
	}
	return args;
}

export class UsageError extends Error {}

export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/** Read only the stash settings this script needs; unknown keys stay untouched. */
export function extractStashSettings(config: unknown): StashSettings {
	const download = section(config, "download");
	const browserHls = section(config, "browser_hls");
	const hosts = download.media_proxy_referer_hosts;
	return {
		workerCdpUrl: typeof browserHls.worker_cdp_url === "string" ? browserHls.worker_cdp_url : null,
		mediaProxyFile: typeof download.media_proxy_file === "string" ? download.media_proxy_file : null,
		mediaProxyRefererHosts: Array.isArray(hosts)
			? hosts.filter((host): host is string => typeof host === "string")
			: [],
	};
}

function section(config: unknown, name: string): Record<string, unknown> {
	if (!config || typeof config !== "object") return {};
	const value = (config as Record<string, unknown>)[name];
	if (!value || typeof value !== "object") return {};
	return value as Record<string, unknown>;
}

export function portFromCdpUrl(url: string | null): number | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		const port = Number(parsed.port);
		return Number.isInteger(port) && port > 0 ? port : null;
	} catch {
		return null;
	}
}

/** Build the media proxy JSON payload from the extension's `proxy_config`. */
export function buildMediaProxy(proxyConfig: unknown, keepHost?: MediaProxyConfig | null): MediaProxyConfig {
	if (!proxyConfig || typeof proxyConfig !== "object") {
		throw new Error("extension proxy_config is missing");
	}
	const config = proxyConfig as Record<string, unknown>;
	const credentials = config.credentials;
	if (!credentials || typeof credentials !== "object") {
		throw new Error("extension proxy_config has no credentials");
	}
	const { username, password } = credentials as Record<string, unknown>;
	if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
		throw new Error("extension proxy_config credentials are empty");
	}
	const host = keepHost ? keepHost.url.replace(/^https:\/\//, "").replace(/:\d+$/, "") : config.host;
	if (typeof host !== "string" || !host) {
		throw new Error("extension proxy_config has no host");
	}
	const scheme = keepHost ? "https" : typeof config.scheme === "string" ? config.scheme : "https";
	if (scheme !== "https") {
		throw new Error(`unsupported proxy scheme: ${scheme}`);
	}
	const port = keepHost ? portOf(keepHost.url) : typeof config.port === "number" ? config.port : 443;
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`invalid proxy port: ${String(config.port)}`);
	}
	return { url: `https://${host}:${port}`, username, password };
}

function portOf(url: string): number {
	try {
		const parsed = new URL(url);
		const port = Number(parsed.port);
		return Number.isInteger(port) && port > 0 ? port : 443;
	} catch {
		return 443;
	}
}

export function parseMediaProxy(text: string): MediaProxyConfig | null {
	try {
		const value = JSON.parse(text) as Record<string, unknown>;
		if (typeof value.url !== "string" || typeof value.username !== "string" || typeof value.password !== "string") {
			return null;
		}
		return { url: value.url, username: value.username, password: value.password };
	} catch {
		return null;
	}
}

export function sameMediaProxy(a: MediaProxyConfig, b: MediaProxyConfig): boolean {
	return a.url === b.url && a.username === b.username && a.password === b.password;
}

export function serializeMediaProxy(config: MediaProxyConfig): string {
	return `${JSON.stringify(config)}\n`;
}

export function fingerprint(secret: string): string {
	return new Bun.CryptoHasher("sha256").update(secret).digest("hex").slice(0, 12);
}

/** Keep the endpoint recognizable without publishing the per-account token. */
export function maskHost(url: string): string {
	try {
		const parsed = new URL(url);
		const labels = parsed.hostname.split(".");
		const head = labels[0].split("-");
		if (head.length >= 4) return `${head.slice(0, head.length - 1).join("-")}-…`;
		return parsed.hostname;
	} catch {
		return "<invalid url>";
	}
}

/** Proxy URL with embedded basic auth, used only in-process for verification. */
export function proxyUrlWithAuth(config: MediaProxyConfig): string {
	const parsed = new URL(config.url);
	return `${parsed.protocol}//${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${parsed.host}`;
}

// ── filesystem ───────────────────────────────────────────────

export async function readStashSettings(path: string): Promise<StashSettings> {
	try {
		const text = await readFile(path, "utf8");
		return extractStashSettings(Bun.TOML.parse(text));
	} catch {
		return { workerCdpUrl: null, mediaProxyFile: null, mediaProxyRefererHosts: [] };
	}
}

export async function readExistingProxy(path: string): Promise<MediaProxyConfig | null> {
	try {
		return parseMediaProxy(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

/** Owner-only write: temp file in the same directory, chmod 0600, atomic rename. */
export async function writeMediaProxy(path: string, contents: string): Promise<void> {
	await ensureDir(path);
	const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
	await writeFile(temp, contents, { mode: 0o600 });
	await chmod(temp, 0o600);
	await rename(temp, path);
}

function basename(path: string): string {
	return path.split("/").pop() ?? "media-proxy.json";
}

async function ensureDir(path: string): Promise<void> {
	const dir = dirname(path);
	try {
		await stat(dir);
	} catch {
		throw new Error(`directory does not exist: ${dir}`);
	}
}

export async function discoverExtensionIds(profileDir: string): Promise<string[]> {
	const ids: string[] = [];
	for (const root of [profileDir]) {
		for (const profile of await listDirs(join(root))) {
			if (!/^(Default|Profile \d+)$/.test(profile)) continue;
			const extensionsDir = join(root, profile, "Extensions");
			for (const id of await listDirs(extensionsDir)) {
				for (const version of await listDirs(join(extensionsDir, id))) {
					const manifestPath = join(extensionsDir, id, version, "manifest.json");
					const name = await extensionName(join(extensionsDir, id, version), manifestPath);
					if (name && EXTENSION_NAME_PATTERN.test(name) && !ids.includes(id)) ids.push(id);
				}
			}
		}
	}
	return ids;
}

async function extensionName(dir: string, manifestPath: string): Promise<string | null> {
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
	const name = typeof manifest.name === "string" ? manifest.name : "";
	const match = /^__MSG_(.+)__$/.exec(name);
	if (!match) return name;
	const locale = typeof manifest.default_locale === "string" ? manifest.default_locale : "en";
	for (const candidate of [locale, "en", "en_US"]) {
		try {
			const messages = JSON.parse(
				await readFile(join(dir, "_locales", candidate, "messages.json"), "utf8"),
			) as Record<string, { message?: string }>;
			const message = messages[match[1]]?.message ?? messages[match[1].toLowerCase()]?.message;
			if (message) return message;
		} catch {
			continue;
		}
	}
	return null;
}

async function listDirs(path: string): Promise<string[]> {
	try {
		const entries = await readdir(path, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return [];
	}
}

// ── CDP ──────────────────────────────────────────────────────

type CdpTarget = {
	id: string;
	type: string;
	title: string;
	url: string;
	webSocketDebuggerUrl?: string;
};

class Cdp {
	private constructor(private readonly ws: WebSocket) {}

	static async connect(wsUrl: string, timeoutMs = 10_000): Promise<Cdp> {
		const ws = new WebSocket(wsUrl);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`timed out connecting to ${wsUrl}`)), timeoutMs);
			ws.onopen = () => {
				clearTimeout(timer);
				resolve();
			};
			ws.onerror = () => {
				clearTimeout(timer);
				reject(new Error(`CDP connection failed: ${wsUrl}`));
			};
		});
		return new Cdp(ws);
	}

	call(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = Math.floor(Math.random() * 1e9);
			const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), timeoutMs);
			const onMessage = (event: MessageEvent) => {
				let message: { id?: number; result?: unknown; error?: { message?: string } };
				try {
					message = JSON.parse(String(event.data));
				} catch {
					return;
				}
				if (message.id !== id) return;
				clearTimeout(timer);
				this.ws.removeEventListener("message", onMessage as EventListener);
				if (message.error) reject(new Error(`CDP ${method}: ${message.error.message ?? "failed"}`));
				else resolve(message.result);
			};
			this.ws.addEventListener("message", onMessage as EventListener);
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	close(): void {
		try {
			this.ws.close();
		} catch {
			// ignore
		}
	}
}

async function cdpJson<T>(port: number, path: string): Promise<T> {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) throw new Error(`CDP ${path} returned HTTP ${response.status}`);
	return (await response.json()) as T;
}

export async function listTargets(port: number): Promise<CdpTarget[]> {
	return cdpJson<CdpTarget[]>(port, "/json");
}

async function browserWebSocketUrl(port: number): Promise<string> {
	const version = await cdpJson<{ webSocketDebuggerUrl?: string }>(port, "/json/version");
	if (!version.webSocketDebuggerUrl) throw new Error("CDP browser endpoint has no websocket url");
	return version.webSocketDebuggerUrl;
}

export async function evaluateOnTarget(wsUrl: string, expression: string): Promise<unknown> {
	const cdp = await Cdp.connect(wsUrl);
	try {
		const result = await cdp.call("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result?.exceptionDetails) {
			throw new Error(result.exceptionDetails.text ?? "evaluate failed");
		}
		return result?.result?.value;
	} finally {
		cdp.close();
	}
}

const READ_PROXY_CONFIG = `(async () => {
	const stored = await chrome.storage.local.get("proxy_config");
	return JSON.stringify(stored.proxy_config ?? null);
})()`;

function extensionIdsFromTargets(targets: CdpTarget[]): string[] {
	const ids: string[] = [];
	for (const target of targets) {
		if (target.type !== "service_worker" && target.type !== "background_page") continue;
		const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(target.url);
		if (match && !ids.includes(match[1])) ids.push(match[1]);
	}
	return ids;
}

export async function findExtensionTarget(
	port: number,
	extensionId: string,
): Promise<CdpTarget | null> {
	const targets = await listTargets(port);
	return (
		targets.find(
			(target) =>
				target.type === "service_worker" &&
				target.url.includes(extensionId) &&
				target.webSocketDebuggerUrl,
		) ?? null
	);
}

/** Wake a sleeping extension service worker by opening a background extension page. */
async function wakeExtension(port: number, extensionId: string): Promise<void> {
	const browser = await Cdp.connect(await browserWebSocketUrl(port));
	let created: string | null = null;
	try {
		const result = await browser.call("Target.createTarget", {
			url: `chrome-extension://${extensionId}/options.html`,
			background: true,
		});
		created = typeof result?.targetId === "string" ? result.targetId : null;
	} catch {
		// The page may be blocked; the service worker often starts anyway.
	}
	if (created) {
		await Bun.sleep(500);
		try {
			await browser.call("Target.closeTarget", { targetId: created });
		} catch {
			// ignore
		}
	}
	browser.close();
}

export async function readExtensionProxyConfig(
	port: number,
	candidates: string[],
): Promise<{ extensionId: string; proxyConfig: unknown }> {
	const errors: string[] = [];
	for (const extensionId of candidates) {
		let target = await findExtensionTarget(port, extensionId);
		if (!target) {
			await wakeExtension(port, extensionId);
			await Bun.sleep(500);
			target = await findExtensionTarget(port, extensionId);
		}
		if (!target?.webSocketDebuggerUrl) {
			errors.push(`${extensionId}: service worker not reachable`);
			continue;
		}
		try {
			const raw = await evaluateOnTarget(target.webSocketDebuggerUrl, READ_PROXY_CONFIG);
			const proxyConfig = typeof raw === "string" ? JSON.parse(raw) : null;
			if (proxyConfig) return { extensionId, proxyConfig };
			errors.push(`${extensionId}: proxy_config is empty`);
		} catch (error) {
			errors.push(`${extensionId}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	throw new Error(`no AdGuard VPN proxy_config found (${errors.join("; ") || "no candidates"})`);
}

// ── verification ─────────────────────────────────────────────

export async function verifyProxy(
	config: MediaProxyConfig,
	url = VERIFY_URL,
): Promise<{ status: number | null; error: string | null }> {
	try {
		const response = await fetch(url, {
			proxy: proxyUrlWithAuth(config),
			signal: AbortSignal.timeout(20_000),
		});
		return { status: response.status, error: null };
	} catch (error) {
		return { status: null, error: error instanceof Error ? error.message.slice(0, 120) : "proxy check failed" };
	}
}

// ── main ─────────────────────────────────────────────────────

export function usage(): string {
	return [
		"usage: bun scripts/sync-media-proxy.ts [options]",
		"",
		"  --config <path>      stash config.toml (default ~/.config/stash/config.toml)",
		"  --target <path>      media proxy json (default from config, else ~/.config/stash/media-proxy.json)",
		"  --cdp-port <n>       Chrome CDP port (default from browser_hls.worker_cdp_url)",
		"  --profile <dir>      Chrome user-data-dir for extension discovery",
		"  --extension-id <id>  skip discovery",
		"  --keep-host          keep the current host, refresh credentials only",
		"  --check              report only, do not write",
		"  --verify             CONNECT through the proxy after syncing",
		"  --quiet              stay silent when nothing changed",
		"  --json               print a JSON summary",
	].join("\n");
}

export async function run(argv: string[]): Promise<{ summary: SyncSummary; output: string }> {
	const args = parseArgs(argv);
	const settings = await readStashSettings(args.config);
	const target = args.target ?? settings.mediaProxyFile ?? DEFAULT_MEDIA_PROXY_PATH;
	const port = args.cdpPort ?? portFromCdpUrl(settings.workerCdpUrl) ?? DEFAULT_CDP_PORT;

	const existing = await readExistingProxy(target);
	const targets = await listTargets(port).catch((error: unknown) => {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Chrome CDP not reachable on 127.0.0.1:${port} (${detail})`);
	});
	const candidates = args.extensionId
		? [args.extensionId]
		: [...extensionIdsFromTargets(targets), ...(await discoverExtensionIds(args.profile))];
	const unique = [...new Set(candidates)];
	if (unique.length === 0) {
		throw new Error(`no AdGuard VPN extension found (CDP port ${port}, profile ${args.profile})`);
	}

	const { extensionId, proxyConfig } = await readExtensionProxyConfig(port, unique);
	const next = buildMediaProxy(proxyConfig, args.keepHost ? existing : null);
	const hostChanged = existing !== null && existing.url !== next.url;
	const changed = existing === null || !sameMediaProxy(existing, next);

	if (args.check) {
		const summary: SyncSummary = {
			status: changed ? "needs-update" : "unchanged",
			target,
			source: extensionId,
			host: maskHost(next.url),
			scheme: new URL(next.url).protocol.replace(":", ""),
			port: Number(new URL(next.url).port || 443),
			usernameFingerprint: fingerprint(next.username),
			passwordFingerprint: fingerprint(next.password),
			previousPasswordFingerprint: existing ? fingerprint(existing.password) : null,
			hostChanged,
			verifyStatus: null,
			verifyError: null,
		};
		return { summary, output: formatSummary(summary) };
	}

	if (changed) {
		await writeMediaProxy(target, serializeMediaProxy(next));
	}

	let verifyStatus: number | null = null;
	let verifyError: string | null = null;
	if (args.verify) {
		const result = await verifyProxy(next);
		verifyStatus = result.status;
		verifyError = result.error;
	}

	const summary: SyncSummary = {
		status: changed ? "synced" : "unchanged",
		target,
		source: extensionId,
		host: maskHost(next.url),
		scheme: new URL(next.url).protocol.replace(":", ""),
		port: Number(new URL(next.url).port || 443),
		usernameFingerprint: fingerprint(next.username),
		passwordFingerprint: fingerprint(next.password),
		previousPasswordFingerprint: existing ? fingerprint(existing.password) : null,
		hostChanged,
		verifyStatus,
		verifyError,
	};
	return { summary, output: formatSummary(summary) };
}

export function formatSummary(summary: SyncSummary): string {
	const lines = [`media-proxy ${summary.status}: ${summary.target}`];
	lines.push(`  source: extension ${summary.source}`);
	lines.push(`  proxy:  ${summary.host} (${summary.scheme})`);
	lines.push(
		`  user:   sha256:${summary.usernameFingerprint}`,
		`  pass:   sha256:${summary.passwordFingerprint}${
			summary.previousPasswordFingerprint ? ` (was sha256:${summary.previousPasswordFingerprint})` : ""
		}`,
	);
	if (summary.hostChanged) {
		lines.push("  warn:   proxy host changed; signed CDN URLs are ASN-bound, expect 403 if the exit ASN moved");
	}
	if (summary.verifyError) lines.push(`  verify: failed (${summary.verifyError})`);
	else if (summary.verifyStatus !== null) lines.push(`  verify: HTTP ${summary.verifyStatus} via proxy`);
	return lines.join("\n");
}

if (import.meta.main) {
	try {
		const argv = process.argv.slice(2);
		const { summary, output } = await run(argv);
		const quiet = argv.includes("--quiet");
		if (!(quiet && summary.status === "unchanged")) {
			console.log(argv.includes("--json") ? JSON.stringify(summary, null, 2) : output);
		}
		if (summary.verifyError) process.exit(1);
		if (summary.verifyStatus !== null && summary.verifyStatus !== 200) process.exit(1);
	} catch (error) {
		if (error instanceof UsageError) {
			console.log(usage());
			process.exit(0);
		}
		console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
