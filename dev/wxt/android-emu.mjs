#!/usr/bin/env node
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { WXTU_CONFIG } from "./config.mjs";

const ANDROID_CONFIG = WXTU_CONFIG.android;
const DEFAULT_AVD_NAME = ANDROID_CONFIG.defaultAvdName;
const DEFAULT_DEVICE_PROFILE = ANDROID_CONFIG.deviceProfile;
const DEFAULT_DEVICE_DISPLAY_NAME = ANDROID_CONFIG.deviceDisplayName;
const DEFAULT_DEVICE_OVERRIDES = {
	"avd.ini.displayname": DEFAULT_DEVICE_DISPLAY_NAME,
	...ANDROID_CONFIG.deviceOverrides,
};

function printUsage() {
	console.log(`Start an Android emulator with stable Linux/Wayland-friendly defaults.

Usage:
  android-emu.mjs [AVD_NAME [-- EXTRA_ARGS...]]

Arguments:
  AVD_NAME      AVD name (default: $ANDROID_AVD_NAME or ${DEFAULT_AVD_NAME}).
  EXTRA_ARGS    Extra flags passed to the emulator binary after '--'.

	Environment:
	  ANDROID_AVD_NAME         Override the default AVD name.
	  ANDROID_EMULATOR_GPU     GPU mode (default: ${ANDROID_CONFIG.emulatorGpu}).
	  ANDROID_EMULATOR_BIN     Full path to the emulator binary.
	  ANDROID_EMULATOR_BIN_DIR Emulator binary directory (default: ${ANDROID_CONFIG.emulatorBinDir}).
	  WXTU_CONFIG              Override the wxtu config file path.

Examples:
  android-emu.mjs ${DEFAULT_AVD_NAME} -- -no-window`);
}

function die(message) {
	console.error(message);
	process.exit(1);
}

function parseArgs(argv) {
	if (argv[0] === "-h" || argv[0] === "--help") {
		printUsage();
		process.exit(0);
	}

	if (argv.length === 0) {
		return { avdNameInput: "", extraArgs: [] };
	}

	if (argv[0] === "--") {
		return { avdNameInput: "", extraArgs: argv.slice(1) };
	}

	const avdNameInput = argv[0];
	if (argv.length === 1) {
		return { avdNameInput, extraArgs: [] };
	}

	if (argv[1] !== "--") {
		printUsage();
		die(`Unexpected argument: ${argv[1]}`);
	}

	return { avdNameInput, extraArgs: argv.slice(2) };
}

function findInPath(binaryName) {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) {
			continue;
		}

		const candidate = path.join(dir, binaryName);
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
}

function findEmulatorBin() {
	const binDir =
		process.env.ANDROID_EMULATOR_BIN_DIR ?? ANDROID_CONFIG.emulatorBinDir;
	const explicitBin = process.env.ANDROID_EMULATOR_BIN;
	if (explicitBin) {
		return explicitBin;
	}

	const defaultBin = path.join(binDir, "emulator");
	if (existsSync(defaultBin)) {
		return defaultBin;
	}

	const resolved = findInPath("emulator");
	if (resolved) {
		return resolved;
	}

	die(
		"emulator not found. Set ANDROID_EMULATOR_BIN or ANDROID_EMULATOR_BIN_DIR.",
	);
}

function resolveAvd(emulatorBin, avdNameInput) {
	if (avdNameInput) {
		return avdNameInput;
	}

	if (process.env.ANDROID_AVD_NAME) {
		return process.env.ANDROID_AVD_NAME;
	}

	return DEFAULT_AVD_NAME;
}

