import { homedir } from "node:os";
import { resolve } from "node:path";

/** Theme store root (`styles.json`, `themes/`). Override with `DESIGN_THEMES`. */
export const DEFAULT_DESIGN_STORE = resolve(
	homedir(),
	".local/share/scripts/dev/design",
);

export function designStore() {
	const fromEnv = process.env.DESIGN_THEMES?.trim();
	if (fromEnv) return resolve(fromEnv);
	return DEFAULT_DESIGN_STORE;
}

export function themeLayoutPath(slug: string, root = designStore()) {
	return resolve(root, "themes", slug, "layout.css");
}

/** Durable live-site analysis. Keyed by hostname, not theme slug. */
export function designRefRoot(root = designStore()) {
	return resolve(root, "ref");
}

export function hostKey(raw: string) {
	const value = raw.trim();
	if (!value) throw new Error("empty host");
	const url = value.includes("://")
		? new URL(value)
		: new URL(`https://${value}`);
	return url.hostname.replace(/^www\./i, "");
}

export function refDirForHost(host: string, root = designStore()) {
	return resolve(designRefRoot(root), hostKey(host));
}
