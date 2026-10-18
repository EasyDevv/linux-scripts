/**
 * pi-ai credential store backed by pi's `auth.json`.
 *
 * The daemon is the only process that holds provider keys for routing: pi extensions and
 * Claude Code hooks send state, never keys. The file is re-read when its mtime changes, so a
 * `/login` in pi reaches the daemon without a restart. `opencode` (Zen: Jev, System One)
 * accepts the same key as `opencode-go`, so it borrows that entry when it has none of its own.
 *
 * Some providers take their key from the environment (`ENV_KEYS`). A systemd user unit does not
 * inherit the login shell's variables, so the key is also read from the shell's env file — only
 * that one `NAME=value` line, never the rest of the file. Env wins over the file, the file over
 * `auth.json`.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

export const DEFAULT_AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

/** Provider id → provider whose stored key it may use. */
export const KEY_ALIASES: Readonly<Record<string, string>> = { opencode: "opencode-go" };

/** Provider id → environment variable holding its API key. */
export const ENV_KEYS: Readonly<Record<string, string>> = { openrouter: "OPENROUTER_API_KEY" };

/** fish loads this `NAME=value` file into every interactive shell (`config.fish`). */
export const DEFAULT_ENV_FILE = join(homedir(), ".config", "fish", ".env");

/** The value of one `NAME=value` line; quotes around the value are dropped. */
export function envFileValue(text: string, name: string): string | undefined {
	for (const line of text.split("\n")) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match || match[1] !== name) continue;
		const value = match[2]?.replace(/^(['"])(.*)\1$/, "$2");
		return value ? value : undefined;
	}
	return undefined;
}

type AuthFile = Record<string, Credential>;

export class PiAuthStore implements CredentialStore {
	private cache: AuthFile = {};
	private mtimeMs = -1;

	constructor(
		private readonly path = DEFAULT_AUTH_PATH,
		private readonly aliases: Readonly<Record<string, string>> = KEY_ALIASES,
		private readonly envFile = DEFAULT_ENV_FILE,
		private readonly env: Readonly<Record<string, string | undefined>> = process.env,
	) {}

	private envKey(providerId: string): { key: string; origin: string } | undefined {
		const name = ENV_KEYS[providerId];
		if (!name) return undefined;
		const fromEnv = this.env[name];
		if (fromEnv) return { key: fromEnv, origin: `env:${name}` };
		try {
			const fromFile = existsSync(this.envFile) ? envFileValue(readFileSync(this.envFile, "utf8"), name) : undefined;
			return fromFile ? { key: fromFile, origin: `${this.envFile}:${name}` } : undefined;
		} catch {
			return undefined;
		}
	}

	private load(): AuthFile {
		try {
			const mtimeMs = statSync(this.path).mtimeMs;
			if (mtimeMs !== this.mtimeMs) {
				const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
				this.cache = parsed && typeof parsed === "object" ? (parsed as AuthFile) : {};
				this.mtimeMs = mtimeMs;
			}
		} catch {
			this.cache = {};
			this.mtimeMs = -1;
		}
		return this.cache;
	}

	/** Where a provider's key comes from, for `/health`; never the key itself. */
	origin(providerId: string): string | undefined {
		const env = this.envKey(providerId);
		if (env) return env.origin;
		const file = this.load();
		if (file[providerId]) return `auth.json:${providerId}`;
		const alias = this.aliases[providerId];
		if (alias && file[alias]) return `auth.json:${alias}`;
		return undefined;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		const env = this.envKey(providerId);
		if (env) return { type: "api_key", key: env.key } as Credential;
		const file = this.load();
		const alias = this.aliases[providerId];
		return file[providerId] ?? (alias ? file[alias] : undefined);
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return Object.entries(this.load()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	// Read-only: pi owns auth.json. API-key providers never write back.
	async modify(providerId: string): Promise<Credential | undefined> {
		return this.read(providerId);
	}

	async delete(): Promise<void> {}
}
