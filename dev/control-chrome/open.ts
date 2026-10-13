import { mkdtempSync, writeFileSync } from "node:fs";
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
import { minimizeWindow } from "./minimize.ts";
import { applyPortTheme, portStartPageUrl } from "./port-identity.ts";
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
import { resetTabs, waitForChrome } from "./cdp.ts";

export type OpenOptions = {
	port: number;
	url: string;
	urlExplicit: boolean;
	userDataDir?: string;
	clean: boolean;
	binary?: string;
	headless: boolean;
	status: boolean;
	minimize: boolean;
	dryRun: boolean;
	json: boolean;
	loadExtension?: string;
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
	/** True once the hook handled the window (the script unloads itself then). */
	waitHandled: (timeoutMs: number) => Promise<boolean>;
	dispose: () => Promise<void>;
};

const HELP = `control-chrome open — Launch Chromium with a remote debugging port

Usage: control-chrome open [options]

Examples:
  control-chrome open --port 9222
  control-chrome open --port 9222 --url http://localhost:5180
  control-chrome open --port 39225 --load-extension .output/chrome-mv3-dev

Options:
  --port <N>            Remote debugging port (default: 9222)
  --url <url>           Initial URL; bare hosts use http:// (default: per-port start page "CDP <port>")
  --user-data <dir>     Chrome profile dir (default: ~/.cache/chrome-debug-profile/9222 on 9222, else ./.user-data/chrome-{name})
  --clean               Launch with a fresh temporary profile
  --binary <path>       Explicit Chromium binary path
  --headless            Launch headless
  --load-extension <dir> Load unpacked extension from directory
  --browser-arg <arg>   Extra argument passed to the browser (repeatable)
  --locale <bcp47>      Browser UI/Accept-Language locale (default: ${DEFAULT_LOCALE})
	--status              Show resolved port and lock status without launching
	--minimize            Start minimized (default on KDE Wayland)
  --normal              Start a normal window (skip default minimize)
	--dry-run             Print the resolved command without launching
	--json                Print JSON output
	--help                Show this help

Environment:
  CONTROL_CHROME_BIN        Override auto-detected browser binary (default: chromium)
  CONTROL_CHROME_LOCALE     Locale used when --locale is not passed (default: ${DEFAULT_LOCALE})`;

function die(msg: string): never {
	console.error(`✗ ${msg}`);
	process.exit(1);
}

function parseArgs(argv: string[]): OpenOptions {
	const options: OpenOptions = {
		port: BROWSER_DEFAULTS.port,
		url: BROWSER_DEFAULTS.url,
		urlExplicit: false,
		headless: false,
		status: false,
		minimize: canUseKWinStartupMinimize(),
		dryRun: false,
		json: false,
		clean: false,
		browserArgs: [],
		locale: process.env.CONTROL_CHROME_LOCALE?.trim() || DEFAULT_LOCALE,
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
			case "--binary":
				options.binary = argv[++i] ?? die("Usage: --binary <path>");
				break;
			case "--headless":
				options.headless = true;
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
				break;
			case "--normal":
			case "--no-minimize":
				options.minimize = false;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
				console.log(HELP);
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
}) {
	const parts = [
		`:${info.port}${info.port !== info.requestedPort ? ` (${info.requestedPort} busy)` : ""} ${info.url.startsWith("data:text/html") ? "start page" : info.url}`,
		info.defaultProfile ? "default profile" : `profile ${info.userDataDir}`,
	];
	parts.push(info.locale);
	if (info.windowState !== "normal") parts.push(info.windowState);
	console.log(`✓ ${parts.join(" · ")}`);
}

function canUseKWinStartupMinimize() {
	if (process.env.XDG_SESSION_TYPE !== "wayland") return false;
	const desktop =
		`${process.env.XDG_CURRENT_DESKTOP ?? ""} ${process.env.DESKTOP_SESSION ?? ""}`.toLowerCase();
	if (!desktop.includes("kde") && !desktop.includes("plasma")) return false;
	return Boolean(Bun.which("gdbus"));
}

function callKWinDbus(objectPath: string, method: string, args: string[] = []) {
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

async function waitForKWinScriptObjectPath(scriptId: number) {
	const objectPath = `/Scripting/Script${scriptId}`;
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			callKWinDbus(
				objectPath,
				"org.freedesktop.DBus.Introspectable.Introspect",
			);
			return objectPath;
		} catch {
			await Bun.sleep(25);
		}
	}
	throw new Error(`KWin script object ${objectPath} did not become available`);
}

const ATTENTION_MS = 5000;
const ATTENTION_SETTLE_MS = 500;

