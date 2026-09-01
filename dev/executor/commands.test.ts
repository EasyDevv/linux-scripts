import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

test("status reports blocked runtime state and its error", async () => {
	const root = join("/tmp", `executor-commands-test-${Date.now()}`);
	const configDir = join(root, "systemd", "user");
	const runtimeDir = join(root, "runtime");
	const runtimePath = join(runtimeDir, "executor", "runtime.json");
	const name = `blocked-${Date.now()}`;
	mkdirSync(configDir, { recursive: true });
	mkdirSync(join(runtimeDir, "executor"), { recursive: true });
	writeFileSync(
		join(configDir, "executor.json"),
		JSON.stringify({
			[name]: {
				dir: "/tmp",
				cmd: "sleep 5 --port 49123",
			},
		}),
	);
	writeFileSync(
		runtimePath,
		JSON.stringify({
			version: 1,
			supervisor: {
				pid: process.pid,
				version: "1.4.0",
				startedAt: Date.now(),
			},
			instances: {
				[name]: {
					name,
					state: "blocked",
					pid: 0,
					startedAt: null,
					restartAttempts: 0,
					nextRetryAt: null,
					lastExit: null,
					lastError: "working directory is unavailable",
				},
			},
			proxy: { pendingRequests: 0, pendingWebSockets: 0 },
		}),
	);

	const commandsPath = join(import.meta.dir, "commands.ts");
	const script = `
process.env.XDG_CONFIG_HOME = ${JSON.stringify(root)};
process.env.XDG_RUNTIME_DIR = ${JSON.stringify(runtimeDir)};
const { runCommand } = await import(${JSON.stringify(commandsPath)});
await runCommand("status", [${JSON.stringify(name)}]);
`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		cwd: join(import.meta.dir, "../.."),
		env: {
			...process.env,
			XDG_CONFIG_HOME: root,
			XDG_RUNTIME_DIR: runtimeDir,
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	try {
		const output = await new Response(child.stdout).text();
		const errorOutput = await new Response(child.stderr).text();
		const exitCode = await child.exited;
		expect(exitCode).toBe(0);
		expect(errorOutput).not.toContain("Unhandled");
		expect(output).toContain("runtime: blocked");
		expect(output).toContain("last error: working directory is unavailable");
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGKILL");
			await child.exited;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