function listAvds(emulatorBin) {
	const result = spawnSync(emulatorBin, ["-list-avds"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		die(result.stderr.trim() || "Failed to list Android AVDs.");
	}

	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseVersionParts(versionText) {
	return versionText
		.split(".")
		.map((part) => Number.parseInt(part, 10))
		.map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersionParts(a, b) {
	const maxLength = Math.max(a.length, b.length);
	for (let index = 0; index < maxLength; index += 1) {
		const left = a[index] ?? 0;
		const right = b[index] ?? 0;
		if (left !== right) {
			return right - left;
		}
	}

	return 0;
}

function selectSystemImagePackage() {
	const result = spawnSync("sdkmanager", ["--list_installed"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		die(
			result.stderr.trim() || "Failed to list installed Android SDK packages.",
		);
	}

	const packages = result.stdout
		.split(/\r?\n/)
		.map((line) => line.split("|")[0]?.trim() ?? "")
		.filter((line) =>
			/^system-images;android-[^;]+;google_apis_playstore;x86_64$/.test(line),
		)
		.map((pkg) => ({
			pkg,
			version: parseVersionParts(pkg.split(";")[1].replace(/^android-/, "")),
		}));

	packages.sort((left, right) =>
		compareVersionParts(left.version, right.version),
	);

	if (packages.length === 0) {
		die(
			"No installed Android system image found. Install one with sdkmanager first.",
		);
	}

	return packages[0].pkg;
}

function parseIni(text) {
	const lines = text.split(/\r?\n/);
	const entries = new Map();
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
			continue;
		}

		const separatorIndex = line.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		entries.set(key, value);
	}

	return entries;
}

function serializeIni(entries) {
	return `${Array.from(entries.entries())
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")}\n`;
}

function ensureAvdConfigured(avdName) {
	const configPath = path.join(
		os.homedir(),
		".android",
		"avd",
		`${avdName}.avd`,
		"config.ini",
	);
	if (!existsSync(configPath)) {
		die(`AVD config not found: ${configPath}`);
	}

	const entries = parseIni(readFileSync(configPath, "utf8"));
	let changed = false;
	for (const [key, value] of Object.entries(DEFAULT_DEVICE_OVERRIDES)) {
		if (entries.get(key) === value) {
			continue;
		}

		entries.set(key, value);
		changed = true;
	}

	if (!changed) {
		return;
	}

	writeFileSync(configPath, serializeIni(entries));
}

function cleanupStaleAvdArtifacts(avdName) {
	const avdRoot = path.join(os.homedir(), ".android", "avd");
	const avdDir = path.join(avdRoot, `${avdName}.avd`);
	const avdIniPath = path.join(avdRoot, `${avdName}.ini`);
	if (!existsSync(avdDir) || existsSync(avdIniPath)) {
		return;
	}

	rmSync(avdDir, { recursive: true, force: true });
}

function ensureAvdExists(emulatorBin, avdName) {
	if (listAvds(emulatorBin).includes(avdName)) {
		ensureAvdConfigured(avdName);
		return;
	}

	cleanupStaleAvdArtifacts(avdName);

	const systemImagePackage = selectSystemImagePackage();
	console.log(
		`Creating Android AVD \"${avdName}\" with ${systemImagePackage} (${DEFAULT_DEVICE_PROFILE})...`,
	);

	const result = spawnSync(
		"avdmanager",
		[
			"create",
			"avd",
			"-n",
			avdName,
			"-k",
			systemImagePackage,
			"-d",
			DEFAULT_DEVICE_PROFILE,
		],
		{
			encoding: "utf8",
			input: "no\n",
		},
	);
	if (result.status !== 0) {
		die(
			result.stderr.trim() ||
				result.stdout.trim() ||
				`Failed to create AVD ${avdName}.`,
		);
	}

	if (!listAvds(emulatorBin).includes(avdName)) {
		die(
			`Created AVD ${avdName}, but it is still not listed by emulator -list-avds.`,
		);
	}

	ensureAvdConfigured(avdName);
}

function ensureHostVulkanOff(emulatorGpu) {
	if (emulatorGpu !== "host") {
		return;
	}

	const iniPath = path.join(os.homedir(), ".android", "advancedFeatures.ini");
	mkdirSync(path.dirname(iniPath), { recursive: true });

	const existing = existsSync(iniPath) ? readFileSync(iniPath, "utf8") : "";
	if (/^[ \t]*Vulkan[ \t]*=[ \t]*off[ \t]*$/m.test(existing)) {
		return;
	}

	const withoutVulkan = existing
		.split(/\r?\n/)
		.filter((line) => !/^[ \t]*Vulkan[ \t]*=/.test(line))
		.filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
		.join("\n");

	const next = withoutVulkan.trimEnd();
	writeFileSync(iniPath, `${next ? `${next}\n` : ""}Vulkan = off\n`);
}

function main() {
	const { avdNameInput, extraArgs } = parseArgs(process.argv.slice(2));
	const emulatorGpu =
		process.env.ANDROID_EMULATOR_GPU ?? ANDROID_CONFIG.emulatorGpu;
	const emulatorBin = findEmulatorBin();
	const emulatorBinDir = path.dirname(emulatorBin);
	const avdName = resolveAvd(emulatorBin, avdNameInput);
	ensureAvdExists(emulatorBin, avdName);

	ensureHostVulkanOff(emulatorGpu);

	const env = {
		...process.env,
		PATH: `${emulatorBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
	};
	if (!env.QT_QPA_PLATFORM && env.XDG_SESSION_TYPE === "wayland") {
		env.QT_QPA_PLATFORM = "xcb";
	}

	const child = spawn(
		emulatorBin,
		[
			"-avd",
			avdName,
			"-no-snapshot-load",
			"-no-boot-anim",
			"-no-audio",
			"-gpu",
			emulatorGpu,
			...extraArgs,
		],
		{ stdio: "inherit", env },
	);

	child.on("error", (error) => die(error.message));
	child.on("close", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}

		process.exit(code ?? 0);
	});
}

main();
