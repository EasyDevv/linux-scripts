#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SAMPLE_REGISTRY = {
	react: {
		dir: "react",
		port: 45173,
		route: "/",
		installArgs: [],
	},
	svelte: {
		dir: "sveltekit",
		port: 45183,
		route: "/publish",
		installArgs: ["--legacy-peer-deps"],
	},
};

export function resolveSampleRoot() {
	return process.env.WXT_SAMPLE_ROOT ?? path.resolve(__dirname, "samples");
}

export function resolveSampleDir(name) {
	const entry = SAMPLE_REGISTRY[name];
	if (!entry)
		throw new Error(
			`Unknown sample: ${name}. Available: ${Object.keys(SAMPLE_REGISTRY).join(", ")}`,
		);
	return path.resolve(resolveSampleRoot(), entry.dir);
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryConnect(port, host) {
	return new Promise((resolve) => {
		const socket = net.createConnection({ port, host });
		const done = (ok) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		socket.setTimeout(1000, () => done(false));
	});
}

export async function waitForPort(port, host, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await tryConnect(port, host)) return;
		await wait(250);
	}
	throw new Error(`Timed out waiting for ${host}:${port}`);
}

function killPort(port) {
	try {
		const output = execSync(`lsof -ti :${port}`, {
			encoding: "utf-8",
		}).trim();
		if (output) {
			for (const line of output.split("\n")) {
				const pid = Number(line.trim());
				if (pid)
					try {
						process.kill(pid, "SIGTERM");
					} catch {}
			}
		}
	} catch {}
}

export async function startSampleServer(name) {
	const entry = SAMPLE_REGISTRY[name];
	if (!entry) throw new Error(`Unknown sample: ${name}`);

	const sampleDir = resolveSampleDir(name);
	const host = process.env.SAMPLE_HOST ?? "127.0.0.1";
	const port = Number(process.env.SAMPLE_PORT ?? entry.port);
	const route = entry.route.startsWith("/") ? entry.route : `/${entry.route}`;
	const url = `http://${host}:${port}${route}`;

	if (!existsSync(sampleDir)) {
		throw new Error(
			`Sample directory not found: ${sampleDir}.\n` +
				`Set WXT_SAMPLE_ROOT to the parent of a ${entry.dir} directory.`,
		);
	}

	if (!existsSync(path.join(sampleDir, "node_modules"))) {
		console.log(`[sample:${name}] Installing dependencies...`);
		execSync(
			`npm install --no-package-lock --no-fund --no-audit ${entry.installArgs.join(" ")}`,
			{ cwd: sampleDir, stdio: "inherit" },
		);
	}

	killPort(port);

	const child = spawn(
		"npx",
		["vite", "--host", host, "--port", String(port), "--strictPort"],
		{ cwd: sampleDir, stdio: "inherit" },
	);

	console.log(`[sample:${name}] Starting sample server on ${url}`);
	await waitForPort(port, host);
	console.log(`[sample:${name}] Ready at ${url}`);

	return { child, url };
}
