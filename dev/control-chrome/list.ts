import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { Tab } from "./cdp.ts";
import { globalProfileDir } from "./chrome-instance.ts";

type CdpBrowser = {
	port: number;
	pid: number;
	userDataDir: string | null;
	profile: "default" | "project" | "other";
	tabs: Array<Pick<Tab, "title" | "url">>;
};

// Browser processes are found from /proc so service-run browsers (e.g. 9201) show up too.
async function findCdpBrowsers(): Promise<Omit<CdpBrowser, "tabs" | "profile">[]> {
	const found = new Map<number, Omit<CdpBrowser, "tabs" | "profile">>();
	for (const entry of await readdir("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		const pid = Number(entry);
		let cmdline: string;
		try {
			cmdline = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll(
				"\0",
				" ",
			);
		} catch {
			continue;
		}
		if (cmdline.includes("--type=")) continue;
		const port = Number(/--remote-debugging-port=(\d+)/.exec(cmdline)?.[1]);
		if (!port || found.has(port)) continue;
		const dir = /--user-data-dir=(\S+)/.exec(cmdline)?.[1] ?? null;
		let userDataDir: string | null = null;
		if (dir) {
			try {
				userDataDir = resolve(await readlinkCwd(pid), dir);
			} catch {
				userDataDir = dir;
			}
		}
		found.set(port, { port, pid, userDataDir });
	}
	return [...found.values()].sort((a, b) => a.port - b.port);
}

async function readlinkCwd(pid: number): Promise<string> {
	const { readlink } = await import("node:fs/promises");
	return await readlink(`/proc/${pid}/cwd`);
}

function classify(browser: { port: number; userDataDir: string | null }) {
	if (!browser.userDataDir) return "other" as const;
	if (browser.userDataDir === globalProfileDir(browser.port))
		return "default" as const;
	return "project" as const;
}

function tilde(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export async function main(argv: string[]): Promise<void> {
	const json = argv.includes("--json");
	const browsers: CdpBrowser[] = [];

	for (const base of await findCdpBrowsers()) {
		let tabs: CdpBrowser["tabs"] = [];
		try {
			const all = (await (
				await fetch(`http://127.0.0.1:${base.port}/json/list`)
			).json()) as Tab[];
			tabs = all
				.filter((t) => t.type === "page")
				.map(({ title, url }) => ({ title, url }));
		} catch {
			// Not reachable yet (still starting): keep the row with no tabs.
		}
		browsers.push({ ...base, profile: classify(base), tabs });
	}

	if (json) {
		console.log(JSON.stringify(browsers, null, 2));
		return;
	}
	if (!browsers.length) {
		console.log("no CDP browsers");
		return;
	}
	for (const b of browsers) {
		const first = b.tabs[0];
		const label = first ? first.title || first.url : "(no tabs)";
		const extra = b.tabs.length > 1 ? ` +${b.tabs.length - 1} tabs` : "";
		const profile =
			b.profile === "default"
				? "default profile"
				: b.userDataDir
					? tilde(b.userDataDir)
					: "unknown profile";
		console.log(`:${b.port} · ${profile} · ${label}${extra}`);
	}
}
