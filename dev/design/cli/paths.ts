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
