import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface RuntimeStateForTest {
	instances: Record<string, { state: string; pid: number }>;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function readRuntimeState(path: string): Promise<RuntimeStateForTest | null> {
	try {
		return (await Bun.file(path).json()) as RuntimeStateForTest;
	} catch {
		return null;
	}
}

async function waitFor(
	predicate: () => Promise<boolean>,
	timeoutMs = 2_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await Bun.sleep(10);
	}
	throw new Error("timed out waiting for supervisor state");
}

test("one blocked instance does not stop a healthy instance", async () => {
	const root = join("/tmp", `executor-supervisor-test-${Date.now()}`);
	const configDir = join(root, "systemd", "user");
	const runtimeDir = join(root, "runtime");
	const configPath = join(configDir, "executor.json");
	const runtimePath = join(runtimeDir, "executor", "runtime.json");
	const badName = `bad-${Date.now()}`;
	const goodName = `good-${Date.now()}`;
	mkdirSync(configDir, { recursive: true });
	mkdirSync(runtimeDir, { recursive: true });
	writeFileSync(
		configPath,
		JSON.stringify({
			[badName]: { dir: join(root, "missing"), cmd: "sleep 5" },
			[goodName]: { dir: "/tmp", cmd: "sleep 5" },
		}),
	);

	const supervisorPath = join(import.meta.dir, "supervisor.ts");
	const script = `import(${JSON.stringify(supervisorPath)}).then(({ runSupervisor }) => runSupervisor(0)).catch((error) => { console.error(error); process.exit(1); });`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		cwd: join(import.meta.dir, "../.."),
		env: {
			...process.env,
			XDG_CONFIG_HOME: root,
			XDG_RUNTIME_DIR: runtimeDir,
		},
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});

	try {
		await waitFor(async () => {
			const state = await readRuntimeState(runtimePath);
			return (
				state?.instances[badName]?.state === "blocked" &&
				state.instances[goodName]?.state === "running"
			);
		});
		const firstState = await readRuntimeState(runtimePath);
		const goodPid = firstState?.instances[goodName]?.pid ?? 0;
		expect(goodPid).toBeGreaterThan(0);
		expect(alive(goodPid)).toBe(true);

		writeFileSync(configPath, "{ malformed");
		await Bun.sleep(150);
		expect(alive(goodPid)).toBe(true);

		process.kill(child.pid, "SIGTERM");
		await child.exited;
	} finally {
		if (alive(child.pid)) {
			child.kill("SIGKILL");
			await child.exited;
		}
		rmSync(root, { recursive: true, force: true });
	}
}, 10_000);
