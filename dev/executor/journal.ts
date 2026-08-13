import { serviceName } from "./paths";
import { fail, printCommand, runText, splitLines } from "./utils";

function serviceJournalLines(output: string): string[] {
	return splitLines(output).filter((line) =>
		/systemd\[[0-9]+\]: (Reloading|Reloaded|Starting|Started|Stopping|Stopped|Failed)/.test(
			line,
		),
	);
}

export function showExecutorServiceLogs(since?: string): void {
	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-u",
		serviceName,
		"--no-pager",
	];
	if (since) {
		args.push("--since", since);
	} else {
		args.push("-n", "50");
	}

	printCommand(args);
	const result = runText(args);
	const lines = serviceJournalLines(result.stdout);
	if (lines.length > 0) {
		console.log(lines.join("\n"));
	}
}

export function showInstanceLogs(name: string, since?: string): void {
	const args = [
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"--output=cat",
		"--no-pager",
	];
	if (since) {
		args.push("--since", since);
	} else {
		args.push("-n", "20");
	}

	printCommand(args);
	const result = runText(args);
	const output = result.stdout.trimEnd();
	if (output) {
		console.log(output);
	}
}

export function showRecentLogs(name: string): void {
	const logs = runText([
		"/usr/bin/journalctl",
		"--user",
		"-t",
		`executor/${name}`,
		"-n",
		"5",
		"--output=cat",
		"--no-pager",
	]);
	const output = logs.stdout.trimEnd();
	if (output) {
		console.log(output);
	} else {
		console.log("    (no logs)");
	}
}

export function reloadExecutorService(): void {
	const activeArgs = ["/usr/bin/systemctl", "--user", "is-active", serviceName];
	const active = runText(activeArgs).stdout.trim();

	if (active === "active") {
		const args = ["/usr/bin/systemctl", "--user", "reload", serviceName];
		printCommand(args);
		const result = runText(args);
		if (!result.success) {
			if (result.stderr.trim()) {
				console.error(result.stderr.trim());
			}
			fail(`failed to reload ${serviceName}`);
		}
		return;
	}

	const resetArgs = [
		"/usr/bin/systemctl",
		"--user",
		"reset-failed",
		serviceName,
	];
	printCommand(resetArgs);
	runText(resetArgs);

	const startArgs = ["/usr/bin/systemctl", "--user", "start", serviceName];
	printCommand(startArgs);
	const start = runText(startArgs);
	if (!start.success) {
		const output = `${start.stdout}${start.stderr}`.trim();
		if (output) {
			console.error(output);
		}
		fail(`failed to start ${serviceName}`);
	}
}

export function verifyExecutorServiceActive(): void {
	const activeArgs = ["/usr/bin/systemctl", "--user", "is-active", serviceName];
	printCommand(activeArgs);
	const active = runText(activeArgs);
	const state = active.stdout.trim() || "unknown";
	console.log(state);
	if (state === "active") {
		return;
	}

	const statusArgs = [
		"/usr/bin/systemctl",
		"--user",
		"--no-pager",
		"--full",
		"status",
		serviceName,
	];
	printCommand(statusArgs);
	const status = runText(statusArgs);
	const output = `${status.stdout}${status.stderr}`.trim();
	if (output) {
		console.log(output);
	}
	fail("executor service is not active after reload");
}
