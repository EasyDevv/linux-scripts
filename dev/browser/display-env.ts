/**
 * A non-headless Chromium needs a display, and a process started outside a
 * desktop session (systemd unit, agent shell, ssh) has none. The systemd user
 * manager still holds the session's display variables, so they are borrowed
 * from `systemctl --user show-environment` before giving up.
 */

export const NO_DISPLAY_MESSAGE =
	"no display (WAYLAND_DISPLAY/DISPLAY unset) — pass --headless or run from a desktop session";

const DISPLAY_KEYS = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY"] as const;

export function hasDisplay(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.WAYLAND_DISPLAY || env.DISPLAY);
}

/**
 * `KEY=value` lines of `systemctl --user show-environment`, narrowed to the
 * display variables `has()` says the process lacks.
 */
export function missingDisplayEnv(
	shown: string,
	has: (key: string) => boolean,
): Record<string, string> {
	const missing: Record<string, string> = {};
	for (const line of shown.split("\n")) {
		const at = line.indexOf("=");
		if (at < 0) continue;
		const key = line.slice(0, at);
		const value = line.slice(at + 1);
		if (!DISPLAY_KEYS.includes(key as (typeof DISPLAY_KEYS)[number])) continue;
		if (!value || has(key)) continue;
		missing[key] = value;
	}
	return missing;
}

async function systemdUserEnvironment(): Promise<string> {
	const proc = Bun.spawnSync({
		cmd: ["systemctl", "--user", "show-environment"],
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	return new TextDecoder().decode(proc.stdout);
}

export type DisplayLaunchEnv = {
	/** Variables to add on top of the inherited environment. */
	env: Record<string, string>;
	/** True once the process environment or the user manager offers a display. */
	display: boolean;
};

/** The display variables a launch inherits; a no-op when the process has them. */
export async function displayLaunchEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<DisplayLaunchEnv> {
	if (hasDisplay(env)) return { env: {}, display: true };
	const shown = await systemdUserEnvironment().catch(() => "");
	const fromSystemd = missingDisplayEnv(shown, (key) => Boolean(env[key]));
	return {
		env: fromSystemd,
		display: hasDisplay({ ...env, ...fromSystemd }),
	};
}
