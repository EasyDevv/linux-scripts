#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WXTU_CONFIG } from "./config.mjs";

const REPO_ROOT = process.cwd();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const DEFAULT_AVD_NAME = WXTU_CONFIG.android.defaultAvdName;
const BOOT_TIMEOUT_MS = WXTU_CONFIG.android.bootTimeoutMs;
const UI_DUMP_PATH = "/sdcard/wxtu-firefox-ui.xml";
const WXTU_TMP_DIR = WXTU_CONFIG.paths.tmpDir;
const LOCAL_UI_DUMP_PATH = path.join(
	WXTU_TMP_DIR,
	`firefox-ui-${process.pid}.xml`,
);
const FIREFOX_ADDONS_MANAGER_DEEP_LINK = "fenix://settings_addon_manager";
const FIREFOX_SETTINGS_DEEP_LINK = "fenix://settings";

function printUsage() {
	console.log(`Firefox Android helpers for WXT extension projects.

Usage:
  android-firefox.mjs install [DEVICE_ID [FIREFOX_APK [BUILD_DIR]]] [-- WEB_EXT_ARGS...]
  android-firefox.mjs manager [DEVICE_ID [FIREFOX_APK [TARGET]]]
  android-firefox.mjs page [DEVICE_ID [FIREFOX_APK [TARGET]]]

Defaults:
  DEVICE_ID    Auto-discovered from adb when one device is attached.
  FIREFOX_APK  Firefox package id, or an APK path. Default: $ANDROID_FIREFOX_APK or org.mozilla.firefox.
  BUILD_DIR    $BUILD_DIR or .output/firefox-mv2.
  TARGET       settings.

Notes:
  - install always runs a clean reinstall with --adb-remove-old-artifacts.
  - install/manager/page auto-start ${DEFAULT_AVD_NAME} when adb has no connected device.
  - if Firefox is missing on the device, a matching APK from ${DATA_DIR} is installed automatically.
  - install also ensures Settings -> Remote debugging via USB is enabled before web-ext connects.
  - manager/page opens Firefox Android's add-ons/settings surface.
  - popup target is intentionally rejected because Firefox Android handles it poorly.`);
}

function die(message, code = 1) {
	console.error(message);
	process.exit(code);
}

function runSync(command, args, options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		...options,
	});

	if (result.error) {
		die(result.error.message);
	}

	return result;
}

function runLong(command, args, options = {}) {
	const child = spawn(command, args, {
		stdio: "inherit",
		env: process.env,
		...options,
	});

	child.on("error", (error) => die(error.message));
	child.on("close", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}

		process.exit(code ?? 0);
	});
	return child;
}

