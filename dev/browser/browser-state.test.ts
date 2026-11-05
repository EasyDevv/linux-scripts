import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "browser-state-test-"));
process.env.BROWSER_STATE_DIR = join(home, "state");
const { claimPortLock, portLockPath, readPortLock } = await import("./browser-state.ts");

afterAll(() => {
	delete process.env.BROWSER_STATE_DIR;
	rmSync(home, { recursive: true, force: true });
});

const seed = (port: number) => ({
	port,
	requestedPort: port,
	owner: "test",
	userDataDir: "/tmp/x",
	url: "about:blank",
	browserSource: "launching" as const,
});

test("a torn lock reads as held, not as an error", async () => {
	mkdirSync(join(home, "state/locks"), { recursive: true });
	writeFileSync(portLockPath(9991), "");
	const lock = await readPortLock(9991);
	expect(lock?.owner).toBe("unreadable-lock");
});

test("concurrent claims on one port: exactly one wins, none throws", async () => {
	const results = await Promise.all(Array.from({ length: 8 }, () => claimPortLock(seed(9992))));
	expect(results.filter((r) => r.acquired)).toHaveLength(1);
});
