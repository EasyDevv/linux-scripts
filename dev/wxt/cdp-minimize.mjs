#!/usr/bin/env node
import { execFileSync } from "node:child_process";

export function spawnDetachedMinimize(port = 9222, opts = {}) {
	const { silent = false, timeoutMs = 15_000 } = opts;
	const args = ["minimize", "--port", String(port)];
	if (silent) args.push("--silent");
	if (Number.isFinite(timeoutMs) && timeoutMs > 0)
		args.push("--timeout-ms", String(timeoutMs));

	try {
		execFileSync("control-chrome", args, {
			encoding: "utf-8",
			timeout: timeoutMs + 5000,
		});
		return true;
	} catch {
		return false;
	}
}

export async function minimizeWindow(port = 9222, opts = {}) {
	const { timeoutMs = 15_000, silent = false } = opts;
	const args = ["minimize", "--port", String(port)];
	if (silent) args.push("--silent");
	if (Number.isFinite(timeoutMs) && timeoutMs > 0)
		args.push("--timeout-ms", String(timeoutMs));

	try {
		execFileSync("control-chrome", args, {
			encoding: "utf-8",
			timeout: timeoutMs + 5000,
		});
		return true;
	} catch {
		return false;
	}
}

function parseCliArgs(argv) {
	let port = 9222;
	let timeoutMs;
	let silent = false;

	for (const arg of argv) {
		if (arg === "--silent") silent = true;
		else if (arg.startsWith("--timeout-ms="))
			timeoutMs = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
		else if (/^\d+$/.test(arg)) port = Number.parseInt(arg, 10);
	}

	return { port, timeoutMs, silent };
}

const scriptPath = new URL(import.meta.url).pathname;
if (process.argv[1] === scriptPath) {
	const { port, timeoutMs, silent } = parseCliArgs(process.argv.slice(2));
	const ok = spawnDetachedMinimize(port, { timeoutMs, silent });
	process.exit(ok ? 0 : 1);
}
