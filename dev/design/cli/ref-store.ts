import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { designRefRoot, hostKey, refDirForHost } from "./paths.ts";

export const VIEWPORTS = {
	desktop: { id: "desktop", width: 1440, height: 900, mobile: false },
	tablet: { id: "tablet", width: 768, height: 1024, mobile: false },
	mobile: { id: "mobile", width: 390, height: 844, mobile: true },
} as const;

export type ViewportId = keyof typeof VIEWPORTS;

export type RefPage = {
	id: string;
	url: string;
};

export type RefViewport = {
	id: string;
	width: number;
	height: number;
	mobile: boolean;
};

export type RefFile = {
	page: string;
	viewport: string;
	url: string;
	file: string;
};

export type RefSnapshot = {
	page: string;
	url: string;
	file: string;
	format: "mhtml";
};

export type RefIndex = {
	capturedAt?: string;
	scheme?: string;
	pages: RefPage[];
	viewports: RefViewport[];
	files: RefFile[];
	snapshots?: RefSnapshot[];
};

export function parseTarget(raw: string): { host: string; url?: URL } {
	const value = raw.trim();
	if (!value) throw new Error("empty url");
	if (value.includes("://") || value.includes("/")) {
		const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
		return { host: hostKey(url.href), url };
	}
	return { host: hostKey(value) };
}

export async function listRefHosts(root?: string) {
	const dir = designRefRoot(root);
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return [];
	}
}

export async function loadRefIndex(host: string, root?: string): Promise<{
	dir: string;
	indexPath: string;
	index: RefIndex | null;
}> {
	const dir = refDirForHost(host, root);
	const indexPath = join(dir, "index.json");
	try {
		const raw = await readFile(indexPath, "utf8");
		return { dir, indexPath, index: JSON.parse(raw) as RefIndex };
	} catch {
		return { dir, indexPath, index: null };
	}
}

export function matchPage(index: RefIndex, url: URL): RefPage | null {
	const targetPath = url.pathname.replace(/\/$/, "") || "/";
	const targetHash = url.hash;
	let best: { page: RefPage; score: number } | null = null;
	for (const page of index.pages) {
		const candidate = new URL(page.url);
		if (candidate.hostname.replace(/^www\./i, "") !== url.hostname.replace(/^www\./i, "")) {
			continue;
		}
		const path = candidate.pathname.replace(/\/$/, "") || "/";
		if (targetPath !== path && !targetPath.startsWith(`${path}/`)) continue;
		let score = path.length;
		if (targetHash && candidate.hash === targetHash) score += 1000;
		if (!best || score > best.score) best = { page, score };
	}
	return best?.page ?? null;
}

export function relativize(dir: string, file: string) {
	if (!file.startsWith("/")) return file;
	return relative(dir, file) || file;
}

export async function fileExists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export function snapshotPath(dir: string, pageId: string) {
	return resolve(dir, "pages", `${pageId}.mhtml`);
}

export function pngPath(dir: string, viewport: string, pageId: string) {
	return resolve(dir, viewport, `${pageId}.png`);
}
