import type { VmConfig } from "./config";

export class CliError extends Error {
	constructor(
		message: string,
		readonly exitCode = 1,
	) {
		super(message);
	}
}

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function run(
	args: string[],
	inherit = false,
): Promise<CommandResult> {
	const proc = Bun.spawn(args, {
		env: { ...process.env, LC_ALL: "C" },
		stdin: inherit ? "inherit" : "ignore",
		stdout: inherit ? "inherit" : "pipe",
		stderr: inherit ? "inherit" : "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		inherit ? Promise.resolve("") : new Response(proc.stdout).text(),
		inherit ? Promise.resolve("") : new Response(proc.stderr).text(),
	]);
	return { stdout, stderr, exitCode };
}

export async function checked(
	args: string[],
	inherit = false,
): Promise<string> {
	const result = await run(args, inherit);
	if (result.exitCode !== 0) {
		throw new CliError(
			result.stderr.trim() || `Command failed: ${args.join(" ")}`,
			result.exitCode,
		);
	}
	return result.stdout;
}

export class Libvirt {
	constructor(readonly config: VmConfig) {}

	private virsh(...args: string[]): string[] {
		return ["virsh", "-c", this.config.uri, ...args];
	}

	async exists(name: string): Promise<boolean> {
		return (await run(this.virsh("dominfo", name))).exitCode === 0;
	}

	async state(name: string): Promise<string> {
		const result = await run(this.virsh("domstate", name));
		return result.exitCode === 0 ? result.stdout.trim() : "missing";
	}

	async isRunning(name: string): Promise<boolean> {
		return (await this.state(name)) === "running";
	}

	async start(name: string): Promise<void> {
		if (!(await this.isRunning(name))) await checked(this.virsh("start", name));
	}

	async shutdown(name: string): Promise<void> {
		if (!(await this.isRunning(name))) return;
		await checked(this.virsh("shutdown", name));
		for (let attempt = 0; attempt < 60; attempt++) {
			if (!(await this.isRunning(name))) return;
			await Bun.sleep(2000);
		}
		console.error(`[vm] graceful shutdown timed out; forcing off ${name}`);
		await checked(this.virsh("destroy", name));
	}

	async listNames(): Promise<string[]> {
		const output = await checked(this.virsh("list", "--all", "--name"));
		return output
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async ip(name: string): Promise<string | undefined> {
		for (const source of ["agent", "lease"]) {
			const result = await run(
				this.virsh("domifaddr", name, "--source", source),
			);
			if (result.exitCode !== 0) continue;
			const match = result.stdout.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\/\d+\b/);
			if (match?.[1] && match[1] !== "127.0.0.1") return match[1];
		}
		return undefined;
	}

	async info(name: string): Promise<Record<string, string>> {
		const output = await checked(this.virsh("dominfo", name));
		return Object.fromEntries(
			output.split("\n").flatMap((line) => {
				const index = line.indexOf(":");
				return index < 0
					? []
					: [[line.slice(0, index).trim(), line.slice(index + 1).trim()]];
			}),
		);
	}

	async diskPath(name: string): Promise<string | undefined> {
		const output = await checked(this.virsh("domblklist", name, "--details"));
		for (const line of output.split("\n")) {
			const columns = line.trim().split(/\s+/);
			if (columns[0] === "file" && columns[1] === "disk") return columns[3];
		}
		return undefined;
	}

	async display(name: string): Promise<string | undefined> {
		const result = await run(this.virsh("domdisplay", name));
		return result.exitCode === 0 ? result.stdout.trim() : undefined;
	}

	async agentReady(name: string): Promise<boolean> {
		return (
			(
				await run(
					this.virsh("qemu-agent-command", name, '{"execute":"guest-ping"}'),
				)
			).exitCode === 0
		);
	}

	async waitForAgent(name: string, timeoutSeconds = 240): Promise<void> {
		const deadline = Date.now() + timeoutSeconds * 1000;
		while (Date.now() < deadline) {
			if (await this.agentReady(name)) return;
			await Bun.sleep(2000);
		}
		throw new CliError(`QEMU guest agent did not become ready: ${name}`);
	}

	async guestExec(
		name: string,
		script: string,
		timeoutSeconds = 180,
	): Promise<CommandResult> {
		const request = JSON.stringify({
			execute: "guest-exec",
			arguments: {
				path: "/bin/sh",
				arg: ["-c", script],
				"capture-output": true,
			},
		});
		const started = JSON.parse(
			await checked(this.virsh("qemu-agent-command", name, request)),
		);
		const pid = started.return?.pid;
		if (typeof pid !== "number")
			throw new CliError("QEMU guest-exec did not return a pid");
		const deadline = Date.now() + timeoutSeconds * 1000;
		while (Date.now() < deadline) {
			const statusRequest = JSON.stringify({
				execute: "guest-exec-status",
				arguments: { pid },
			});
			const status = JSON.parse(
				await checked(this.virsh("qemu-agent-command", name, statusRequest)),
			).return;
			if (status?.exited) {
				return {
					stdout: status["out-data"]
						? Buffer.from(status["out-data"], "base64").toString()
						: "",
					stderr: status["err-data"]
						? Buffer.from(status["err-data"], "base64").toString()
						: "",
					exitCode: status.exitcode ?? 255,
				};
			}
			await Bun.sleep(1000);
		}
		throw new CliError(`Guest command timed out: ${name}`);
	}

	async guestChecked(
		name: string,
		script: string,
		timeoutSeconds = 180,
	): Promise<string> {
		const result = await this.guestExec(name, script, timeoutSeconds);
		if (result.exitCode !== 0)
			throw new CliError(
				result.stderr.trim() || `Guest command failed: ${result.exitCode}`,
			);
		return result.stdout;
	}
}
