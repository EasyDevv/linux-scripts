import { printHelp } from "./ui.ts";
import { closeSync, existsSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	clearPortLock,
	claimPortLock,
	defaultLockOwner,
	findAvailablePort,
	refreshPortLock,
	resolvePortState,
	writePortLock,
} from "./browser-state.ts";
import { BROWSER_DEFAULTS, buildChromeLaunchArgs } from "./config.ts";
import {
	DEFAULT_LOCALE,
	localeLaunchArgs,
	localeSpawnEnv,
	primeChromiumProfile,
	resolveLocale,
} from "./locale.ts";
import {
	callKWinDbus,
	canUseKWin,
	engageWindowGuard,
	kwinClassLiteral,
	loadKWinScript,
	releaseWindowGuard,
	unloadKWinScript,
	unparkWindows,
	waitUntilKWinScriptUnloaded,
} from "./kwin.ts";
import { minimizeWindow } from "./minimize.ts";
import { applyPortTheme, portClass, portStartPageUrl } from "./port-identity.ts";
import {
	type LaunchInfo,
	clearLaunchInfo,
	processExists,
	processMatchesLaunchInfo,
	readLaunchInfo,
	isDefaultProfilePort,
	resolveDefaultProfileDir,
	terminateProcess,
	writeLaunchInfo,
	resolveBinary,
} from "./chrome-instance.ts";
import { type CDP, resetTabs, waitForChrome } from "./cdp.ts";
import { startRecording } from "./browser-record.ts";
import { NO_DISPLAY_MESSAGE, displayLaunchEnv } from "./display-env.ts";
import { mergeExtensionDirs, readProfileConfig } from "./profiles.ts";
import {
	injectBrowserCookies,
	readSession,
	sessionNameForProfile,
} from "./session.ts";

export type OpenOptions = {
	port: number;
	url: string;
	urlExplicit: boolean;
	userDataDir?: string;
	clean: boolean;
	session?: string;
	binary?: string;
	headless: boolean;
	status: boolean;
	minimize: boolean;
	/** Below every other window, hidden from the taskbar (the default), instead of minimized. */
	park: boolean;
	flash: boolean;
	dryRun: boolean;
	json: boolean;
	loadExtension?: string;
	android: boolean;
	record: boolean;
	recordFrames: number | null;
	browserArgs: string[];
	locale: string;
};

type OpenPlan = {
	requestedPort: number;
	actualPort: number;
	browserAction: "launch-new-browser" | "attach-existing-browser";
	portNote: string;
	lockStatus: "none" | "active" | "stale-cleared";
};

type KWinStartupMinimizeHandle = {
	dispose: () => Promise<void>;
};

const HELP = `browser open — launch Chromium with a CDP port, or attach to a running one

Usage
  browser open [options]

Options
  --port <N>               CDP port (default: 9222)
  --url <url>              first tab; bare hosts get http:// (default: the "CDP <port>" page)
  --user-data <dir>        profile dir (default: global for 9222, else ./.user-data/chrome-{name})
  --clean                  throwaway profile, removed on close
  --session <name>         inject a saved session's cookies after launch
  --load-extension <dir>   load an unpacked extension (comma list ok)
  --android                emulate an Android phone (UA, touch, 412x915)
  --record [N]             record N frames after focus; omit N to record until close
  --background             the default: below all your windows, hidden from the taskbar and
                           alt-tab; CDP and screenshots work, a click never takes your focus
  --minimize               minimized instead (KWin sends it no frames, so navigate-then-capture can hang)
  --normal                 a normal visible window (for a human to look at or sign in)
  --flash                  with --minimize: flash the taskbar entry for 5s (off by default)
  --headless               no window
  --locale <bcp47>         UI and Accept-Language (default: ${DEFAULT_LOCALE})
  --browser-arg <arg>      extra Chromium flag (repeatable)
  --binary <path>          Chromium binary
  --status                 show the resolved port and lock, launch nothing
  --dry-run                print the command, launch nothing
  --json                   JSON output

Examples
  browser open --port 9222 --url http://localhost:5180
  browser open --port 9223 --clean --session 9222    # parallel worker
  browser open --port 39225 --load-extension .output/chrome-mv3-dev
  browser open --port 9224 --android --record 10 --url https://example.com
  browser close --port 9224                         # also stops its recording

Environment
  BROWSER_CHROMIUM_BIN     browser binary (default: chromium)
  BROWSER_LOCALE           locale when --locale is not passed

Notes
  Without a display (WAYLAND_DISPLAY/DISPLAY both unset) a non-headless launch
  takes them from systemctl --user show-environment, and fails if that has none.
  Recorded frames: ~/.cache/browser/state/captures/chrome-<port>-<time>/`;

