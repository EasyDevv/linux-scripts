import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildMediaProxy,
	discoverExtensionIds,
	extractStashSettings,
	fingerprint,
	formatSummary,
	maskHost,
	parseArgs,
	parseMediaProxy,
	portFromCdpUrl,
	proxyUrlWithAuth,
	sameMediaProxy,
	serializeMediaProxy,
	writeMediaProxy,
	type SyncSummary,
} from "./sync-media-proxy";

const CONFIG = {
	url: "https://dtpt-jp-nrt-01-aaaaaaaa.adguard.io:443",
	username: "646b723f-fdaf-47f7-80a2-7d0812b0049d",
	password: "0123456789abcdef",
};

describe("parseArgs", () => {
	test("defaults", () => {
		const args = parseArgs([]);
		expect(args.cdpPort).toBeNull();
		expect(args.target).toBeNull();
		expect(args.check).toBe(false);
		expect(args.keepHost).toBe(false);
	});

	test("expands home and reads values", () => {
		const args = parseArgs(["--target", "~/x.json", "--cdp-port", "12345", "--check"]);
		expect(args.target?.endsWith("/x.json")).toBe(true);
		expect(args.target?.startsWith("~")).toBe(false);
		expect(args.cdpPort).toBe(12345);
		expect(args.check).toBe(true);
	});

	test("rejects unknown flags and missing values", () => {
		expect(() => parseArgs(["--nope"])).toThrow("unknown option");
		expect(() => parseArgs(["--target"])).toThrow("missing value");
		expect(() => parseArgs(["--target", "--check"])).toThrow("missing value");
	});
});

describe("extractStashSettings", () => {
	test("reads only the fields the script needs", () => {
		const settings = extractStashSettings({
			download: { media_proxy_file: "/p.json", media_proxy_referer_hosts: ["recordplay.biz", "playrecord.biz"] },
			browser_hls: { worker_cdp_url: "http://127.0.0.1:12345" },
			other: { ignored: true },
		});
		expect(settings.mediaProxyFile).toBe("/p.json");
		expect(settings.workerCdpUrl).toBe("http://127.0.0.1:12345");
		expect(settings.mediaProxyRefererHosts).toEqual(["recordplay.biz", "playrecord.biz"]);
	});

	test("tolerates a missing or malformed config", () => {
		expect(extractStashSettings(null).mediaProxyFile).toBeNull();
		expect(extractStashSettings({ download: "nope" }).workerCdpUrl).toBeNull();
	});
});

describe("portFromCdpUrl", () => {
	test("parses ports", () => {
		expect(portFromCdpUrl("http://127.0.0.1:12345")).toBe(12345);
		expect(portFromCdpUrl("http://127.0.0.1")).toBeNull();
		expect(portFromCdpUrl("not a url")).toBeNull();
		expect(portFromCdpUrl(null)).toBeNull();
	});
});

describe("buildMediaProxy", () => {
	test("uses the extension host, scheme and port", () => {
		const config = buildMediaProxy({
			host: "dtpt-jp-nrt-01-aaaaaaaa.adguard.io",
			port: 443,
			scheme: "https",
			credentials: { username: "u", password: "p" },
		});
		expect(config).toEqual({ url: "https://dtpt-jp-nrt-01-aaaaaaaa.adguard.io:443", username: "u", password: "p" });
	});

	test("keepHost pins the existing endpoint", () => {
		const config = buildMediaProxy(
			{ host: "other.example.com", port: 8443, scheme: "https", credentials: { username: "u", password: "p" } },
			CONFIG,
		);
		expect(config.url).toBe(CONFIG.url);
	});

	test("rejects unusable extension state", () => {
		expect(() => buildMediaProxy(null)).toThrow("missing");
		expect(() => buildMediaProxy({ host: "h", port: 443, scheme: "https" })).toThrow("no credentials");
		expect(() => buildMediaProxy({ host: "h", port: 443, scheme: "https", credentials: { username: "", password: "" } })).toThrow(
			"empty",
		);
		expect(() => buildMediaProxy({ host: "", port: 443, scheme: "https", credentials: { username: "u", password: "p" } })).toThrow(
			"no host",
		);
		expect(() =>
			buildMediaProxy({ host: "h", port: 443, scheme: "socks5", credentials: { username: "u", password: "p" } }),
		).toThrow("unsupported proxy scheme");
	});
});

