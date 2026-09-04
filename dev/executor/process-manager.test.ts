import { expect, test } from "bun:test";
import { join } from "node:path";

interface WorkerResult {
	ok?: boolean;
	state?: string;
	stateAfterStop?: string;
	lastError?: string | null;
	pid?: number;
	identityExists?: boolean;
	restartAttempts?: number;
	nextRetryAt?: number | null;
	stopMs?: number;
	newPid?: number;
	alive?: boolean;
	elapsedMs?: number;
	oldChildAlive?: boolean;
	newChildAlive?: boolean;
	pidAtRestartReturn?: number;
}

async function runWorker(scenario: string): Promise<WorkerResult> {
	const root = join("/tmp", `executor-pm-worker-${Date.now()}-${Math.random()}`);
	const runtimeDir = join(root, "runtime");
	const processManagerPath = join(import.meta.dir, "process-manager.ts");
	const pathsPath = join(import.meta.dir, "paths.ts");
	const script = `
const { rmSync, chmodSync } = await import("node:fs");
const { join } = await import("node:path");
const root = ${JSON.stringify(root)};
const { ProcessManager } = await import(${JSON.stringify(processManagerPath)});
const { stateDir } = await import(${JSON.stringify(pathsPath)});
const scenario = ${JSON.stringify(scenario)};
const name = scenario + "-" + Date.now();
const makeInstance = (cmd, dir = "/tmp") => ({ name, dir, cmd, enabled: true, env: {} });
const manager = (options = {}) => new ProcessManager({}, {
  systemdCatPath: "/executor-test/missing-systemd-cat-" + name,
  backoffDelaysMs: [10, 20, 40],
  backoffJitter: 0,
  normalRuntimeMs: 1000,
  terminationGraceMs: 100,
  ...options,
});
const waitFor = async (predicate, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error("timed out waiting for process manager state");
};
const waitForAsync = async (predicate, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("timed out waiting for asynchronous condition");
};
const isAlive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const readPid = async (path) => {
  try {
    const value = Number((await Bun.file(path).text()).trim());
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};
const makeHelper = async (body) => {
  const path = join(root, "helper-" + Date.now() + "-" + Math.random());
  await Bun.write(path, "#!/bin/sh\\n" + body + "\\n");
  chmodSync(path, 0o755);
  return path;
};
const cleanup = () => {
  for (const suffix of ["pid", "identity.json"]) {
    rmSync(join(stateDir, name + "." + suffix), { force: true });
  }
};
await manager().clearState();
let result;
if (scenario === "missing-cwd") {
  const handle = manager().start(makeInstance("sleep 5", "/executor-test/missing-cwd"));
  await waitFor(() => handle.state === "blocked");
  result = { state: handle.state, lastError: handle.snapshot.lastError };
  await handle.stop();
  result.stateAfterStop = handle.state;
} else if (scenario === "journal-fallback") {
  const handle = manager().start(makeInstance("sleep 5"));
  await waitFor(() => handle.state === "running");
  result = {
    state: handle.state,
    pid: handle.pid,
    identityExists: await Bun.file(join(stateDir, name + ".identity.json")).exists(),
  };
  await handle.stop();
} else if (scenario === "journal-failure") {
  const handle = manager({ systemdCatPath: "/bin/false" }).start(makeInstance("sleep 5"));
  await waitFor(() => handle.state === "running");
  result = { state: handle.state, pid: handle.pid };
  await handle.stop();
} else if (scenario === "backoff") {
  const handle = manager().start(makeInstance("exit 1"));
  await waitFor(() => handle.state === "backoff");
  result = {
    state: handle.state,
    restartAttempts: handle.snapshot.restartAttempts,
    nextRetryAt: handle.snapshot.nextRetryAt,
  };
  const started = performance.now();
  await handle.stop();
  result.stopMs = performance.now() - started;
} else if (scenario === "restart") {
  const handle = manager().start(makeInstance("sleep 5"));
  await waitFor(() => handle.state === "running");
  const firstPid = handle.pid;
  await Promise.all([handle.restart(), handle.restart(), handle.restart()]);
  await waitFor(() => handle.state === "running" && handle.pid !== firstPid);
  result = { pid: firstPid, newPid: handle.pid, state: handle.state };
  await handle.stop();
} else if (scenario === "restart-starting") {
  const logger = await makeHelper("sleep 0.15\\nexit 1");
  const handle = manager({ systemdCatPath: logger }).start(makeInstance("sleep 5"));
  const started = performance.now();
  await handle.restart();
  result = {
    state: handle.state,
    pid: handle.pid,
    elapsedMs: performance.now() - started,
  };
  await handle.stop();
} else if (scenario === "restart-backoff") {
  const handle = manager({ backoffDelaysMs: [1_000] }).start(makeInstance("sleep 0.2"));
  await waitFor(() => handle.state === "backoff");
  await handle.restart();
  result = { state: handle.state, pidAtRestartReturn: handle.pid };
  await handle.stop();
} else if (scenario === "stubborn-descendant") {
  const childFile = join(root, "stubborn-child.pid");
  const cmd = "trap 'exit 0' TERM INT; (trap '' TERM INT; exec sleep 30) & child=$!; echo $child > " + childFile + "; wait";
  const handle = manager().start(makeInstance(cmd));
  await waitForAsync(async () => (await Bun.file(childFile).exists()), 1500);
  const firstChild = await readPid(childFile);
  const firstPid = handle.pid;
  await handle.restart();
  await waitFor(() => handle.state === "running" && handle.pid !== firstPid);
  await waitForAsync(async () => (await readPid(childFile)) !== firstChild, 1500);
  const secondChild = await readPid(childFile);
  await waitForAsync(() => !isAlive(firstChild), 1000);
  await handle.stop();
  await waitForAsync(() => !isAlive(secondChild), 1000);
  result = {
    state: handle.state,
    oldChildAlive: isAlive(firstChild),
    newChildAlive: isAlive(secondChild),
  };
} else if (scenario === "stale-pid" || scenario === "corrupt-pid") {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response("reservation") });
  const port = reservation.port;
  reservation.stop(true);
  const cmd = "sleep 5 # --port " + port;
  const externalScript =
    "const marker = " + JSON.stringify(cmd) + ";\\n" +
    "const server = Bun.serve({ port: " + port + ", fetch: () => new Response('alive') });\\n" +
    "setInterval(() => {}, 1000);\\n";
  const external = Bun.spawn([process.execPath, "-e", externalScript], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForAsync(async () => {
    try {
      return (await (await fetch("http://127.0.0.1:" + port)).text()) === "alive";
    } catch {
      return false;
    }
  }, 1500);
  await Bun.write(join(stateDir, name + ".pid"), external.pid + "\\n");
  if (scenario === "corrupt-pid") {
    await Bun.write(join(stateDir, name + ".identity.json"), "not-json\\n");
  }
  const handle = manager().start(makeInstance(cmd));
  await waitFor(() => handle.state === "backoff");
  const response = await fetch("http://127.0.0.1:" + port);
  result = { state: handle.state, alive: (await response.text()) === "alive" };
  await handle.stop();
  external.kill("SIGTERM");
  await external.exited;
} else if (scenario === "lsof-failure") {
  const helper = await makeHelper("exit 2");
  const handle = manager({ lsofPath: helper }).start(makeInstance("sleep 5 # --port 43123"));
  await waitFor(() => handle.state === "blocked");
  result = { state: handle.state, lastError: handle.snapshot.lastError };
  await handle.stop();
} else if (scenario === "lsof-timeout") {
  const helper = await makeHelper("sleep 3");
  const handle = manager({ lsofPath: helper }).start(makeInstance("sleep 5 # --port 43124"));
  await waitFor(() => handle.state === "blocked", 3500);
  result = { state: handle.state, lastError: handle.snapshot.lastError };
  await handle.stop();
} else if (scenario === "lsof-overflow") {
  const helper = await makeHelper("head -c 2000000 /dev/zero");
  const handle = manager({ lsofPath: helper }).start(makeInstance("sleep 5 # --port 43125"));
  await waitFor(() => handle.state === "blocked");
  result = { state: handle.state, lastError: handle.snapshot.lastError };
  await handle.stop();
} else if (scenario === "ps-failure") {
  const helper = await makeHelper("exit 2");
  const handle = manager({ psPath: helper }).start(makeInstance("exec sleep 5"));
  await waitFor(() => handle.state === "running");
  const pid = handle.pid;
  await handle.stop();
  result = { state: handle.state, alive: isAlive(pid) };
} else if (scenario === "port") {
  const upstream = Bun.serve({ port: 0, fetch: () => new Response("alive") });
  const handle = manager().start(makeInstance("sleep 5 --port " + upstream.port));
  await waitFor(() => handle.state === "backoff");
  const response = await fetch("http://127.0.0.1:" + upstream.port);
  result = { state: handle.state, alive: (await response.text()) === "alive" };
  await handle.stop();
  await upstream.stop(true);
} else if (scenario === "established-not-listen") {
  const helper = await makeHelper(
    'for arg in "$@"; do case "$arg" in *LISTEN*) exit 1 ;; esac; done; echo 1; exit 0',
  );
  const handle = manager({ lsofPath: helper }).start(makeInstance("sleep 5 --port 43126"));
  await waitFor(() => handle.state === "running" || handle.state === "blocked");
  result = { state: handle.state, lastError: handle.snapshot.lastError };
  await handle.stop();
}
cleanup();
console.log(JSON.stringify(result));
`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		cwd: join(import.meta.dir, "../.."),
		env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [output, errorOutput] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(
			`process-manager worker failed (${exitCode}): ${output}\n${errorOutput}`,
		);
	}
	return JSON.parse(output.trim()) as WorkerResult;
}