function sleepMs(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function decodeXmlAttribute(value) {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

function parseUiNodes(xmlText) {
	const nodes = [];
	for (const nodeMatch of xmlText.matchAll(/<node\b([^>]*)\/>/g)) {
		const attrs = {};
		for (const attrMatch of nodeMatch[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
			attrs[attrMatch[1]] = decodeXmlAttribute(attrMatch[2]);
		}
		nodes.push(attrs);
	}
	return nodes;
}

function ensureWxtuTmpDir() {
	mkdirSync(WXTU_TMP_DIR, { recursive: true });
}

function dumpUiNodes(deviceId) {
	ensureWxtuTmpDir();

	const dumpResult = runSync("adb", [
		"-s",
		deviceId,
		"shell",
		"uiautomator",
		"dump",
		UI_DUMP_PATH,
	]);
	if (dumpResult.status !== 0) {
		die(
			dumpResult.stderr.trim() ||
				dumpResult.stdout.trim() ||
				"Failed to dump Android UI.",
		);
	}

	const pullResult = runSync("adb", [
		"-s",
		deviceId,
		"pull",
		UI_DUMP_PATH,
		LOCAL_UI_DUMP_PATH,
	]);
	if (pullResult.status !== 0) {
		die(
			pullResult.stderr.trim() ||
				pullResult.stdout.trim() ||
				"Failed to pull Android UI dump.",
		);
	}

	return parseUiNodes(readFileSync(LOCAL_UI_DUMP_PATH, "utf8"));
}

function getBoundsCenter(boundsText) {
	const match = boundsText.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
	if (!match) {
		return null;
	}

	const [, x1, y1, x2, y2] = match.map(Number);
	return {
		x: Math.round((x1 + x2) / 2),
		y: Math.round((y1 + y2) / 2),
	};
}

function tapNode(deviceId, node) {
	const center = getBoundsCenter(node.bounds ?? "");
	if (!center) {
		die(`Missing bounds for UI node: ${JSON.stringify(node)}`);
	}

	const result = runSync("adb", [
		"-s",
		deviceId,
		"shell",
		"input",
		"tap",
		String(center.x),
		String(center.y),
	]);
	if (result.status !== 0) {
		die(
			result.stderr.trim() ||
				result.stdout.trim() ||
				"Failed to tap Android UI node.",
		);
	}
}

function swipeUp(deviceId) {
	const result = runSync("adb", [
		"-s",
		deviceId,
		"shell",
		"input",
		"swipe",
		"540",
		"2100",
		"540",
		"700",
		"300",
	]);
	if (result.status !== 0) {
		die(
			result.stderr.trim() ||
				result.stdout.trim() ||
				"Failed to swipe Android UI.",
		);
	}
	sleepMs(1000);
}

function findNode(nodes, predicate) {
	return nodes.find(predicate) ?? null;
}

function waitForNode(deviceId, predicate, timeoutMs = 15000) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const nodes = dumpUiNodes(deviceId);
		const node = findNode(nodes, predicate);
		if (node) {
			return { nodes, node };
		}
		sleepMs(1000);
	}

	return null;
}

function findRemoteDebuggingControls(nodes) {
	const titleNode = findNode(
		nodes,
		(node) => node.text === "Remote debugging via USB",
	);
	if (!titleNode) {
		return null;
	}

	const titleCenter = getBoundsCenter(titleNode.bounds ?? "");
	const switchNode =
		findNode(
			nodes,
			(node) =>
				node["resource-id"] === "org.mozilla.firefox:id/switchWidget" &&
				getBoundsCenter(node.bounds ?? "") &&
				Math.abs(getBoundsCenter(node.bounds ?? "").y - titleCenter.y) < 120,
		) ??
		findNode(
			nodes,
			(node) =>
				node["resource-id"] === "org.mozilla.firefox:id/switch_widget" &&
				getBoundsCenter(node.bounds ?? "") &&
				Math.abs(getBoundsCenter(node.bounds ?? "").y - titleCenter.y) < 120,
		);

	return switchNode ? { titleNode, switchNode } : null;
}

function startFirefoxDeepLink(deviceId, firefoxPackageName, deepLink) {
	const result = runSync(
		"adb",
		[
			"-s",
			deviceId,
			"shell",
			"am",
			"start",
			"-W",
			"-a",
			"android.intent.action.VIEW",
			"-n",
			`${firefoxPackageName}/org.mozilla.fenix.HomeActivity`,
			"-d",
			deepLink,
		],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function isFirefoxOptionsPage(nodes) {
	return nodes.some(
		(node) =>
			node["resource-id"] === "ADDRESSBAR_URL_BOX" &&
			/node\.html|\/options\.html/.test(
				`${node.text ?? ""} ${node["content-desc"] ?? ""}`,
			),
	);
}

function findFirefoxAddOnConfirmationButton(nodes) {
	return findNode(
		nodes,
		(node) =>
			node["resource-id"] === "org.mozilla.firefox:id/confirm_button" ||
			node.text === "OK",
	);
}

function findFirefoxExtensionListEntry(nodes, extensionName) {
	return findNode(
		nodes,
		(node) =>
			node["resource-id"] === "org.mozilla.firefox:id/add_on_name" &&
			typeof node.text === "string" &&
			(node.text === extensionName ||
				node.text.includes(extensionName) ||
				extensionName.includes(node.text)),
	);
}

function findFirefoxExtensionSettingsEntry(nodes) {
	return findNode(
		nodes,
		(node) =>
			node["resource-id"] === "org.mozilla.firefox:id/settings" ||
			node.text === "Settings",
	);
}

function openFirefoxExtensionOptions(
	deviceId,
	firefoxPackageName,
	extensionName,
) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		startFirefoxDeepLink(
			deviceId,
			firefoxPackageName,
			FIREFOX_ADDONS_MANAGER_DEEP_LINK,
		);
		sleepMs(1500);

		for (let step = 0; step < 10; step += 1) {
			const nodes = dumpUiNodes(deviceId);
			if (isFirefoxOptionsPage(nodes)) {
				return;
			}

			const confirmationButton = findFirefoxAddOnConfirmationButton(nodes);
			if (confirmationButton) {
				tapNode(deviceId, confirmationButton);
				sleepMs(1500);
				break;
			}

			const settingsEntry = findFirefoxExtensionSettingsEntry(nodes);
			if (settingsEntry) {
				tapNode(deviceId, settingsEntry);
				sleepMs(2500);
				if (isFirefoxOptionsPage(dumpUiNodes(deviceId))) {
					return;
				}
				continue;
			}

			const extensionEntry = findFirefoxExtensionListEntry(
				nodes,
				extensionName,
			);
			if (extensionEntry) {
				tapNode(deviceId, extensionEntry);
				sleepMs(1500);
				continue;
			}

			sleepMs(1000);
		}
	}

	die(
		[
			`Could not open ${extensionName} options page in Firefox Android.`,
			`The supported fallback is: Add-ons Manager -> ${extensionName} -> Settings`,
		].join("\n"),
	);
}

function openFirefoxSettingsScreen(deviceId, firefoxPackageName) {
	startFirefoxDeepLink(
		deviceId,
		firefoxPackageName,
		FIREFOX_SETTINGS_DEEP_LINK,
	);

	const settingsState = waitForNode(
		deviceId,
		(node) => node.text === "Settings",
		10000,
	);
	if (!settingsState) {
		die('Could not open Firefox "Settings" screen.');
	}

	sleepMs(1000);
}

function ensureRemoteDebuggingEnabled(deviceId, firefoxPackageName) {
	console.log("Ensuring Firefox Android remote debugging is enabled...");
	runSync("adb", [
		"-s",
		deviceId,
		"shell",
		"am",
		"force-stop",
		firefoxPackageName,
	]);
	sleepMs(1000);

	openFirefoxSettingsScreen(deviceId, firefoxPackageName);

	for (let attempt = 0; attempt < 6; attempt += 1) {
		const nodes = dumpUiNodes(deviceId);
		const controls = findRemoteDebuggingControls(nodes);
		if (controls) {
			if (controls.switchNode.checked === "true") {
				console.log("Firefox remote debugging is already enabled.");
				return;
			}

			tapNode(deviceId, controls.switchNode);
			sleepMs(1000);
			const refreshed = findRemoteDebuggingControls(dumpUiNodes(deviceId));
			if (refreshed?.switchNode.checked === "true") {
				console.log("Enabled Firefox remote debugging via USB.");
				return;
			}

			die("Failed to enable Firefox remote debugging via USB.");
		}

		swipeUp(deviceId);
	}

	die('Could not find Firefox "Remote debugging via USB" setting.');
}

function listConnectedDeviceIds() {
	const result = runSync("adb", ["devices"]);
	if (result.status !== 0) {
		die(result.stderr.trim() || "Failed to list adb devices.");
	}

	return result.stdout
		.split(/\r?\n/)
		.slice(1)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split(/\s+/))
		.filter((parts) => parts[1] === "device")
		.map((parts) => parts[0]);
}

