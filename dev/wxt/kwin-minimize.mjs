#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

export function spawnDetachedKWinMinimize(match = {}, opts = {}) {
	const { silent = false, timeoutMs = 15_000 } = opts;
	const args = [];
	if (Number.isFinite(match.pid) && match.pid > 0)
		args.push(`--pid=${match.pid}`);
	if (Number.isFinite(match.ancestorPid) && match.ancestorPid > 0)
		args.push(`--ancestor-pid=${match.ancestorPid}`);
	if (typeof match.exeName === "string" && match.exeName.length > 0)
		args.push(`--exe-name=${match.exeName}`);
	if (Number.isFinite(timeoutMs) && timeoutMs > 0)
		args.push(`--timeout-ms=${timeoutMs}`);
	if (silent) args.push("--silent");

	const child = spawn(process.execPath, [scriptPath, ...args], {
		detached: true,
		stdio: ["ignore", "ignore", "ignore"],
		env: process.env,
	});
	child.on("error", () => {});
	child.unref();
	return child;
}

export async function minimizeKWinWindow(match = {}, opts = {}) {
	const { timeoutMs = 15_000, silent = false } = opts;
	if (process.platform !== "linux") {
		warn("[kwin-minimize] Only Linux is supported.", silent);
		return false;
	}

	const deadline = Date.now() + timeoutMs;
	const targetPid =
		normalizePid(match.pid) ??
		(await waitForDescendantPid(
			normalizePid(match.ancestorPid),
			match.exeName,
			deadline,
		));
	if (!targetPid) {
		warn("[kwin-minimize] Timed out waiting for the target process.", silent);
		return false;
	}

	if (!(await canReachKWin())) {
		warn(
			"[kwin-minimize] qdbus6/KWin is not available in this session.",
			silent,
		);
		return false;
	}

	const pluginName = `sns_detox_minimize_${randomUUID().replace(/-/g, "")}`;
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "kwin-minimize-"));
	const tempScriptPath = path.join(tempDir, "main.js");
	await writeFile(tempScriptPath, buildKWinScript(targetPid), "utf8");

	let loaded = false;
	let scriptObjectPath = null;

	try {
		const scriptId = await qdbus([
			"org.kde.KWin",
			"/Scripting",
			"org.kde.kwin.Scripting.loadScript",
			tempScriptPath,
			pluginName,
		]);
		loaded = true;
		scriptObjectPath = `/Scripting/Script${scriptId}`;

		await qdbus(["org.kde.KWin", scriptObjectPath, "org.kde.kwin.Script.run"]);
		await sleep(Math.max(500, deadline - Date.now()));
		if (!silent)
			console.log(
				`[kwin-minimize] Minimize watcher finished for PID ${targetPid}`,
			);
		return true;
	} catch (error) {
		warn(
			`[kwin-minimize] Failed to minimize PID ${targetPid}: ${error instanceof Error ? error.message : String(error)}`,
			silent,
		);
		return false;
	} finally {
		if (scriptObjectPath) {
			try {
				await qdbus([
					"org.kde.KWin",
					scriptObjectPath,
					"org.kde.kwin.Script.stop",
				]);
			} catch {}
		}
		if (loaded) {
			try {
				await qdbus([
					"org.kde.KWin",
					"/Scripting",
					"org.kde.kwin.Scripting.unloadScript",
					pluginName,
				]);
			} catch {}
		}
		await rm(tempDir, { recursive: true, force: true });
	}
}

function normalizePid(value) {
	return Number.isFinite(value) && value > 0 ? Number(value) : null;
}

async function waitForDescendantPid(ancestorPid, exeName, deadline) {
	if (!ancestorPid || typeof exeName !== "string" || exeName.length === 0)
		return null;
	while (Date.now() < deadline) {
		const descendant = await findDescendantPid(ancestorPid, exeName);
		if (descendant) return descendant;
		await sleep(200);
	}
	return null;
}

async function findDescendantPid(rootPid, exeName) {
	const target = exeName.toLowerCase();
	const descendants = await listDescendants(rootPid);
	for (const pid of descendants) {
		const [exePath, comm] = await Promise.all([
			readlink(`/proc/${pid}/exe`).catch(() => ""),
			readFile(`/proc/${pid}/comm`, "utf8").catch(() => ""),
		]);
		const normalizedExePath = exePath.toLowerCase();
		const normalizedComm = comm.trim().toLowerCase();
		if (
			normalizedExePath.includes(target) ||
			path.basename(normalizedExePath) === target ||
			normalizedComm === target
		) {
			return pid;
		}
	}
	return null;
}

async function listDescendants(rootPid) {
	const descendants = [];
	const queue = [rootPid];
	const seen = new Set(queue);
	while (queue.length > 0) {
		const pid = queue.shift();
		const childPath = `/proc/${pid}/task/${pid}/children`;
		const children = await readFile(childPath, "utf8").catch(() => "");
		for (const child of children.trim().split(/\s+/).filter(Boolean)) {
			const childPid = Number.parseInt(child, 10);
			if (!Number.isFinite(childPid) || seen.has(childPid)) continue;
			seen.add(childPid);
			descendants.push(childPid);
			queue.push(childPid);
		}
	}
	return descendants;
}

function canReachKWin() {
	return new Promise((resolve) => {
		execFile(
			"qdbus6",
			["org.kde.KWin", "/KWin", "org.freedesktop.DBus.Peer.Ping"],
			(error) => resolve(!error),
		);
	});
}

function qdbus(args) {
	return new Promise((resolve, reject) => {
		execFile("qdbus6", args, { encoding: "utf8" }, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout.trim());
		});
	});
}

function buildKWinScript(targetPid) {
	return `
const targetPid = ${JSON.stringify(targetPid)};
workspace.windowAdded.connect(function(window) {
	if (window.pid === targetPid) {
		window.minimized = true;
	}
});
for (const window of workspace.windowList()) {
	if (window.pid === targetPid) {
		window.minimized = true;
	}
}
`;
}

function warn(message, silent) {
	if (!silent) console.warn(message);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCliArgs(argv) {
	const match = {};
	let timeoutMs;
	let silent = false;
	for (const arg of argv) {
		if (arg === "--silent") silent = true;
		else if (arg.startsWith("--pid="))
			match.pid = Number.parseInt(arg.slice("--pid=".length), 10);
		else if (arg.startsWith("--ancestor-pid="))
			match.ancestorPid = Number.parseInt(
				arg.slice("--ancestor-pid=".length),
				10,
			);
		else if (arg.startsWith("--exe-name="))
			match.exeName = arg.slice("--exe-name=".length);
		else if (arg.startsWith("--timeout-ms="))
			timeoutMs = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
	}
	return { match, timeoutMs, silent };
}

if (process.argv[1] === scriptPath) {
	const { match, timeoutMs, silent } = parseCliArgs(process.argv.slice(2));
	minimizeKWinWindow(match, { timeoutMs, silent })
		.then((ok) => {
			process.exit(ok ? 0 : 1);
		})
		.catch((error) => {
			if (!silent)
				console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