const ANDROID_USER_AGENT =
	"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36";

const ANDROID_USER_AGENT_METADATA = {
	brands: [
		{ brand: "Google Chrome", version: "136" },
		{ brand: "Chromium", version: "136" },
	],
	fullVersionList: [
		{ brand: "Google Chrome", version: "136.0.0.0" },
		{ brand: "Chromium", version: "136.0.0.0" },
	],
	platform: "Android",
	platformVersion: "15",
	architecture: "arm",
	model: "Pixel 9",
	mobile: true,
	bitness: "64",
	wow64: false,
};

const ANDROID_DEVICE_METRICS = {
	width: 412,
	height: 915,
	deviceScaleFactor: 2.625,
	mobile: true,
};

/** Browser-level flags that make the whole instance present itself as a phone. */
export function androidLaunchArgs(android: boolean): string[] {
	return android
		? [`--user-agent=${ANDROID_USER_AGENT}`, "--touch-events=enabled"]
		: [];
}

function buildAndroidNavigatorOverrideScript() {
	const metadataJson = JSON.stringify(ANDROID_USER_AGENT_METADATA);

	return `(() => {
		const metadata = ${metadataJson};
		const defineGetter = (target, key, value) => {
			Object.defineProperty(target, key, {
				configurable: true,
				get: () => value,
			});
		};

		const userAgentData = {
			brands: metadata.brands,
			mobile: metadata.mobile,
			platform: metadata.platform,
			getHighEntropyValues: async (hints) => {
				const requested = Array.isArray(hints) ? hints : [];
				const values = {
					architecture: metadata.architecture,
					bitness: metadata.bitness,
					brands: metadata.brands,
					fullVersionList: metadata.fullVersionList,
					mobile: metadata.mobile,
					model: metadata.model,
					platform: metadata.platform,
					platformVersion: metadata.platformVersion,
					uaFullVersion: metadata.fullVersionList[0]?.version ?? "",
					wow64: metadata.wow64,
				};
				return Object.fromEntries(requested.map((hint) => [hint, values[hint]]));
			},
			toJSON: () => ({
				brands: metadata.brands,
				mobile: metadata.mobile,
				platform: metadata.platform,
			}),
		};

		defineGetter(Navigator.prototype, "platform", metadata.platform);
		defineGetter(Navigator.prototype, "maxTouchPoints", 5);
		defineGetter(Navigator.prototype, "userAgentData", userAgentData);
	})();`;
}

/** Applied on the focused tab, whether the browser was launched or attached to. */
export async function configureAndroidTab(cdp: CDP) {
	await cdp.send("Emulation.setDeviceMetricsOverride", ANDROID_DEVICE_METRICS);
	await cdp.send("Emulation.setTouchEmulationEnabled", {
		enabled: true,
		maxTouchPoints: 5,
	});
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source: buildAndroidNavigatorOverrideScript(),
	});
	await cdp.send("Emulation.setUserAgentOverride", {
		userAgent: ANDROID_USER_AGENT,
		acceptLanguage: "en-US,en",
		platform: "Android",
		userAgentMetadata: ANDROID_USER_AGENT_METADATA,
	});
}

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