describe("media proxy file round trip", () => {
	test("parse, compare and serialize", () => {
		const text = serializeMediaProxy(CONFIG);
		expect(text.endsWith("\n")).toBe(true);
		const parsed = parseMediaProxy(text);
		expect(parsed).not.toBeNull();
		expect(sameMediaProxy(parsed!, CONFIG)).toBe(true);
		expect(sameMediaProxy(parsed!, { ...CONFIG, password: "x" })).toBe(false);
		expect(parseMediaProxy("{}")).toBeNull();
		expect(parseMediaProxy("not json")).toBeNull();
	});
});

describe("fingerprint and masking", () => {
	test("fingerprint is stable and short", () => {
		expect(fingerprint("abc")).toBe(fingerprint("abc"));
		expect(fingerprint("abc")).toHaveLength(12);
		expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
	});

	test("maskHost hides the per-account token", () => {
		expect(maskHost(CONFIG.url)).toBe("dtpt-jp-nrt-01-…");
		expect(maskHost("https://proxy.example.com:443")).toBe("proxy.example.com");
		expect(maskHost("nope")).toBe("<invalid url>");
	});

	test("summary never contains the raw credentials", () => {
		const summary: SyncSummary = {
			status: "synced",
			target: "/tmp/media-proxy.json",
			source: "hhdobjgopfphlmjbmnpglhfcgppchgje",
			host: maskHost(CONFIG.url),
			scheme: "https",
			port: 443,
			usernameFingerprint: fingerprint(CONFIG.username),
			passwordFingerprint: fingerprint(CONFIG.password),
			previousPasswordFingerprint: fingerprint("old-secret"),
			hostChanged: false,
			verifyStatus: 200,
			verifyError: null,
		};
		const output = formatSummary(summary);
		expect(output).toContain("media-proxy synced");
		expect(output).toContain("verify: HTTP 200");
		expect(output).not.toContain(CONFIG.password);
		expect(output).not.toContain(CONFIG.username);
		expect(output).not.toContain("old-secret");
	});
});

describe("proxyUrlWithAuth", () => {
	test("embeds credentials without leaking them into the file", () => {
		// https:// URLs normalize the default port away; that is still the same endpoint.
		expect(proxyUrlWithAuth(CONFIG)).toBe(
			"https://646b723f-fdaf-47f7-80a2-7d0812b0049d:0123456789abcdef@dtpt-jp-nrt-01-aaaaaaaa.adguard.io",
		);
		expect(proxyUrlWithAuth({ ...CONFIG, url: "https://p.example.com:8443" })).toBe(
			"https://646b723f-fdaf-47f7-80a2-7d0812b0049d:0123456789abcdef@p.example.com:8443",
		);
	});
});

describe("writeMediaProxy", () => {
	test("writes owner-only and replaces atomically", async () => {
		const dir = await mkdtemp(join(tmpdir(), "sync-media-proxy-"));
		const path = join(dir, "media-proxy.json");
		await writeFile(path, "old", { mode: 0o644 });
		await writeMediaProxy(path, serializeMediaProxy(CONFIG));
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(parseMediaProxy(await readFile(path, "utf8"))).toEqual(CONFIG);
		const leftovers = (await Array.fromAsync(new Bun.Glob("*.tmp-*").scan({ cwd: dir }))).length;
		expect(leftovers).toBe(0);
	});

	test("refuses a missing directory", async () => {
		await expect(writeMediaProxy("/nonexistent-dir-xyz/media-proxy.json", "{}")).rejects.toThrow("directory does not exist");
	});
});

describe("discoverExtensionIds", () => {
	test("resolves __MSG_name__ from _locales", async () => {
		const root = await mkdtemp(join(tmpdir(), "profile-"));
		const id = "hhdobjgopfphlmjbmnpglhfcgppchgje";
		const dir = join(root, "Default", "Extensions", id, "2.11.1_0");
		await mkdir(join(dir, "_locales", "en"), { recursive: true });
		await writeFile(join(dir, "manifest.json"), JSON.stringify({ name: "__MSG_name__", default_locale: "en" }));
		await writeFile(join(dir, "_locales", "en", "messages.json"), JSON.stringify({ name: { message: "AdGuard VPN: free & secure proxy" } }));
		expect(await discoverExtensionIds(root)).toEqual([id]);
	});

	test("ignores unrelated extensions", async () => {
		const root = await mkdtemp(join(tmpdir(), "profile-"));
		const dir = join(root, "Default", "Extensions", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1.0.0");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "manifest.json"), JSON.stringify({ name: "Something else" }));
		expect(await discoverExtensionIds(root)).toEqual([]);
	});
});