function startDefaultEmulator() {
	const scriptPath = path.join(__dirname, "android-emu.mjs");
	const child = spawn(process.execPath, [scriptPath, DEFAULT_AVD_NAME], {
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();
}

function waitForStartedDeviceId() {
	const startedAt = Date.now();
	while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
		const devices = listConnectedDeviceIds();
		if (devices.length === 1) {
			return devices[0];
		}
		if (devices.length > 1) {
			die(
				`Multiple Android devices found: ${devices.join(" ")}. Pass DEVICE_ID explicitly.`,
			);
		}

		sleepMs(2000);
	}

	die(
		`Timed out waiting for emulator \"${DEFAULT_AVD_NAME}\" to appear in adb devices.`,
	);
}

function waitForBootCompleted(deviceId) {
	const startedAt = Date.now();
	runSync("adb", ["-s", deviceId, "wait-for-device"], { stdio: "inherit" });

	while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
		const result = runSync("adb", [
			"-s",
			deviceId,
			"shell",
			"getprop",
			"sys.boot_completed",
		]);
		if (result.status === 0 && result.stdout.trim() === "1") {
			return;
		}

		sleepMs(2000);
	}

	die(`Timed out waiting for Android emulator boot on ${deviceId}.`);
}

function ensureAndroidKeyboardSettings(deviceId) {
	// Keep the software keyboard available even when the emulator exposes a host keyboard.
	runSync("adb", [
		"-s",
		deviceId,
		"shell",
		"settings",
		"put",
		"secure",
		"show_ime_with_hard_keyboard",
		"1",
	]);
}