test("missing cwd blocks only the affected managed instance", async () => {
	const result = await runWorker("missing-cwd");

	expect(result.state).toBe("blocked");
	expect(result.lastError).toContain("working directory");
});

test("missing systemd-cat uses the direct-process fallback", async () => {
	const result = await runWorker("journal-fallback");

	expect(result.state).toBe("running");
	expect(result.pid).toBeGreaterThan(0);
	expect(result.identityExists).toBe(true);
});

test("an existing but failing logger cannot block the managed command", async () => {
	const result = await runWorker("journal-failure");

	expect(result.state).toBe("running");
	expect(result.pid).toBeGreaterThan(0);
});

test("immediate exits enter bounded exponential backoff", async () => {
	const result = await runWorker("backoff");

	expect(result.state).toBe("backoff");
	expect(result.restartAttempts).toBeGreaterThanOrEqual(1);
	expect(result.nextRetryAt).not.toBeNull();
	expect(result.stopMs).toBeLessThan(1_000);
});

test("concurrent restart requests terminate and start one managed process", async () => {
	const result = await runWorker("restart");

	expect(result.state).toBe("running");
	expect(result.pid).toBeGreaterThan(0);
	expect(result.newPid).toBeGreaterThan(0);
	expect(result.newPid).not.toBe(result.pid);
});