export function parseArgs(argv: string[]): OpenOptions {
	const options: OpenOptions = {
		port: BROWSER_DEFAULTS.port,
		url: BROWSER_DEFAULTS.url,
		urlExplicit: false,
		headless: false,
		status: false,
		minimize: true,
		park: true,
		flash: false,
		dryRun: false,
		json: false,
		clean: false,
		android: false,
		record: false,
		recordFrames: null,
		browserArgs: [],
		locale: process.env.BROWSER_LOCALE?.trim() || DEFAULT_LOCALE,
	};

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				options.port = +(argv[++i] ?? die("Usage: --port <N>"));
				break;
			case "--url":
				options.url = argv[++i] ?? die("Usage: --url <url>");
				options.urlExplicit = true;
				break;
			case "--user-data":
				options.userDataDir = argv[++i] ?? die("Usage: --user-data <dir>");
				break;
			case "--clean":
				options.clean = true;
				break;
			case "--session":
				options.session = argv[++i] ?? die("Usage: --session <name>");
				break;
			case "--binary":
				options.binary = argv[++i] ?? die("Usage: --binary <path>");
				break;
			case "--headless":
				options.headless = true;
				break;
			case "--android":
				options.android = true;
				break;
			case "--record":
				options.record = true;
				if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
					const frames = +(argv[i + 1] ?? "");
					if (!Number.isInteger(frames) || frames <= 0)
						die("Usage: --record [N]");
					options.recordFrames = frames;
					i += 1;
				}
				break;
			case "--status":
				options.status = true;
				break;
			case "--load-extension":
				options.loadExtension =
					argv[++i] ?? die("Usage: --load-extension <dir>");
				break;
			case "--browser-arg":
				options.browserArgs.push(
					argv[++i] ?? die("Usage: --browser-arg <arg>"),
				);
				break;
			case "--locale":
				options.locale = argv[++i] ?? die("Usage: --locale <bcp47>");
				break;
			case "--minimize":
				options.minimize = true;
				options.park = false;
				break;
			case "--background":
				options.minimize = true;
				options.park = true;
				break;
			case "--normal":
			case "--no-minimize":
				options.minimize = false;
				options.park = false;
				break;
			case "--flash":
				options.flash = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
				printHelp(HELP);
				process.exit(0);
			default:
				die(`Unknown option: ${argv[i]}`);
		}
	}

	if (!Number.isInteger(options.port) || options.port <= 0)
		die("Port must be a positive integer");
	if (options.userDataDir && options.clean)
		die("--user-data and --clean are mutually exclusive");
	if (
		options.recordFrames !== null &&
		(!Number.isInteger(options.recordFrames) || options.recordFrames <= 0)
	)
		die("--record must use a positive integer when a frame count is provided");

	if (
		options.url &&
		!/^(https?|ftp|about|chrome|file|data|view-source):/i.test(options.url)
	) {
		if (options.url.startsWith("//")) {
			options.url = `http:${options.url}`;
		} else if (/^[\w.-]+/.test(options.url)) {
			options.url = `http://${options.url}`;
		}
	}

	return options;
}

function renderOutput(output: Record<string, unknown>, json = false) {
	if (json) {
		console.log(JSON.stringify(output, null, 2));
		return;
	}

	const status =
		typeof output.headline === "string"
			? output.headline
			: output.dryRun
				? "would prepare browser"
				: "browser ready";
	console.log(`✓ ${status}`);
	if (output.requestedPort)
		console.log(`  requested port: ${output.requestedPort}`);
	console.log(`  actual port: ${output.port}`);
	console.log(`  profile: ${output.userDataDir}`);
	console.log(`  focused url: ${output.url}`);
	if (output.browserAction)
		console.log(`  browser action: ${output.browserAction}`);
	if (output.tabAction) console.log(`  tab action: ${output.tabAction}`);
	if (output.lockStatus) console.log(`  lock status: ${output.lockStatus}`);
	if (output.portNote) console.log(`  note: ${output.portNote}`);
	if (output.binary) console.log(`  binary: ${output.binary}`);
	if (output.command) console.log(`  command: ${output.command}`);
	if (output.pid) console.log(`  pid: ${output.pid}`);
	if (output.replacedPid) console.log(`  replaced pid: ${output.replacedPid}`);
	if (output.windowState) console.log(`  window state: ${output.windowState}`);
	if (output.locale) console.log(`  locale: ${output.locale}`);
	if (output.acceptLanguage)
		console.log(`  accept-language: ${output.acceptLanguage}`);
	if (output.emulation) console.log(`  emulation: ${output.emulation}`);
	if (output.recordStatus) console.log(`  record: ${output.recordStatus}`);
	if (output.recordOutputDir)
		console.log(`  record output dir: ${output.recordOutputDir}`);
}

function describeRecord(options: OpenOptions): string {
	if (!options.record) return "off";
	return options.recordFrames === null
		? "will capture frames until stopped"
		: `will capture ${options.recordFrames} frame(s) after focus`;
}

