#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleServer, SAMPLE_REGISTRY } from "./sample-dev.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WXT_FIREFOX_SERVER_SCRIPT = path.join(SCRIPT_DIR, "dev-firefox-wxt.mjs");

const args = process.argv.slice(2);
let startUrl = process.env.WXT_START_URL || process.env.URL || "";
const serverArgs = [];
let sampleName = null;

for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === "--sample") {
		sampleName = args[++i];
		if (!sampleName || !SAMPLE_REGISTRY[sampleName]) {
			console.error(
				`--sample requires one of: ${Object.keys(SAMPLE_REGISTRY).join(", ")}`,
			);
			process.exit(1);
		}
	} else {
		serverArgs.push(arg);
	}
}

// eslint-disable-next-line no-async-promise-executor
await new Promise(async (resolve, reject) => {
	let sampleChild = null;

	if (sampleName) {
		const { child, url } = await startSampleServer(sampleName);
		sampleChild = child;
		if (!startUrl) startUrl = url;
	}

	const child = spawn(
		process.execPath,
		[WXT_FIREFOX_SERVER_SCRIPT, ...serverArgs],
		{
			cwd: process.cwd(),
			stdio: "inherit",
			env: {
				...process.env,
				WXT_START_URL: startUrl,
				CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? "1",
			},
		},
	);

	child.on("error", (error) => {
		console.error(`Failed to start wxt (firefox): ${error.message}`);
		reject(error);
	});

	child.on("close", (code, signal) => {
		if (sampleChild && !sampleChild.killed) sampleChild.kill();
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		resolve(code ?? 0);
	});
}).then((code) => process.exit(code));