function resolveDeviceId(preferred) {
	if (preferred) {
		ensureAndroidKeyboardSettings(preferred);
		return preferred;
	}

	let devices = listConnectedDeviceIds();
	if (devices.length === 0) {
		console.log(
			`No Android device found. Starting emulator \"${DEFAULT_AVD_NAME}\"...`,
		);
		startDefaultEmulator();
		const deviceId = waitForStartedDeviceId();
		waitForBootCompleted(deviceId);
		devices = listConnectedDeviceIds();
	}

	if (devices.length === 0) {
		die(
			"No Android device found after starting the emulator. Confirm it with: adb devices",
		);
	}

	if (devices.length > 1) {
		die(
			`Multiple Android devices found: ${devices.join(" ")}. Pass DEVICE_ID explicitly.`,
		);
	}

	ensureAndroidKeyboardSettings(devices[0]);
	return devices[0];
}

function resolveExtensionName(buildDir, fallback = "(unknown extension)") {
	const manifestPath = path.join(buildDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		return fallback;
	}

	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	let name = manifest.name;
	if (
		typeof name === "string" &&
		name.startsWith("__MSG_") &&
		name.endsWith("__") &&
		typeof manifest.default_locale === "string"
	) {
		const key = name.slice(6, -2);
		const messagesPath = path.join(
			buildDir,
			"_locales",
			manifest.default_locale,
			"messages.json",
		);
		if (existsSync(messagesPath)) {
			const messages = JSON.parse(readFileSync(messagesPath, "utf8"));
			const localized = messages[key]?.message;
			if (localized) {
				name = localized;
			}
		}
	}

	return typeof name === "string" && name.length > 0 ? name : fallback;
}

function normalizeTarget(target) {
	switch ((target || "settings").toLowerCase()) {
		case "settings":
		case "options":
		case "options.html":
			return "settings";
		case "manager":
		case "addons":
		case "add-ons":
		case "addon-manager":
			return "manager";
		case "popup":
		case "popup.html":
			return "popup";
		default:
			die(
				`Unsupported TARGET: ${target}\nUse one of: settings, manager, popup.html`,
			);
	}
}

function readApkPackageInfo(apkPath) {
	const result = runSync("aapt", ["dump", "badging", apkPath]);
	if (result.status !== 0) {
		die(
			result.stderr.trim() ||
				result.stdout.trim() ||
				`Failed to inspect APK: ${apkPath}`,
		);
	}

	const firstLine = result.stdout.split(/\r?\n/)[0] ?? "";
	const nameMatch = firstLine.match(/name='([^']+)'/);
	const versionMatch = firstLine.match(/versionName='([^']+)'/);
	if (!nameMatch) {
		die(`Could not determine package name from APK: ${apkPath}`);
	}

	return {
		apkPath,
		packageName: nameMatch[1],
		versionName: versionMatch?.[1] ?? "",
	};
}