// One-line result for agents: port, url, profile; extras only when non-default.
function renderOpenSummary(info: {
	port: number;
	requestedPort: number;
	url: string;
	userDataDir: string;
	defaultProfile: boolean;
	windowState: string;
	locale: string;
	emulation: string;
	record?: string;
}) {
	const parts = [
		`:${info.port}${info.port !== info.requestedPort ? ` (${info.requestedPort} busy)` : ""} ${info.url.startsWith("data:text/html") ? "start page" : info.url}`,
		info.defaultProfile ? "default profile" : `profile ${info.userDataDir}`,
	];
	parts.push(info.locale);
	if (info.emulation !== "desktop") parts.push(info.emulation);
	if (info.record) parts.push(`record ${info.record}`);
	if (info.windowState !== "normal") parts.push(info.windowState);
	console.log(`✓ ${parts.join(" · ")}`);
}

// Chromium's stderr is the only clue when it exits before opening its debugging
// port. A file, not a pipe: the detached browser outlives this process.
function chromeStderrLogPath(port: number): string {
	return join(tmpdir(), `browser-chrome-${port}.stderr.log`);
}

async function reportStderrTail(path: string, lines = 10) {
	const text = await Bun.file(path)
		.text()
		.catch(() => "");
	const tail = text
		.trimEnd()
		.split("\n")
		.filter((line) => line.trim());
	if (!tail.length) return;
	const shown = tail.slice(-lines);
	console.error(
		`Chromium stderr (last ${shown.length} lines, log: ${path}):`,
	);
	for (const line of shown) console.error(`  ${line}`);
}

const ATTENTION_MS = 5000;
const ATTENTION_SETTLE_MS = 500;

// KWin clears demandsAttention while the new window is still being activated, so
// a detached helper sets it once the window has settled, then clears it again.
function scheduleTaskbarFlash(pid: number) {
	const dir = mkdtempSync(join(tmpdir(), "browser-kwin-flash-"));
	const tag = `${pid}-${Date.now()}`;
	const scriptFor = (on: boolean) => {
		const name = `browser-attention-${on ? "on" : "off"}-${tag}`;
		const file = join(dir, `${on ? "on" : "off"}.js`);
		writeFileSync(
			file,
			`for (const w of workspace.stackingOrder) {
	if (w.pid === ${pid}) w.demandsAttention = ${on};
}
callDBus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", "${name}");
`,
		);
		return `run '${file}' '${name}'`;
	};
	const kwin = "gdbus call --session --dest org.kde.KWin --object-path";
	const shell = `run() { ${kwin} /Scripting --method org.kde.kwin.Scripting.loadScript "$1" "$2" >/dev/null; ${kwin} /Scripting --method org.kde.kwin.Scripting.start >/dev/null; }
sleep ${ATTENTION_SETTLE_MS / 1000}; ${scriptFor(true)}
sleep ${ATTENTION_MS / 1000}; ${scriptFor(false)}
sleep 1; rm -rf '${dir}'`;
	Bun.spawn({
		cmd: ["sh", "-c", shell],
		detached: true,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	}).unref();
}

