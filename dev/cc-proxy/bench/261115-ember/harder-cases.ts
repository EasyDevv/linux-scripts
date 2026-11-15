// Harder cases (261115 round 2): long specs, many interacting edge rules, one multi-file task.
// Goal: a set where `low` fails often enough for effort to matter. Expected values come from the
// reference implementations below, never from a model.
import type { Case } from "./cases.ts";

type Ref = { id: string; spec: string; ref: (input: any) => unknown; inputs: unknown[]; files?: Record<string, string>; requiredPatterns?: Record<string, string[]> };

// ---------- expr ----------
function expr({ expr, vars }: { expr: string; vars: Record<string, number> }) {
	let i = 0;
	const s = expr;
	const ws = () => {
		while (i < s.length && /\s/.test(s[i]!)) i++;
	};
	const fail = () => {
		throw new Error("x");
	};
	const peek = () => (ws(), s[i]);
	const sum = (): number => {
		let v = term();
		for (;;) {
			const c = peek();
			if (c === "+" || c === "-") {
				i++;
				const r = term();
				v = c === "+" ? v + r : v - r;
			} else return v;
		}
	};
	const term = (): number => {
		let v = unary();
		for (;;) {
			const c = peek();
			if (c === "*" || c === "/" || c === "%") {
				i++;
				const r = unary();
				if ((c === "/" || c === "%") && r === 0) fail();
				v = c === "*" ? v * r : c === "/" ? v / r : v % r;
			} else return v;
		}
	};
	const unary = (): number => {
		const c = peek();
		if (c === "+" || c === "-") {
			i++;
			const v = unary();
			return c === "-" ? -v : v;
		}
		return power();
	};
	const power = (): number => {
		const b = primary();
		if (peek() === "^") {
			i++;
			return b ** unary();
		}
		return b;
	};
	const primary = (): number => {
		const c = peek();
		if (c === "(") {
			i++;
			const v = sum();
			if (peek() !== ")") fail();
			i++;
			return v;
		}
		const num = /^\d+(\.\d+)?/.exec(s.slice(i));
		if (num) {
			i += num[0].length;
			return Number(num[0]);
		}
		const id = /^[a-z_][a-z0-9_]*/.exec(s.slice(i));
		if (!id) fail();
		i += id![0].length;
		if (peek() === "(") {
			i++;
			const args: number[] = [];
			if (peek() !== ")") {
				args.push(sum());
				while (peek() === ",") {
					i++;
					args.push(sum());
				}
			}
			if (peek() !== ")") fail();
			i++;
			const name = id![0];
			if (name === "abs") {
				if (args.length !== 1) fail();
				return Math.abs(args[0]!);
			}
			if (name === "min" || name === "max") {
				if (args.length < 1) fail();
				return name === "min" ? Math.min(...args) : Math.max(...args);
			}
			fail();
		}
		if (!Object.hasOwn(vars, id![0])) fail();
		return vars[id![0]]!;
	};
	try {
		const v = sum();
		ws();
		if (i !== s.length) return null;
		return v;
	} catch {
		return null;
	}
}

// ---------- cron ----------
function cron({ expr, from, count }: { expr: string; from: string; count: number }) {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	const limits = [
		[0, 59],
		[0, 23],
		[1, 31],
		[1, 12],
		[0, 7],
	] as const;
	const sets: Set<number>[] = [];
	for (let f = 0; f < 5; f++) {
		const [lo, hi] = limits[f]!;
		const set = new Set<number>();
		for (const item of parts[f]!.split(",")) {
			const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
			if (!m) return null;
			let a: number, b: number;
			if (m[1] === "*") {
				a = lo;
				b = hi;
			} else {
				a = Number(m[2]);
				b = m[3] !== undefined ? Number(m[3]) : a;
				if (m[3] === undefined && m[4] !== undefined) return null; // "a/s" is not allowed
			}
			const step = m[4] !== undefined ? Number(m[4]) : 1;
			if (a < lo || b > hi || a > b || step < 1) return null;
			for (let v = a; v <= b; v += step) set.add(f === 4 && v === 7 ? 0 : v);
		}
		sets.push(set);
	}
	const domStar = parts[2] === "*",
		dowStar = parts[4] === "*";
	const out: string[] = [];
	let t = Math.floor(Date.parse(from) / 60000) * 60000 + 60000;
	const end = Date.parse(from) + 5 * 366 * 86400000;
	while (out.length < count && t <= end) {
		const d = new Date(t);
		const okDom = sets[2]!.has(d.getUTCDate()),
			okDow = sets[4]!.has(d.getUTCDay());
		const day = domStar && dowStar ? true : domStar ? okDow : dowStar ? okDom : okDom || okDow;
		if (sets[0]!.has(d.getUTCMinutes()) && sets[1]!.has(d.getUTCHours()) && sets[3]!.has(d.getUTCMonth() + 1) && day)
			out.push(d.toISOString().slice(0, 16) + "Z");
		t += 60000;
	}
	return out;
}