function resolveFirefoxTarget(firefoxApkInput) {
	if (existsSync(firefoxApkInput) && firefoxApkInput.endsWith(".apk")) {
		const apkInfo = readApkPackageInfo(path.resolve(firefoxApkInput));
		return {
			packageName: apkInfo.packageName,
			installApkPath: apkInfo.apkPath,
		};
	}

	return {
		packageName: firefoxApkInput,
		installApkPath: process.env.ANDROID_FIREFOX_APK_PATH || "",
	};
}

function resolveBundledFirefoxApk(packageName) {
	if (!existsSync(DATA_DIR)) {
		return "";
	}

	const candidates = readdirSync(DATA_DIR)
		.filter((entry) => entry.endsWith(".apk"))
		.map((entry) => path.join(DATA_DIR, entry))
		.map((apkPath) => readApkPackageInfo(apkPath))
		.filter((apkInfo) => apkInfo.packageName === packageName)
		.sort((left, right) =>
			right.versionName.localeCompare(left.versionName, undefined, {
				numeric: true,
			}),
		);

	return candidates[0]?.apkPath ?? "";
}

function hasFirefoxPackage(deviceId, firefoxPackage) {
	const result = runSync("adb", [
		"-s",
		deviceId,
		"shell",
		"pm",
		"path",
		firefoxPackage,
	]);
	return (
		result.status === 0 &&
		result.stdout.split(/\r?\n/).some((line) => line.startsWith("package:"))
	);
}

function ensureFirefoxPackage(deviceId, firefoxTarget) {
	if (hasFirefoxPackage(deviceId, firefoxTarget.packageName)) {
		return;
	}

	const installApkPath = firefoxTarget.installApkPath
		? path.resolve(firefoxTarget.installApkPath)
		: resolveBundledFirefoxApk(firefoxTarget.packageName);
	if (!installApkPath) {
		die(
			`Firefox package not found on device: ${firefoxTarget.packageName}\nNo matching APK found in ${DATA_DIR}.`,
		);
	}

	console.log(
		`Installing Firefox APK for ${firefoxTarget.packageName} from ${installApkPath}...`,
	);
	const installResult = runSync(
		"adb",
		["-s", deviceId, "install", "-r", installApkPath],
		{ stdio: "inherit" },
	);
	if (installResult.status !== 0) {
		process.exit(installResult.status ?? 1);
	}

	if (!hasFirefoxPackage(deviceId, firefoxTarget.packageName)) {
		die(
			`Firefox install completed, but package is still missing: ${firefoxTarget.packageName}`,
		);
	}
}

