import { mkdirSync, rmSync } from "node:fs";
import { stateDir } from "./paths";
import type { NormalizedInstance } from "./types";
import { journalLog, runText, sleepMs, extractPort } from "./utils";

let cachedUid: string | null = null;

async function ensureStateDir(): Promise<void> {
	mkdirSync(stateDir, { recursive: true });
}

export async function clearStateDir(): Promise<void> {
	await ensureStateDir();
	rmSync(stateDir, { recursive: true, force: true });
	mkdirSync(stateDir, { recursive: true });
}

function instancePidFile(name: string): string {
	return `${stateDir}/${name}.pid`;
}

async function writeInstancePidFile(name: string, pid: number): Promise<void> {
	await ensureStateDir();
	await Bun.write(instancePidFile(name), `${pid}\n`);
}

async function removeInstancePidFile(name: string): Promise<void> {
	rmSync(instancePidFile(name), { force: true });
}

async function readInstancePid(name: string): Promise<number | null> {
	const file = Bun.file(instancePidFile(name));
	if (!(await file.exists())) {
		return null;
	}

	const raw = (await file.text()).trim();
	if (!raw) {
		return null;
	}

	const pid = Number(raw);
	return Number.isInteger(pid) ? pid : null;
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function getUid(): string {
	if (cachedUid) {
		return cachedUid;
	}

	const result = runText(["/usr/bin/id", "-u"]);
	cachedUid = result.stdout.trim();
	return cachedUid;
}

interface UserProcess {
	pid: number;
	args: string;
}

function userProcesses(): UserProcess[] {
	const result = runText(["/bin/ps", "-u", getUid(), "-o", "pid=,args="]);
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trimStart())
		.filter(Boolean)
		.map((line) => {
			const firstSpace = line.indexOf(" ");
			const pid = Number(firstSpace === -1 ? line : line.slice(0, firstSpace));
			const args = firstSpace === -1 ? "" : line.slice(firstSpace + 1);
			return { pid, args };
		})
		.filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
}

function childPids(parentPid: number): number[] {
	const result = runText([
		"/bin/ps",
		"-o",
		"pid=",
		"--ppid",
		String(parentPid),
	]);
	return result.stdout
		.split(/\r?\n/)
		.map((line) => Number(line.trim()))
		.filter((value) => Number.isInteger(value) && value > 0);
}

function collectDescendantPids(rootPid: number): number[] {
	const queue = [rootPid];
	const seen = new Set<number>();
	const output: number[] = [];

	while (queue.length > 0) {
		const current = queue.shift() as number;
		if (seen.has(current)) {
			continue;
		}

		seen.add(current);
		output.push(current);

		for (const child of childPids(current)) {
			queue.push(child);
		}
	}

	return output;
}

async function terminateProcessTree(rootPid: number): Promise<void> {
	const initialTree = collectDescendantPids(rootPid).reverse();
	for (const pid of initialTree) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Ignore dead processes.
		}
	}

	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (!processExists(rootPid)) {
			return;
		}
		await sleepMs(100);
	}

	const remainingTree = collectDescendantPids(rootPid).reverse();
	for (const pid of remainingTree) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Ignore dead processes.
		}
	}
}

