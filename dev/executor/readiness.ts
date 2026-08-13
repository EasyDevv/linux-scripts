import { ProcessManager } from "./process-manager";
import { printViteReadyFallback } from "./vite-adapter";
import { fail, formatSince, printCommand, runText, sleepMs } from "./utils";
import {
	reloadExecutorService,
	verifyExecutorServiceActive,
	showExecutorServiceLogs,
	showInstanceLogs,
} from "./journal";

const pm = new ProcessManager(
	Object.fromEntries(
		Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
	),
);

function addressMatchesPort(address: string, port: string): boolean {
	return new RegExp(`:${port}$`).test(address);
}

const portConflictRe = /Port\s+\d+\s+is\s+already\s+in\s+use/i;

async function waitForLogPattern(
	name: string,
	pattern: string,
	since: string,
	label: string,
	timeoutSeconds = 15,
	port?: string,
): Promise<void> {
	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--since",
		since,
		"--output=cat",
		"--no-pager",
	];
	const deadline = Date.now() + timeoutSeconds * 1_000;
	let conflictHandled = false;

	while (Date.now() < deadline) {
		const result = runText(args);
		if (result.stdout.includes(pattern)) {
			return;
		}

		if (!conflictHandled && port && portConflictRe.test(result.stdout)) {
			conflictHandled = true;
			pm.killProcessOnPort(port);
		}

		await sleepMs(1_000);
	}

	printCommand(args);
	const result = runText(args);
	const output = result.stdout.trimEnd();
	if (output) {
		console.log(output);
	}
	fail(`timed out waiting for ${label} on ${name}`);
}

async function waitForInstanceReady(
	name: string,
	pattern: string,
	since: string,
	label: string,
	cmd: string,
	dir: string,
	port: string,
	timeoutSeconds = 15,
): Promise<void> {
	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--since",
		since,
		"--output=cat",
		"--no-pager",
	];
	const startedAt = Date.now();
	const deadline = Date.now() + timeoutSeconds * 1_000;
	let portReadyAt = 0;
	let conflictHandled = false;

	while (Date.now() < deadline) {
		const result = runText(args);
		if (result.stdout.includes(pattern)) {
			return;
		}

		if (!conflictHandled && port && portConflictRe.test(result.stdout)) {
			conflictHandled = true;
			console.log(
				`[executor] port ${port} conflict detected; killing occupant`,
			);
			pm.killProcessOnPort(port);
			reloadExecutorService();
		}

		const addresses = await pm.listeningAddresses(name, cmd);
		if (addresses.some((address) => addressMatchesPort(address, port))) {
			if (!portReadyAt) {
				portReadyAt = Date.now();
			}

			if (Date.now() - portReadyAt >= 5_000) {
				await printViteReadyFallback(dir, name, port, Date.now() - startedAt);
				return;
			}
		}

		await sleepMs(portReadyAt ? 500 : 1_000);
	}

	printCommand(args);
	const result = runText(args);
	const output = result.stdout.trimEnd();
	if (output) {
		console.log(output);
	}
	fail(`timed out waiting for ${label} on ${name}`);
}

export async function changeAndWait(
	name: string,
	cmd: string,
	dir: string,
	pattern: string,
	label: string,
	readyPattern?: string,
	readyPort?: string,
): Promise<void> {
	const since = formatSince();
	reloadExecutorService();
	verifyExecutorServiceActive();
	await waitForLogPattern(name, pattern, since, label, 15, readyPort);
	if (readyPattern && readyPort) {
		await waitForInstanceReady(
			name,
			readyPattern,
			since,
			`${label} ready`,
			cmd,
			dir,
			readyPort,
		);
	} else if (readyPattern) {
		await waitForLogPattern(name, readyPattern, since, `${label} ready`);
	}
	showExecutorServiceLogs(since);
	showInstanceLogs(name, since);
}

export async function stopAndVerify(name: string): Promise<void> {
	const since = formatSince();

	reloadExecutorService();
	verifyExecutorServiceActive();

	showExecutorServiceLogs(since);

	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--since",
		since,
		"--output=cat",
		"--no-pager",
	];

	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		const result = runText(args);
		const logs = result.stdout;

		if (logs.includes("[executor] disabling managed instance")) {
			showInstanceLogs(name, since);
			return;
		}

		if (logs.includes("[executor] starting ")) {
			printCommand(args);
			const output = logs.trimEnd();
			if (output) {
				console.log(output);
			}
			fail(`instance restarted after stop request: ${name}`);
		}

		await sleepMs(1_000);
	}

	showInstanceLogs(name, since);
}
