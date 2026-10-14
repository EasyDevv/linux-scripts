import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Every CDP window is identified by its port alone, whichever profile dir it uses:
// Wayland app_id, taskbar title (start page), and browser theme color all derive from it.

export function portClass(port: number): string {
	return `cdp-${port}`;
}

// Integer golden-angle spread so neighbouring ports get distinct hues; shared with bash callers.
export function portHue(port: number): number {
	return Math.floor((port * 137508) / 1000) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [
		number,
		number,
		number,
	];
}

/** Chromium stores theme seed colors as signed 32-bit ARGB. */
export function portThemeColor(port: number): number {
	const [r, g, b] = hslToRgb(portHue(port), 0.75, 0.5);
	return ((0xff << 24) | (r << 16) | (g << 8) | b) | 0;
}

export function portStartPageUrl(port: number): string {
	const html =
		`<!doctype html><meta charset="utf-8"><title>CDP ${port}</title>` +
		`<style>body{margin:0;height:100vh;display:grid;place-items:center;` +
		`background:hsl(${portHue(port)} 55% 22%);color:#fff;font:700 22vmin system-ui}</style>${port}`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export async function applyPortTheme(
	profileDir: string,
	port: number,
): Promise<void> {
	const defaultDir = join(profileDir, "Default");
	const file = join(defaultDir, "Preferences");
	await mkdir(defaultDir, { recursive: true });

	let prefs: Record<string, any> = {};
	try {
		prefs = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
	}

	const theme = ((prefs.browser ??= {}).theme ??= {});
	theme.user_color2 = portThemeColor(port);
	theme.color_variant2 = 3; // vibrant
	theme.color_scheme2 = 2; // dark
	// Without this Chromium on Linux keeps the system (KDE/GTK) theme and ignores the seed color.
	((prefs.extensions ??= {}).theme ??= {}).system_theme = 0;

	await writeFile(file, JSON.stringify(prefs), "utf8");
}
