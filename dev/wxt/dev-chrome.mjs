#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startSampleServer, SAMPLE_REGISTRY } from "./sample-dev.mjs";
import { consumeCommonDevArg } from "./dev-wxt-utils.mjs";
import { WXTU_CONFIG } from "./config.mjs";
import { getPageTab } from "../control-chrome/cdp.ts";

function readBooleanEnv(name, fallback) {
	const value = process.env[name];
	return value == null ? fallback : /^(1|true|yes)$/i.test(value);
}

function getDefaultChromiumDataDir() {
	const packageJsonPath = path.join(process.cwd(), "package.json");
	let packageName = path.basename(process.cwd());

	if (existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
			if (typeof pkg.name === "string" && pkg.name.trim()) {
				packageName = pkg.name.trim();
			}
		} catch {
			// Fall back to the current directory name when package.json can't be read.
		}
	}

	const safeName = packageName.replace(/[^a-zA-Z0-9._-]+/g, "-");
	return path.resolve(".user-data", `chrome-${safeName}`);
}

const CHROMIUM_DATA_DIR = path.resolve(
	process.env.WXT_CHROME_DATA_DIR ?? getDefaultChromiumDataDir(),
);
const CHROME_CONFIG = WXTU_CONFIG.chrome;
const CHROME_DEBUG_PORT = parseInt(
	process.env.WXT_CHROME_DEBUG_PORT ?? String(CHROME_CONFIG.defaultCdpPort),
	10,
);
const CHROME_BIN = process.env.WXT_CHROME_BIN || CHROME_CONFIG.browserBinary;
const START_MINIMIZED = readBooleanEnv(
	"WXT_CHROME_MINIMIZE",
	CHROME_CONFIG.startMinimized,
);
const DEV_LOCALE =
	process.env.WXT_CHROME_LOCALE?.trim() ||
	process.env.CONTROL_CHROME_LOCALE?.trim() ||
	CHROME_CONFIG.defaultLocale;
const LOCALE_RELAUNCH = readBooleanEnv(
	"WXT_CHROME_LOCALE_RELAUNCH",
	CHROME_CONFIG.localeRelaunch,
);
const DEFAULT_WXT_PORT = CHROME_CONFIG.defaultWxtPort;
const DETACHED_CHILD_ENV = "WXTU_DEV_CHROME_DETACHED_CHILD";
const DEFAULT_START_URL = CHROME_CONFIG.defaultStartUrl;
const DEV_CHROME_LOG = path.resolve(
	process.env.WXT_DEV_CHROME_LOG ?? CHROME_CONFIG.devLogPath,
);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const WXT_CHROME_SERVER_SCRIPT = path.join(SCRIPT_DIR, "dev-chrome-wxt.mjs");
const isDetachedChild = process.env[DETACHED_CHILD_ENV] === "1";
const CONTROL_CHROME_VALUE_FLAGS = new Set([
	"--binary",
	"--browser-arg",
	"--load-extension",
	"--locale",
	"--port",
	"--url",
	"--user-data",
]);
const CONTROL_CHROME_BOOLEAN_FLAGS = new Set([
	"--clean",
	"--dry-run",
	"--headless",
	"--help",
	"--json",
	"--minimize",
	"--status",
]);

const args = process.argv.slice(2);
let startUrl = process.env.WXT_START_URL || process.env.URL || "";
const scriptArgs = [];
const serverArgs = [];
const browserArgs = [];
let detachedMode = true;
let sampleName = null;
let sawWxtRoot = false;
let explicitWxtPort = null;

function consumeControlChromeArg(args, index) {
	const arg = args[index];
	if (CONTROL_CHROME_VALUE_FLAGS.has(arg)) return index + 1;
	if (CONTROL_CHROME_BOOLEAN_FLAGS.has(arg)) return index;
	return null;
}

function resolveChromeSessionOptions() {
	const options = {
		port: CHROME_DEBUG_PORT,
		url: startUrl || DEFAULT_START_URL,
		userDataDir: CHROMIUM_DATA_DIR,
		locale: DEV_LOCALE,
	};

	for (let i = 0; i < browserArgs.length; i++) {
		const arg = browserArgs[i];
		switch (arg) {
			case "--port":
				options.port = parseInt(browserArgs[++i], 10);
				break;
			case "--url":
				options.url = browserArgs[++i] ?? options.url;
				break;
			case "--user-data":
				options.userDataDir = path.resolve(
					browserArgs[++i] ?? options.userDataDir,
				);
				break;
			case "--locale":
				options.locale = browserArgs[++i] ?? options.locale;
				break;
		}
	}

	return options;
}

