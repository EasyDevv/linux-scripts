import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closestMatch, guard, guardCall, simpleCommands } from "./guard.ts";

const HOME = "/home/user";
const call = (command: string) => guardCall(command, HOME);

describe("shell words", () => {
	test("quotes, expansions and heredoc bodies stay inside their word or out of the commands", () => {
		const groups = simpleCommands(`cd "a b" && echo $(pkill -f x) 'c;d'\ncat <<'EOF'\npkill -f inside\nEOF\nls`);
		expect(groups.map((g) => g.map((w) => w.value))).toEqual([
			["cd", "a b"],
			["echo", "$(pkill -f x)", "c;d"],
			["cat"],
			["ls"],
		]);
	});

	test("2>&1 is one word, not a background separator", () => {
		expect(simpleCommands("make 2>&1 | tail").map((g) => g.map((w) => w.raw))).toEqual([["make", "2>&1"], ["tail"]]);
	});
});

describe("pkill_self", () => {
	test("pkill -f gets -A, and the rest of the line is untouched", () => {
		const r = call("pkill -f target/debug/dashboard-native; sleep 1; setsid target/debug/dashboard-native &");
		expect(r.action).toBe("rewrite");
		expect(r.rules).toEqual(["pkill_self"]);
		expect(r.args?.command).toBe(
			"pkill -A -f target/debug/dashboard-native; sleep 1; setsid target/debug/dashboard-native &",
		);
		expect(r.message?.startsWith("[decision:guard]")).toBe(true);
		expect(r.notice).toContain("-A");
	});

	test("every pkill -f in the line, clusters and --full included", () => {
		const r = call(`pkill -f '.install-flow.ts'; pkill tauri-driver; pkill -9f WebKit && pkill --full "x y"`);
		expect(r.args?.command).toBe(
			`pkill -A -f '.install-flow.ts'; pkill tauri-driver; pkill -A -9f WebKit && pkill -A --full "x y"`,
		);
	});

	test("already -A, plain pkill, signal names, and pkill inside a heredoc stay as they are", () => {
		for (const c of [
			"pkill -A -f x",
			"pkill -fA x",
			"pkill spectacle",
			"pkill -TERM spectacle",
			"cat <<EOF\npkill -f x\nEOF",
		])
			expect(call(c).action).toBe("none");
	});
});

describe("quote_glob", () => {
	test("--include=*.ts and -name *.md are quoted for the program", () => {
		const r = call(`grep -rn "resolveMedia" --include=*.ts src; find . -name *.md -newer x`);
		expect(r.rules).toEqual(["quote_glob"]);
		expect(r.args?.command).toBe(`grep -rn "resolveMedia" --include='*.ts' src; find . -name '*.md' -newer x`);
	});

	test("a shell glob over files, quoted patterns and expansions are left alone", () => {
		for (const c of [
			"ls docs/*.md",
			`grep -rn x --include='*.ts' .`,
			"rg -g '*.svelte' x",
			"echo $?",
			'find . -name "$P"',
		])
			expect(call(c).action).toBe("none");
	});

	test("both rules in one line", () => {
		const r = call("pkill -f vite; rg -g *.ts foo src");
		expect(r.rules).toEqual(["pkill_self", "quote_glob"]);
		expect(r.args?.command).toBe("pkill -A -f vite; rg -g '*.ts' foo src");
	});
});

describe("wide_search", () => {
	test("find over ~, $HOME, the home path or / is denied with a way out", () => {
		for (const c of [
			'find ~ -path "*explore-domains/SKILL.md" 2>/dev/null | head',
			'find /home/user -type d -name "explore-domains"',
			"find $HOME -name x",
			"find / -path '*pi-coding-agent/dist/core/extensions/types.d.ts'",
			'ls ~/.agents/skills/x 2>/dev/null || find /home/user -maxdepth 4 -name "wv.ts"',
		]) {
			const r = call(c);
			expect(r.action).toBe("deny");
			expect(r.rules).toEqual(["wide_search"]);
			expect(r.message).toContain("fd <name> <dir>");
		}
	});

	test("grep -r and rg over the home tree are denied", () => {
		expect(call(`grep -ril "voxtype" ~ --exclude-dir=.cache`).action).toBe("deny");
		expect(call("rg -n foo ~/").action).toBe("deny");
	});

	test("a shallow find, a named directory, and non-recursive grep pass", () => {
		for (const c of [
			"find ~ -maxdepth 2 -name x",
			"find ~/.agents -name SKILL.md",
			"grep -n x ~/.zshrc",
			"rg -d 3 foo ~",
			"fd wv.ts ~",
		])
			expect(call(c).action).toBe("none");
	});
});

