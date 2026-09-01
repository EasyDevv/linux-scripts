import { expect, test } from "bun:test";
import { journalLog, runText } from "./utils";

test("runText normalizes a missing executable without throwing", () => {
	const result = runText(["/executor-test/missing-executable"]);

	expect(result.ok).toBe(false);
	expect(result.success).toBe(false);
	expect(result.exitCode).toBeNull();
	expect(result.spawnError).not.toBeNull();
	expect(result.timedOut).toBe(false);
});

test("runText returns a bounded timeout result", () => {
	const result = runText(["/bin/sh", "-c", "sleep 1"], {
		timeoutMs: 25,
		maxBuffer: 1024,
	});

	expect(result.ok).toBe(false);
	expect(result.timedOut).toBe(true);
	expect(result.spawnError).toBeNull();
});

test("runText bounds subprocess output", () => {
	const result = runText(
		["/bin/sh", "-c", "printf 123456789; sleep 1"],
		{ timeoutMs: 1_000, maxBuffer: 4 },
	);

	expect(result.ok).toBe(false);
	expect(result.outputOverflow).toBe(true);
	expect(result.spawnError).toBeNull();
});

test("journalLog falls back without rejecting when systemd-cat is absent", async () => {
	const messages: string[] = [];
	const originalError = console.error;
	console.error = (...args: unknown[]) => messages.push(args.join(" "));

	try {
		await journalLog(
			"executor/test-journal-fallback",
			"[executor] fallback test\n",
			"/executor-test/missing-systemd-cat",
		);
	} finally {
		console.error = originalError;
	}

	expect(messages.join("\n")).toContain("journal logging unavailable");
	expect(messages.join("\n")).toContain("fallback test");
});
