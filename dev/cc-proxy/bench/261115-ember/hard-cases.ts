// Harder cases with many edge tests, to separate effort levels where cases.ts hits the ceiling.
// Expected values come from the reference implementations below, never from a model.
import type { Case } from "./cases.ts";

type Ref = { id: string; spec: string; ref: (input: any) => unknown; inputs: unknown[] };

const semverParse = (v: string) => v.split(".").map(Number);
const cmp = (a: number[], b: number[]) => {
	for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
	return 0;
};
function satisfies({ version, range }: { version: string; range: string }) {
	const v = semverParse(version);
	return range.split("||").some((part) =>
		part
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.every((c) => {
				if (c === "*" || c === "x") return true;
				const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(c)!;
				const op = m[1] ?? "=";
				const raw = m[2]!.split(".");
				const wild = raw.findIndex((p) => p === "x" || p === "*");
				const n = raw.map((p) => (p === "x" || p === "*" ? 0 : Number(p)));
				while (n.length < 3) n.push(0);
				const given = wild === -1 ? raw.length : wild;
				if (op === "=" && given < 3) {
					const upper = [...n];
					upper[given - 1] = (upper[given - 1] ?? 0) + 1;
					for (let i = given; i < 3; i++) upper[i] = 0;
					return given === 0 || (cmp(v, n) >= 0 && cmp(v, upper) < 0);
				}
				if (op === "^") {
					const first = n.findIndex((x) => x !== 0);
					const at = first === -1 ? 2 : first;
					const upper = n.map((x, i) => (i < at ? x : i === at ? x + 1 : 0));
					return cmp(v, n) >= 0 && cmp(v, upper) < 0;
				}
				if (op === "~") {
					const upper = given <= 1 ? [n[0]! + 1, 0, 0] : [n[0]!, n[1]! + 1, 0];
					return cmp(v, n) >= 0 && cmp(v, upper) < 0;
				}
				const r = cmp(v, n);
				return op === ">=" ? r >= 0 : op === "<=" ? r <= 0 : op === ">" ? r > 0 : op === "<" ? r < 0 : r === 0;
			}),
	);
}

function csv(text: string) {
	const rows: string[][] = [];
	let row: string[] = [],
		field = "",
		quoted = false,
		i = 0,
		any = false;
	while (i < text.length) {
		const ch = text[i]!;
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				field += '"';
				i += 2;
				continue;
			}
			if (ch === '"') {
				quoted = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === '"' && field === "") {
			quoted = true;
			any = true;
			i++;
			continue;
		}
		if (ch === ",") {
			row.push(field);
			field = "";
			any = true;
			i++;
			continue;
		}
		if (ch === "\r" || ch === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			any = false;
			i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
			continue;
		}
		field += ch;
		any = true;
		i++;
	}
	if (any || field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

function glob({ pattern, path }: { pattern: string; path: string }) {
	let re = "^";
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i]!;
		if (ch === "\\" && i + 1 < pattern.length) {
			re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
		} else if (ch === "*" && pattern[i + 1] === "*") {
			i++;
			if (pattern[i + 1] === "/") {
				i++;
				re += "(?:.*/)?";
			} else re += ".*";
		} else if (ch === "*") re += "[^/]*";
		else if (ch === "?") re += "[^/]";
		else if (ch === "[") {
			const end = pattern.indexOf("]", i + 1);
			let body = pattern.slice(i + 1, end);
			const neg = body.startsWith("!");
			if (neg) body = body.slice(1);
			re += `[${neg ? "^" : ""}${body.replace(/\\/g, "\\\\")}]`;
			i = end;
		} else re += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	}
	return new RegExp(`${re}$`).test(path);
}

function topo(edges: Record<string, string[]>) {
	const nodes = new Set<string>(Object.keys(edges));
	for (const deps of Object.values(edges)) for (const d of deps) nodes.add(d);
	const indeg = new Map([...nodes].map((n) => [n, 0]));
	const out = new Map<string, string[]>([...nodes].map((n) => [n, []]));
	for (const [n, deps] of Object.entries(edges))
		for (const d of new Set(deps)) {
			out.get(d)!.push(n);
			indeg.set(n, indeg.get(n)! + 1);
		}
	const ready = [...nodes].filter((n) => indeg.get(n) === 0).sort();
	const order: string[] = [];
	while (ready.length) {
		const n = ready.shift()!;
		order.push(n);
		for (const m of out.get(n)!) {
			indeg.set(m, indeg.get(m)! - 1);
			if (indeg.get(m) === 0) {
				ready.push(m);
				ready.sort();
			}
		}
	}
	return order.length === nodes.size ? order : null;
}

function allocate({ total, ratios }: { total: number; ratios: number[] }) {
	const sum = ratios.reduce((a, b) => a + b, 0);
	if (sum === 0) return ratios.map(() => 0);
	const exact = ratios.map((r) => (total * r) / sum);
	const base = exact.map(Math.floor);
	let left = total - base.reduce((a, b) => a + b, 0);
	const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
	for (const [, i] of order) {
		if (left <= 0) break;
		base[i]!++;
		left--;
	}
	return base;
}