// ---------- jsonpatch ----------
function jsonpatch({ doc, ops }: { doc: unknown; ops: any[] }) {
	const bad = () => {
		throw new Error("x");
	};
	const tokens = (p: unknown) => {
		if (typeof p !== "string") bad();
		if (p === "") return [];
		if (!(p as string).startsWith("/")) bad();
		return (p as string)
			.slice(1)
			.split("/")
			.map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
	};
	const isIndex = (t: string) => /^(0|[1-9]\d*)$/.test(t);
	const get = (root: any, ts: string[]) => {
		let cur = root;
		for (const t of ts) {
			if (Array.isArray(cur)) {
				if (!isIndex(t) || Number(t) >= cur.length) bad();
				cur = cur[Number(t)];
			} else if (cur && typeof cur === "object") {
				if (!Object.hasOwn(cur, t)) bad();
				cur = cur[t];
			} else bad();
		}
		return cur;
	};
	const eq = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
	const sortKeys = (v: any): any =>
		Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
	try {
		let root: any = structuredClone(doc);
		const add = (ts: string[], value: unknown) => {
			if (!ts.length) {
				root = value;
				return;
			}
			const parent = get(root, ts.slice(0, -1));
			const last = ts.at(-1)!;
			if (Array.isArray(parent)) {
				if (last === "-") parent.push(value);
				else if (isIndex(last) && Number(last) <= parent.length) parent.splice(Number(last), 0, value);
				else bad();
			} else if (parent && typeof parent === "object") parent[last] = value;
			else bad();
		};
		const remove = (ts: string[]) => {
			if (!ts.length) bad();
			const parent = get(root, ts.slice(0, -1));
			const last = ts.at(-1)!;
			if (Array.isArray(parent)) {
				if (!isIndex(last) || Number(last) >= parent.length) bad();
				parent.splice(Number(last), 1);
			} else if (parent && typeof parent === "object") {
				if (!Object.hasOwn(parent, last)) bad();
				delete parent[last];
			} else bad();
		};
		for (const op of ops) {
			const path = tokens(op.path);
			if (op.op === "add") add(path, structuredClone(op.value));
			else if (op.op === "remove") remove(path);
			else if (op.op === "replace") {
				get(root, path);
				if (!path.length) root = structuredClone(op.value);
				else {
					remove(path);
					add(path, structuredClone(op.value));
				}
			} else if (op.op === "move") {
				const from = tokens(op.from);
				if (op.from === op.path) {
					get(root, from);
					continue;
				}
				if ((op.path as string).startsWith(`${op.from}/`)) bad();
				const value = get(root, from);
				remove(from);
				add(path, value);
			} else if (op.op === "copy") add(path, structuredClone(get(root, tokens(op.from))));
			else if (op.op === "test") {
				if (!eq(get(root, path), op.value)) bad();
			} else bad();
		}
		return root;
	} catch {
		return null;
	}
}

