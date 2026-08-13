import {
	ensureConfigFile,
	readConfig,
	writeConfig,
	writeRestartToken,
} from "./config";
import { showRecentLogs } from "./journal";
import { changeAndWait, stopAndVerify } from "./readiness";
import { isViteCommand, viteReadyPattern } from "./vite-adapter";
import { configFile, serviceName } from "./paths";
import { ProcessManager } from "./process-manager";
import { runSupervisor } from "./supervisor";
import type { NormalizedConfig } from "./types";
import { fail, pad, printCommand, runInherit } from "./utils";
import { localUrl } from "./local-proxy";

const pm = new ProcessManager(
	Object.fromEntries(
		Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
	),
);

export function usage(): void {
	console.log(`Usage:
  executor run
  executor list
  executor log <name> [--web|--api|--all] [journalctl args...]
  executor status [<name>]
  executor start <name>
  executor stop <name>
  executor reload <name>
  executor service <start|stop|restart|reload|status>`);
}

async function currentConfig(required = true): Promise<NormalizedConfig> {
	const config = await readConfig(required);
	if (!config) {
		fail(`Missing config file: ${configFile}`);
	}
	return config;
}

async function getPortForDisplay(
	config: NormalizedConfig,
	name: string,
): Promise<string> {
	const instance = config.instances.get(name);
	const cmd = instance?.cmd ?? "";
	return (
		config.getPort(name) ||
		(await pm.runtimePort(name, cmd)) ||
		pm.loggedPort(name)
	);
}

async function printPortSuffix(
	config: NormalizedConfig,
	name: string,
): Promise<void> {
	const port = await getPortForDisplay(config, name);
	if (port) {
		console.log(`▶ ${localUrl(name)}`);
	}
}

async function autoInstanceName(config: NormalizedConfig): Promise<string> {
	const name = config.instanceMatchingCwd();
	if (!name) {
		usage();
		fail("", 1);
	}
	console.error(`[executor] auto-detected instance: ${name}`);
	return name;
}

async function resolvedInstanceName(
	config: NormalizedConfig,
	nameArg?: string,
): Promise<string> {
	const name = nameArg || (await autoInstanceName(config));
	config.getInstance(name);
	return name;
}

async function runtimeStatus(
	config: NormalizedConfig,
	name: string,
): Promise<"active" | "inactive" | "stopped"> {
	if (!config.isEnabled(name)) {
		return "stopped";
	}

	const cmd = config.getInstance(name).cmd;
	return (await pm.isActive(name, cmd)) ? "active" : "inactive";
}

async function commandList(): Promise<void> {
	const config = await currentConfig();

	for (const [name, instance] of config.instances) {
		const dir = instance.dir;
		const cmd = instance.cmd || "-";
		const state = config.isEnabled(name) ? "managed" : "stopped";
		console.log([name, state, dir, cmd].join("\t"));
	}
}

async function commandLog(args: string[], recentOnly: boolean): Promise<never> {
	const config = await currentConfig();
	let nameArg: string | undefined;
	let target: "base" | "web" | "api" | "all" = "base";
	const journalArgs: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--web") {
			target = "web";
		} else if (arg === "--api") {
			target = "api";
		} else if (arg === "--all") {
			target = "all";
		} else if (!nameArg && !arg.startsWith("-")) {
			nameArg = arg;
		} else {
			journalArgs.push(arg);
			if (
				(arg === "-n" || arg === "--lines" || arg === "--since") &&
				args[i + 1]
			) {
				journalArgs.push(args[++i]);
			}
		}
	}

	const hasExplicitName = Boolean(nameArg);
	const name = hasExplicitName
		? await resolvedInstanceName(config, nameArg)
		: await autoInstanceName(config);

	await printPortSuffix(config, name);
	const tags =
		target === "web"
			? [`executor/${name}/web`]
			: target === "api"
				? [`executor/${name}/api`]
				: target === "all"
					? [`executor/${name}`, `executor/${name}/web`, `executor/${name}/api`]
					: [`executor/${name}`];

	const command = ["/usr/bin/journalctl", "--user", "--output=cat"];
	for (const tag of tags) {
		command.push("-t", tag);
	}
	if (recentOnly) {
		command.push("-n", "50", "--no-pager");
	}
	command.push(...journalArgs);

	printCommand(command);
	process.exit(await runInherit(command));
}