describe("wait_loop", () => {
	const poll =
		"until [ -s /tmp/claude-1000/example/tasks/b0.output ]; do sleep 20; done; cat /tmp/claude-1000/example/tasks/b0.output";

	test("a Claude foreground loop polling a task output is denied toward background/Monitor", () => {
		const r = guardCall(poll, HOME, { harness: "claude" });
		expect(r.action).toBe("deny");
		expect(r.rules).toEqual(["wait_loop"]);
		expect(r.message).toContain("run_in_background");
	});

	test("the same loop in the background, under pi, or polling a server is left alone", () => {
		expect(guardCall(poll, HOME, { harness: "claude", background: true }).action).toBe("none");
		expect(guardCall(poll, HOME, { harness: "pi" }).action).toBe("none");
		expect(
			guardCall("until curl -sf http://127.0.0.1:8080/health; do sleep 3; done", HOME, { harness: "claude" }).action,
		).toBe("none");
	});
});

describe("edit_hint", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	const file = join(dir, "yt.sh");
	writeFileSync(
		file,
		["#!/bin/bash", "ensure() {", '\tif [[ -x "$BIN" ]]; then', "\t\techo ok", "\tfi", "}", "x=1", "x=1", ""].join(
			"\n",
		),
	);
	const edit = (args: Record<string, unknown>, output: string) =>
		guard({ phase: "result", tool: "edit", args, output, isError: true, cwd: dir }, HOME);

	test("not found: the closest lines and the first differing line, escaped", () => {
		const r = edit(
			{
				path: "yt.sh",
				edits: [
					{ oldText: "x", newText: "y" },
					{
						oldText: 'ensure() {\n    if [[ -x "$BIN" ]]; then\n\t\techo ok',
						newText: "",
					},
				],
			},
			"Could not find edits[1] in yt.sh. The oldText must match exactly including all whitespace and newlines.",
		);
		expect(r.action).toBe("hint");
		expect(r.rules).toEqual(["edit_hint"]);
		expect(r.message).toContain(
			"edits[1].oldText in yt.sh: Closest match: lines 2-4 (3/3 lines equal ignoring indentation)",
		);
		expect(r.message).toContain("line 3");
		expect(r.message).toContain(String.raw`file:    "\tif [[ -x \"$BIN\" ]]; then"`);
	});

	test("overlap names both spans; duplicates name every line", () => {
		const overlap = edit(
			{
				path: file,
				edits: [{ oldText: "ensure() {\n\tif" }, { oldText: "\tif [[ -x" }],
			},
			"edits[0] and edits[1] overlap in yt.sh. Merge them into one edit or target disjoint regions.",
		);
		expect(overlap.message).toContain("edits[0].oldText spans lines 2-3 and edits[1].oldText lines 3-3 of yt.sh");
		const dup = edit(
			{ path: file, edits: [{ oldText: "x=1" }] },
			"Found 2 occurrences of edits[0] in yt.sh. Each oldText must be unique.",
		);
		expect(dup.message).toContain("occurs at lines 7, 8 of yt.sh");
	});

	test("Claude's Edit: old_string and its error text", () => {
		const r = guard(
			{
				phase: "result",
				tool: "Edit",
				args: { file_path: file, old_string: "\t\techo  ok" },
				output: "String to replace not found in file.",
				isError: true,
			},
			HOME,
		);
		expect(r.message).toContain("oldText in yt.sh");
	});

	test("nothing in common says to read the file again", () => {
		expect(closestMatch("a\nb\n", "zzz yyy")).toContain("Read it again");
	});

	test("a missing file, a success, or another error yields nothing", () => {
		expect(edit({ path: join(dir, "gone.sh"), oldText: "x" }, "Could not find the exact text").action).toBe("none");
		expect(guard({ phase: "result", tool: "edit", args: { path: file }, isError: false }, HOME).action).toBe("none");
		expect(edit({ path: file, oldText: "x" }, "EACCES").action).toBe("none");
	});
});

test("tools without a rule are skipped, not denied", () => {
	const r = guard({ phase: "call", tool: "read", args: { path: "a" } }, HOME);
	expect(r).toMatchObject({ status: "skipped", action: "none" });
});