function roman(s: string) {
	if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s) || s === "") return null;
	const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const a = v[s[i]!]!,
			b = v[s[i + 1]!] ?? 0;
		n += a < b ? -a : a;
	}
	return n;
}

function lru({ capacity, ops }: { capacity: number; ops: Array<[string, string, number?, number?]> }) {
	// ops: ["set", key, value, now] | ["get", key, now]; entries expire ttl=10 after their last set.
	const map = new Map<string, { value: number; at: number }>();
	const outs: Array<number | null> = [];
	for (const op of ops) {
		if (op[0] === "set") {
			const [, key, value, now] = op;
			map.delete(key);
			map.set(key, { value: value!, at: now! });
			for (const [k, e] of map) if (now! - e.at >= 10) map.delete(k);
			while (map.size > capacity) map.delete(map.keys().next().value!);
		} else {
			const [, key, now] = op as unknown as [string, string, number];
			const e = map.get(key);
			if (!e || now - e.at >= 10) {
				if (e) map.delete(key);
				outs.push(null);
			} else {
				map.delete(key);
				map.set(key, e);
				outs.push(e.value);
			}
		}
	}
	return outs;
}

function intervals({ items, gap }: { items: Array<[number, number]>; gap: number }) {
	const sorted = items.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
	const merged: Array<[number, number]> = [];
	for (const [a, b] of sorted) {
		const last = merged.at(-1);
		if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
		else merged.push([a, b]);
	}
	return merged;
}