function runInstall(args) {
	if (args[0] === "-h" || args[0] === "--help") {
		printUsage();
		process.exit(0);
	}

	const separatorIndex = args.indexOf("--");
	const positionalArgs =
		separatorIndex === -1 ? args : args.slice(0, separatorIndex);
	if (positionalArgs.length > 3) {
		die(`Unexpected argument: ${positionalArgs[3]}`);
	}

	const deviceIdInput =
		positionalArgs[0] || process.env.ANDROID_DEVICE_ID || "";
	const firefoxTarget = resolveFirefoxTarget(
		positionalArgs[1] ||
			process.env.ANDROID_FIREFOX_APK ||
			"org.mozilla.firefox",
	);
	const buildDir = path.resolve(
		positionalArgs[2] ||
			process.env.BUILD_DIR ||
			path.join(REPO_ROOT, ".output/firefox-mv2"),
	);
	const webExtArgs =
		separatorIndex === -1 ? [] : args.slice(separatorIndex + 1);

	if (!existsSync(path.join(REPO_ROOT, "package.json"))) {
		die(
			`package.json not found in ${REPO_ROOT}. Run this from the extension project root.`,
		);
	}

	const deviceId = resolveDeviceId(deviceIdInput);
	const buildCommand =
		process.env.FIREFOX_BUILD_SCRIPT || "bun run build:firefox";

	ensureFirefoxPackage(deviceId, firefoxTarget);
	ensureRemoteDebuggingEnabled(deviceId, firefoxTarget.packageName);

	console.log("Building Firefox bundle...");
	const buildResult = runSync("bash", ["-lc", buildCommand], {
		cwd: REPO_ROOT,
		stdio: "inherit",
	});
	if (buildResult.status !== 0) {
		process.exit(buildResult.status ?? 1);
	}

	if (!existsSync(buildDir)) {
		die(`Firefox build directory not found: ${buildDir}`);
	}

	console.log(
		`Installing Firefox Android extension to ${deviceId} (${firefoxTarget.packageName})...`,
	);
	runLong(
		"bunx",
		[
			"web-ext@latest",
			"run",
			"-s",
			buildDir,
			"-t",
			"firefox-android",
			"--adb-device",
			deviceId,
			"--firefox-apk",
			firefoxTarget.packageName,
			"--adb-remove-old-artifacts",
			...webExtArgs,
		],
		{ cwd: REPO_ROOT },
	);
}

function runPage(args, defaultTarget = "settings") {
	if (args[0] === "-h" || args[0] === "--help") {
		printUsage();
		process.exit(0);
	}

	if (args.length > 3) {
		die(`Unexpected argument: ${args[3]}`);
	}

	const buildDir = path.resolve(
		process.env.BUILD_DIR || path.join(REPO_ROOT, ".output/firefox-mv2"),
	);
	const deviceId = resolveDeviceId(
		args[0] || process.env.ANDROID_DEVICE_ID || "",
	);
	const firefoxTarget = resolveFirefoxTarget(
		args[1] || process.env.ANDROID_FIREFOX_APK || "org.mozilla.firefox",
	);
	const targetKind = normalizeTarget(args[2] || defaultTarget);
	const extensionName = resolveExtensionName(
		buildDir,
		process.env.EXTENSION_NAME || "(unknown extension)",
	);

	ensureFirefoxPackage(deviceId, firefoxTarget);

	if (targetKind === "popup") {
		die(
			[
				"Firefox Android does not reliably handle external moz-extension popup intents.",
				"Opening popup.html this way can stall for a long time and fall back to a blank page.",
				"",
				"Use the supported settings path instead:",
				`  wxtu android firefox page ${deviceId} ${firefoxTarget.packageName} settings`,
				"",
				"Then, inside Firefox Android:",
				`  1. Tap \"${extensionName}\"`,
				'  2. Tap "Settings"',
			].join("\n"),
			2,
		);
	}

	if (targetKind === "settings") {
		console.log("Opening Firefox Android extension settings...");
		openFirefoxExtensionOptions(
			deviceId,
			firefoxTarget.packageName,
			extensionName,
		);
		console.log("Opened options.html inside Firefox Android.");
		return;
	}

	console.log("Launching Firefox Android Add-ons Manager...");
	startFirefoxDeepLink(
		deviceId,
		firefoxTarget.packageName,
		FIREFOX_ADDONS_MANAGER_DEEP_LINK,
	);
	console.log("Opened Firefox Android Add-ons Manager.");
}

function main() {
	const args = process.argv.slice(2);
	const first = args[0];

	if (!first || first === "-h" || first === "--help") {
		printUsage();
		process.exit(first ? 0 : 1);
	}

	if (first === "install") {
		runInstall(args.slice(1));
		return;
	}

	if (first === "manager") {
		runPage(args.slice(1), "manager");
		return;
	}

	if (first === "page") {
		runPage(args.slice(1));
		return;
	}

	// Backwards-compatible wrapper mode: treat plain positional args as page mode.
	runPage(args);
}

main();
