#!/usr/bin/env node
import { startSampleServer, SAMPLE_REGISTRY } from "./sample-dev.mjs";

const name = process.argv[2];

if (!name || !SAMPLE_REGISTRY[name]) {
	console.error(
		`Usage: wxtu sample <name>\nAvailable: ${Object.keys(SAMPLE_REGISTRY).join(", ")}`,
	);
	process.exit(1);
}

const { child } = await startSampleServer(name);

process.on("SIGINT", () => {
	child.kill("SIGINT");
	process.exit(130);
});
process.on("SIGTERM", () => {
	child.kill("SIGTERM");
	process.exit(143);
});

child.on("close", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});

await new Promise(() => {});