function fuserKill(port: string): void {
	try {
		Bun.spawnSync(["/usr/bin/fuser", "-k", `${port}/tcp`], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
	} catch {
		// fuser exits non-zero when nothing to kill; ignore.
	}
}

export interface ManagedProcess {
	readonly name: string;
	readonly pid: number;
	readonly running: boolean;
	stop(): Promise<void>;
}

export class ProcessManager {
	constructor(private env: Record<string, string>) {}

	async clearState(): Promise<void> {
		await clearStateDir();
	}

	start(instance: NormalizedInstance): ManagedProcess {
		const tag = `executor/${instance.name}`;
		const stopController = new AbortController();
		let currentProc: Bun.Subprocess | null = null;
		let running = true;

		const loop = (async () => {
			while (!stopController.signal.aborted) {
				await journalLog(tag, `[executor] starting ${instance.cmd}\n`);

				const port = extractPort(instance.cmd);
				if (port) {
					fuserKill(port);
				}

				const proc = Bun.spawn(
					[
						"/usr/bin/systemd-cat",
						"-t",
						tag,
						"/usr/bin/setsid",
						"/usr/bin/stdbuf",
						"-oL",
						"-eL",
						"/bin/sh",
						"-lc",
						instance.cmd,
					],
					{
						cwd: instance.dir,
						env: {
							...this.env,
							...instance.env,
							DIR: instance.dir,
							CMD: instance.cmd,
							EXECUTOR_NAME: instance.name,
							EXECUTOR_TAG: `executor/${instance.name}`,
						},
						stdin: "ignore",
						stdout: "ignore",
						stderr: "ignore",
					},
				);

				currentProc = proc;
				await writeInstancePidFile(instance.name, proc.pid);
				await proc.exited;
				currentProc = null;
				await removeInstancePidFile(instance.name);

				if (stopController.signal.aborted) {
					break;
				}

				await journalLog(tag, "[executor] process exited; restarting in 1s\n");
				await sleepMs(1_000);
			}

			running = false;
		})();

		return {
			name: instance.name,
			get pid() {
				return currentProc?.pid ?? 0;
			},
			get running() {
				return running;
			},
			stop: async () => {
				stopController.abort();
				const proc = currentProc;

				if (proc) {
					await journalLog(tag, "[executor] stopping managed instance\n");
					await terminateProcessTree(proc.pid);
					await proc.exited;
				}

				await removeInstancePidFile(instance.name);
				await loop;
			},
		};
	}

	async isActive(name: string, cmd: string): Promise<boolean> {
		const pid = await readInstancePid(name);
		if (pid && processExists(pid)) {
			return true;
		}

		if (pid) {
			await removeInstancePidFile(name);
		}

		if (!cmd) {
			return false;
		}

		return userProcesses().some((entry) => entry.args.includes(cmd));
	}

	async instanceRuntimePids(name: string, cmd: string): Promise<number[]> {
		const pid = await readInstancePid(name);
		if (pid && processExists(pid)) {
			return collectDescendantPids(pid);
		}

		if (!cmd) {
			return [];
		}

		const match = userProcesses().find((entry) => entry.args.includes(cmd));
		return match ? collectDescendantPids(match.pid) : [];
	}

	async listeningAddresses(name: string, cmd: string): Promise<string[]> {
		const pids = await this.instanceRuntimePids(name, cmd);
		if (pids.length === 0) {
			return [];
		}

		const result = runText([
			"/usr/bin/lsof",
			"-Pan",
			"-p",
			pids.join(","),
			"-iTCP",
			"-sTCP:LISTEN",
			"-Fn",
		]);

		return result.stdout
			.split(/\r?\n/)
			.filter((line) => line.startsWith("n"))
			.map((line) => line.slice(1));
	}

	async runtimePort(name: string, cmd: string): Promise<string> {
		const addresses = await this.listeningAddresses(name, cmd);
		for (const address of addresses) {
			const match = address.match(/:(\d+)$/);
			if (match) {
				return match[1];
			}
		}

		return "";
	}

	killProcessOnPort(port: string): void {
		const result = runText(["/usr/bin/lsof", "-ti", `:${port}`]);
		if (!result.success) {
			return;
		}

		const pids = result.stdout
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => Number(line.trim()))
			.filter((pid) => Number.isInteger(pid));

		for (const pid of pids) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already gone
			}
		}
	}

	loggedPort(name: string): string {
		const result = runText([
			"/usr/bin/journalctl",
			"--user",
			"-t",
			`executor/${name}`,
			"-n",
			"20",
			"--output=cat",
			"--no-pager",
		]);

		for (const line of result.stdout.split(/\r?\n/)) {
			const match = line.match(/localhost:(\d+)/);
			if (match) {
				return match[1];
			}
		}

		return "";
	}
}
