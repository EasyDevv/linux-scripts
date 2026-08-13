#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "./config";
import { cloneDebian, createGolden, prepareCache, setupDebian } from "./debian";
import { checked, CliError, Libvirt, run } from "./libvirt";

function usage(): void {
	console.log(`Usage:
  vm list
  vm status [name]
  vm ip [name]
  vm ssh-command [name]
  vm ssh                       List currently reachable SSH targets
  vm ssh <name> [-- command...] Connect to a VM
  vm start|stop|restart|console [name]
  vm delete <name> --force
  vm setup [--ssh]
  vm reinstall --force [--ssh]
  vm golden
  vm clone <name> [--ssh]
  vm cache

The default VM is debian13-kde-podman. Set VM_NAME to override it.`);
}

function requestedName(value?: string): string {
	return value && !value.startsWith("-") ? value : loadConfig().name;
}

async function ensureRunning(name: string): Promise<Libvirt> {
	const config = loadConfig(name);
	const libvirt = new Libvirt(config);
	if (!(await libvirt.exists(name)))
		throw new CliError(`VM does not exist: ${name}`);
	await libvirt.start(name);
	await libvirt.waitForAgent(name);
	return libvirt;
}

async function resolveIp(name: string): Promise<string> {
	const libvirt = await ensureRunning(name);
	const ip = await libvirt.ip(name);
	if (!ip) throw new CliError(`Unable to resolve an IP address for ${name}`);
	return ip;
}

function sshArgs(name: string, remoteArgs: string[] = []): Promise<string[]> {
	return resolveIp(name).then((ip) => {
		const config = loadConfig(name);
		const knownHosts = join(dirname(config.publicKeyPath), "vm_known_hosts");
		return [
			"ssh",
			"-o",
			"IdentitiesOnly=yes",
			"-o",
			"StrictHostKeyChecking=accept-new",
			"-o",
			`UserKnownHostsFile=${knownHosts}`,
			"-o",
			`HostKeyAlias=${name}`,
			"-i",
			config.publicKeyPath.replace(/\.pub$/, ""),
			`${config.user}@${ip}`,
			...remoteArgs,
		];
	});
}

async function commandList(): Promise<void> {
	const config = loadConfig();
	const libvirt = new Libvirt(config);
	const names = await libvirt.listNames();
	console.log(
		`${"NAME".padEnd(30)} ${"STATE".padEnd(10)} ${"IP".padEnd(16)} ${"AUTOSTART".padEnd(10)} SSH`,
	);
	for (const name of names) {
		const [state, ip, info] = await Promise.all([
			libvirt.state(name),
			libvirt.ip(name),
			libvirt.info(name),
		]);
		const ssh =
			ip && (await sshReachable(libvirt, name)) ? `vm ssh ${name}` : "-";
		console.log(
			`${name.padEnd(30)} ${state.padEnd(10)} ${(ip ?? "-").padEnd(16)} ${(info.Autostart ?? "-").padEnd(10)} ${ssh}`,
		);
	}
}

async function sshReachable(libvirt: Libvirt, name: string): Promise<boolean> {
	if (!(await libvirt.agentReady(name))) return false;
	return (
		(await libvirt.guestExec(name, "systemctl is-active --quiet ssh"))
			.exitCode === 0
	);
}

async function commandSshList(): Promise<void> {
	const config = loadConfig();
	const libvirt = new Libvirt(config);
	const targets: Array<{ name: string; ip: string }> = [];
	for (const name of await libvirt.listNames()) {
		if (!(await libvirt.isRunning(name))) continue;
		const ip = await libvirt.ip(name);
		if (ip && (await sshReachable(libvirt, name))) targets.push({ name, ip });
	}
	if (targets.length === 0) {
		console.log("No VMs are currently reachable over SSH.");
		return;
	}
	console.log(`${"NAME".padEnd(30)} ${"IP".padEnd(16)} COMMAND`);
	for (const target of targets) {
		console.log(
			`${target.name.padEnd(30)} ${target.ip.padEnd(16)} vm ssh ${target.name}`,
		);
	}
}

async function commandStatus(name: string): Promise<void> {
	const config = loadConfig(name);
	const libvirt = new Libvirt(config);
	if (!(await libvirt.exists(name)))
		throw new CliError(`VM does not exist: ${name}`);
	const [state, ip, info, disk, display, agent] = await Promise.all([
		libvirt.state(name),
		libvirt.ip(name),
		libvirt.info(name),
		libvirt.diskPath(name),
		libvirt.display(name),
		libvirt.agentReady(name),
	]);
	console.log(`Name:       ${name}
State:      ${state}
IP:         ${ip ?? "-"}
Memory:     ${info["Max memory"] ?? "-"}
VCPUs:      ${info["CPU(s)"] ?? "-"}
Disk:       ${disk ?? "-"}
Autostart:  ${info.Autostart ?? "-"}
Agent:      ${agent ? "ready" : "unavailable"}
Display:    ${display ?? "-"}`);
}

