import { readConfig } from "./config";
import { configFile, pollIntervalMs } from "./paths";
import type { NormalizedConfig, NormalizedInstance } from "./types";
import { CliError, journalLog, sleepMs } from "./utils";
import { ProcessManager, type ManagedProcess } from "./process-manager";
import { LocalProxy } from "./local-proxy";

interface ManagedEntry {
	name: string;
	specKey: string;
	process: ManagedProcess;
}

function specKey(
	config: NormalizedConfig,
	instance: NormalizedInstance,
): string {
	return JSON.stringify({
		dir: instance.dir,
		cmd: instance.cmd,
		env: instance.env,
		restart: config.restartTokens.get(instance.name) ?? "",
	});
}

async function reconcile(
	managed: Map<string, ManagedEntry>,
	pm: ProcessManager,
	proxy: LocalProxy,
	lastIssue: { value: string },
): Promise<void> {
	let config: NormalizedConfig | null;
	try {
		config = await readConfig(false);
	} catch (error) {
		const message =
			error instanceof CliError
				? error.message
				: `Invalid config file: ${String(error)}`;
		if (lastIssue.value !== message) {
			console.error(message);
			lastIssue.value = message;
		}
		return;
	}

	if (!config) {
		const message = `Missing config file: ${configFile}`;
		if (lastIssue.value !== message) {
			console.error(message);
			lastIssue.value = message;
		}
		return;
	}

	lastIssue.value = "";
	proxy.update(config);
	const desired = new Set<string>();

	for (const [name, instance] of config.instances) {
		desired.add(name);

		if (config.disabled.has(name)) {
			if (managed.has(name)) {
				await journalLog(
					`executor/${name}`,
					"[executor] disabling managed instance\n",
				);
				await managed.get(name)?.process.stop();
				managed.delete(name);
			}
			continue;
		}

		const nextSpecKey = specKey(config, instance);
		const current = managed.get(name);
		if (!current || current.specKey !== nextSpecKey) {
			if (current) {
				await current.process.stop();
			}

			const process = pm.start(instance);
			managed.set(name, {
				name,
				specKey: nextSpecKey,
				process,
			});
		}
	}

	for (const [name, current] of [...managed.entries()]) {
		if (!desired.has(name) || config.disabled.has(name)) {
			await current.process.stop();
			managed.delete(name);
		}
	}
}

export async function runSupervisor(): Promise<void> {
	const env = Object.fromEntries(
		Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
	);
	const pm = new ProcessManager(env);
	const proxy = new LocalProxy();
	await pm.clearState();

	const managed = new Map<string, ManagedEntry>();
	const lastIssue = { value: "" };
	let stopping = false;
	let wakeNow = false;
	let wakeResolver: (() => void) | null = null;

	const wake = () => {
		wakeNow = true;
		wakeResolver?.();
		wakeResolver = null;
	};

	const stopAll = async () => {
		if (stopping) {
			return;
		}

		stopping = true;
		wake();
		for (const entry of [...managed.values()]) {
			await entry.process.stop();
		}
		managed.clear();
	};

	process.on("SIGHUP", wake);
	process.on("SIGINT", () => {
		void stopAll();
	});
	process.on("SIGTERM", () => {
		void stopAll();
	});

	try {
		while (!stopping) {
			await reconcile(managed, pm, proxy, lastIssue);
			if (stopping) {
				break;
			}

			if (wakeNow) {
				wakeNow = false;
				continue;
			}

			await Promise.race([
				sleepMs(pollIntervalMs),
				new Promise<void>((resolve) => {
					wakeResolver = resolve;
				}),
			]);
			wakeNow = false;
			wakeResolver = null;
		}
	} finally {
		proxy.stop();
		await stopAll();
	}
}