for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === "--") {
		const passthroughArgs = args.slice(i + 1);
		browserArgs.push(...passthroughArgs);
		scriptArgs.push(arg, ...passthroughArgs);
		break;
	}
	if (!startUrl && (arg.startsWith("http://") || arg.startsWith("https://"))) {
		startUrl = arg;
	} else if (arg === "--detached") {
		detachedMode = true;
		scriptArgs.push(arg);
	} else if (arg === "--foreground") {
		detachedMode = false;
		scriptArgs.push(arg);
	} else if (arg === "--sample") {
		sampleName = args[++i];
		if (!sampleName || !SAMPLE_REGISTRY[sampleName]) {
			console.error(
				`--sample requires one of: ${Object.keys(SAMPLE_REGISTRY).join(", ")}`,
			);
			process.exit(1);
		}
		scriptArgs.push(arg, sampleName);
	} else {
		const consumedIndex = consumeCommonDevArg(args, i);
		if (consumedIndex != null) {
			const forwarded = args.slice(i, consumedIndex + 1);
			if ((arg === "--port" || arg === "-p") && forwarded[1]) {
				explicitWxtPort = parseInt(forwarded[1], 10);
			}
			serverArgs.push(...forwarded);
			scriptArgs.push(...forwarded);
			i = consumedIndex;
		} else if (arg.startsWith("-")) {
			const browserConsumedIndex = consumeControlChromeArg(args, i);
			if (browserConsumedIndex != null) {
				const forwarded = args.slice(i, browserConsumedIndex + 1);
				browserArgs.push(...forwarded);
				scriptArgs.push(...forwarded);
				i = browserConsumedIndex;
			} else {
				browserArgs.push(arg);
				scriptArgs.push(arg);
			}
		} else if (!sawWxtRoot) {
			sawWxtRoot = true;
			serverArgs.push(arg);
			scriptArgs.push(arg);
		} else {
			browserArgs.push(arg);
			scriptArgs.push(arg);
		}
	}
}

function isPortAvailableOnHost(port, host) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.unref();
		server.on("error", (error) => {
			if (error?.code === "EAFNOSUPPORT") {
				resolve(true);
				return;
			}
			resolve(false);
		});
		server.listen({ port, host }, () => {
			server.close(() => resolve(true));
		});
	});
}

async function isPortAvailable(port) {
	const [ipv4Available, ipv6Available] = await Promise.all([
		isPortAvailableOnHost(port, "127.0.0.1"),
		isPortAvailableOnHost(port, "::1"),
	]);
	return ipv4Available && ipv6Available;
}

async function findAvailablePort(start = DEFAULT_WXT_PORT) {
	for (let p = start; p < start + 100; p++) {
		if (await isPortAvailable(p)) return p;
	}
	throw new Error(`No available port found starting from ${start}`);
}

function resolveOutDir() {
	return path.join(process.cwd(), ".output", "chrome-mv3-dev");
}

let wxt;

function startDetachedChild() {
	mkdirSync(path.dirname(DEV_CHROME_LOG), { recursive: true });
	const logFd = openSync(DEV_CHROME_LOG, "a");
	const child = spawn(process.execPath, [SCRIPT_PATH, ...scriptArgs], {
		cwd: process.cwd(),
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: {
			...process.env,
			WXT_START_URL: startUrl,
			[DETACHED_CHILD_ENV]: "1",
		},
	});

	child.on("error", (error) => {
		console.error(`Failed to start detached dev session: ${error.message}`);
		process.exit(1);
	});

	child.unref();

	console.log(`Started detached dev session: ${child.pid}`);
	console.log(`Log file: ${DEV_CHROME_LOG}`);
	const sessionOptions = resolveChromeSessionOptions();
	console.log(
		`CDP port: ${sessionOptions.port} (browser close still stops WXT)`,
	);
}

function isChromeDebugEndpointAlive(port) {
	return new Promise((resolve) => {
		const req = http.get(
			{
				host: "127.0.0.1",
				port,
				path: "/json/version",
				timeout: 1500,
			},
			(res) => {
				res.resume();
				resolve(res.statusCode === 200);
			},
		);

		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});

		req.on("error", () => resolve(false));
	});
}

function watchChromeExit(port) {
	let missedChecks = 0;
	const interval = setInterval(async () => {
		if (await isChromeDebugEndpointAlive(port)) {
			missedChecks = 0;
			return;
		}

		missedChecks += 1;
		if (missedChecks < 3) return;

		clearInterval(interval);
		console.log("\n\u2139 Browser closed \u2014 shutting down dev server");
		wxt.kill();
		process.exit(0);
	}, 2000);
}

async function readNavigatorLanguage(port) {
	let tab;
	try {
		tab = await getPageTab(port);
	} catch {
		return null;
	}
	const ws = new WebSocket(tab.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = () => reject(new Error("ws error"));
	});
	const id = 1;
	const result = await new Promise((resolve) => {
		ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			if (msg.id === id) resolve(msg.result);
		};
		ws.send(
			JSON.stringify({
				id,
				method: "Runtime.evaluate",
				params: {
					expression: "navigator.language || ''",
					returnByValue: true,
					awaitPromise: true,
				},
			}),
		);
	});
	ws.close();
	const value = result?.result?.value;
	return typeof value === "string" ? value : null;
}

function localeMatches(actual, expected) {
	if (!actual) return false;
	return actual.toLowerCase().startsWith(expected.toLowerCase());
}

async function terminateExistingChrome(port) {
	try {
		execFileSync("control-chrome", ["close", "--port", String(port)], {
			stdio: "ignore",
			timeout: 10_000,
		});
	} catch {}
}

