import { mkdirSync, renameSync, unlinkSync, watch } from "node:fs";
import { ensureConfigFile, readConfig } from "./config";
import {
	configDir,
	configFile,
	configName,
	configWatchDebounceMs,
	runtimeStateFile,
	safetyPollIntervalMs,
	stateDir,
} from "./paths";
import type {
	ManagedProcessSnapshot,
	NormalizedConfig,
	NormalizedInstance,
} from "./types";
import { CliError } from "./utils";
import { ProcessManager, type ManagedProcess } from "./process-manager";
import { LocalProxy } from "./local-proxy";

interface ManagedEntry {
	name: string;
	specKey: string;
	process: ManagedProcess;
}

type ReconcileAction =
	| {
			kind: "start";
			name: string;
			instance: NormalizedInstance;
			specKey: string;
	  }
	| {
			kind: "replace";
			name: string;
			instance: NormalizedInstance;
			specKey: string;
			current: ManagedEntry;
	  }
	| {
			kind: "stop";
			name: string;
			current: ManagedEntry;
	  };

interface ConfigCache {
	fingerprint: string | null;
	config: NormalizedConfig | null;
	issue: string;
}

interface RuntimeStateFile {
	version: 1;
	supervisor: {
		pid: number;
		version: string;
		startedAt: number;
	};
	instances: Record<string, ManagedProcessSnapshot>;
	proxy: {
		pendingRequests: number;
		pendingWebSockets: number;
	};
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

function buildReconcilePlan(
	managed: Map<string, ManagedEntry>,
	config: NormalizedConfig,
): ReconcileAction[] {
	const plan: ReconcileAction[] = [];
	const desired = new Set<string>();

	for (const [name, instance] of config.instances) {
		desired.add(name);
		const current = managed.get(name);
		if (!config.isEnabled(name)) {
			if (current) plan.push({ kind: "stop", name, current });
			continue;
		}

		const nextSpecKey = specKey(config, instance);
		if (!current) {
			plan.push({ kind: "start", name, instance, specKey: nextSpecKey });
		} else if (current.specKey !== nextSpecKey) {
			plan.push({
				kind: "replace",
				name,
				instance,
				specKey: nextSpecKey,
				current,
			});
		}
	}

	for (const [name, current] of managed) {
		if (!desired.has(name)) {
			plan.push({ kind: "stop", name, current });
		}
	}

	return plan;
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function safeIssueText(error: unknown): string {
	return errorText(error).replace(/\s+/g, " ").trim().slice(0, 300);
}

function reportIssue(
	issues: Map<string, string>,
	key: string,
	message: string,
): void {
	if (issues.get(key) === message) return;
	issues.set(key, message);
	console.error(message);
}

async function sourceFingerprint(): Promise<string> {
	const configText = await Bun.file(configFile).text();
	const controlFile = `${configFile}\0${
		(await Bun.file(`${stateDir}/control.json`).exists())
			? await Bun.file(`${stateDir}/control.json`).text()
			: ""
	}`;
	return String(Bun.hash(`${configText}\0${controlFile}`));
}

async function loadConfig(cache: ConfigCache): Promise<{
	config: NormalizedConfig | null;
	issue: string;
	changed: boolean;
}> {
	let fingerprint: string;
	try {
		fingerprint = await sourceFingerprint();
	} catch (error) {
		const issue = `Unable to read executor config: ${safeIssueText(error)}`;
		return { config: cache.config, issue, changed: true };
	}

	if (cache.fingerprint === fingerprint) {
		return { config: cache.config, issue: cache.issue, changed: false };
	}
	cache.fingerprint = fingerprint;

	try {
		const config = await readConfig(false);
		if (!config) {
			cache.issue = `Missing config file: ${configFile}`;
			return { config: cache.config, issue: cache.issue, changed: true };
		}
		cache.config = config;
		cache.issue = "";
		return { config, issue: "", changed: true };
	} catch (error) {
		const issue =
			error instanceof CliError
				? error.message
				: `Invalid config file: ${safeIssueText(error)}`;
		cache.issue = issue;
		return { config: cache.config, issue, changed: true };
	}
}

async function reconcile(
	managed: Map<string, ManagedEntry>,
	pm: ProcessManager,
	proxy: LocalProxy,
	cache: ConfigCache,
	issues: Map<string, string>,
	shouldStop: () => boolean = () => false,
): Promise<void> {
	const loaded = await loadConfig(cache);
	if (loaded.issue) {
		reportIssue(issues, "config", loaded.issue);
		return;
	}
	issues.delete("config");
	if (!loaded.config || !loaded.changed) return;

	const config = loaded.config;
	proxy.update(config);
	const plan = buildReconcilePlan(managed, config);

	for (const action of plan) {
		if (shouldStop()) return;
		try {
			switch (action.kind) {
				case "start": {
					if (shouldStop()) return;
					const process = pm.start(action.instance);
					managed.set(action.name, {
						name: action.name,
						specKey: action.specKey,
						process,
					});
					break;
				}
				case "replace":
					await action.current.process.stop();
					managed.delete(action.name);
					if (shouldStop()) return;
					managed.set(action.name, {
						name: action.name,
						specKey: action.specKey,
						process: pm.start(action.instance),
					});
					break;
				case "stop":
					await action.current.process.stop();
					managed.delete(action.name);
					break;
			}
			issues.delete(`instance:${action.name}`);
		} catch (error) {
			reportIssue(
				issues,
				`instance:${action.name}`,
				`[executor] ${action.name}: ${safeIssueText(error)}`,
			);
		}
	}
}

async function writeRuntimeState(
	managed: Map<string, ManagedEntry>,
	proxy: LocalProxy,
	startedAt: number,
): Promise<void> {
	mkdirSync(stateDir, { recursive: true });
	const instances: Record<string, ManagedProcessSnapshot> = {};
	for (const [name, entry] of managed) {
		instances[name] = entry.process.snapshot;
	}
	const state: RuntimeStateFile = {
		version: 1,
		supervisor: {
			pid: process.pid,
			version: Bun.version,
			startedAt,
		},
		instances,
		proxy: proxy.snapshot,
	};
	const tmpFile = `${runtimeStateFile}.${process.pid}.${Date.now()}.tmp`;
	try {
		await Bun.write(tmpFile, `${JSON.stringify(state, null, 2)}\n`);
		renameSync(tmpFile, runtimeStateFile);
	} finally {
		try {
			unlinkSync(tmpFile);
		} catch {
			// The rename already removed the temporary name.
		}
	}
}

export async function runSupervisor(proxyPort = 80): Promise<void> {
	const env = Object.fromEntries(
		Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
	);
	await ensureConfigFile();

	const managed = new Map<string, ManagedEntry>();
	const startedAt = Date.now();
	const issues = new Map<string, string>();
	let proxy!: LocalProxy;
	let statusWriteTail: Promise<void> = Promise.resolve();
	const saveRuntimeState = (): void => {
		statusWriteTail = statusWriteTail
			.then(() => writeRuntimeState(managed, proxy, startedAt))
			.catch((error) => {
				reportIssue(
					issues,
					"runtime-state",
					`[executor] unable to write runtime state: ${safeIssueText(error)}`,
				);
			});
	};
	const pm = new ProcessManager(env, { onStateChange: saveRuntimeState });
	proxy = new LocalProxy(proxyPort, 5_000, (name) => {
		const restart = managed.get(name)?.process.restart();
		if (restart) {
			void restart.catch((error) =>
				reportIssue(
					issues,
					`instance:${name}`,
					`[executor] ${name}: ${safeIssueText(error)}`,
				),
			);
		}
	});

	const cache: ConfigCache = { fingerprint: null, config: null, issue: "" };
	let stopping = false;
	let dirty = true;
	let wakeResolver: (() => void) | null = null;
	let watcher: ReturnType<typeof watch> | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const wake = (): void => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		dirty = true;
		const resolve = wakeResolver;
		wakeResolver = null;
		resolve?.();
	};
	const scheduleWatcherWake = (): void => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			wake();
		}, configWatchDebounceMs);
	};
	const onConfigEvent = (
		_event: string,
		filename: string | Buffer | null,
	): void => {
		if (filename && filename.toString() !== configName) return;
		scheduleWatcherWake();
	};
	try {
		watcher = watch(configDir, { persistent: false }, onConfigEvent);
		watcher.on("error", (error) => {
			if (watcher) {
				watcher.close();
				watcher = null;
			}
			reportIssue(
				issues,
				"watcher",
				`[executor] config watcher disabled: ${safeIssueText(error)}`,
			);
			wake();
		});
	} catch (error) {
		reportIssue(
			issues,
			"watcher",
			`[executor] config watcher unavailable: ${safeIssueText(error)}`,
		);
	}

	let stopPromise: Promise<void> | null = null;
	const stopAll = (): Promise<void> => {
		if (stopPromise) return stopPromise;
		stopping = true;
		wake();
		stopPromise = Promise.allSettled(
			[...managed.values()].map((entry) => entry.process.stop()),
		).then(() => {
			managed.clear();
			saveRuntimeState();
		});
		return stopPromise;
	};

	const onSighup = (): void => wake();
	const onSigint = (): void => {
		void stopAll();
	};
	const onSigterm = (): void => {
		void stopAll();
	};
	process.on("SIGHUP", onSighup);
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);

	try {
		while (!stopping) {
			if (dirty) {
				dirty = false;
				try {
					await reconcile(
						managed,
						pm,
						proxy,
						cache,
						issues,
						() => stopping,
					);
				} catch (error) {
					reportIssue(
						issues,
						"reconcile",
						`[executor] reconcile failed: ${safeIssueText(error)}`,
					);
				}
				saveRuntimeState();
				if (dirty) continue;
			}

			const woke = await new Promise<boolean>((resolve) => {
				let finished = false;
				let timer: ReturnType<typeof setTimeout>;
				const finish = (byWake: boolean): void => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					if (wakeResolver === onWake) wakeResolver = null;
					resolve(byWake);
				};
				const onWake = (): void => finish(true);
				timer = setTimeout(() => finish(false), safetyPollIntervalMs);
				wakeResolver = onWake;
			});
			if (!woke) dirty = true;
		}
	} finally {
		if (debounceTimer) clearTimeout(debounceTimer);
		watcher?.close();
		watcher = null;
		process.off("SIGHUP", onSighup);
		process.off("SIGINT", onSigint);
		process.off("SIGTERM", onSigterm);
		try {
			await proxy.stop();
		} finally {
			await stopAll();
			await statusWriteTail;
		}
	}
}
