import { expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFetchArgs, isPrivateUrl } from "./fetch.ts";
import { detectLogin, isLoginUrl } from "./login.ts";
import { mergeExtensionDirs } from "./profiles.ts";
import {
	type CdpCookie,
	baseDomain,
	fromCdpCookie,
	readSession,
	sessionCookiesPath,
	summarizeCookies,
	writeSession,
} from "./session.ts";

const now = 1_800_000_000;
const cookie = (over: Partial<CdpCookie>): CdpCookie => ({
	name: "x",
	value: "1",
	domain: ".example.com",
	path: "/",
	expires: now + 86_400,
	httpOnly: false,
	secure: true,
	...over,
});

test("baseDomain keeps country second-level domains", () => {
	expect(baseDomain(".www.example.com")).toBe("example.com");
	expect(baseDomain("shop.naver.co.kr")).toBe("naver.co.kr");
	expect(baseDomain("127.0.0.1")).toBe("127.0.0.1");
	expect(baseDomain("localhost")).toBe("localhost");
});

test("fromCdpCookie maps session cookies to expires null", () => {
	expect(fromCdpCookie(cookie({ expires: -1, session: true })).expires).toBeNull();
	expect(fromCdpCookie(cookie({ sameSite: undefined })).sameSite).toBe("Lax");
});

test("detectLogin ignores baseline, short-lived, and other-site cookies", () => {
	const baseline = [cookie({ name: "__cf_bm", httpOnly: true })];
	expect(detectLogin(baseline, baseline, "www.example.com", now)).toBeNull();
	const shortLived = cookie({ name: "csrf", httpOnly: true, expires: now + 60 });
	const other = cookie({ name: "sid", domain: ".other.com" });
	expect(detectLogin(baseline, [...baseline, shortLived, other], "example.com", now)).toBeNull();
	const tracker = cookie({ name: "_ga" });
	expect(detectLogin(baseline, [...baseline, tracker], "example.com", now)).toBeNull();
});

test("detectLogin fires on a new httpOnly or auth-named cookie", () => {
	const hit = cookie({ name: "li_at", httpOnly: true });
	expect(detectLogin([], [hit], "www.example.com", now)?.name).toBe("li_at");
	const named = cookie({ name: "session_token" });
	expect(detectLogin([], [named], "example.com", now)?.name).toBe("session_token");
	const rotated = cookie({ name: "token_v2", value: "anon", httpOnly: true });
	expect(detectLogin([rotated], [{ ...rotated, value: "anon2" }], "reddit.com", now)).toBeNull();
});

test("writeSession is private and summaries carry no values", async () => {
	process.env.BROWSER_SESSIONS_DIR = await mkdtemp(join(tmpdir(), "browser-sessions-"));
	const cookies = [fromCdpCookie(cookie({ value: "SECRET" }))];
	await writeSession("t1", cookies);
	expect((await stat(sessionCookiesPath("t1"))).mode & 0o777).toBe(0o600);
	expect((await readSession("t1"))?.[0].value).toBe("SECRET");
	expect(JSON.stringify(summarizeCookies(cookies, "example.com"))).not.toContain("SECRET");
	delete process.env.BROWSER_SESSIONS_DIR;
});

test("fetch args: stealth, quiet text dump, private network for local hosts", () => {
	const args = buildFetchArgs({ url: "http://127.0.0.1:3000", pass: [], stealth: true, verbose: false });
	expect(args).toEqual([
		"fetch",
		"http://127.0.0.1:3000",
		"--dump",
		"text",
		"--stealth",
		"--allow-private-network",
		"--quiet",
	]);
	expect(
		buildFetchArgs({ url: "https://a.com", pass: ["--eval", "1"], stealth: false, storageDir: "/s", verbose: true }),
	).toEqual(["fetch", "https://a.com", "--eval", "1", "--storage-dir", "/s"]);
	expect(isPrivateUrl("http://dashboard.localhost")).toBe(true);
	expect(isPrivateUrl("https://172.32.0.1")).toBe(false);
});

test("mergeExtensionDirs dedupes comma lists", () => {
	expect(mergeExtensionDirs("/a,/b", ["/b", "/c"], undefined)).toBe("/a,/b,/c");
	expect(mergeExtensionDirs(undefined, [])).toBeUndefined();
});

test("detectLogin ignores challenge bookkeeping (reddit session_tracker)", () => {
	const tracker = cookie({ name: "session_tracker", session: true, expires: -1 });
	const csrf = cookie({ name: "csrf_token", session: true, expires: -1, httpOnly: true });
	expect(detectLogin([], [tracker, csrf], "www.reddit.com", now)).toBeNull();
	const real = cookie({ name: "reddit_session", httpOnly: true, domain: ".reddit.com" });
	expect(detectLogin([], [tracker, real], "www.reddit.com", now)?.name).toBe("reddit_session");
});

test("isLoginUrl spots sign-in and challenge pages", () => {
	expect(isLoginUrl("https://www.reddit.com/login/?js_challenge=1")).toBe(true);
	expect(isLoginUrl("https://github.com/session")).toBe(false);
	expect(isLoginUrl("https://accounts.example.com/signin/v2")).toBe(true);
	expect(isLoginUrl("https://www.reddit.com/")).toBe(false);
});
