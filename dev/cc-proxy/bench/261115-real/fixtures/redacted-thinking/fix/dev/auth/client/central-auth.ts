/**
 * Reader for the central credential file the Go `auth` tool owns (see `../CONTRACTS.md`).
 *
 * Reading is plain file I/O (mtime-cached, no lock: the tool replaces the file atomically).
 * Writing never happens here. An expired OAuth token is renewed by running `auth refresh`,
 * which takes the file lock, so a rotated refresh token is spent once however many processes ask.
 * Standard library only; cc-proxy and the decision daemon both import this file.
 */
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Credential =
	| { type: "api_key"; key?: string; env?: Record<string, string> }
	| { type: "oauth"; access: string; refresh: string; expires: number; [extra: string]: unknown };

export type CredentialInfo = { providerId: string; type: Credential["type"] };

const FORMAT_VERSION = 1;

type Options = {
	/** Credential file. Default: `$AUTH_FILE`, else `~/.config/auth/credentials.json`. */
	path?: string;
	/** The `auth` binary used to refresh. Default: `$AUTH_BIN`, else `dev/auth/bin/auth`. */
	bin?: string;
	now?: () => number;
};

export function defaultAuthPath(env: NodeJS.ProcessEnv = process.env): string {
	if (env.AUTH_FILE) return env.AUTH_FILE;
	return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "auth", "credentials.json");
}

export function defaultAuthBin(env: NodeJS.ProcessEnv = process.env): string {
	return env.AUTH_BIN || join(homedir(), ".local", "share", "scripts", "dev", "auth", "bin", "auth");
}

export class CentralAuth {
	private readonly path: string;
	private readonly bin: string;
	private readonly now: () => number;
	private cache: { mtimeMs: number; data: Record<string, Credential> } | null = null;
	private readonly refreshing = new Map<string, Promise<Credential | undefined>>();
	/** Why the last read failed, for status output. */
	lastError: string | undefined;

	constructor(options: Options = {}) {
		this.path = options.path ?? defaultAuthPath();
		this.bin = options.bin ?? defaultAuthBin();
		this.now = options.now ?? Date.now;
	}

	/** Where the file is, for `/health`-style output (never the secrets). */
	get file(): string {
		return this.path;
	}

	/**
	 * The stored credentials. A missing file is empty. An unreadable one keeps the last good
	 * view, so a bad read never signs everything out.
	 */
	private load(): Record<string, Credential> {
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
			const doc = JSON.parse(readFileSync(this.path, "utf8")) as { version?: number; credentials?: Record<string, Credential> };
			if (doc.version !== FORMAT_VERSION) throw new Error(`format version ${String(doc.version)}, expected ${FORMAT_VERSION}`);
			this.cache = { mtimeMs, data: doc.credentials ?? {} };
			this.lastError = undefined;
			return this.cache.data;
		} catch (cause) {
			this.lastError = `${this.path}: ${cause instanceof Error ? cause.message : String(cause)}`;
			return this.cache?.data ?? {};
		}
	}

	list(): CredentialInfo[] {
		return Object.entries(this.load()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	/** The stored credential as is, possibly an expired OAuth one. Display and status use. */
	peek(providerId: string): Credential | undefined {
		return this.load()[providerId];
	}

	has(providerId: string): boolean {
		return this.peek(providerId) !== undefined;
	}

	/** A credential that can be used now; an expired OAuth token is refreshed first. */
	async get(providerId: string): Promise<Credential | undefined> {
		const stored = this.peek(providerId);
		if (!stored || stored.type !== "oauth" || stored.expires > this.now()) return stored;
		let pending = this.refreshing.get(providerId);
		if (!pending) {
			pending = this.refresh(providerId).finally(() => this.refreshing.delete(providerId));
			this.refreshing.set(providerId, pending);
		}
		return pending;
	}

	private async refresh(providerId: string): Promise<Credential | undefined> {
		await new Promise<void>((resolve, reject) => {
			execFile(this.bin, ["refresh", providerId], { timeout: 30_000, env: { ...process.env, AUTH_FILE: this.path } }, (error, _stdout, stderr) => {
				if (!error) return resolve();
				const detail = stderr.trim() || error.message;
				reject(new Error(/ENOENT/.test(error.message) ? `auth binary not found at ${this.bin}; run dev/auth.sh` : detail));
			});
		});
		const fresh = this.peek(providerId);
		if (fresh?.type === "oauth" && fresh.expires <= this.now()) throw new Error(`${providerId}: token still expired after refresh`);
		return fresh;
	}
}
