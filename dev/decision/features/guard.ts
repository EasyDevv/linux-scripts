/**
 * guard: deterministic pre-flight for the tool calls that failed most in real sessions, and a hint
 * for the edit failures models retry blindly.
 *
 * Every rule is code, never Jev: a shell call asks once per call, so the answer must be immediate.
 * Rules (CONTRACTS.md › `POST /v1/guard`):
 * - `pkill_self`: `pkill -f <pat>` also matches the shell running it (its argv holds `<pat>`), so the
 *   shell dies with 143/144 before the rest of the command runs. `-A` (procps-ng ≥ 4.0.3) skips the
 *   caller's ancestors and still kills the target.
 * - `quote_glob`: a glob meant for the program (`--include=*.ts`, `-name *.md`) is expanded by the
 *   shell first; zsh fails with "no matches found", bash may pass a wrong file list.
 * - `wide_search`: `find ~`, `grep -r … ~`, `rg … /` walk the whole tree and time out; so do the
 *   `find`/`grep` tools of pi rooted at `~` or `/` (a recursive SKILL.md glob over the home dir ran
 *   44 min in a pi session). Claude Code searches through Bash, so both harnesses get the same answer.
 * - `wait_loop` (not pi, which has no background mode): `until grep -q done tasks/x.output; do
 *   sleep 20; done` in the foreground waits on a background task past the 120 s Bash timeout; the
 *   harness notifies on exit instead.
 * - `edit_hint`: "Could not find" alone sends the model into re-read/retry spirals; say where the
 *   closest match is and which line differs, escaped so tabs and backslashes show.
 * - `path_resolve` (path-resolve.ts): a `read`/`edit`/`find`/`grep`/`ls` on a path that does not
 *   exist. A skill file under the wrong `.agents/skills-*` folder is rewritten to where it lives
 *   before the call runs; any other miss gets the nearest existing directory's entries appended to
 *   the failure, so no `ls`/`find` turn follows.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { describeMissing, resolveMissing } from "./path-resolve.ts";
import type { FeatureDef, FeatureResult } from "./types.ts";
import { isRecord, str } from "./types.ts";

export type GuardRule = "pkill_self" | "quote_glob" | "wide_search" | "wait_loop" | "edit_hint" | "path_resolve";

export interface GuardInput {
	harness?: string;
	cwd?: string;
	phase: "call" | "result";
	tool: string;
	args: Record<string, unknown>;
	output?: string;
	isError?: boolean;
}

export interface GuardResult extends FeatureResult {
	action: "none" | "rewrite" | "deny" | "hint";
	rules: GuardRule[];
	args?: Record<string, unknown>;
	message?: string;
	notice?: string;
}

const MARKER = "[decision:guard]";
const SHELL_TOOLS = new Set(["bash", "Bash"]);
const EDIT_TOOLS = new Set(["edit", "Edit"]);
/** Tools whose `path` / `file_path` must exist (`write` creates files, so it is not here). */
const PATH_TOOLS = new Set(["read", "Read", "edit", "Edit", "find", "grep", "ls"]);
const MISSING_OUTPUT = /ENOENT|Path not found|File does not exist|No such file or directory/u;

// ── shell words ─────────────────────────────────────────────────────────────────────────────

export interface Word {
	/** Source text, quotes included. */
	raw: string;
	/** The word with quotes removed (best effort; expansions stay literal). */
	value: string;
	start: number;
	end: number;
	/** No quote, backslash, or expansion anywhere in the word. */
	plain: boolean;
}