async function commandStatus(nameArg?: string): Promise<void> {
	const config = await currentConfig();

	if (!nameArg) {
		console.log(`${pad("INSTANCE", 16)} ${pad("URL", 38)}  STATUS`);
		for (const [name] of config.instances) {
			const port = (await getPortForDisplay(config, name)) || "-";
			const status = await runtimeStatus(config, name);
			const url = port === "-" ? "-" : localUrl(name);
			console.log(`${pad(name, 16)} ${pad(url, 38)}  ${status}`);
		}
		return;
	}

	const name = await resolvedInstanceName(config, nameArg);
	const instance = config.getInstance(name);
	await printPortSuffix(config, name);
	console.log(`  dir: ${instance.dir || "-"}`);
	console.log(`  cmd: ${instance.cmd || "-"}`);
	console.log(`  enabled: ${String(config.isEnabled(name))}`);
	console.log(`  runtime: ${await runtimeStatus(config, name)}`);

	console.log("  logs:");
	showRecentLogs(name);

	console.log("  ports:");
	const addresses = await pm.listeningAddresses(name, instance.cmd);
	if (addresses.length === 0) {
		console.log("    (none)");
		return;
	}

	for (const address of addresses) {
		console.log(`    ${address}`);
	}
}

async function commandStart(nameArg?: string): Promise<void> {
	const config = await currentConfig();
	const name = await resolvedInstanceName(config, nameArg);

	await writeConfig((m) => m.setEnabled(name, true));

	const cfg2 = await currentConfig();
	const instance = cfg2.getInstance(name);
	const port = cfg2.getPort(name);
	const command = instance.cmd;
	if (port) {
		pm.killProcessOnPort(port);
	}
	const readyPattern =
		port && isViteCommand(command) ? viteReadyPattern() : undefined;
	await printPortSuffix(cfg2, name);
	await changeAndWait(
		name,
		instance.cmd,
		instance.dir,
		"[executor] starting ",
		"start",
		readyPattern,
		port,
	);
}

async function commandStop(nameArg?: string): Promise<void> {
	const config = await currentConfig();
	const name = await resolvedInstanceName(config, nameArg);

	await writeConfig((m) => m.setEnabled(name, false));

	await printPortSuffix(config, name);
	await stopAndVerify(name);
}

async function commandReload(nameArg?: string): Promise<void> {
	const config = await currentConfig();
	const name = await resolvedInstanceName(config, nameArg);
	const token = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;

	await writeConfig((m) => m.setEnabled(name, true));
	await writeRestartToken(name, token);

	const cfg2 = await currentConfig();
	const instance = cfg2.getInstance(name);
	const port = cfg2.getPort(name);
	const command = instance.cmd;
	const readyPattern =
		port && isViteCommand(command) ? viteReadyPattern() : undefined;
	await printPortSuffix(cfg2, name);
	await changeAndWait(
		name,
		instance.cmd,
		instance.dir,
		"[executor] starting ",
		"reload",
		readyPattern,
		port,
	);
}

async function commandService(action?: string): Promise<never> {
	if (
		!action ||
		!["start", "stop", "restart", "reload", "status"].includes(action)
	) {
		usage();
		process.exit(1);
	}

	process.exit(
		await runInherit(["/usr/bin/systemctl", "--user", action, serviceName]),
	);
}

export async function runCommand(
	command: string | undefined,
	args: string[],
): Promise<void> {
	switch (command) {
		case "run":
			await ensureConfigFile();
			await runSupervisor();
			return;
		case "list":
			await commandList();
			return;
		case "log":
		case "logs":
			await commandLog(args, false);
			return;
		case "show-recent-logs":
			await commandLog(args, true);
			return;
		case "status":
			await commandStatus(args[0]);
			return;
		case "start":
			await commandStart(args[0]);
			return;
		case "stop":
			await commandStop(args[0]);
			return;
		case "reload":
			await commandReload(args[0]);
			return;
		case "service":
			await commandService(args[0]);
			return;
		default:
			usage();
			process.exit(1);
	}
}