async function launchChrome() {
	const outDir = resolveOutDir();
	const sessionOptions = resolveChromeSessionOptions();
	const url = sessionOptions.url;

	if (await isChromeDebugEndpointAlive(sessionOptions.port)) {
		if (LOCALE_RELAUNCH) {
			const actual = await readNavigatorLanguage(sessionOptions.port);
			if (!localeMatches(actual, sessionOptions.locale)) {
				console.log(
					`\nℹ Existing Chromium reports navigator.language=${actual ?? "<unknown>"}; expected ${sessionOptions.locale}. Relaunching…`,
				);
				await terminateExistingChrome(sessionOptions.port);
			} else {
				console.log(
					`\nℹ Browser already running on port ${sessionOptions.port} with locale ${actual}; reusing existing Chromium session`,
				);
				console.log(`  profile: ${sessionOptions.userDataDir}`);
				watchChromeExit(sessionOptions.port);
				return;
			}
		} else {
			console.log(
				`\nℹ Browser already running on port ${sessionOptions.port}; reusing existing Chromium session`,
			);
			console.log(`  profile: ${sessionOptions.userDataDir}`);
			watchChromeExit(sessionOptions.port);
			return;
		}
	}

	const ctrlArgs = [
		"open",
		"--port",
		String(sessionOptions.port),
		"--load-extension",
		outDir,
		"--locale",
		sessionOptions.locale,
		"--url",
		url,
		"--json",
	];

	if (START_MINIMIZED) {
		ctrlArgs.push("--minimize");
	}

	if (process.env.WXT_CHROME_DATA_DIR) {
		ctrlArgs.push("--user-data", CHROMIUM_DATA_DIR);
	}

	ctrlArgs.push(...browserArgs);

	try {
		const result = execFileSync("control-chrome", ctrlArgs, {
			encoding: "utf-8",
			timeout: 30000,
		});
		const output = JSON.parse(result.trim());

		console.log(
			`\n✓ Browser launched (chromium) on port ${output.port} → ${url}`,
		);
		console.log(
			`  profile: ${output.userDataDir ?? sessionOptions.userDataDir}`,
		);
		console.log(`  extension: ${outDir}`);
		console.log(`  locale: ${output.locale ?? sessionOptions.locale}`);
		console.log(`  window state: ${output.windowState}`);

		watchChromeExit(output.port ?? sessionOptions.port);
	} catch (error) {
		console.error(`Failed to launch browser: ${error.stderr || error.message}`);
		wxt.kill();
		process.exit(1);
	}
}

function waitForWxtReady(child) {
	return new Promise((resolve) => {
		let ready = false;

		const checkReady = (data) => {
			const text = String(data);
			if (
				text.includes("as an unpacked extension manually") ||
				text.includes("Opened browser") ||
				text.includes("Press o + enter")
			) {
				if (!ready) {
					ready = true;
					resolve();
				}
			}
		};

		child.stdout?.on("data", checkReady);
		child.stderr?.on("data", checkReady);

		child.on("error", () => {
			if (!ready) {
				ready = true;
				resolve();
			}
		});

		child.on("close", () => {
			if (!ready) {
				ready = true;
				resolve();
			}
		});
	});
}

async function main() {
	if (detachedMode && !isDetachedChild) {
		startDetachedChild();
		return;
	}

	let sampleChild = null;

	if (sampleName) {
		const { child, url } = await startSampleServer(sampleName);
		sampleChild = child;
		if (!startUrl) startUrl = url;
	}

	const wxtPort =
		explicitWxtPort != null && !Number.isNaN(explicitWxtPort)
			? explicitWxtPort
			: await findAvailablePort(DEFAULT_WXT_PORT);

	const wxtEnv = {
		...process.env,
		WXT_START_URL: startUrl,
		CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? "1",
	};

	wxt = spawn(
		process.execPath,
		[WXT_CHROME_SERVER_SCRIPT, "--port", String(wxtPort), ...serverArgs],
		{
			cwd: process.cwd(),
			stdio: [detachedMode ? "pipe" : "inherit", "pipe", "pipe"],
			env: wxtEnv,
		},
	);

	wxt.stdout?.on("data", (data) => {
		const text = String(data);
		const portLine = text.match(
			/Started dev server @ http:\/\/localhost:(\d+)/,
		);
		if (portLine) {
			const actualPort = portLine[1];
			if (actualPort !== String(wxtPort)) {
				console.log(`\u2139 WXT using port ${actualPort}`);
			}
		}
		process.stdout.write(data);
	});
	wxt.stderr?.pipe(process.stderr);

	wxt.on("error", (error) => {
		console.error(`Failed to start wxt (chrome): ${error.message}`);
		process.exit(1);
	});

	wxt.on("close", (code, signal) => {
		if (sampleChild && !sampleChild.killed) sampleChild.kill();
		if (signal) process.kill(process.pid, signal);
		else process.exit(code ?? 0);
	});

	await waitForWxtReady(wxt);
	await launchChrome();
}

main();
