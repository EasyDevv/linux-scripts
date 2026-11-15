/**
 * pi-ai credential store backed by the central `auth` store (`dev/auth`).
 *
 * The daemon is the only process that holds provider keys for routing: pi extensions and
 * Claude Code hooks send state, never keys. The file is re-read when its mtime changes, so an
 * `auth login` / `auth set` reaches the daemon without a restart. It is independent of pi's own
 * `auth.json`. `opencode` (Zen: Jev, System One) accepts the same key as `opencode-go`, so it
 * borrows that entry when it has none of its own.
 *
 * Read-only here: the Go `auth` tool owns writes and OAuth refresh (`auth refresh`).
 */

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { CentralAuth } from "../auth/client/central-auth.ts";

/** Provider id → provider whose stored key it may use. */
export const KEY_ALIASES: Readonly<Record<string, string>> = { opencode: "opencode-go" };

export class CentralAuthStore implements CredentialStore {
	constructor(
		private readonly central = new CentralAuth(),
		private readonly aliases: Readonly<Record<string, string>> = KEY_ALIASES,
	) {}

	/** The stored entry that serves `providerId`: its own, else its alias's. */
	private entryId(providerId: string): string | undefined {
		if (this.central.has(providerId)) return providerId;
		const alias = this.aliases[providerId];
		return alias && this.central.has(alias) ? alias : undefined;
	}

	/** Where a provider's key comes from, for `/health`; never the key itself. */
	origin(providerId: string): string | undefined {
		const id = this.entryId(providerId);
		return id ? `auth:${id}` : undefined;
	}

	/** Why the credential file could not be read, for `/health`. */
	get problem(): string | undefined {
		return this.central.lastError;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		const id = this.entryId(providerId);
		return id ? ((await this.central.get(id)) as Credential | undefined) : undefined;
	}

	async list(): Promise<readonly CredentialInfo[]> {
		return this.central.list();
	}

	// Read-only: the `auth` tool owns writes. An expired OAuth token is refreshed through it.
	async modify(providerId: string): Promise<Credential | undefined> {
		return this.read(providerId);
	}

	async delete(): Promise<void> {}
}
