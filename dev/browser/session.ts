import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { CDP, getBrowserWsUrl } from "./cdp.ts";

/**
 * A session is `cookies.json` used by `fetch --session` and `open --session`:
 * `<root>/<name>/cookies.json`.
 * Chromium profiles are disposable caches; this file is what survives.
 * Cookie values never reach stdout — callers print names, domains, counts.
 */
export type StoredCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite: "Strict" | "Lax" | "None";
	expires: number | null;
};

export type CdpCookie = {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	session?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
};

export function sessionRoot(): string {
	return (
		process.env.BROWSER_SESSIONS_DIR ??
		join(homedir(), ".local", "share", "browser", "sessions")
	);
}

export function sessionDir(name: string): string {
	if (!/^[\w.@-]+$/.test(name)) throw new Error(`Invalid session name: ${name}`);
	return join(sessionRoot(), name);
}

export function sessionCookiesPath(name: string): string {
	return join(sessionDir(name), "cookies.json");
}

/** Global Chromium profiles (`~/.cache/browser/profiles/<name>`) own a session of the same name. */
export function globalProfileRoot(): string {
	return join(homedir(), ".cache", "browser", "profiles");
}

export function sessionNameForProfile(userDataDir: string): string | null {
	return dirname(userDataDir) === globalProfileRoot()
		? basename(userDataDir)
		: null;
}

export function fromCdpCookie(c: CdpCookie): StoredCookie {
	return {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path || "/",
		secure: c.secure,
		httpOnly: c.httpOnly,
		sameSite: c.sameSite ?? "Lax",
		expires: c.session || c.expires < 0 ? null : Math.floor(c.expires),
	};
}

export function toCdpCookieParam(c: StoredCookie): Record<string, unknown> {
	const param: Record<string, unknown> = {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		secure: c.secure,
		httpOnly: c.httpOnly,
		sameSite: c.sameSite,
	};
	if (c.expires !== null) param.expires = c.expires;
	return param;
}

export async function readSession(name: string): Promise<StoredCookie[] | null> {
	const file = Bun.file(sessionCookiesPath(name));
	if (!(await file.exists())) return null;
	return (await file.json()) as StoredCookie[];
}

export async function writeSession(
	name: string,
	cookies: StoredCookie[],
): Promise<string> {
	const dir = sessionDir(name);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700);
	const path = sessionCookiesPath(name);
	const tmp = `${path}.tmp`;
	await Bun.write(tmp, `${JSON.stringify(cookies, null, 2)}\n`);
	await chmod(tmp, 0o600);
	await rename(tmp, path);
	return path;
}

export async function removeSession(name: string): Promise<boolean> {
	const dir = sessionDir(name);
	const exists = await stat(dir).then(
		() => true,
		() => false,
	);
	if (exists) await rm(dir, { recursive: true, force: true });
	return exists;
}

export async function listSessions(): Promise<
	Array<{ name: string; cookies: number; domains: number; updated: Date }>
> {
	const names = await readdir(sessionRoot()).catch(() => [] as string[]);
	const rows: Array<{ name: string; cookies: number; domains: number; updated: Date }> = [];
	for (const name of names.sort()) {
		const cookies = await readSession(name).catch(() => null);
		if (!cookies) continue;
		const updated = (await stat(sessionCookiesPath(name))).mtime;
		rows.push({
			name,
			cookies: cookies.length,
			domains: new Set(cookies.map((c) => baseDomain(c.domain))).size,
			updated,
		});
	}
	return rows;
}

/** Last two labels of a cookie domain (`.www.example.com` → `example.com`). */
export function baseDomain(domain: string): string {
	const host = domain.replace(/^\./, "").toLowerCase();
	const labels = host.split(".");
	if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) return host;
	// co.kr, com.au, …: keep three labels when the second-level label is short.
	const tail = labels.slice(-2);
	return tail[0].length <= 3 && labels.length >= 3
		? labels.slice(-3).join(".")
		: tail.join(".");
}

export function cookieMatchesHost(cookie: { domain: string }, host: string) {
	return baseDomain(cookie.domain) === baseDomain(host);
}

/** One line per site: `example.com 5`. Never prints values. */
export function summarizeCookies(cookies: StoredCookie[], host?: string) {
	const counts = new Map<string, number>();
	for (const c of cookies) {
		const d = baseDomain(c.domain);
		counts.set(d, (counts.get(d) ?? 0) + 1);
	}
	const site = host ? (counts.get(baseDomain(host)) ?? 0) : undefined;
	return { total: cookies.length, sites: counts.size, site };
}

async function withBrowser<T>(port: number, fn: (cdp: CDP) => Promise<T>) {
	const wsUrl = await getBrowserWsUrl(port);
	if (!wsUrl) throw new Error(`No Chromium on port ${port}`);
	const cdp = await CDP.connect(wsUrl);
	try {
		return await fn(cdp);
	} finally {
		cdp.close();
	}
}

export async function readBrowserCookies(port: number): Promise<CdpCookie[]> {
	return await withBrowser(port, async (cdp) => {
		const { cookies } = await cdp.send<{ cookies: CdpCookie[] }>(
			"Storage.getCookies",
		);
		return cookies;
	});
}

export async function injectBrowserCookies(
	port: number,
	cookies: StoredCookie[],
): Promise<void> {
	if (!cookies.length) return;
	await withBrowser(port, async (cdp) => {
		await cdp.send("Storage.setCookies", {
			cookies: cookies.map(toCdpCookieParam),
		});
	});
}

export async function saveSessionFromPort(port: number, name: string) {
	const cookies = (await readBrowserCookies(port)).map(fromCdpCookie);
	const path = await writeSession(name, cookies);
	return { path, cookies };
}