async function commandSsh(name: string, remoteArgs: string[]): Promise<void> {
	const args = await sshArgs(name, remoteArgs);
	const result = await run(args, true);
	if (result.exitCode !== 0)
		throw new CliError("SSH exited with an error", result.exitCode);
}

async function printConnection(name: string): Promise<void> {
	const args = await sshArgs(name);
	console.log(`SSH: ${args.join(" ")}`);
	console.log(`Connect now: vm ssh ${name}`);
}

async function commandLifecycle(command: string, name: string): Promise<void> {
	const config = loadConfig(name);
	const libvirt = new Libvirt(config);
	if (!(await libvirt.exists(name)))
		throw new CliError(`VM does not exist: ${name}`);
	if (command === "start") await libvirt.start(name);
	if (command === "stop") await libvirt.shutdown(name);
	if (command === "restart") {
		await libvirt.shutdown(name);
		await libvirt.start(name);
	}
	if (command === "console") {
		const result = await run(
			["virt-manager", "--connect", config.uri, "--show-domain-console", name],
			true,
		);
		if (result.exitCode !== 0)
			throw new CliError("virt-manager failed", result.exitCode);
		return;
	}
	console.log(`${name}: ${await libvirt.state(name)}`);
}

async function commandDelete(name: string): Promise<void> {
	const config = loadConfig(name);
	const libvirt = new Libvirt(config);
	if (!(await libvirt.exists(name)))
		throw new CliError(`VM does not exist: ${name}`);
	const disk = await libvirt.diskPath(name);
	await libvirt.shutdown(name);
	await checked(["virsh", "-c", config.uri, "undefine", name]);
	if (disk) {
		const volume = disk.split("/").at(-1);
		if (volume) {
			await checked([
				"virsh",
				"-c",
				config.uri,
				"pool-refresh",
				config.storagePool,
			]);
			const removed = await run([
				"virsh",
				"-c",
				config.uri,
				"vol-delete",
				"--pool",
				config.storagePool,
				volume,
			]);
			if (removed.exitCode !== 0) await rm(disk, { force: true });
		}
	}
	console.log(`[vm] deleted ${name}`);
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	if (
		!command ||
		command === "help" ||
		command === "-h" ||
		command === "--help"
	) {
		usage();
		return;
	}

	if (command === "list") return commandList();
	if (command === "status") return commandStatus(requestedName(args[0]));
	if (command === "ip") {
		console.log(await resolveIp(requestedName(args[0])));
		return;
	}
	if (command === "ssh-command") {
		if (!args[0]) return commandSshList();
		console.log((await sshArgs(requestedName(args[0]))).join(" "));
		return;
	}
	if (command === "ssh") {
		if (args.length === 0) return commandSshList();
		const hasName = Boolean(args[0] && !args[0].startsWith("-"));
		const name = requestedName(args[0]);
		const remoteArgs = args
			.slice(hasName ? 1 : 0)
			.filter((arg, index) => !(index === 0 && arg === "--"));
		return commandSsh(name, remoteArgs);
	}
	if (["start", "stop", "restart", "console"].includes(command)) {
		return commandLifecycle(command, requestedName(args[0]));
	}
	if (command === "delete") {
		if (!args[0]) throw new CliError("Usage: vm delete <name>", 2);
		if (!args.includes("--force"))
			throw new CliError("Refusing destructive delete without --force", 2);
		return commandDelete(args[0]);
	}
	if (command === "cache") return prepareCache(loadConfig());
	if (command === "golden") return createGolden(loadConfig());
	if (command === "setup" || command === "reinstall") {
		if (command === "reinstall" && !args.includes("--force"))
			throw new CliError("Refusing destructive reinstall without --force", 2);
		const config = loadConfig();
		await setupDebian(config, command === "reinstall");
		await printConnection(config.name);
		if (args.includes("--ssh")) await commandSsh(config.name, []);
		return;
	}
	if (command === "clone") {
		const name = args.find((arg) => !arg.startsWith("-"));
		if (!name) throw new CliError("Usage: vm clone <name> [--ssh]", 2);
		await cloneDebian(loadConfig(), name);
		await printConnection(name);
		if (args.includes("--ssh")) await commandSsh(name, []);
		return;
	}

	usage();
	throw new CliError(`Unknown command: ${command}`, 2);
}

main().catch((error) => {
	if (error instanceof CliError) {
		if (error.message) console.error(`[vm] ${error.message}`);
		process.exit(error.exitCode);
	}
	console.error(error);
	process.exit(1);
});