const refs: Ref[] = [
	{
		id: "semver",
		spec: "Implement solve({version,range}) returning true when version (x.y.z, numbers only) satisfies the npm-style range. Support || (any part), space-separated AND of comparators, operators >= <= > < = (bare version means =), * or x alone (anything), partial versions (\"1.2\" with = means >=1.2.0 <1.3.0; \"1\" means >=1.0.0 <2.0.0; x or * in a position works like an omitted position), caret (^1.2.3 := >=1.2.3 <2.0.0; ^0.2.3 := >=0.2.3 <0.3.0; ^0.0.3 := >=0.0.3 <0.0.4) and tilde (~1.2.3 := >=1.2.3 <1.3.0; ~1.2 := >=1.2.0 <1.3.0; ~1 := >=1.0.0 <2.0.0). No prereleases. Never mutate input.",
		ref: satisfies,
		inputs: [
			{ version: "1.2.3", range: "^1.0.0" }, { version: "2.0.0", range: "^1.0.0" }, { version: "0.2.9", range: "^0.2.3" },
			{ version: "0.3.0", range: "^0.2.3" }, { version: "0.0.4", range: "^0.0.3" }, { version: "1.2.9", range: "~1.2.3" },
			{ version: "1.3.0", range: "~1.2" }, { version: "1.9.0", range: "~1" }, { version: "1.4.0", range: "1.2 || >=1.4.0 <1.5.0" },
			{ version: "1.2.7", range: "1.2.x" }, { version: "3.0.0", range: "*" }, { version: "1.0.0", range: ">1.0.0" },
			{ version: "1.0.0", range: "<=1.0.0 >=0.9.0" }, { version: "2.5.1", range: "1" }, { version: "1.5.1", range: "1.x" },
		],
	},
	{
		id: "csv",
		spec: "Implement solve(text) parsing RFC-4180-style CSV into an array of rows (arrays of strings). Fields are separated by commas. A field that starts with a double quote is quoted: inside it, \"\" is a literal quote, and commas, CR and LF are literal. Rows end at LF, CR or CRLF outside quotes. A trailing line break does not create an extra empty row; an empty input gives []. A line that is empty between two line breaks is the row [\"\"]. Do not trim spaces. Never mutate input.",
		ref: csv,
		inputs: [
			"a,b\nc,d", "a,b\r\nc,d\r\n", "\"x,y\",z", "\"he said \"\"hi\"\"\",2", "\"multi\nline\",x\ny,z", "", "a,,b,", " a , b ", "a\n\nb", "\"\"", "x\ry",
		],
	},
	{
		id: "glob",
		spec: "Implement solve({pattern,path}) returning true when the whole path matches the glob. * matches any run of characters except /, ? matches one character except /, ** matches any run including / (and **/ also matches zero directories), [abc] / [a-c] match one character from the class, [!a-c] negates, backslash escapes the next character. All other characters are literal (including . + ( )). Never mutate input.",
		ref: glob,
		inputs: [
			{ pattern: "*.ts", path: "a.ts" }, { pattern: "*.ts", path: "src/a.ts" }, { pattern: "**/*.ts", path: "a.ts" },
			{ pattern: "**/*.ts", path: "src/x/a.ts" }, { pattern: "src/**", path: "src/a/b" }, { pattern: "a?c", path: "abc" },
			{ pattern: "a?c", path: "a/c" }, { pattern: "[a-c]x", path: "bx" }, { pattern: "[!a-c]x", path: "bx" },
			{ pattern: "\\*.md", path: "*.md" }, { pattern: "\\*.md", path: "a.md" }, { pattern: "a+(b).js", path: "a+(b).js" },
			{ pattern: "src/**/test/*.js", path: "src/test/a.js" },
		],
	},
	{
		id: "topo",
		spec: "Implement solve(edges) where edges maps a node to the list of nodes it depends on (dependencies come first). Nodes that appear only as dependencies are nodes too. Return a topological order as an array; among nodes that are ready at the same time always take the alphabetically smallest first (Kahn's algorithm with a sorted ready set, re-sorted when nodes become ready). Duplicate dependencies count once. Return null when there is a cycle. Never mutate input.",
		ref: topo,
		inputs: [
			{ b: ["a"], c: ["a"], d: ["b", "c"] }, { z: [], y: [], x: [] }, { a: ["b"], b: ["a"] }, { app: ["lib", "lib", "util"], lib: ["util"] },
			{ c: ["b"], b: [], a: ["c"], d: [] }, { m: ["n"], n: ["o"], o: ["m"], p: [] }, {},
		],
	},
	{
		id: "allocate",
		spec: "Implement solve({total,ratios}) splitting integer cents total across ratios (non-negative numbers) with the largest-remainder method: each share is floor(total*ratio/sum); the leftover cents go one each to the largest fractional remainders, ties broken by lower index. If the ratios sum to 0 return all zeros. The result sums to total. Never mutate input.",
		ref: allocate,
		inputs: [
			{ total: 100, ratios: [1, 1, 1] }, { total: 10, ratios: [3, 3, 4] }, { total: 7, ratios: [0, 0, 0] }, { total: 1, ratios: [1, 1] },
			{ total: 1000, ratios: [0.2, 0.3, 0.5] }, { total: 5, ratios: [2, 0, 1] }, { total: 0, ratios: [1, 2] },
		],
	},
	{
		id: "roman",
		spec: "Implement solve(s) returning the integer value of a strict Roman numeral (1–3999, standard subtractive forms only: IV IX XL XC CD CM; no IIII, VV, IC, IL, XM, lowercase, or empty string), or null when s is not a valid strict numeral. Never mutate input.",
		ref: roman,
		inputs: ["III", "IV", "MCMXCIV", "MMMCMXCIX", "IIII", "IC", "VV", "", "XLII", "iv", "MMMM", "CDXLIV", "XM"],
	},
	{
		id: "ttlcache",
		spec: "Implement solve({capacity,ops}) simulating an LRU cache with a TTL of 10. ops are [\"set\",key,value,now] or [\"get\",key,now]. An entry expires when now - (time of its last set) >= 10. set: insert or replace the key as most recent with its time, then drop every expired entry, then evict least-recent entries while size > capacity. get: if the key is missing or expired return null (and drop it if expired); otherwise return its value and make it most recent (without changing its set time). Return the array of get results in order. Never mutate input.",
		ref: lru,
		inputs: [
			{ capacity: 2, ops: [["set", "a", 1, 0], ["set", "b", 2, 1], ["get", "a", 2], ["set", "c", 3, 3], ["get", "b", 4], ["get", "a", 5], ["get", "c", 6]] },
			{ capacity: 3, ops: [["set", "a", 1, 0], ["get", "a", 9], ["get", "a", 10], ["set", "a", 2, 11], ["get", "a", 20], ["get", "a", 21]] },
			{ capacity: 1, ops: [["set", "a", 1, 0], ["set", "b", 2, 1], ["get", "a", 2], ["get", "b", 2]] },
			{ capacity: 2, ops: [["set", "a", 1, 0], ["set", "b", 2, 5], ["set", "c", 3, 12], ["get", "a", 12], ["get", "b", 12], ["get", "c", 12]] },
		],
	},
	{
		id: "intervals",
		spec: "Implement solve({items,gap}) merging half-open intervals [start,end). Drop intervals with end <= start. Sort by start then end. Merge an interval into the previous merged one when start - previousEnd <= gap (so with gap 0, touching intervals [1,2) and [2,3) merge). Return the merged list as [start,end] pairs. Never mutate input.",
		ref: intervals,
		inputs: [
			{ items: [[1, 2], [2, 3]], gap: 0 }, { items: [[5, 7], [1, 3], [2, 4]], gap: 0 }, { items: [[1, 2], [4, 5]], gap: 2 },
			{ items: [[3, 3], [1, 0], [2, 5]], gap: 0 }, { items: [], gap: 1 }, { items: [[1, 10], [2, 3], [11, 12]], gap: 1 },
		],
	},
];

export const hard: Case[] = refs.map((r) => ({
	id: r.id,
	spec: r.spec,
	files: { "main.cjs": "exports.solve = input => input;\n" },
	tests: r.inputs.map((input) => ({ input, expected: JSON.parse(JSON.stringify(r.ref(structuredClone(input)))) })),
}));
