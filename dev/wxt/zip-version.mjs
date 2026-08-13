#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const rootDir = process.cwd();
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

const MENU_ACTIONS = ["patch", "minor", "major", "keep"];

const rootPackageJsonPath = path.join(rootDir, "package.json");

// Auto-discover wasm paths by scanning known locations.
const WASM_SEARCH_PATHS = [
	{
		cargo: "src-rust/Cargo.toml",
		lock: "src-rust/Cargo.lock",
		pkg: "src/lib/wasm/pkg/package.json",
	},
	{
		cargo: "src/wasm/Cargo.toml",
		lock: "src/wasm/Cargo.lock",
		pkg: "src/wasm/pkg/package.json",
	},
	{
		cargo: "src/lib/wasm/Cargo.toml",
		lock: "src/lib/wasm/Cargo.lock",
		pkg: "src/lib/wasm/pkg/package.json",
	},
];

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function discoverWasmPaths() {
	for (const candidate of WASM_SEARCH_PATHS) {
		const cargoPath = path.join(rootDir, candidate.cargo);
		if (await fileExists(cargoPath)) {
			const cargoContents = await readFile(cargoPath, "utf8");
			const nameMatch = /\[package\]\s*\r?\n\s*name\s*=\s*"([^"]+)"/.exec(
				cargoContents,
			);
			if (!nameMatch) continue;

			return {
				cargoTomlPath: cargoPath,
				cargoLockPath: path.join(rootDir, candidate.lock),
				wasmPackageJsonPath: path.join(rootDir, candidate.pkg),
				wasmPackageName: nameMatch[1],
			};
		}
	}

	return null;
}

function normalizeAction(value) {
	if (!value) return null;

	switch (value.trim().toLowerCase()) {
		case "1":
		case "p":
		case "patch":
			return "patch";
		case "2":
		case "n":
		case "minor":
			return "minor";
		case "3":
		case "m":
		case "major":
			return "major";
		case "4":
		case "k":
		case "keep":
		case "pass":
			return "keep";
		default:
			return null;
	}
}

function normalizeCustomChoice(value) {
	if (!value) return false;

	switch (value.trim().toLowerCase()) {
		case "5":
		case "c":
		case "custom":
		case "d":
		case "direct":
			return true;
		default:
			return false;
	}
}

function normalizeExplicitVersion(value) {
	if (!value) return null;
	const trimmed = value.trim();
	return VERSION_PATTERN.test(trimmed) ? trimmed : null;
}

function parseVersion(version) {
	const match = VERSION_PATTERN.exec(version);
	if (!match) {
		throw new Error(
			`Expected package version to look like x.y.z, received "${version}".`,
		);
	}

	return match.slice(1, 4).map((part) => Number(part));
}

function bumpVersion(currentVersion, action) {
	if (action === "keep") return currentVersion;

	const [major, minor, patch] = parseVersion(currentVersion);
	if (action === "major") return `${major + 1}.0.0`;
	if (action === "patch") return `${major}.${minor}.${patch + 1}`;
	return `${major}.${minor + 1}.0`;
}

function parseSelectionValue(value) {
	const action = normalizeAction(value);
	if (action) return { kind: "action", value: action };

	const version = normalizeExplicitVersion(value);
	if (version) return { kind: "version", value: version };

	return null;
}

function resolveExplicitSelection(args) {
	const positionalArgs = args.filter((arg) => !arg.startsWith("--"));
	if (positionalArgs.length === 0) return null;

	if (positionalArgs.length === 2 && normalizeCustomChoice(positionalArgs[0])) {
		const version = normalizeExplicitVersion(positionalArgs[1]);
		if (version) return { kind: "version", value: version };

		throw new Error(
			`Invalid explicit version "${positionalArgs[1]}". Use a version like 1.2.3.`,
		);
	}

	if (positionalArgs.length !== 1) {
		throw new Error(
			"Pass patch, minor, major, keep, a version like 1.2.3, or custom <version>.",
		);
	}

	if (normalizeCustomChoice(positionalArgs[0])) {
		throw new Error(
			"Pass a version after custom, for example: bun run zip:version -- custom 1.2.3",
		);
	}

	const selection = parseSelectionValue(positionalArgs[0]);
	if (selection) return selection;

	throw new Error(
		`Invalid version argument "${positionalArgs[0]}". Use patch, minor, major, keep, or a version like 1.2.3.`,
	);
}

function replaceOrThrow(contents, searchValue, replacement, label) {
	const nextContents = contents.replace(searchValue, replacement);
	if (nextContents === contents) {
		throw new Error(`Failed to update ${label}.`);
	}
	return nextContents;
}

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function promptForVersion(currentVersion) {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		while (true) {
			const answer = await rl.question(
				`Custom version (existing ${currentVersion}): `,
			);
			const version = normalizeExplicitVersion(answer);
			if (version) return version;

			process.stdout.write("Invalid version. Enter a version like 1.2.3.\n");
		}
	} finally {
		rl.close();
	}
}

