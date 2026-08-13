#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function die(message) {
	console.error(message);
	process.exit(1);
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

function printUsage() {
	console.log(`Stop Android emulator instances.

Usage:
  android-stop.mjs [DEVICE_ID...]

Arguments:
  DEVICE_ID   Optional adb emulator serial(s). Defaults to all connected emulators.

Examples:
  android-stop.mjs
  android-stop.mjs emulator-5554`);
}

function listConnectedEmulatorIds() {
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
		.filter(
			(parts) => parts[1] === "device" && /^emulator-\d+$/.test(parts[0] ?? ""),
		)
		.map((parts) => parts[0]);
}

function stopEmulator(deviceId) {
	const result = runSync("adb", ["-s", deviceId, "emu", "kill"], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function main() {
	const args = process.argv.slice(2);
	if (args[0] === "-h" || args[0] === "--help") {
		printUsage();
		process.exit(0);
	}

	const deviceIds = args.length > 0 ? args : listConnectedEmulatorIds();
	if (deviceIds.length === 0) {
		console.log("No running Android emulator found.");
		return;
	}

	for (const deviceId of deviceIds) {
		console.log(`Stopping Android emulator ${deviceId}...`);
		stopEmulator(deviceId);
	}
	console.log("Stopped Android emulator session(s).");
}

main();