// ---------- bizdays ----------
function bizdays({ start, days, holidays }: { start: string; days: number; holidays: string[] }) {
	const hol = new Set(holidays);
	const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
	const business = (t: number) => {
		const d = new Date(t).getUTCDay();
		return d !== 0 && d !== 6 && !hol.has(iso(t));
	};
	let t = Date.parse(`${start}T00:00:00Z`);
	if (days === 0) {
		while (!business(t)) t += 86400000;
		return iso(t);
	}
	const step = days > 0 ? 86400000 : -86400000;
	let left = Math.abs(days);
	while (left > 0) {
		t += step;
		if (business(t)) left--;
	}
	return iso(t);
}

// ---------- kpath ----------
function kpath({ edges, from, to, k }: { edges: Array<[string, string, number]>; from: string; to: string; k: number }) {
	if (from === to) return { cost: 0, path: [from] };
	const best = new Map<string, number>();
	for (const [u, v, w] of edges) {
		const key = `${u}\u0000${v}`;
		if (!best.has(key) || w < best.get(key)!) best.set(key, w);
	}
	const out = new Map<string, Array<[string, number]>>();
	for (const [key, w] of best) {
		const [u, v] = key.split("\u0000") as [string, string];
		if (!out.has(u)) out.set(u, []);
		out.get(u)!.push([v, w]);
	}
	let found: { cost: number; path: string[] } | null = null;
	const better = (c: number, p: string[]) => {
		if (!found) return true;
		if (c !== found.cost) return c < found.cost;
		if (p.length !== found.path.length) return p.length < found.path.length;
		for (let i = 0; i < p.length; i++) if (p[i] !== found.path[i]) return p[i]! < found.path[i]!;
		return false;
	};
	const walk = (node: string, cost: number, path: string[]) => {
		if (node === to) {
			if (better(cost, path)) found = { cost, path: [...path] };
			return;
		}
		if (path.length - 1 >= k) return;
		for (const [v, w] of out.get(node) ?? []) {
			if (path.includes(v)) continue;
			path.push(v);
			walk(v, cost + w, path);
			path.pop();
		}
	};
	walk(from, 0, [from]);
	return found;
}

// ---------- lcsdiff ----------
function lcsdiff({ a, b }: { a: string[]; b: string[] }) {
	const n = a.length,
		m = b.length;
	const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
	const ops: Array<[string, string]> = [];
	let i = 0,
		j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[i] === b[j]) {
			ops.push(["=", a[i]!]);
			i++;
			j++;
		} else if (j === m || (i < n && L[i + 1][j] >= L[i][j + 1])) {
			ops.push(["-", a[i]!]);
			i++;
		} else {
			ops.push(["+", b[j]!]);
			j++;
		}
	}
	return ops;
}

// ---------- rooms ----------
function rooms(meetings: Array<{ id: string; start: number; end: number }>) {
	if (meetings.some((m) => m.end <= m.start)) return null;
	const sorted = [...meetings].sort((x, y) => x.start - y.start || x.end - y.end || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
	const ends: number[] = [];
	const assign: Record<string, number> = {};
	for (const m of sorted) {
		let room = ends.findIndex((e) => e <= m.start);
		if (room === -1) {
			ends.push(m.end);
			room = ends.length - 1;
		} else ends[room] = m.end;
		assign[m.id] = room + 1;
	}
	return { rooms: ends.length, assign };
}

// ---------- ledger (multi-file) ----------
function parseLine(line: string) {
	const f = line.split(",").map((x) => x.trim());
	if (f.length !== 3) return null;
	const [date, account, amount] = f as [string, string, string];
	const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!dm) return null;
	const y = Number(dm[1]),
		mo = Number(dm[2]),
		d = Number(dm[3]);
	const t = new Date(Date.UTC(y, mo - 1, d));
	if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
	if (!/^[A-Za-z0-9:_-]+$/.test(account)) return null;
	const am = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
	if (!am) return null;
	const cents = Number(am[2]) * 100 + Number((am[3] ?? "").padEnd(2, "0"));
	return { date, account, cents: am[1] ? -cents : cents };
}
function ledger({ lines }: { lines: string[] }) {
	const seen = new Set<string>();
	const sums = new Map<string, number>();
	const errors: number[] = [];
	lines.forEach((line, i) => {
		const p = parseLine(line);
		const key = p ? `${p.date},${p.account},${p.cents}` : "";
		if (!p || seen.has(key)) {
			errors.push(i);
			return;
		}
		seen.add(key);
		sums.set(p.account, (sums.get(p.account) ?? 0) + p.cents);
	});
	return {
		balances: [...sums].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([account, cents]) => ({ account, cents: cents === 0 ? 0 : cents })),
		errors,
	};
}