async function promptForChoice({ question, options, defaultIndex = 0 }) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("Interactive mode requires a TTY.");
	}

	let selected = defaultIndex;
	const MENU_LINES = options.length + 1;

	process.stdin.setRawMode(true);
	emitKeypressEvents(process.stdin);
	process.stdin.resume();

	process.stdout.write(`${question}\n`);
	for (let i = 0; i < options.length; i++) {
		const prefix = i === selected ? "\x1b[36m▶\x1b[0m " : "  ";
		process.stdout.write(`${prefix}${options[i].label}\n`);
	}

	try {
		return await new Promise((resolve) => {
			const onKeypress = (str, key) => {
				if (key.ctrl && key.name === "c") {
					process.stdout.write("^C\n");
					process.exit(130);
				}

				if (key.name === "up" || str === "k") {
					selected = selected > 0 ? selected - 1 : options.length - 1;
					redraw();
				} else if (key.name === "down" || str === "j") {
					selected = selected < options.length - 1 ? selected + 1 : 0;
					redraw();
				} else if (key.name === "return") {
					process.stdin.removeListener("keypress", onKeypress);
					process.stdin.setRawMode(false);
					process.stdin.pause();
					resolve(options[selected].value);
				} else if (key.name === "escape" || str === "q") {
					process.stdout.write("\n");
					process.exit(0);
				}
			};

			function redraw() {
				process.stdout.write(`\x1b[${MENU_LINES}A`);
				process.stdout.write(`\r\x1b[2K${question}\n`);
				for (let i = 0; i < options.length; i++) {
					const prefix = i === selected ? "\x1b[36m▶\x1b[0m " : "  ";
					process.stdout.write(`\r\x1b[2K${prefix}${options[i].label}\n`);
				}
			}

			process.stdin.on("keypress", onKeypress);
		});
	} finally {
		try {
			process.stdin.setRawMode(false);
		} catch {}
		process.stdin.pause();
	}
}

async function promptForSelection(currentVersion) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			"Interactive mode requires a TTY. Pass patch, minor, major, keep, or a version like 1.2.3 as an argument in non-interactive mode.",
		);
	}

	const patchVersion = bumpVersion(currentVersion, "patch");
	const minorVersion = bumpVersion(currentVersion, "minor");
	const majorVersion = bumpVersion(currentVersion, "major");

	const choice = await promptForChoice({
		question: "Choose version action:",
		options: [
			{
				label: `patch (fix) -> ${patchVersion}`,
				value: { kind: "action", value: "patch" },
			},
			{
				label: `minor (feature) -> ${minorVersion}`,
				value: { kind: "action", value: "minor" },
			},
			{
				label: `major (breaking) -> ${majorVersion}`,
				value: { kind: "action", value: "major" },
			},
			{
				label: `keep current -> ${currentVersion} (zip only)`,
				value: { kind: "action", value: "keep" },
			},
			{ label: "custom version", value: { kind: "custom" } },
		],
		defaultIndex: 0,
	});

	if (choice.kind === "custom") {
		const ver = await promptForVersion(currentVersion);
		return { kind: "version", value: ver };
	}

	return choice;
}

async function promptForSubmit() {
	const choice = await promptForChoice({
		question: "Submit to store?",
		options: [
			{ label: "no", value: null },
			{ label: "all (configured stores)", value: "all" },
			{ label: "chrome", value: "chrome" },
			{ label: "firefox", value: "firefox" },
			{ label: "edge", value: "edge" },
		],
		defaultIndex: 0,
	});

	return choice;
}

const VALID_SUBMIT_CHOICES = ["all", "chrome", "firefox", "edge"];

function resolveSubmitChoice(args) {
	const skip = args.includes("--skip-submit");
	const submitFlag = args.find((arg) => arg.startsWith("--submit="));

	if (skip && submitFlag) {
		throw new Error("Cannot combine --skip-submit with --submit=<choice>.");
	}
	if (skip) return { skip: true, value: null };

	if (submitFlag) {
		const value = submitFlag.slice("--submit=".length);
		if (!VALID_SUBMIT_CHOICES.includes(value)) {
			throw new Error(
				`Invalid --submit value "${value}". Use all, chrome, firefox, or edge.`,
			);
		}
		return { skip: false, value };
	}

	return { skip: false, value: null };
}

function submitArgsFor(choice) {
	switch (choice) {
		case "all":
			return [];
		case "chrome":
			return ["--chrome"];
		case "firefox":
			return ["--firefox"];
		case "edge":
			return ["--edge"];
		default:
			throw new Error(`Unknown submit choice: ${choice}`);
	}
}

async function runSubmit(submitArgs) {
	const submitScript = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"wxt-submit.mjs",
	);

	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [submitScript, ...submitArgs], {
			cwd: rootDir,
			stdio: "inherit",
			env: process.env,
		});

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`submit failed with exit code ${code ?? "unknown"}.`));
		});
	});
}