/** Keep every matching window minimized at map time; do not unload on first match. */
async function installKWinStartupMinimize(
	className: string,
): Promise<KWinStartupMinimizeHandle | null> {
	if (!canUseKWin()) return null;

	const pluginName = `browser-start-minimize-${className}-${Date.now()}`;
	const cls = kwinClassLiteral(className);
	const scriptSource = `function maybeHandle(window) {
	if (!window || !window.normalWindow) return;
	if (String(window.resourceClass) !== ${cls}) return;
	window.minimized = true;
}
workspace.windowAdded.connect(maybeHandle);
for (const window of workspace.stackingOrder) maybeHandle(window);
`;

	try {
		const loaded = await loadKWinScript(scriptSource, pluginName);
		return {
			dispose: () =>
				unloadKWinScript(pluginName, loaded.scriptDir),
		};
	} catch (error) {
		console.warn(
			`[open] KWin startup minimize hook unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

async function kwinMinimizeByClass(className: string): Promise<boolean> {
	if (!canUseKWin()) return false;
	const pluginName = `browser-force-minimize-${className}-${Date.now()}`;
	const cls = kwinClassLiteral(className);
	const scriptSource = `for (const w of workspace.stackingOrder) {
	if (!w.normalWindow) continue;
	if (String(w.resourceClass) !== ${cls}) continue;
	w.minimized = true;
}
callDBus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", ${JSON.stringify(pluginName)});
`;
	try {
		const loaded = await loadKWinScript(scriptSource, pluginName);
		const finished = await waitUntilKWinScriptUnloaded(pluginName, 2000);
		if (!finished) {
			await unloadKWinScript(pluginName, loaded.scriptDir);
		} else {
			await rm(loaded.scriptDir, { recursive: true, force: true }).catch(
				() => undefined,
			);
		}
		return true;
	} catch (error) {
		console.warn(
			`[open] KWin minimize unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

async function kwinClassIsMinimized(className: string): Promise<boolean | null> {
	if (!canUseKWin()) return null;
	const tag = `KWINMIN$${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	const pluginName = `browser-min-read-${className}-${Date.now()}`;
	const cls = kwinClassLiteral(className);
	const scriptSource = `const cls = ${cls};
for (const w of workspace.stackingOrder) {
	if (!w.normalWindow) continue;
	if (String(w.resourceClass) !== cls) continue;
	print(${JSON.stringify(tag)} + " min=" + w.minimized + " active=" + w.active);
}
callDBus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", ${JSON.stringify(pluginName)});
`;
	try {
		const loaded = await loadKWinScript(scriptSource, pluginName);
		const finished = await waitUntilKWinScriptUnloaded(pluginName, 2000);
		if (!finished) {
			await unloadKWinScript(pluginName, loaded.scriptDir);
		} else {
			await rm(loaded.scriptDir, { recursive: true, force: true }).catch(
				() => undefined,
			);
		}
		await Bun.sleep(300);
		const log = Bun.spawnSync({
			cmd: [
				"journalctl",
				"--user",
				"--since",
				"15 seconds ago",
				"--no-pager",
			],
			stdout: "pipe",
			stderr: "pipe",
		});
		const text = new TextDecoder().decode(log.stdout);
		const lines = text.split("\n").filter((line) => line.includes(tag));
		if (!lines.length) return null;
		return lines.every(
			(line) => line.includes("min=true") && !line.includes("active=true"),
		);
	} catch {
		return null;
	}
}

async function buildOpenPlan(requestedPort: number): Promise<OpenPlan> {
	const requested = await resolvePortState(requestedPort);
	if (requested.lock) {
		const actualPort = await findAvailablePort(requestedPort + 1);
		return {
			requestedPort,
			actualPort,
			browserAction: "launch-new-browser",
			portNote: `Requested port ${requestedPort} is locked by another browser session, so Chrome will use ${actualPort}.`,
			lockStatus: requested.lockStatus,
		};
	}

	if (requested.browserReachable) {
		return {
			requestedPort,
			actualPort: requestedPort,
			browserAction: "attach-existing-browser",
			portNote: `Chrome is already reachable on port ${requestedPort}, so the existing browser will be reset and focused.`,
			lockStatus: requested.lockStatus,
		};
	}

	if (requested.portBindable) {
		return {
			requestedPort,
			actualPort: requestedPort,
			browserAction: "launch-new-browser",
			portNote: `Requested port ${requestedPort} is available for a fresh Chrome session.`,
			lockStatus: requested.lockStatus,
		};
	}

	const actualPort = await findAvailablePort(requestedPort + 1);
	return {
		requestedPort,
		actualPort,
		browserAction: "launch-new-browser",
		portNote: `Requested port ${requestedPort} is already used by another process, so Chrome will use ${actualPort}.`,
		lockStatus: requested.lockStatus,
	};
}

async function claimOpenLock(
	options: OpenOptions,
	plan: OpenPlan,
	userDataDir: string,
) {
	let actualPort = plan.actualPort;
	let browserAction = plan.browserAction;
	let portNote = plan.portNote;
	let claimedLock;

	while (!claimedLock) {
		const claim = await claimPortLock({
			port: actualPort,
			requestedPort: options.port,
			owner: defaultLockOwner(),
			userDataDir,
			url: options.url,
			browserSource:
				browserAction === "attach-existing-browser" ? "attached" : "launching",
			note: portNote,
		});

		if (claim.acquired) {
			claimedLock = claim.lock;
			break;
		}

		actualPort = await findAvailablePort(actualPort + 1);
		browserAction = "launch-new-browser";
		portNote = `Requested port ${options.port} became busy while opening, so Chrome will use ${actualPort}.`;
	}

	return { actualPort, browserAction, portNote, lock: claimedLock };
}

async function maybeResolveExistingLaunch(userDataDir: string, port: number) {
	const existing = await readLaunchInfo(userDataDir);
	if (!existing) return null;

	if (!existing.pid) return existing;
	if (!processExists(existing.pid)) {
		await clearLaunchInfo(userDataDir);
		return null;
	}

	const matches = await processMatchesLaunchInfo({
		pid: existing.pid,
		port,
		userDataDir,
	});
	if (matches === false) {
		await clearLaunchInfo(userDataDir);
		return null;
	}

	return existing;
}

export async function main(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	const plan = await buildOpenPlan(options.port);
	if (!options.urlExplicit) options.url = portStartPageUrl(plan.actualPort);

	// A non-headless Chromium needs a display. A shell started by a service has
	// none, but the systemd user manager still holds the session's variables.
	const displayEnv =
		process.platform === "linux" &&
		!options.headless &&
		plan.browserAction === "launch-new-browser"
			? await displayLaunchEnv()
			: undefined;
	if (displayEnv && !displayEnv.display) die(NO_DISPLAY_MESSAGE);

	let userDataDir: string;
	let usesDefaultProfile = false;
	if (options.userDataDir) {
		userDataDir = options.userDataDir;
	} else if (options.clean) {
		if (options.dryRun) {
			userDataDir = join(tmpdir(), "browser-clean-XXXXXX");
		} else {
			userDataDir = await mkdtemp(join(tmpdir(), "browser-clean-"));
		}
	} else {
		userDataDir = resolveDefaultProfileDir(plan.actualPort);
		usesDefaultProfile = isDefaultProfilePort(plan.actualPort);
	}

	// Global profiles are caches: restore unpacked extensions always, and the
	// saved session only into a profile dir that does not exist yet.
	const profileName = sessionNameForProfile(userDataDir);
	const freshProfile = !existsSync(userDataDir);
	if (profileName) {
		const { extensions } = await readProfileConfig(profileName);
		options.loadExtension = mergeExtensionDirs(options.loadExtension, extensions);
	}

	const statusOutput = {
		headline: "browser status",
		requestedPort: plan.requestedPort,
		port: plan.actualPort,
		userDataDir,
		url: options.url,
		browserAction: plan.browserAction,
		tabAction: "reset-all-tabs-and-focus-one-tab",
		lockStatus: plan.lockStatus,
		portNote: plan.portNote,
		windowState: options.headless
			? "headless"
			: options.park
				? "background"
				: options.minimize
					? "minimized"
				: "normal",
		emulation: options.android ? "android" : "desktop",
		recordStatus: describeRecord(options),
		dryRun: options.dryRun,
	};

	if (options.status || options.dryRun) {
		const binary =
			plan.browserAction === "launch-new-browser"
				? resolveBinary(options.binary)
				: "(existing browser)";

		const resolvedLocale = resolveLocale(options.locale);
		const extraArgs: string[] = [
			...localeLaunchArgs(resolvedLocale),
			...androidLaunchArgs(options.android),
			...options.browserArgs,
		];
		if (options.loadExtension) {
			extraArgs.push(`--load-extension=${options.loadExtension}`);
		}

		const previewCommand =
			binary === "(existing browser)"
				? undefined
				: [
						binary,
						...buildChromeLaunchArgs({
							port: plan.actualPort,
							userDataDir,
							url: options.url,
							headless: options.headless,
							startMinimized: options.minimize && !options.park,
							extraArgs,
						}),
					].join(" ");

		renderOutput(
			{
				...statusOutput,
				binary,
				command: previewCommand,
				locale: resolvedLocale.appLocale,
				acceptLanguage: resolvedLocale.acceptLanguages,
			},
			options.json,
		);
		return;
	}

	const binary =
		plan.browserAction === "launch-new-browser"
			? resolveBinary(options.binary)
			: undefined;

	const claimed = await claimOpenLock(options, plan, userDataDir);
	const actualPort = claimed.actualPort;
	if (!options.urlExplicit && actualPort !== plan.actualPort) {
		options.url = portStartPageUrl(actualPort);
	}

	if (!options.clean) {
		await mkdir(userDataDir, { recursive: true });
	}

	const resolvedLocale = resolveLocale(options.locale);
	await primeChromiumProfile(userDataDir, resolvedLocale, {
		force: options.clean,
	});

	if (claimed.browserAction === "launch-new-browser" && !options.headless) {
		await applyPortTheme(userDataDir, actualPort);
	}

	let replacedPid: number | undefined;
	let launchedPid: number | undefined;
	let focusedUrl = options.url;
	let outputBinary = binary ?? "(existing browser)";
	let kwinStartupMinimize: KWinStartupMinimizeHandle | null = null;
	let windowState = options.headless
		? "headless"
		: options.park
			? "background"
			: options.minimize
				? "minimized"
			: "normal";

	try {
		const className = portClass(actualPort);
		// Parking needs KWin; without it the window is minimized the old way.
		if (options.park && !options.headless) {
			options.park = await engageWindowGuard(className, "background");
		}

		const previousLaunch = await maybeResolveExistingLaunch(
			userDataDir,
			actualPort,
		);

		if (claimed.browserAction === "launch-new-browser") {
			if (previousLaunch?.pid) {
				await terminateProcess(previousLaunch.pid);
				replacedPid = previousLaunch.pid;
				await clearLaunchInfo(userDataDir);
			}

			const extraArgs: string[] = [
				...localeLaunchArgs(resolvedLocale),
				...androidLaunchArgs(options.android),
				...options.browserArgs,
			];
			if (options.loadExtension) {
				extraArgs.push(`--load-extension=${options.loadExtension}`);
			}

			const chromeArgs = buildChromeLaunchArgs({
				port: actualPort,
				userDataDir,
				url: options.url,
				headless: options.headless,
				startMinimized: options.minimize && !options.park,
				extraArgs,
			});

			const command = [binary!, ...chromeArgs];
			const stderrLog = chromeStderrLogPath(actualPort);
			const stderrFd = openSync(stderrLog, "w");
			if (!options.headless && options.minimize && !options.park) {
				kwinStartupMinimize = await installKWinStartupMinimize(className);
			}
			const proc = Bun.spawn({
				cmd: command,
				detached: true,
				stdin: "ignore",
				stdout: "ignore",
				stderr: stderrFd,
				env: {
					...process.env,
					...localeSpawnEnv(resolvedLocale),
					...(displayEnv?.env ?? {}),
				},
			});
			proc.unref();
			closeSync(stderrFd);
			launchedPid = proc.pid;
			outputBinary = binary!;

			await writeLaunchInfo({
				pid: proc.pid,
				port: actualPort,
				requestedPort: options.port,
				binary: binary!,
				url: options.url,
				userDataDir,
				command: command.join(" "),
				launchedAt: new Date().toISOString(),
				source: "launched",
				ephemeral: options.clean,
			});
			await refreshPortLock(actualPort, {
				browserPid: proc.pid,
				browserSource: "launched",
				userDataDir,
				url: options.url,
				note: claimed.portNote,
			});

			await waitForChrome(actualPort, 10_000, () =>
				reportStderrTail(stderrLog),
			);
			const inject = options.session ?? (freshProfile ? profileName : null);
			if (inject) {
				const saved = await readSession(inject).catch(() => null);
				if (saved) await injectBrowserCookies(actualPort, saved);
				else if (options.session) console.warn(`⚠ session ${inject} not found`);
			}
			const focused = await resetTabs(
				actualPort,
				options.url,
				options.android ? configureAndroidTab : undefined,
				{ activate: !options.minimize },
			);
			focusedUrl = focused.tab.url;

			await writeLaunchInfo({
				pid: proc.pid,
				port: actualPort,
				requestedPort: options.port,
				binary: binary!,
				url: focusedUrl,
				userDataDir,
				command: command.join(" "),
				launchedAt: new Date().toISOString(),
				source: "launched",
				ephemeral: options.clean,
			});
			await refreshPortLock(actualPort, {
				browserPid: proc.pid,
				browserSource: "launched",
				userDataDir,
				url: focusedUrl,
				note: claimed.portNote,
			});
		} else {
			await waitForChrome(actualPort);
			const focused = await resetTabs(
				actualPort,
				options.url,
				options.android ? configureAndroidTab : undefined,
				{ activate: !options.minimize },
			);
			focusedUrl = focused.tab.url;

			const managedPid = previousLaunch?.pid;
			outputBinary = previousLaunch?.binary ?? "(existing browser)";

			await writeLaunchInfo({
				pid: managedPid,
				port: actualPort,
				requestedPort: options.port,
				binary: outputBinary,
				url: focusedUrl,
				userDataDir,
				command: "attach-existing-browser",
				launchedAt: new Date().toISOString(),
				source: managedPid ? "launched" : "attached",
				ephemeral: previousLaunch?.ephemeral,
			});
			await refreshPortLock(actualPort, {
				browserPid: managedPid,
				browserSource: managedPid ? "launched" : "attached",
				userDataDir,
				url: focusedUrl,
				note: claimed.portNote,
			});
		}

		if (!options.headless && options.minimize && !options.park) {
			await kwinMinimizeByClass(className);
			let minimized = await minimizeWindow(actualPort, {
				timeoutMs: 5000,
				silent: true,
			});
			await kwinMinimizeByClass(className);
			const kwinMinimized = await kwinClassIsMinimized(className);
			if (kwinMinimized === false) {
				await Bun.sleep(400);
				await kwinMinimizeByClass(className);
				minimized =
					(await minimizeWindow(actualPort, {
						timeoutMs: 2000,
						silent: true,
					})) || minimized;
				const again = await kwinClassIsMinimized(className);
				minimized = again ?? minimized;
			} else if (kwinMinimized === true) {
				minimized = true;
			}
			windowState = minimized ? "minimized" : "normal";
			if (windowState === "minimized" && options.flash && launchedPid) {
				scheduleTaskbarFlash(launchedPid);
			}
		}

		if (!options.headless && !options.minimize) {
			// A normal window for a human: drop an earlier guard and bring a parked window back.
			await releaseWindowGuard(className);
			await unparkWindows(className);
		}

		await kwinStartupMinimize?.dispose().catch(() => undefined);
		kwinStartupMinimize = null;
		// After every temporary script is unloaded: the guard is the one that stays.
		if (!options.headless && options.minimize && !options.park && windowState === "minimized") {
			await engageWindowGuard(className, "minimize");
		}

		let recordStatus = "off";
		let recordOutputDir: string | undefined;
		if (options.record) {
			try {
				const recording = await startRecording({
					port: actualPort,
					tabIndex: 0,
					frames: options.recordFrames,
					format: "png",
				});
				recordStatus =
					recording.framesRequested === null
						? "started (saving until stopped)"
						: `started (${recording.framesRequested} frame(s))`;
				recordOutputDir = recording.outputDir;
			} catch (error) {
				recordStatus = `not started: ${error instanceof Error ? error.message : String(error)}`;
			}
		}

		if (options.json) {
			renderOutput(
				{
					requestedPort: options.port,
					port: actualPort,
					userDataDir,
					url: focusedUrl,
					browserAction: claimed.browserAction,
					tabAction: "closed-all-existing-tabs-and-focused-one-tab",
					lockStatus: "active",
					portNote: claimed.portNote,
					binary: outputBinary,
					pid: launchedPid,
					replacedPid,
					windowState,
					locale: resolvedLocale.appLocale,
					acceptLanguage: resolvedLocale.acceptLanguages,
					defaultProfile: usesDefaultProfile,
					emulation: options.android ? "android" : "desktop",
					recordStatus,
					recordOutputDir,
				},
				true,
			);
		} else {
			renderOpenSummary({
				port: actualPort,
				requestedPort: options.port,
				url: focusedUrl,
				userDataDir,
				defaultProfile: usesDefaultProfile,
				windowState,
				locale: resolvedLocale.appLocale,
				emulation: options.android ? "android" : "desktop",
				record:
					recordStatus === "off"
						? undefined
						: (recordOutputDir ?? recordStatus),
			});
		}
	} catch (error) {
		await kwinStartupMinimize?.dispose().catch(() => undefined);
		await releaseWindowGuard(portClass(actualPort));
		await clearLaunchInfo(userDataDir);
		if (launchedPid) {
			await terminateProcess(launchedPid, 2000).catch(() => undefined);
		}
		await clearPortLock(actualPort);
		throw error;
	}
}
