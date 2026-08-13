#!/usr/bin/env bun

const TARGETS = [
	{ key: "local", label: "local PC", command: "sudo" },
	{ key: "vm", label: "debian13-kde-podman", command: "vm" },
	{ key: "cachyos", label: "cachyos-home", command: "ssh" },
] as const;

export type TargetKey = (typeof TARGETS)[number]["key"];
type RunOptions = { stdin?: string; quiet?: boolean };
export type TargetRunner = (
	target: TargetKey,
	args: string[],
	options?: RunOptions,
) => Promise<number>;
const SETUP_SCRIPT = await Bun.file(
	`${import.meta.dir}/unlock-sudo-setup.sh`,
).text();

function shellQuote(value: string): string {
	return `'${value.split("'").join(`'"'"'`)}'`;
}

export function targetCommand(target: TargetKey, args: string[]): string[] {
	if (target === "local") return args;
	const remoteCommand = args.map(shellQuote).join(" ");
	if (target === "vm")
		return ["vm", "ssh", "debian13-kde-podman", "--", remoteCommand];
	return ["ssh", "cachyos-home", remoteCommand];
}

const runTarget: TargetRunner = async (target, args, options = {}) => {
	const proc = Bun.spawn(targetCommand(target, args), {
		stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
		stdout: options.quiet ? "ignore" : "inherit",
		stderr: options.quiet ? "ignore" : "inherit",
	});
	return await proc.exited;
};

export async function applyTarget(
	target: TargetKey,
	label: string,
	promptPassword: (label: string) => Promise<string>,
	run: TargetRunner = runTarget,
): Promise<void> {
	console.log(`[${label}] checking SSH and sudo access`);
	const unlocked =
		(await run(target, ["sudo", "-n", "true"], { quiet: true })) === 0;
	if (unlocked) {
		console.log(`[${label}] passwordless sudo already available; skipping`);
		return;
	}
	if (
		target !== "local" &&
		(await run(target, ["true"], { quiet: true })) !== 0
	) {
		throw new Error(`${label}: SSH connection failed`);
	}
	const sudoArgs = ["sudo", "-S", "-k", "-p", "", "sh", "-c", SETUP_SCRIPT];
	const options: RunOptions = { stdin: `${await promptPassword(label)}\n` };
	if ((await run(target, sudoArgs, options)) !== 0) {
		throw new Error(
			`${label}: sudo authentication or policy installation failed`,
		);
	}
	if ((await run(target, ["sudo", "-n", "true"], { quiet: true })) !== 0) {
		throw new Error(`${label}: sudo policy verification failed`);
	}
	console.log(`[${label}] passwordless sudo enabled until reboot`);
}

function paint(code: string, text: string, enabled: boolean): string {
	return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function readTerminal(hidden: boolean): Promise<string> {
	if (!process.stdin.isTTY)
		throw new Error("an interactive terminal is required");
	return new Promise((resolve, reject) => {
		let value = "";
		process.stdin.setRawMode(true);
		process.stdin.resume();
		const finish = (error?: Error) => {
			process.stdin.off("data", onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
			error ? reject(error) : resolve(value);
		};
		const onData = (chunk: Buffer) => {
			const text = chunk.toString();
			if (text === "\x03") return finish(new Error("cancelled"));
			if (text.includes("\r") || text.includes("\n")) return finish();
			if (text === "\x7f") value = value.slice(0, -1);
			else value += text;
			if (!hidden) finish();
		};
		process.stdin.on("data", onData);
	});
}

async function selectTargets(): Promise<Set<TargetKey>> {
	const selected = new Set<TargetKey>(TARGETS.map(({ key }) => key));
	const color = !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";
	let current = 0;
	process.stdout.write("\x1b[?25l");
	try {
		while (true) {
			process.stdout.write("\x1b[2J\x1b[H");
			console.log(paint("1;36", "unlock-sudo target selection", color));
			console.log(
				"\n" +
					paint(
						"2",
						"Arrow/jk: move | Space: toggle | a: toggle all | Enter: continue | q: cancel",
						color,
					) +
					"\n",
			);
			for (const [index, target] of TARGETS.entries()) {
				const active = selected.has(target.key);
				const focused = index === current;
				const code = focused ? "1;36" : active ? "1;32" : "2";
				console.log(
					paint(
						code,
						`${focused ? ">" : " "} ${active ? "[o]" : "[ ]"} ${target.label}`,
						color,
					),
				);
			}
			console.log(
				"\n" +
					paint("1;33", `Selected: ${selected.size}/${TARGETS.length}`, color),
			);
			const key = await readTerminal(false);
			if (key === "") return selected;
			if (/^[qQ]$/.test(key)) throw new Error("cancelled");
			if (/^[jJ]$/.test(key) || key === "\x1b[B")
				current = (current + 1) % TARGETS.length;
			else if (/^[kK]$/.test(key) || key === "\x1b[A")
				current = (current + TARGETS.length - 1) % TARGETS.length;
			else if (key === " ") {
				const target = TARGETS[current].key;
				selected.has(target) ? selected.delete(target) : selected.add(target);
			} else if (/^[aA]$/.test(key)) {
				if (selected.size === TARGETS.length) selected.clear();
				else TARGETS.forEach(({ key }) => selected.add(key));
			}
		}
	} finally {
		process.stdout.write("\x1b[?25h\n");
	}
}

async function promptPassword(label: string): Promise<string> {
	process.stdout.write(`[${label}] sudo password: `);
	try {
		return await readTerminal(true);
	} finally {
		process.stdout.write("\n");
	}
}

function usage(): void {
	console.log(
		`Usage: unlock-sudo\n\nInteractively enables NOPASSWD sudo on the local PC, debian13-kde-podman,\nand cachyos-home. The policy lives under /run and is cleared by reboot.`,
	);
}

async function commandExists(command: string): Promise<boolean> {
	return (
		(await Bun.spawn(["sh", "-c", 'command -v "$1"', "sh", command], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		}).exited) === 0
	);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length === 1 && ["-h", "--help"].includes(args[0])) return usage();
	if (args.length) throw new Error(`unexpected argument: ${args[0]}`);
	const selected = await selectTargets();
	if (!selected.size) return console.log("No targets selected.");
	for (const target of TARGETS) {
		if (!selected.has(target.key)) continue;
		if (!(await commandExists(target.command)))
			throw new Error(`required command not found: ${target.command}`);
		await applyTarget(target.key, target.label, promptPassword);
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "cancelled") process.exit(130);
		console.error(`error: ${message}`);
		process.exit(1);
	});