// KWin clears demandsAttention while the new window is still being activated, so
// a detached helper sets it once the window has settled, then clears it again.
function scheduleTaskbarFlash(pid: number) {
	const dir = mkdtempSync(join(tmpdir(), "control-chrome-kwin-flash-"));
	const tag = `${pid}-${Date.now()}`;
	const scriptFor = (on: boolean) => {
		const name = `control-chrome-attention-${on ? "on" : "off"}-${tag}`;
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
	const shell = `run() { id=$(${kwin} /Scripting --method org.kde.kwin.Scripting.loadScript "$1" "$2" | tr -dc 0-9); ${kwin} /Scripting/Script$id --method org.kde.kwin.Script.run >/dev/null; }
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

async function installKWinStartupMinimize(
	pid: number,
	minimize: boolean,
): Promise<KWinStartupMinimizeHandle | null> {
	if (!canUseKWinStartupMinimize()) return null;

	const scriptDir = await mkdtemp(join(tmpdir(), "control-chrome-kwin-"));
	const scriptPath = join(scriptDir, "startup-minimize.js");
	const pluginName = `control-chrome-start-minimize-${pid}-${Date.now()}`;
	const scriptSource = `let handled = false;

function maybeHandle(window) {
	if (handled || !window) return;
	if (window.pid !== ${pid}) return;
	if (!window.normalWindow) return;
	handled = true;
	${minimize ? "window.minimized = true;" : ""}
	callDBus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting", "unloadScript", "${pluginName}");
}

workspace.windowAdded.connect(maybeHandle);
for (const window of workspace.stackingOrder) {
	maybeHandle(window);
}
`;

	await Bun.write(scriptPath, scriptSource);

	let scriptId: number | undefined;
	try {
		const loadOutput = callKWinDbus(
			"/Scripting",
			"org.kde.kwin.Scripting.loadScript",
			[scriptPath, pluginName],
		);
		const match = /\(\s*(-?\d+)/.exec(loadOutput);
		if (!match) {
			throw new Error(`Unexpected loadScript output: ${loadOutput}`);
		}
		scriptId = Number(match[1]);
		callKWinDbus("/Scripting", "org.kde.kwin.Scripting.start");
		const scriptObjectPath = await waitForKWinScriptObjectPath(scriptId);
		callKWinDbus(scriptObjectPath, "org.kde.kwin.Script.run");
	} catch (error) {
		try {
			callKWinDbus("/Scripting", "org.kde.kwin.Scripting.unloadScript", [
				pluginName,
			]);
		} catch {
			// Best-effort cleanup only.
		}
		await rm(scriptDir, { recursive: true, force: true }).catch(
			() => undefined,
		);
		console.warn(
			`[open] KWin startup minimize hook unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}

	return {
		waitHandled: async (timeoutMs) => {
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
		},
		dispose: async () => {
			if (scriptId !== undefined) {
				try {
					callKWinDbus(
						`/Scripting/Script${scriptId}`,
						"org.kde.kwin.Script.stop",
					);
				} catch {
					// Best-effort cleanup only.
				}
			}
			try {
				callKWinDbus("/Scripting", "org.kde.kwin.Scripting.unloadScript", [
					pluginName,
				]);
			} catch {
				// Best-effort cleanup only.
			}
			await rm(scriptDir, { recursive: true, force: true }).catch(
				() => undefined,
			);
		},
	};
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

	let userDataDir: string;
	let usesDefaultProfile = false;
	if (options.userDataDir) {
		userDataDir = options.userDataDir;
	} else if (options.clean) {
		if (options.dryRun) {
			userDataDir = join(tmpdir(), "control-chrome-clean-XXXXXX");
		} else {
			userDataDir = await mkdtemp(join(tmpdir(), "control-chrome-clean-"));
		}
	} else {
		userDataDir = resolveDefaultProfileDir(plan.actualPort);
		usesDefaultProfile = isDefaultProfilePort(plan.actualPort);
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
			: options.minimize
				? "minimized"
				: "normal",
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
							startMinimized: options.minimize,
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
		: options.minimize
			? "minimized"
			: "normal";

	try {
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
				startMinimized: options.minimize,
				extraArgs,
			});

			const command = [binary!, ...chromeArgs];
			const proc = Bun.spawn({
				cmd: command,
				detached: true,
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
				env: { ...process.env, ...localeSpawnEnv(resolvedLocale) },
			});
			proc.unref();
			launchedPid = proc.pid;
			outputBinary = binary!;
			if (!options.headless) {
				kwinStartupMinimize = await installKWinStartupMinimize(
					proc.pid,
					options.minimize,
				);
			}

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

			await waitForChrome(actualPort);
			const focused = await resetTabs(actualPort, options.url);
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
			const focused = await resetTabs(actualPort, options.url);
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

		// The KWin hook acts at map time; CDP keeps reporting "normal" for seconds.
		const hookHandled =
			(await kwinStartupMinimize?.waitHandled(3000).catch(() => false)) ??
			false;
		if (hookHandled && launchedPid) {
			scheduleTaskbarFlash(launchedPid);
		}

		if (!options.headless && options.minimize) {
			let minimized = hookHandled;
			if (!minimized) {
				minimized = await minimizeWindow(actualPort, {
					timeoutMs: 5000,
					silent: true,
				});
			}
			if (!minimized && claimed.browserAction === "launch-new-browser") {
				await Bun.sleep(400);
				minimized =
					(await minimizeWindow(actualPort, {
						timeoutMs: 2000,
						silent: true,
					})) || minimized;
			}
			windowState = minimized ? "minimized" : "normal";
		}

		// Keep the hook until the window exists: CDP is up before the window maps.
		await kwinStartupMinimize?.dispose().catch(() => undefined);
		kwinStartupMinimize = null;

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
			});
		}
	} catch (error) {
		await kwinStartupMinimize?.dispose().catch(() => undefined);
		await clearLaunchInfo(userDataDir);
		if (launchedPid) {
			await terminateProcess(launchedPid, 2000).catch(() => undefined);
		}
		await clearPortLock(actualPort);
		throw error;
	}
}
