import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `~/.local/share/browser/profiles.json` keeps what a disposable global profile
 * must get back: unpacked extension dirs, keyed by profile name.
 *   { "9222": { "extensions": ["/abs/path/to/unpacked"] } }
 */
export type ProfileConfig = { extensions?: string[] };

export function profilesConfigPath(): string {
	return (
		process.env.BROWSER_PROFILES_FILE ??
		join(homedir(), ".local", "share", "browser", "profiles.json")
	);
}

export async function readProfileConfig(name: string): Promise<ProfileConfig> {
	const file = Bun.file(profilesConfigPath());
	if (!(await file.exists())) return {};
	const all = (await file.json()) as Record<string, ProfileConfig>;
	return all[name] ?? {};
}

/** Merge extension dirs into one `--load-extension` value (Chromium takes a comma list). */
export function mergeExtensionDirs(...groups: Array<string | string[] | undefined>) {
	const dirs = groups
		.flatMap((g) => (g === undefined ? [] : Array.isArray(g) ? g : g.split(",")))
		.map((d) => d.trim())
		.filter(Boolean);
	return dirs.length ? [...new Set(dirs)].join(",") : undefined;
}
