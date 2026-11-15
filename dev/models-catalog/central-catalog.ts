/**
 * Reader for the central model catalog the dashboard server owns (`~/.config/models/catalog.json`).
 *
 * Shape of pi's `models-store.json`: `{ "<provider>": { "models": [...], "checkedAt": <ms> } }`.
 * The dashboard server seeds it once from pi's store and refreshes the providers with a public
 * list (OpenRouter, OpenCode, OpenCode Go); nothing here writes. Reading is plain file I/O,
 * mtime-cached; a bad read keeps the last good view, a missing file is empty. Standard library
 * only: the decision daemon and cc-proxy both import this file.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CatalogModel = { id: string; type?: string; provider?: string; [field: string]: unknown };
type Store = Record<string, { models?: CatalogModel[] } | undefined>;

export function defaultCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
	const config = env.XDG_CONFIG_HOME?.startsWith("/") ? env.XDG_CONFIG_HOME : join(homedir(), ".config");
	return join(config, "models", "catalog.json");
}

export class CentralCatalog {
	private cache: { mtimeMs: number; data: Store } | null = null;
	/** Why the last read failed, for status output. */
	lastError: string | undefined;

	constructor(private readonly path: string = defaultCatalogPath()) {}

	get file(): string {
		return this.path;
	}

	private load(): Store {
		let mtimeMs: number;
		try {
			mtimeMs = statSync(this.path).mtimeMs;
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
				this.lastError = undefined;
				this.cache = null;
				return {};
			}
			this.lastError = String(cause);
			return this.cache?.data ?? {};
		}
		if (this.cache?.mtimeMs === mtimeMs) return this.cache.data;
		try {
			const data = JSON.parse(readFileSync(this.path, "utf8")) as Store;
			if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("not an object");
			this.cache = { mtimeMs, data };
			this.lastError = undefined;
			return data;
		} catch (cause) {
			this.lastError = String(cause);
			return this.cache?.data ?? {};
		}
	}

	/** A provider's models; `type` narrows (a record with no `type` counts as `chat`). */
	models(provider: string, type?: string): CatalogModel[] {
		const all = this.load()[provider]?.models ?? [];
		return type ? all.filter((model) => (model.type ?? "chat") === type) : all;
	}

	model(provider: string, id: string, type?: string): CatalogModel | undefined {
		return this.models(provider, type).find((model) => model.id === id);
	}

	/** Seconds since the provider's list was last fetched, or undefined when it never was. */
	ageSec(provider: string, now = Date.now()): number | undefined {
		const checked = (this.load()[provider] as { checkedAt?: number } | undefined)?.checkedAt;
		return typeof checked === "number" ? Math.round((now - checked) / 1000) : undefined;
	}
}