/** Simple commands of a shell line: words split at `;` `&&` `||` `|` `&` newline and bare parens. */
export function simpleCommands(cmd: string): Word[][] {
	const groups: Word[][] = [];
	let group: Word[] = [];
	let word: Word | undefined;
	const heredocs: string[] = [];
	const endWord = () => {
		if (word) group.push(word);
		word = undefined;
	};
	const endGroup = () => {
		endWord();
		if (group.length > 0) groups.push(group);
		group = [];
	};
	const take = (i: number, raw: string, value: string, plain: boolean) => {
		word ??= { raw: "", value: "", start: i, end: i, plain: true };
		word.raw += raw;
		word.value += value;
		word.end = i + raw.length;
		word.plain &&= plain;
	};
	/** Index just past the char that closes `open` at `i`, honouring nesting and quotes. */
	const balanced = (i: number, open: string, close: string): number => {
		let depth = 0;
		for (let j = i; j < cmd.length; j++) {
			const c = cmd[j];
			if (c === "\\") j++;
			else if (c === "'") j = cmd.indexOf("'", j + 1) === -1 ? cmd.length : cmd.indexOf("'", j + 1);
			else if (c === open) depth++;
			else if (c === close && --depth === 0) return j + 1;
		}
		return cmd.length;
	};

	let i = 0;
	while (i < cmd.length) {
		const c = cmd[i] as string;
		if (c === " " || c === "\t") {
			endWord();
			i++;
		} else if (c === "\n") {
			endGroup();
			i++;
			// Heredoc bodies are data, not commands.
			while (heredocs.length > 0 && i < cmd.length) {
				const eol = cmd.indexOf("\n", i);
				const line = cmd.slice(i, eol === -1 ? cmd.length : eol);
				i = eol === -1 ? cmd.length : eol + 1;
				if (line.trim() === heredocs[0]) heredocs.shift();
			}
		} else if (c === "#" && !word) {
			const eol = cmd.indexOf("\n", i);
			i = eol === -1 ? cmd.length : eol;
		} else if (c === "'") {
			const close = cmd.indexOf("'", i + 1);
			const end = close === -1 ? cmd.length : close + 1;
			take(i, cmd.slice(i, end), cmd.slice(i + 1, close === -1 ? end : close), false);
			i = end;
		} else if (c === '"') {
			let j = i + 1;
			while (j < cmd.length && cmd[j] !== '"') j += cmd[j] === "\\" ? 2 : 1;
			const end = Math.min(j + 1, cmd.length);
			take(i, cmd.slice(i, end), cmd.slice(i + 1, j).replace(/\\(["\\$`])/gu, "$1"), false);
			i = end;
		} else if (c === "\\") {
			take(i, cmd.slice(i, i + 2), cmd.slice(i + 1, i + 2), false);
			i += 2;
		} else if (c === "$" && (cmd[i + 1] === "(" || cmd[i + 1] === "{")) {
			const end = balanced(i + 1, cmd[i + 1] as string, cmd[i + 1] === "(" ? ")" : "}");
			take(i, cmd.slice(i, end), cmd.slice(i, end), false);
			i = end;
		} else if (c === "$") {
			take(i, c, c, false);
			i++;
		} else if (c === "`") {
			const close = cmd.indexOf("`", i + 1);
			const end = close === -1 ? cmd.length : close + 1;
			take(i, cmd.slice(i, end), cmd.slice(i, end), false);
			i = end;
		} else if (c === "<" && cmd.startsWith("<<", i) && !cmd.startsWith("<<<", i)) {
			endWord();
			const m = /^<<-?[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z_][\w-]*))/u.exec(cmd.slice(i));
			if (m) heredocs.push(m[1] ?? m[2] ?? m[3] ?? "");
			i += m ? m[0].length : 2;
		} else if (c === ";" || c === "|" || (c === "&" && !(word && /[<>]$/u.test(word.raw)))) {
			endGroup();
			i += cmd[i + 1] === c ? 2 : 1;
		} else if ((c === "(" || c === ")" || c === "{" || c === "}") && !word) {
			endGroup();
			i++;
		} else {
			take(i, c, c, true);
			i++;
		}
	}
	endGroup();
	return groups;
}

/** Words that run the next word as the command. */
const PREFIX = new Set([
	"sudo",
	"env",
	"nohup",
	"time",
	"exec",
	"command",
	"setsid",
	"nice",
	"then",
	"do",
	"else",
	"!",
]);

/** Index of the command word in a simple command (after assignments and prefixes), else -1. */
export function commandIndex(words: readonly Word[]): number {
	for (let i = 0; i < words.length; i++) {
		const w = words[i] as Word;
		if (/^[A-Za-z_]\w*=/u.test(w.raw) || PREFIX.has(w.value)) continue;
		if (w.value === "timeout") {
			while (words[i + 1]?.value.startsWith("-")) i++;
			i++; // the duration
			continue;
		}
		return i;
	}
	return -1;
}

// ── call rules ──────────────────────────────────────────────────────────────────────────────

interface Splice {
	start: number;
	end: number;
	text: string;
}

function applySplices(cmd: string, splices: Splice[]): string {
	let out = cmd;
	for (const s of [...splices].sort((a, b) => b.start - a.start))
		out = out.slice(0, s.start) + s.text + out.slice(s.end);
	return out;
}

/** `-f`, `--full`, or a short cluster holding `f` (`-9f`, `-af`); signal names are upper case. */
function isFullFlag(v: string): boolean {
	return v === "--full" || (/^-[a-z0-9]+$/u.test(v) && v.includes("f"));
}

function isAncestorFlag(v: string): boolean {
	return v === "--ignore-ancestors" || (/^-[a-zA-Z0-9]+$/u.test(v) && v.includes("A"));
}

function pkillSelf(groups: Word[][]): Splice[] {
	const out: Splice[] = [];
	for (const words of groups) {
		const at = commandIndex(words);
		const cmd = words[at];
		if (cmd?.value !== "pkill") continue;
		const args = words.slice(at + 1);
		if (args.some((w) => isFullFlag(w.value)) && !args.some((w) => isAncestorFlag(w.value)))
			out.push({ start: cmd.end, end: cmd.end, text: " -A" });
	}
	return out;
}

/** Options whose next word is a pattern for the program, not for the shell. */
const PATTERN_OPTS = new Set([
	"-name",
	"-iname",
	"-path",
	"-ipath",
	"-wholename",
	"-iwholename",
	"-lname",
	"-ilname",
	"--include",
	"--exclude",
	"--exclude-dir",
	"--glob",
	"--iglob",
	"-g",
]);

function quoteGlob(groups: Word[][]): Splice[] {
	const out: Splice[] = [];
	for (const words of groups) {
		const at = commandIndex(words);
		for (let i = at + 1; at >= 0 && i < words.length; i++) {
			const w = words[i] as Word;
			if (!w.plain || !/[*?]/u.test(w.raw)) continue;
			const option = /^--?[A-Za-z][\w-]*=/u.exec(w.raw)?.[0] ?? "";
			if (option !== "" || PATTERN_OPTS.has(words[i - 1]?.value ?? ""))
				out.push({
					start: w.start + option.length,
					end: w.end,
					text: `'${w.raw.slice(option.length)}'`,
				});
		}
	}
	return out;
}

const MAX_DEPTH = 3;

function wholeTreeRoots(home: string): Set<string> {
	const h = home.replace(/\/+$/u, "");
	return new Set(["~", "~/", "$HOME", "$HOME/", "${HOME}", "${HOME}/", h, `${h}/`, "/", "/home", "/home/"]);
}

/** The first `find`/`grep -r`/`rg` over a whole tree, as `find ~`, else undefined. */
function wideSearch(groups: Word[][], home: string): string | undefined {
	const roots = wholeTreeRoots(home);
	const isRoot = (w: Word) => roots.has(w.raw) || roots.has(w.value);
	for (const words of groups) {
		const at = commandIndex(words);
		const cmd = words[at]?.value;
		const args = words.slice(at + 1);
		const depthOk = (flags: readonly string[]) =>
			args.some((w, i) => {
				const m = /^(?:-maxdepth|--max-depth|-d)(?:=(\d+))?$/u.exec(w.value);
				if (!m || !flags.some((f) => w.value.startsWith(f))) return false;
				const n = Number(m[1] ?? args[i + 1]?.value);
				return Number.isFinite(n) && n <= MAX_DEPTH;
			});
		if (cmd === "find") {
			// Roots come before the first expression word.
			const firstExpr = args.findIndex((w) => /^[-(!]/u.test(w.value));
			const hit = (firstExpr === -1 ? args : args.slice(0, firstExpr)).find(isRoot);
			if (hit && !depthOk(["-maxdepth"])) return `find ${hit.raw}`;
		} else if (cmd === "grep" || cmd === "egrep") {
			const recursive = args.some(
				(w) => w.value === "--recursive" || w.value === "--dereference-recursive" || /^-[a-zA-Z]*[rR]/u.test(w.value),
			);
			const hit = args.find(isRoot);
			if (recursive && hit) return `grep -r … ${hit.raw}`;
		} else if (cmd === "rg") {
			const hit = args.find(isRoot);
			if (hit && !depthOk(["--max-depth", "-d"])) return `rg … ${hit.raw}`;
		}
	}
	return undefined;
}

/** pi's search tools, which take `pattern` and `path`. Claude Code has none: its searches run through Bash. */
const SEARCH_TOOLS = new Set(["find", "grep"]);

/** `~`, `$HOME` and relative paths resolved to an absolute path without a trailing slash. */
function absPath(p: string, home: string, cwd: string | undefined): string | undefined {
	const h = home.replace(/\/+$/u, "");
	const expanded = p.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/u, h);
	if (!isAbsolute(expanded) && cwd === undefined) return undefined;
	const abs = resolve(cwd ?? "/", expanded);
	return abs.length > 1 ? abs.replace(/\/+$/u, "") : abs;
}

/**
 * A search tool call rooted at `~`, `/` or `/home`, as `find /home/user`, else undefined. The root is
 * `path`, else the static directory prefix of an absolute `find` pattern, else the cwd.
 */
function wideSearchTool(
	tool: string,
	args: Record<string, unknown>,
	home: string,
	cwd: string | undefined,
): string | undefined {
	const pattern = str(args.pattern) ?? "";
	let base = str(args.path);
	if (base === undefined && tool === "find" && /^(?:\/|~|\$HOME|\$\{HOME\})/u.test(pattern)) {
		const wild = pattern.search(/[*?[{]/u);
		const literal = wild === -1 ? pattern : pattern.slice(0, wild);
		base = literal.slice(0, literal.lastIndexOf("/") + 1) || "/";
	}
	const root = absPath(base ?? ".", home, cwd);
	if (root === undefined) return undefined;
	const h = home.replace(/\/+$/u, "");
	return new Set([h, "/", "/home"]).has(root) ? `${tool} ${base ?? root}` : undefined;
}

function wideDenied(wide: string, depthHint = ""): GuardResult {
	return result("deny", ["wide_search"], {
		message: `${MARKER} Blocked \`${wide}\`: it walks the whole tree and times out. Name the directories to search (~/.agents ~/.config ~/dev …), ${depthHint}or find a file by name with \`fd <name> <dir>\`.`,
		notice: `guard: blocked ${wide} (whole-tree search)`,
	});
}

const TASK_OUTPUT = /\/tasks\/|\.(?:output|out|log)\b/u;

/** A foreground `until`/`while` loop that sleeps while polling a task output file. */
function waitLoop(groups: Word[][]): boolean {
	const loop = groups.some((words) => {
		const head = words[0]?.value;
		return (head === "until" || head === "while") && words.some((w) => TASK_OUTPUT.test(w.value));
	});
	return loop && groups.some((words) => words[commandIndex(words)]?.value === "sleep");
}

export interface CallContext {
	harness?: string;
	/** Claude `run_in_background: true`: the call cannot hit the foreground timeout. */
	background?: boolean;
}

export function guardCall(command: string, home = homedir(), ctx: CallContext = {}): GuardResult {
	const groups = simpleCommands(command);
	if (ctx.harness !== "pi" && ctx.background !== true && waitLoop(groups)) {
		return result("deny", ["wait_loop"], {
			message: `${MARKER} Blocked a foreground wait loop: it outlives the 120 s Bash timeout. A background task notifies you when it exits, so end the turn or do other work; to wait on a condition, run the same loop with run_in_background: true or use Monitor.`,
			notice: "guard: blocked foreground wait loop (use background/Monitor)",
		});
	}
	const wide = wideSearch(groups, home);
	if (wide !== undefined) return wideDenied(wide, `add -maxdepth ${MAX_DEPTH} / --max-depth ${MAX_DEPTH}, or `);
	const rules: GuardRule[] = [];
	const splices: Splice[] = [];
	/** For the model: what changed and why. */
	const notes: string[] = [];
	/** For the person: what changed, short. */
	const shown: string[] = [];
	const pk = pkillSelf(groups);
	if (pk.length > 0) {
		rules.push("pkill_self");
		splices.push(...pk);
		notes.push("added -A to `pkill -f` so it cannot match and kill its own shell");
		shown.push("pkill -f → pkill -A -f");
	}
	const qg = quoteGlob(groups);
	if (qg.length > 0) {
		const quoted = qg.map((s) => s.text).join(" ");
		rules.push("quote_glob");
		splices.push(...qg);
		notes.push(`quoted ${quoted} so the program, not the shell, expands the pattern`);
		shown.push(`quoted ${quoted}`);
	}
	if (rules.length === 0) return result("none", []);
	return result("rewrite", rules, {
		args: { command: applySplices(command, splices) },
		message: `${MARKER} Ran with changes: ${notes.join("; ")}.`,
		notice: `guard: ${shown.join(", ")}`,
	});
}

// ── edit hint ───────────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 2_000_000;
const SHOW_LINES = 3;
const SHOW_CHARS = 200;

interface EditSpec {
	oldText: string;
}

/** The edits of a pi `edit` (`edits[]` or one `oldText`) or a Claude `Edit` (`old_string`). */
function editSpecs(args: Record<string, unknown>): EditSpec[] {
	if (Array.isArray(args.edits))
		return args.edits.map((e) => ({
			oldText: isRecord(e) ? (str(e.oldText) ?? str(e.old_string) ?? "") : "",
		}));
	const one = str(args.oldText) ?? str(args.old_string);
	return one === undefined ? [] : [{ oldText: one }];
}

function lineOf(text: string, offset: number): number {
	let n = 1;
	for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) n++;
	return n;
}

function span(text: string, needle: string): [number, number] | undefined {
	const at = text.indexOf(needle);
	if (at === -1 || needle === "") return undefined;
	return [lineOf(text, at), lineOf(text, at + needle.length - 1)];
}

const show = (s: string) => JSON.stringify(s.length > SHOW_CHARS ? `${s.slice(0, SHOW_CHARS)}…` : s);

/** Where `needle` most nearly sits in `text`, by lines equal once indentation is ignored. */
export function closestMatch(text: string, needle: string): string {
	const file = text.split("\n");
	const want = needle.split("\n");
	const index = new Map<string, number[]>();
	file.forEach((line, i) => {
		const key = line.trim();
		if (key.length >= 3) index.set(key, [...(index.get(key) ?? []), i]);
	});
	const votes = new Map<number, number>();
	want.forEach((line, j) => {
		for (const i of index.get(line.trim()) ?? []) votes.set(i - j, (votes.get(i - j) ?? 0) + 1);
	});
	let start = -1;
	let best = 0;
	for (const [s, v] of votes) if (v > best || (v === best && s < start)) [start, best] = [s, v];
	if (start === -1)
		return "No line of it occurs in the file, even ignoring indentation: the file is not what you remember. Read it again before editing.";
	const from = Math.max(0, start);
	const lines = `${from + 1}-${Math.min(file.length, start + want.length)}`;
	const diffs: string[] = [];
	for (let j = 0; j < want.length && diffs.length < SHOW_LINES; j++) {
		const have = file[start + j];
		if (have === want[j]) continue;
		diffs.push(
			`  line ${start + j + 1}\n    oldText: ${show(want[j] ?? "")}\n    file:    ${have === undefined ? "(past end of file)" : show(have)}`,
		);
	}
	const head = `Closest match: lines ${lines} (${best}/${want.length} lines equal ignoring indentation).`;
	if (diffs.length === 0) return `${head} Every line is equal; check line endings (\\r) and the trailing newline.`;
	return `${head} First differences (JSON-escaped, so tabs and backslashes show):\n${diffs.join("\n")}\nCopy the file's text exactly.`;
}

function readTarget(
	args: Record<string, unknown>,
	cwd: string | undefined,
	home: string,
): { path: string; text: string } | undefined {
	const raw = str(args.path) ?? str(args.file_path);
	if (!raw) return undefined;
	const expanded = raw.replace(/^~(?=\/|$)/u, home);
	const path = isAbsolute(expanded) ? expanded : resolve(cwd ?? process.cwd(), expanded);
	try {
		if (statSync(path).size > MAX_FILE_BYTES) return undefined;
		return { path, text: readFileSync(path, "utf8") };
	} catch {
		return undefined;
	}
}

export function guardEditResult(input: GuardInput, home = homedir()): GuardResult {
	const output = input.output ?? "";
	const specs = editSpecs(input.args);
	if (specs.length === 0) return result("none", []);
	const target = readTarget(input.args, input.cwd, home);
	if (!target) return result("none", []);
	const name = basename(target.path);
	const label = (i: number) => (Array.isArray(input.args.edits) ? `edits[${i}].oldText` : "oldText");

	let body: string | undefined;
	const overlap = /edits\[(\d+)\] and edits\[(\d+)\] overlap/u.exec(output);
	const repeated = /Found (\d+) (?:occurrences|matches) of (?:edits\[(\d+)\]|the)/u.exec(output);
	const missing = /Could not find (?:edits\[(\d+)\]|the exact text)|String to replace not found/u.exec(output);
	if (overlap) {
		const [a, b] = [Number(overlap[1]), Number(overlap[2])];
		const where = (i: number) => {
			const s = span(target.text, specs[i]?.oldText ?? "");
			return s ? `lines ${s[0]}-${s[1]}` : "not found";
		};
		body = `${label(a)} spans ${where(a)} and ${label(b)} ${where(b)} of ${name}. Merge them into one edit whose oldText covers both.`;
	} else if (repeated) {
		const i = Number(repeated[2] ?? 0);
		const needle = specs[i]?.oldText ?? "";
		const at: number[] = [];
		for (
			let k = target.text.indexOf(needle);
			needle !== "" && k !== -1 && at.length < 8;
			k = target.text.indexOf(needle, k + 1)
		)
			at.push(lineOf(target.text, k));
		body = `${label(i)} occurs at lines ${at.join(", ")} of ${name}. Add a neighbouring line that differs so it is unique.`;
	} else if (missing) {
		const i = Number(missing[1] ?? 0);
		body = `${label(i)} in ${name}: ${closestMatch(target.text, specs[i]?.oldText ?? "")}`;
	}
	if (body === undefined) return result("none", []);
	return result("hint", ["edit_hint"], {
		message: `${MARKER} ${body}`,
		notice: `guard: edit hint for ${name}`,
	});
}

// ── path resolve ────────────────────────────────────────────────────────────────────────────

/** The path argument: pi `path`, Claude `file_path`. */
function pathKey(args: Record<string, unknown>): "path" | "file_path" | undefined {
	return str(args.path) ? "path" : str(args.file_path) ? "file_path" : undefined;
}

/** A call on a missing path whose skill lives elsewhere runs with the right path. */
function guardPathCall(input: GuardInput, home: string): GuardResult {
	const key = pathKey(input.args);
	const raw = key && str(input.args[key]);
	if (!key || !raw) return result("none", []);
	const r = resolveMissing(raw, { home, cwd: input.cwd });
	if (r?.kind !== "rewrite") return result("none", []);
	return result("rewrite", ["path_resolve"], {
		args: { ...input.args, [key]: r.path },
		message: `${MARKER} \`${r.from}\` did not exist (${r.why}); ran with \`${r.path}\`. Use that path from now on.`,
		notice: `guard: ${basename(r.from)} → ${r.path}`,
	});
}

/** A failed call on a missing path learns where to look instead. */
function guardPathResult(input: GuardInput, home: string): GuardResult {
	const key = pathKey(input.args);
	const raw = key && str(input.args[key]);
	if (!key || !raw || !MISSING_OUTPUT.test(input.output ?? "")) return result("none", []);
	const r = resolveMissing(raw, { home, cwd: input.cwd });
	if (!r) return result("none", []);
	const message =
		r.kind === "rewrite" ? `\`${r.from}\` does not exist; \`${r.path}\` does (${r.why}).` : describeMissing(r);
	return result("hint", ["path_resolve"], {
		message: `${MARKER} ${message}`,
		notice: `guard: path hint for ${basename(raw)}`,
	});
}

// ── feature ─────────────────────────────────────────────────────────────────────────────────

function result(action: GuardResult["action"], rules: GuardRule[], extra: Partial<GuardResult> = {}): GuardResult {
	return {
		status: "routed",
		reason: rules.length > 0 ? rules.join(", ") : "clear",
		notes: [],
		action,
		rules,
		...extra,
	};
}

export function guard(input: GuardInput, home = homedir()): GuardResult {
	if (input.phase === "call" && SHELL_TOOLS.has(input.tool)) {
		const command = str(input.args.command);
		if (command === undefined) return result("none", []);
		return guardCall(command, home, {
			harness: input.harness,
			background: input.args.run_in_background === true,
		});
	}
	if (input.phase === "call" && SEARCH_TOOLS.has(input.tool)) {
		const wide = wideSearchTool(input.tool, input.args, home, input.cwd);
		if (wide !== undefined) return wideDenied(wide);
	}
	if (input.phase === "call" && PATH_TOOLS.has(input.tool)) return guardPathCall(input, home);
	if (input.phase === "result" && PATH_TOOLS.has(input.tool) && input.isError) {
		const edit = EDIT_TOOLS.has(input.tool) ? guardEditResult(input, home) : result("none", []);
		return edit.action === "none" ? guardPathResult(input, home) : edit;
	}
	return {
		...result("none", []),
		status: "skipped",
		reason: "no rule for this tool",
	};
}

function parseGuardInput(b: Record<string, unknown>): GuardInput | string {
	const phase = b.phase;
	if (phase !== "call" && phase !== "result") return "phase must be call or result";
	const tool = str(b.tool);
	if (!tool) return "tool is required";
	if (!isRecord(b.args)) return "args must be an object";
	return {
		harness: str(b.harness),
		cwd: str(b.cwd),
		phase,
		tool,
		args: b.args,
		output: str(b.output),
		isError: b.isError === true,
	};
}

export const guardFeature: FeatureDef = {
	name: "guard",
	path: "/v1/guard",
	load() {
		return {
			version: "v1",
			parse: parseGuardInput,
			run: async (input) => guard(input as GuardInput),
		};
	},
	/** `expected`: `{action, rules?, command?}`; `command` is the rewritten shell line. */
	score(expected, r) {
		const want = isRecord(expected) ? expected : {};
		const got = r as GuardResult;
		const rules = Array.isArray(want.rules) ? JSON.stringify(want.rules) === JSON.stringify(got.rules) : true;
		const command = typeof want.command === "string" ? want.command === str(got.args?.command) : true;
		const path = typeof want.path === "string" ? want.path === (str(got.args?.path) ?? str(got.args?.file_path)) : true;
		return { exact: Number(want.action === got.action && rules && command && path) };
	},
	logs: (r) => (r as GuardResult).action !== "none",
};