const refs: Ref[] = [
	{
		id: "expr",
		spec:
			"Implement solve({expr,vars}) evaluating an arithmetic expression string; return the number, or null on any error. Grammar, loosest to tightest: + and - (left-assoc); * / % (left-assoc, % is the JS remainder); unary + and - (prefix, may repeat, e.g. --3); ^ power (right-assoc, and its right operand may itself start with unary minus, e.g. 2^-1). Unary minus binds looser than ^, so -2^2 is -4 and 2^3^2 is 512. Operands: numbers written as digits with an optional fraction (3, 2.5; not .5, not 1., no exponent notation), parentheses, identifiers [a-z_][a-z0-9_]* looked up in vars (unknown name is an error), and calls name(arg, ...) for abs (exactly 1 argument), min and max (1 or more). Any other function name, a wrong argument count, division or % by zero, leftover input, or a syntax error gives null. Whitespace is allowed between tokens. Never mutate input.",
		ref: expr,
		inputs: [
			{ expr: "1 + 2 * 3", vars: {} }, { expr: "(1+2)*3", vars: {} }, { expr: "-2^2", vars: {} }, { expr: "2^3^2", vars: {} },
			{ expr: "2^-1", vars: {} }, { expr: "10 % 4 - 3", vars: {} }, { expr: "min(3, x, 2*y)", vars: { x: 1, y: 0.25 } },
			{ expr: "max()", vars: {} }, { expr: "abs(-3, 1)", vars: {} }, { expr: "1/0", vars: {} }, { expr: "5 % 0", vars: {} },
			{ expr: "2 * (3 + )", vars: {} }, { expr: "foo + 1", vars: {} }, { expr: "--3", vars: {} }, { expr: "3 -  -  2", vars: {} },
			{ expr: "2*-3", vars: {} }, { expr: "abs(-(2^2))", vars: {} }, { expr: "4 / 2 / 2", vars: {} }, { expr: ".5 + 1", vars: {} },
			{ expr: "1. + 1", vars: {} }, { expr: "min(1,2)(3)", vars: {} }, { expr: "sqrt(4)", vars: {} }, { expr: "x^2 - y", vars: { x: 3, y: 1 } },
			{ expr: "-x^2", vars: { x: 3 } }, { expr: "2 ^ 2 ^ -1", vars: {} }, { expr: "  7  ", vars: {} },
		],
	},
	{
		id: "cron",
		spec:
			"Implement solve({expr,from,count}) returning the next count run times of a 5-field cron expression (minute hour day-of-month month day-of-week), all in UTC, strictly after from (an ISO time like 2026-01-01T00:07:30Z). Each run is formatted YYYY-MM-DDTHH:MMZ (e.g. 2026-01-05T09:00Z). Fields are separated by whitespace; ranges minute 0-59, hour 0-23, day-of-month 1-31, month 1-12, day-of-week 0-7 where both 0 and 7 mean Sunday. Each field is a comma-separated list of items, each item one of: *, n, a-b, */s, a-b/s (s >= 1). Anything else (including n/s), a value out of range, a > b, or not exactly 5 fields makes the whole result null. Day rule: if both day-of-month and day-of-week are restricted (their field text is not exactly *), a day matches when EITHER matches; if only one is restricted, only that one must match; if neither, every day matches. Search at most 5*366 days after from and return the runs found (possibly fewer than count). Never mutate input.",
		ref: cron,
		inputs: [
			{ expr: "*/15 * * * *", from: "2026-01-01T00:07:30Z", count: 3 }, { expr: "0 9 * * 1-5", from: "2026-01-02T10:00:00Z", count: 3 },
			{ expr: "0 0 31 * *", from: "2026-01-31T00:00:00Z", count: 3 }, { expr: "0 12 13 * 5", from: "2026-02-01T00:00:00Z", count: 3 },
			{ expr: "5,10-12 0 1 1 *", from: "2026-01-01T00:06:00Z", count: 3 }, { expr: "0 0 * * 7", from: "2026-01-01T00:00:00Z", count: 3 },
			{ expr: "0 */6 1-3/2 * *", from: "2026-03-01T05:00:00Z", count: 3 }, { expr: "0 0 29 2 *", from: "2027-03-01T00:00:00Z", count: 1 },
			{ expr: "60 * * * *", from: "2026-01-01T00:00:00Z", count: 1 }, { expr: "* * *", from: "2026-01-01T00:00:00Z", count: 1 },
			{ expr: "5/10 * * * *", from: "2026-01-01T00:00:00Z", count: 1 }, { expr: "30 23 * 12 0,6", from: "2026-12-30T23:30:00Z", count: 2 },
		],
	},
	{
		id: "jsonpatch",
		spec:
			"Implement solve({doc,ops}) applying an RFC 6902 JSON Patch and returning the new document, or null if any operation fails (the patch is atomic: no partial result). Paths are JSON Pointers: \"\" is the whole document, otherwise \"/a/b\" with ~1 meaning / and ~0 meaning ~ inside a token. Array tokens must be 0 or a non-negative integer without leading zeros. Ops: add (array: insert at index <= length, or \"-\" to append; object: set the member; path \"\" replaces the document), remove (target must exist; not the root), replace (target must exist; \"\" replaces the document), move (from must exist; moving a location into its own child is an error; from equal to path is a no-op; otherwise remove from then add at path), copy (deep copy of from added at path), test (deep equality with value, object key order ignored). An unknown op is an error. Never mutate input.",
		ref: jsonpatch,
		inputs: [
			{ doc: { foo: "bar" }, ops: [{ op: "add", path: "/baz", value: "qux" }] },
			{ doc: { foo: ["bar", "baz"] }, ops: [{ op: "add", path: "/foo/1", value: "qux" }] },
			{ doc: { foo: ["all", "grass", "cows", "eat"] }, ops: [{ op: "move", from: "/foo/1", path: "/foo/3" }] },
			{ doc: { foo: { bar: "baz", waldo: "fred" }, qux: { corge: "grault" } }, ops: [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }] },
			{ doc: { baz: "qux" }, ops: [{ op: "test", path: "/baz", value: "bar" }] },
			{ doc: { a: [1] }, ops: [{ op: "add", path: "/a/-", value: 2 }, { op: "add", path: "/a/5", value: 3 }] },
			{ doc: { "a/b": 1, "m~n": 2 }, ops: [{ op: "test", path: "/a~1b", value: 1 }, { op: "replace", path: "/m~0n", value: 3 }] },
			{ doc: { a: { b: 1 } }, ops: [{ op: "move", from: "/a", path: "/a/b/c" }] },
			{ doc: { a: { x: 1 } }, ops: [{ op: "copy", from: "/a", path: "/b" }, { op: "replace", path: "/b/x", value: 2 }] },
			{ doc: { foo: [1, 2] }, ops: [{ op: "add", path: "/foo/01", value: 9 }] },
			{ doc: { a: 1 }, ops: [{ op: "remove", path: "/a" }, { op: "remove", path: "/a" }] },
			{ doc: { a: { y: [1, { z: 2 }], x: 0 } }, ops: [{ op: "test", path: "/a", value: { x: 0, y: [1, { z: 2 }] } }, { op: "replace", path: "", value: [0] }, { op: "add", path: "/0", value: -1 }] },
			{ doc: { a: 1 }, ops: [{ op: "copy", from: "/nope", path: "/b" }] },
			{ doc: { a: 1 }, ops: [{ op: "inc", path: "/a" }] },
		],
	},
	{
		id: "bizdays",
		spec:
			"Implement solve({start,days,holidays}) for business-day arithmetic on UTC calendar dates written YYYY-MM-DD. A business day is Monday to Friday and not listed in holidays. days == 0: return start if it is a business day, else the next business day after it. days > 0: move forward one calendar day at a time from start (start itself is not counted) and return the date on which the days-th business day is reached. days < 0: the same going backward. Return the date as YYYY-MM-DD. Never mutate input.",
		ref: bizdays,
		inputs: [
			{ start: "2026-01-02", days: 1, holidays: [] }, { start: "2026-01-03", days: 0, holidays: [] }, { start: "2026-01-03", days: 1, holidays: [] },
			{ start: "2026-01-05", days: -1, holidays: [] }, { start: "2026-12-24", days: 2, holidays: ["2026-12-25", "2026-12-28"] },
			{ start: "2026-02-27", days: 1, holidays: [] }, { start: "2024-02-28", days: 1, holidays: [] },
			{ start: "2026-01-01", days: -3, holidays: ["2025-12-31"] }, { start: "2026-01-05", days: 0, holidays: ["2026-01-05", "2026-01-06"] },
			{ start: "2026-03-06", days: 10, holidays: ["2026-03-12"] }, { start: "2026-01-04", days: -1, holidays: ["2026-01-02"] },
		],
	},
	{
		id: "kpath",
		spec:
			"Implement solve({edges,from,to,k}) where edges are directed [u,v,w] with non-negative numeric weights (parallel edges may exist; between two nodes the cheapest one counts). Find a simple path (no node repeated) from from to to that uses at most k edges and has the minimum total weight. Ties: fewer edges first, then the lexicographically smallest node sequence (compare node names one by one with plain string comparison). Return {cost, path} with path the list of nodes, or null if no such path exists. If from equals to return {cost:0, path:[from]}. Never mutate input.",
		ref: kpath,
		inputs: [
			{ edges: [["a", "b", 1], ["b", "c", 1], ["a", "c", 3]], from: "a", to: "c", k: 2 },
			{ edges: [["a", "b", 1], ["b", "c", 1], ["a", "c", 3]], from: "a", to: "c", k: 1 },
			{ edges: [["a", "b", 1], ["b", "d", 1], ["a", "c", 1], ["c", "d", 1]], from: "a", to: "d", k: 3 },
			{ edges: [["a", "b", 5], ["a", "b", 1], ["b", "c", 1]], from: "a", to: "c", k: 5 },
			{ edges: [["a", "b", 1], ["b", "a", 1]], from: "a", to: "z", k: 4 },
			{ edges: [["s", "x", 0], ["x", "t", 2], ["s", "t", 2], ["s", "y", 1], ["y", "z", 0], ["z", "t", 1]], from: "s", to: "t", k: 3 },
			{ edges: [], from: "q", to: "q", k: 0 },
			{ edges: [["a", "b", 2], ["a", "c", 1], ["c", "b", 1], ["b", "d", 1], ["c", "d", 3]], from: "a", to: "d", k: 2 },
		],
	},
	{
		id: "lcsdiff",
		spec:
			"Implement solve({a,b}) producing a line diff from array a to array b as a list of [op,line] with op '=', '-' or '+'. Let L(i,j) be the length of the longest common subsequence of a[i..] and b[j..] (suffixes). Walk with i=0, j=0 until both are exhausted: if a[i] === b[j] emit ['=',a[i]] and advance both; else if b is exhausted, or (a is not exhausted and L(i+1,j) >= L(i,j+1)) emit ['-',a[i]] and advance i; else emit ['+',b[j]] and advance j. Never mutate input.",
		ref: lcsdiff,
		inputs: [
			{ a: ["a", "b", "c"], b: ["a", "c"] }, { a: [], b: ["x"] }, { a: ["x", "y"], b: [] },
			{ a: ["a", "b", "c", "d"], b: ["b", "a", "d", "c"] }, { a: ["1", "2", "3", "4", "5"], b: ["1", "3", "2", "5", "4", "6"] },
			{ a: ["same"], b: ["same"] }, { a: ["k", "x", "k"], b: ["x", "k", "x"] },
		],
	},
	{
		id: "rooms",
		spec:
			"Implement solve(meetings) where meetings is an array of {id,start,end} (numbers, half-open [start,end)). If any meeting has end <= start return null. Process meetings sorted by start, then end, then id (plain string comparison). Rooms are numbered from 1; a room is free for a meeting when the end of the last meeting assigned to it is <= the meeting's start. Assign the lowest-numbered free room, or open a new room numbered one more than the current count. Return {rooms: number of rooms opened, assign: {id: room}}. Never mutate input.",
		ref: rooms,
		inputs: [
			[{ id: "a", start: 0, end: 10 }, { id: "b", start: 5, end: 15 }, { id: "c", start: 10, end: 20 }],
			[{ id: "x", start: 1, end: 2 }, { id: "y", start: 1, end: 2 }, { id: "z", start: 2, end: 3 }],
			[{ id: "m", start: 0, end: 5 }, { id: "n", start: 0, end: 3 }, { id: "o", start: 3, end: 4 }, { id: "p", start: 4, end: 9 }],
			[{ id: "bad", start: 3, end: 3 }],
			[],
			[{ id: "b", start: 0, end: 4 }, { id: "a", start: 0, end: 4 }, { id: "c", start: 4, end: 6 }, { id: "d", start: 1, end: 5 }, { id: "e", start: 5, end: 7 }],
		],
	},
	{
		id: "ledger",
		spec:
			"Two files. In parse.cjs implement exports.parseLine(line) returning {date, account, cents} or null. A line is three comma-separated fields date,account,amount; each field is trimmed of surrounding spaces; exactly three fields. date is YYYY-MM-DD and must be a real calendar date (2026-02-30 is invalid). account matches [A-Za-z0-9:_-]+ (case-sensitive). amount is an optional leading '-', digits, and optionally '.' with 1 or 2 digits (12, 12.5, -0.07); convert it to integer cents exactly, without floating-point rounding errors. In main.cjs implement solve({lines}) that imports parseLine from ./parse.cjs and returns {balances, errors}: errors are the zero-based indexes of lines that do not parse, or that are duplicates of an earlier valid line (same date, account and cents); balances are [{account, cents}] summing valid lines per account, sorted by account with plain string comparison, including accounts whose sum is 0. Never mutate input.",
		ref: ledger,
		files: { "main.cjs": "const {parseLine}=require('./parse.cjs');\nexports.solve = ({lines}) => ({balances: [], errors: []});\n", "parse.cjs": "exports.parseLine = line => null;\n" },
		requiredPatterns: { "main.cjs": ["require\\(['\\\"]\\./parse\\.cjs['\\\"]\\)", "parseLine\\("], "parse.cjs": ["exports\\.parseLine\\s*="] },
		inputs: [
			{ lines: ["2026-01-01,cash,10.50", "2026-01-02,cash,-0.5", "2026-01-02, bank , 3"] },
			{ lines: ["2026-02-30,cash,1", "2026-02-28,cash,1.234", "2026-02-28,cash,1.2", "2026-02-28,cash,1.20"] },
			{ lines: ["2026-01-01,a:b,0.07", "2026-01-01,A:b,-0.07", "2026-01-01,a:b,-0.07", "bad", "2026-01-01,c,1,2"] },
			{ lines: ["2024-02-29,x,0.1", "2023-02-29,x,0.1", "2026-13-01,x,1", "2026-01-01,x,-.5", "2026-01-01,x,5."] },
			{ lines: ["2026-01-01,z,99999999.99", "2026-01-01,y,0.01", "2026-01-02,y,-0.01"] },
			{ lines: [] },
		],
	},
];

export const harder: Case[] = refs.map((r) => ({
	id: r.id,
	spec: r.spec,
	files: r.files ?? { "main.cjs": "exports.solve = input => input;\n" },
	...(r.requiredPatterns ? { requiredPatterns: r.requiredPatterns } : {}),
	tests: r.inputs.map((input) => ({ input, expected: JSON.parse(JSON.stringify(r.ref(structuredClone(input)))) })),
}));
