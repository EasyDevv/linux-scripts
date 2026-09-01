import { expect, test } from "bun:test";
import {
	runtimeStartComplete,
	runtimeStateFailure,
	runtimeStopComplete,
	type RuntimeSnapshotView,
} from "./readiness";

function snapshot(
	state: RuntimeSnapshotView["state"],
	overrides: Partial<RuntimeSnapshotView> = {},
): RuntimeSnapshotView {
	return {
		state,
		pid: 0,
		startedAt: null,
		restartAttempts: 0,
		nextRetryAt: null,
		lastExit: null,
		lastError: null,
		...overrides,
	};
}

test("runtime start failures expose blocked and backoff details", () => {
	const blocked = runtimeStateFailure(
		"web",
		"start",
		snapshot("blocked", { lastError: "working directory is unavailable" }),
	);
	const backoff = runtimeStateFailure(
		"api",
		"reload",
		snapshot("backoff", {
			lastExit: { exitCode: 1, signalCode: null, at: Date.now() },
		}),
	);

	expect(blocked).toContain("start blocked for web");
	expect(blocked).toContain("working directory is unavailable");
	expect(backoff).toContain("reload failed for api");
	expect(backoff).toContain("instance is in backoff");
	expect(backoff).toContain("exit 1");
	expect(runtimeStateFailure("web", "start", snapshot("running"))).toBeNull();
});

test("runtime state can confirm a start without journal output", () => {
	const running = snapshot("running", { pid: process.pid });

	expect(runtimeStartComplete(true, running, null, false)).toBe(true);
	expect(runtimeStartComplete(false, running, null, false)).toBe(false);
	expect(runtimeStartComplete(true, snapshot("blocked"), null, false)).toBe(false);
});

test("stop readiness requires an available runtime snapshot and a dead prior pid", () => {
	expect(runtimeStopComplete(true, null, 999_999_999)).toBe(true);
	expect(runtimeStopComplete(false, null, 999_999_999)).toBe(false);
	expect(runtimeStopComplete(true, null, process.pid)).toBe(false);
	expect(
		runtimeStopComplete(
			true,
			snapshot("stopping"),
			999_999_999,
		),
	).toBe(false);
});
