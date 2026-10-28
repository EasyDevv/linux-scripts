import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// An agent or service shell lacks the session variables; the systemd user manager keeps them.
let sessionEnvCache: Record<string, string> | undefined;
function sessionEnv(key: string): string {
	if (process.env[key]) return process.env[key] ?? "";
	sessionEnvCache ??= Object.fromEntries(
		new TextDecoder()
			.decode(
				Bun.spawnSync({
					cmd: ["systemctl", "--user", "show-environment"],
					stdin: "ignore",
					stdout: "pipe",
					stderr: "ignore",
				}).stdout,
			)
			.split("\n")
			.filter((line) => line.includes("="))
			.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
	);
	return sessionEnvCache[key] ?? "";
}

/** KWin scripting over D-Bus: only on a KDE Wayland session with gdbus. */
export function canUseKWin() {
	if (sessionEnv("XDG_SESSION_TYPE") !== "wayland") return false;
	const desktop =
		`${sessionEnv("XDG_CURRENT_DESKTOP")} ${sessionEnv("DESKTOP_SESSION")}`.toLowerCase();
	if (!desktop.includes("kde") && !desktop.includes("plasma")) return false;
	return Boolean(Bun.which("gdbus"));
}

export function callKWinDbus(objectPath: string, method: string, args: string[] = []) {
	const proc = Bun.spawnSync({
		cmd: [
			"gdbus",
			"call",
			"--session",
			"--dest",
			"org.kde.KWin",
			"--object-path",
			objectPath,
			"--method",
			method,
			...args,
		],
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = new TextDecoder().decode(proc.stdout).trim();
	const stderr = new TextDecoder().decode(proc.stderr).trim();
	if (proc.exitCode !== 0) {
		throw new Error(stderr || stdout || `${method} failed`);
	}
	return stdout;
}

export function kwinClassLiteral(className: string): string {
	return JSON.stringify(className);
}

/**
 * `Scripting.start` runs the script at once. A script that unloads itself is
 * gone before any follow-up D-Bus call, so nothing here waits for its object.
 */
export async function loadKWinScript(
	scriptSource: string,
	pluginName: string,
	persistDir?: string,
): Promise<{ scriptId: number; scriptDir: string }> {
	const scriptDir = persistDir ?? (await mkdtemp(join(tmpdir(), "browser-kwin-")));
	await mkdir(scriptDir, { recursive: true });
	const scriptPath = join(scriptDir, persistDir ? `${pluginName}.js` : "script.js");
	await Bun.write(scriptPath, scriptSource);
	try {
		const loadOutput = callKWinDbus(
			"/Scripting",
			"org.kde.kwin.Scripting.loadScript",
			[scriptPath, pluginName],
		);
		const match = /\(\s*(-?\d+)/.exec(loadOutput);
		if (!match || Number(match[1]) < 0) {
			throw new Error(`Unexpected loadScript output: ${loadOutput}`);
		}
		callKWinDbus("/Scripting", "org.kde.kwin.Scripting.start");
		return { scriptId: Number(match[1]), scriptDir };
	} catch (error) {
		try {
			callKWinDbus("/Scripting", "org.kde.kwin.Scripting.unloadScript", [
				pluginName,
			]);
		} catch {
			// Best-effort cleanup only.
		}
		await removeScriptFiles(scriptDir, pluginName, persistDir !== undefined);
		throw error;
	}
}

async function removeScriptFiles(scriptDir: string, pluginName: string, persisted: boolean) {
	if (persisted) {
		await rm(join(scriptDir, `${pluginName}.js`), { force: true }).catch(() => undefined);
		return;
	}
	await rm(scriptDir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Unload by plugin name only. KWin numbers a script by how many are loaded, so an
 * id can be reused while a longer-lived script (the window guard) still holds it:
 * `Script<id>.run/stop` may reach the wrong script. Nothing here addresses a script by id.
 */
export async function unloadKWinScript(pluginName: string, scriptDir: string) {
	try {
		callKWinDbus("/Scripting", "org.kde.kwin.Scripting.unloadScript", [
			pluginName,
		]);
	} catch {
		// Best-effort cleanup only.
	}
	await rm(scriptDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function waitUntilKWinScriptUnloaded(pluginName: string, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const loaded = callKWinDbus(
			"/Scripting",
			"org.kde.kwin.Scripting.isScriptLoaded",
			[pluginName],
		);
		if (loaded.includes("false")) return true;
		await Bun.sleep(50);
	}
	return false;
}

// The window guard keeps an agent's Chromium window out of the user's way while CDP
// keeps working. Two modes, both held by one persistent KWin script per window class:
//  - "background" (default): the window stays on the screen but below every other
//    window, hidden from the taskbar and switcher, and focus goes back to the user's
//    window when a click activates it. Chromium keeps painting, so navigation,
//    emulation and screenshots work. It shows only where nothing covers it.
//  - "minimize": the window is minimized and restored windows are minimized again.
//    KWin sends no frames to a minimized window, so anything that needs a new frame
//    (navigate then capture, resize emulation) can hang.
const GUARD_DIR = join(homedir(), ".cache", "browser", "state", "kwin-guard");

export type GuardMode = "minimize" | "background";

export function guardPluginName(className: string): string {
	return `browser-guard-${className}`;
}

const legacyPluginName = (className: string) => `browser-keepmin-${className}`;

export function keepMinimizedScriptSource(className: string): string {
	return `const cls = ${kwinClassLiteral(className)};
function keep(window) {
	if (!window || !window.normalWindow) return;
	if (String(window.resourceClass) !== cls) return;
	if (!window.minimized) window.minimized = true;
	window.minimizedChanged.connect(function () {
		if (!window.minimized) window.minimized = true;
	});
}
workspace.windowAdded.connect(keep);
for (const window of workspace.stackingOrder) keep(window);
`;
}

export function backgroundScriptSource(className: string): string {
	return `const cls = ${kwinClassLiteral(className)};
let prev = null;
let busy = false;
function mine(w) {
	return w && w.normalWindow && String(w.resourceClass) === cls;
}
function sink(w) {
	w.keepBelow = true;
	w.skipTaskbar = true;
	w.skipSwitcher = true;
	w.skipPager = true;
}
function hook(w) {
	if (!mine(w)) return;
	sink(w);
	w.keepBelowChanged.connect(function () {
		if (!w.keepBelow) sink(w);
	});
}
workspace.windowAdded.connect(hook);
workspace.windowActivated.connect(function (w) {
	if (!w || busy) return;
	if (String(w.resourceClass) === cls) {
		if (prev && prev !== w && !prev.minimized) {
			busy = true;
			workspace.activeWindow = prev;
			busy = false;
		}
	} else {
		prev = w;
	}
});
workspace.windowRemoved.connect(function (w) {
	if (w === prev) prev = null;
});
for (const w of workspace.stackingOrder) hook(w);
if (workspace.activeWindow && String(workspace.activeWindow.resourceClass) !== cls) {
	prev = workspace.activeWindow;
}
`;
}

/** Hold the class's windows out of the way until released. */
export async function engageWindowGuard(
	className: string,
	mode: GuardMode = "minimize",
): Promise<boolean> {
	if (!canUseKWin()) return false;
	await releaseWindowGuard(className);
	try {
		await loadKWinScript(
			mode === "background"
				? backgroundScriptSource(className)
				: keepMinimizedScriptSource(className),
			guardPluginName(className),
			GUARD_DIR,
		);
		return true;
	} catch (error) {
		console.warn(
			`[open] KWin window guard unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/** Unload the guard (a no-op when none is loaded); it does not change the window's flags. */
export async function releaseWindowGuard(className: string): Promise<void> {
	if (!canUseKWin()) return;
	for (const name of [guardPluginName(className), legacyPluginName(className)]) {
		try {
			callKWinDbus("/Scripting", "org.kde.kwin.Scripting.unloadScript", [name]);
		} catch {
			// KWin may be gone; there is nothing left to release.
		}
		await rm(join(GUARD_DIR, `${name}.js`), { force: true }).catch(() => undefined);
	}
}

export function unparkScriptSource(className: string, pluginName: string, focus: boolean): string {
	return `const cls = ${kwinClassLiteral(className)};
const edge = workspace.virtualScreenGeometry.x + workspace.virtualScreenGeometry.width;
for (const w of workspace.stackingOrder) {
	if (!w.normalWindow || String(w.resourceClass) !== cls) continue;
	w.keepBelow = false;
	w.skipTaskbar = false;
	w.skipSwitcher = false;
	w.skipPager = false;
	if (w.frameGeometry.x >= edge) {
		const area = workspace.clientArea(KWin.PlacementArea, workspace.activeScreen, workspace.currentDesktop);
		const g = w.frameGeometry;
		w.frameGeometry = {
			x: area.x + Math.round((area.width - g.width) / 2),
			y: area.y + Math.round((area.height - g.height) / 2),
			width: g.width,
			height: g.height,
		};
	}
	if (w.minimized) w.minimized = false;
	${focus ? "workspace.activeWindow = w;" : ""}
}
callDBus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", ${JSON.stringify(pluginName)});
`;
}

/**
 * Take the window out of "below, hidden" mode (and back onto the screen if an older
 * guard had moved it off). Run after `releaseWindowGuard`, or the guard sinks it again.
 */
export async function unparkWindows(className: string, focus = false): Promise<void> {
	if (!canUseKWin()) return;
	const pluginName = `browser-unpark-${className}-${Date.now()}`;
	try {
		const loaded = await loadKWinScript(
			unparkScriptSource(className, pluginName, focus),
			pluginName,
		);
		if (!(await waitUntilKWinScriptUnloaded(pluginName, 2000))) {
			await unloadKWinScript(pluginName, loaded.scriptDir);
		} else {
			await rm(loaded.scriptDir, { recursive: true, force: true }).catch(() => undefined);
		}
	} catch (error) {
		console.warn(
			`[show] KWin unpark unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