test("restart during starting waits for the replacement process", async () => {
	const result = await runWorker("restart-starting");

	expect(result.state).toBe("running");
	expect(result.pid).toBeGreaterThan(0);
	expect(result.elapsedMs).toBeGreaterThan(100);
});

test("restart during backoff waits until a process is running", async () => {
	const result = await runWorker("restart-backoff");

	expect(result.state).toBe("running");
	expect(result.pidAtRestartReturn).toBeGreaterThan(0);
});

test("restart and stop remove stubborn descendants after the root exits", async () => {
	const result = await runWorker("stubborn-descendant");

	expect(result.state).toBe("stopped");
	expect(result.oldChildAlive).toBe(false);
	expect(result.newChildAlive).toBe(false);
});

test("a stale pid file never authorizes killing an external port occupant", async () => {
	const result = await runWorker("stale-pid");

	expect(result.state).toBe("backoff");
	expect(result.alive).toBe(true);
});

test("a corrupt identity sidecar is treated as unowned", async () => {
	const result = await runWorker("corrupt-pid");

	expect(result.state).toBe("backoff");
	expect(result.alive).toBe(true);
});

test("lsof helper failure blocks a port-bearing instance", async () => {
	const result = await runWorker("lsof-failure");

	expect(result.state).toBe("blocked");
	expect(result.lastError).toContain("lsof helper failed");
});

test("lsof helper timeout blocks instead of assuming an empty port", async () => {
	const result = await runWorker("lsof-timeout");

	expect(result.state).toBe("blocked");
	expect(result.lastError).toContain("timed out");
});

test("lsof output overflow blocks instead of assuming an empty port", async () => {
	const result = await runWorker("lsof-overflow");

	expect(result.state).toBe("blocked");
	expect(result.lastError).toContain("output exceeded");
});

test("ps helper failure does not leave stop waiting forever", async () => {
	const result = await runWorker("ps-failure");

	expect(result.state).toBe("stopped");
	expect(result.alive).toBe(false);
});

test("port cleanup refuses to kill an external process", async () => {
	const result = await runWorker("port");

	expect(result.state).toBe("backoff");
	expect(result.alive).toBe(true);
});

test("established sockets on a port do not count as occupancy", async () => {
	const result = await runWorker("established-not-listen");

	expect(result.state).toBe("running");
});

