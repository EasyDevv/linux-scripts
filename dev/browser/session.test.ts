import { expect, test } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	FETCH_PORT_BASE,
	FETCH_PORT_SPAN,
	blocksToMarkdown,
	decodeResponseBody,
	deheadlessUserAgent,
	fetchPortsIncludeReserved,
	formatAssets,
	formatEvalValue,
	formatLinks,
	mergeSessionCookies,
	netIdleDone,
	netIdleReady,
	netIdleStart,
	parseFetchArgs,
} from "./fetch.ts";
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

test("parseFetchArgs defaults, scheme, and stealth no-ops", () => {
	const opts = parseFetchArgs(["example.com", "--stealth", "--no-stealth"]);
	expect(opts.url).toBe("https://example.com");
	expect(opts.dump).toBe("text");
	expect(opts.waitS).toBe(2);
	expect(opts.waitUntil).toBe("load");
	expect(opts.timeoutS).toBe(30);
	expect(opts.eval).toBeUndefined();
	expect(opts.verbose).toBe(false);
});

test("parseFetchArgs keeps the flags callers pass", () => {
	const opts = parseFetchArgs([
		"http://127.0.0.1:3000",
		"--eval",
		"1",
		"--dump",
		"links",
		"--selector",
		"h1",
		"--wait",
		"0",
		"--wait-until",
		"networkidle0",
		"--timeout",
		"10",
		"--proxy",
		"socks5://127.0.0.1:1080",
		"--output",
		"out.txt",
		"--session",
		"9222",
		"--user-agent",
		"ua",
		"--verbose",
	]);
	expect(opts).toMatchObject({
		url: "http://127.0.0.1:3000",
		eval: "1",
		dump: "links",
		selector: "h1",
		waitS: 0,
		waitUntil: "networkidle0",
		timeoutS: 10,
		proxy: "socks5://127.0.0.1:1080",
		output: "out.txt",
		session: "9222",
		userAgent: "ua",
		verbose: true,
	});
});

test("parseFetchArgs rejects unknown dump, unknown flag, and a missing url", () => {
	expect(() => parseFetchArgs(["--dump", "pdf", "https://a.com"])).toThrow(/dump/i);
	expect(() => parseFetchArgs(["https://a.com", "--nope"])).toThrow(/Unknown option/);
	expect(() => parseFetchArgs([])).toThrow(/url/i);
});

test("formatLinks dedupes and keeps the first text", () => {
	expect(
		formatLinks([
			{ url: "https://a.com", text: "" },
			{ url: "https://a.com", text: "A" },
			{ url: "https://b.com/x", text: "go" },
			{ url: "https://b.com/x", text: "other" },
		]),
	).toBe("https://a.com\tA\nhttps://b.com/x\tgo");
});

test("blocksToMarkdown covers headings, lists, code, tables, and images", () => {
	const md = blocksToMarkdown([
		{ t: "h", level: 2, inlines: [{ t: "text", s: "Title" }] },
		{
			t: "p",
			inlines: [
				{ t: "text", s: "See " },
				{ t: "link", href: "https://a.com", s: "A" },
				{ t: "text", s: " and " },
				{ t: "code", s: "x" },
			],
		},
		{ t: "ul", items: [[{ t: "text", s: "one" }], [{ t: "text", s: "two" }]] },
		{ t: "pre", s: "code\n" },
		{ t: "table", rows: [["a", "b"], ["1", "2"]] },
		{ t: "img", alt: "pic", src: "https://a.com/i.png" },
	]);
	expect(md).toContain("## Title");
	expect(md).toContain("[A](https://a.com)");
	expect(md).toContain("`x`");
	expect(md).toContain("- one");
	expect(md).toContain("```");
	expect(md).toContain("| a | b |");
	expect(md).toContain("| --- | --- |");
	expect(md).toContain("![pic](https://a.com/i.png)");
});

test("formatEvalValue prints strings raw and JSON otherwise", () => {
	expect(formatEvalValue("string", "hi")).toBe("hi");
	expect(formatEvalValue("number", 30)).toBe("30");
	expect(formatEvalValue("boolean", true)).toBe("true");
	expect(formatEvalValue("object", { a: 1 })).toBe('{"a":1}');
	expect(formatEvalValue("undefined", undefined)).toBe("null");
});

test("deheadlessUserAgent rewrites HeadlessChrome", () => {
	expect(deheadlessUserAgent("Mozilla HeadlessChrome/131.0 Safari")).toBe(
		"Mozilla Chrome/131.0 Safari",
	);
	expect(deheadlessUserAgent("Chrome/131")).toBe("Chrome/131");
});

test("formatAssets is deduped NDJSON with a lowercased type", () => {
	expect(
		formatAssets([
			{ url: "https://a.com/s.js", type: "Script" },
			{ url: "https://a.com/s.js", type: "Script" },
			{ url: "https://a.com/a.png", type: "Image" },
		]),
	).toBe('{"url":"https://a.com/s.js","type":"script"}\n{"url":"https://a.com/a.png","type":"image"}');
});

test("decodeResponseBody honors base64", () => {
	expect(new TextDecoder().decode(decodeResponseBody("aGk=", true))).toBe("hi");
	expect(new TextDecoder().decode(decodeResponseBody("hi", false))).toBe("hi");
});

test("fetch port window never includes 9201 or 9222", () => {
	expect(fetchPortsIncludeReserved()).toBe(false);
	expect(FETCH_PORT_BASE).toBeGreaterThan(9222);
	expect(FETCH_PORT_BASE + FETCH_PORT_SPAN - 1).toBeLessThan(39225);
});

test("networkidle0 is 500ms with nothing in flight", () => {
	let state = { inflight: 0, quietSince: null as number | null };
	state = netIdleStart(state);
	state = netIdleStart(state);
	state = netIdleDone(state, 1000);
	expect(netIdleReady(state, 1600)).toBe(false);
	state = netIdleDone(state, 1100);
	expect(state.quietSince).toBe(1100);
	expect(netIdleReady(state, 1599)).toBe(false);
	expect(netIdleReady(state, 1600)).toBe(true);
	state = netIdleStart(state);
	expect(netIdleReady(state, 2000)).toBe(false);
});

test("mergeSessionCookies keeps dropped cookies and applies updates", () => {
	const original = [
		{
			name: "a",
			value: "1",
			domain: ".a.com",
			path: "/",
			secure: true,
			httpOnly: true,
			sameSite: "Lax" as const,
			expires: 10,
		},
		{
			name: "b",
			value: "2",
			domain: ".b.com",
			path: "/",
			secure: false,
			httpOnly: false,
			sameSite: "Lax" as const,
			expires: null,
		},
	];
	const live = [
		{ ...original[1], value: "3" },
		{
			name: "c",
			value: "4",
			domain: ".c.com",
			path: "/",
			secure: false,
			httpOnly: false,
			sameSite: "None" as const,
			expires: 20,
		},
	];
	const merged = mergeSessionCookies(original, live);
	expect(merged.map((c) => [c.name, c.value])).toEqual([
		["a", "1"],
		["b", "3"],
		["c", "4"],
	]);
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