async function updateVersionFiles(nextVersion) {
	const rootPackageJson = await readJson(rootPackageJsonPath);
	rootPackageJson.version = nextVersion;
	await writeJson(rootPackageJsonPath, rootPackageJson);

	const wasm = await discoverWasmPaths();
	if (!wasm) {
		process.stdout.write(
			"No wasm package found — skipping Cargo/wasm version sync.\n",
		);
		return;
	}

	const { cargoTomlPath, cargoLockPath, wasmPackageJsonPath, wasmPackageName } =
		wasm;
	const escapedName = wasmPackageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	if (await fileExists(wasmPackageJsonPath)) {
		const wasmPackageJson = await readJson(wasmPackageJsonPath);
		wasmPackageJson.version = nextVersion;
		await writeJson(wasmPackageJsonPath, wasmPackageJson);
	}

	const cargoToml = await readFile(cargoTomlPath, "utf8");
	await writeFile(
		cargoTomlPath,
		replaceOrThrow(
			cargoToml,
			new RegExp(
				`(\\[package\\]\\r?\\nname = "${escapedName}"\\r?\\nversion = ")([^"]+)(")`,
			),
			`$1${nextVersion}$3`,
			`${path.relative(rootDir, cargoTomlPath)} version`,
		),
	);

	if (await fileExists(cargoLockPath)) {
		const cargoLock = await readFile(cargoLockPath, "utf8");
		await writeFile(
			cargoLockPath,
			replaceOrThrow(
				cargoLock,
				new RegExp(
					`(\\[\\[package\\]\\]\\r?\\nname = "${escapedName}"\\r?\\nversion = ")([^"]+)(")`,
				),
				`$1${nextVersion}$3`,
				`${path.relative(rootDir, cargoLockPath)} version`,
			),
		);
	}
}

async function runZip(browserTarget) {
	const globalScript = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"run-wxt-targets.mjs",
	);
	const localScript = path.join(rootDir, "scripts/run-wxt-targets.mjs");
	const scriptPath = (await fileExists(globalScript))
		? globalScript
		: localScript;
	const zipArgs = browserTarget ? ["zip", browserTarget] : ["zip"];

	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath, ...zipArgs], {
			cwd: rootDir,
			stdio: "inherit",
		});

		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`zip failed with exit code ${code ?? "unknown"}.`));
		});
		child.on("error", reject);
	});
}

function resolveComparablePath(filePath) {
	try {
		return realpathSync(filePath);
	} catch {
		return path.resolve(filePath);
	}
}

function isInvokedAsMainModule(argvPath, moduleUrl) {
	if (!argvPath) return false;
	return (
		resolveComparablePath(argvPath) ===
		resolveComparablePath(fileURLToPath(moduleUrl))
	);
}

async function main() {
	const args = process.argv.slice(2);

	// Extract --browser flag (used by wxtu zip chrome|firefox)
	let browserTarget = null;
	const filteredArgs = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--browser" && i + 1 < args.length) {
			browserTarget = args[i + 1] || null;
			i++;
		} else {
			filteredArgs.push(args[i]);
		}
	}

	const skipZip = filteredArgs.includes("--skip-zip");
	const submitArg = resolveSubmitChoice(filteredArgs);
	const explicitSelection = resolveExplicitSelection(filteredArgs);

	const rootPackageJson = await readJson(rootPackageJsonPath);
	const currentVersion = rootPackageJson.version;
	process.stdout.write(`Existing version: ${currentVersion}\n`);

	const selection =
		explicitSelection ?? (await promptForSelection(currentVersion));
	const nextVersion =
		selection.kind === "version"
			? selection.value
			: bumpVersion(currentVersion, selection.value);

	process.stdout.write(`Target version: ${nextVersion}\n`);

	if (nextVersion === currentVersion) {
		process.stdout.write(`Keeping existing version ${currentVersion}.\n`);
	} else {
		process.stdout.write(
			`Updating version ${currentVersion} -> ${nextVersion}.\n`,
		);
		await updateVersionFiles(nextVersion);
	}

	if (skipZip) {
		process.stdout.write("Skipping zip because --skip-zip was provided.\n");
		return;
	}

	await runZip(browserTarget);

	// Submit flow
	if (submitArg.skip) {
		process.stdout.write(
			"Skipping submit because --skip-submit was provided.\n",
		);
		return;
	}

	let submitChoice = submitArg.value;
	if (submitChoice === null) {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			return;
		}
		submitChoice = await promptForSubmit();
		if (submitChoice === null) {
			process.stdout.write("Submit skipped.\n");
			return;
		}
	}

	await runSubmit(submitArgsFor(submitChoice));
}

export {
	bumpVersion,
	isInvokedAsMainModule,
	normalizeAction,
	normalizeCustomChoice,
	normalizeExplicitVersion,
	parseSelectionValue,
	resolveExplicitSelection,
};

const isMainModule = isInvokedAsMainModule(process.argv[1], import.meta.url);

if (isMainModule) {
	main().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	});
}
