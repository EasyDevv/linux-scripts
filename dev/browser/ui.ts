// Terminal look shared by every subcommand: color, help layout, keys.

const ESC = "\x1b[";
export const STYLE = {
	reset: "0",
	bold: "1",
	dim: "2",
	red: "31",
	green: "32",
	yellow: "33",
	blue: "34",
	magenta: "35",
	cyan: "36",
} as const;
type Style = keyof typeof STYLE;

export function colorOn(stream: { isTTY?: boolean } = process.stdout): boolean {
	return Boolean(stream.isTTY) && !process.env.NO_COLOR;
}

export function paint(text: string, styles: Style[], on = colorOn()): string {
	if (!on || !styles.length) return text;
	return `${ESC}${styles.map((s) => STYLE[s]).join(";")}m${text}${ESC}0m`;
}

/**
 * Help text convention (plain in source, painted at print time):
 *   line 1           `browser <cmd> — summary`
 *   `Header` line    unindented, optional ` · note`
 *   `  term   desc`  two-space indent, term and desc split by 2+ spaces
 *   `  # comment`    dim (inside examples, after a command too)
 *   `(default: …)`   dim anywhere
 */
export function renderHelp(text: string, on = colorOn()): string {
	const p = (t: string, s: Style[]) => paint(t, s, on);
	const dimDefaults = (t: string) =>
		t.replace(/\((?:default|e\.g\.)[^)]*\)/g, (m) => p(m, ["dim"]));
	return text
		.split("\n")
		.map((line, i) => {
			if (i === 0) {
				const [name, rest] = line.split(" — ");
				return rest ? `${p(name, ["bold"])} ${p(`— ${rest}`, ["dim"])}` : p(line, ["bold"]);
			}
			if (!line.trim()) return line;
			if (!line.startsWith(" ")) {
				const [head, note] = line.split(" · ");
				return `${p(head, ["bold", "cyan"])}${note ? p(` · ${note}`, ["dim"]) : ""}`;
			}
			const comment = line.indexOf(" # ");
			if (/^\s+#/.test(line)) return p(line, ["dim"]);
			const body = comment > 0 ? line.slice(0, comment) : line;
			const tail = comment > 0 ? p(line.slice(comment), ["dim"]) : "";
			const m = /^(\s+)(\S(?:.*?\S)?)(\s{2,})(.*)$/.exec(body);
			if (!m) return `${colorTerm(body, p)}${tail}`;
			const [, indent, term, gap, desc] = m;
			return `${indent}${colorTerm(term, p)}${gap}${dimDefaults(desc)}${tail}`;
		})
		.join("\n");
}

function colorTerm(term: string, p: (t: string, s: Style[]) => string): string {
	const lead = term.match(/^\s*/)?.[0] ?? "";
	const body = term.slice(lead.length);
	if (body.startsWith("-") || /^[A-Z_]+$/.test(body)) return lead + p(body, ["green"]);
	return lead + p(body, ["yellow"]);
}

export function printHelp(text: string): void {
	console.log(renderHelp(text));
}

// ── keys ────────────────────────────────────────────────────────────

export type Key = "up" | "down" | "first" | "last" | "enter" | "abort" | { char: string } | null;

/** One stdin read can carry several keys (`j\r`, `\x1b[B\x1b[A\r`): split before classifying. */
export function splitKeys(chunk: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < chunk.length; ) {
		if (chunk[i] === "\x1b") {
			const csi = /^\x1b\[[0-9;]*[A-Za-z~]/.exec(chunk.slice(i));
			const ss3 = /^\x1bO[A-Za-z]/.exec(chunk.slice(i));
			const seq = csi?.[0] ?? ss3?.[0] ?? "\x1b";
			out.push(seq);
			i += seq.length;
		} else {
			out.push(chunk[i]);
			i += 1;
		}
	}
	return out;
}

export function classifyKey(key: string): Key {
	switch (key) {
		case "\x1b[A":
		case "\x1bOA":
		case "k":
			return "up";
		case "\x1b[B":
		case "\x1bOB":
		case "j":
			return "down";
		case "g":
		case "\x1b[H":
		case "\x1b[1~":
		case "\x1bOH":
			return "first";
		case "G":
		case "\x1b[F":
		case "\x1b[4~":
		case "\x1bOF":
			return "last";
		case "\r":
		case "\n":
			return "enter";
		case "q":
		case "\x1b":
		case "\x03":
			return "abort";
		default:
			return key.length === 1 ? { char: key } : null;
	}
}

// ── raw terminal ────────────────────────────────────────────────────

export function interactive(): boolean {
	return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/** Raw mode on stdin, paint on stderr; restores cursor and mode on every exit path. */
export class Term {
	private lines = 0;
	private pending: string[] = [];
	private waiter: ((k: string) => void) | null = null;
	private onData = (buf: Buffer) => {
		for (const k of splitKeys(buf.toString("utf8"))) {
			if (this.waiter) {
				const w = this.waiter;
				this.waiter = null;
				w(k);
			} else this.pending.push(k);
		}
	};

	open(): void {
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on("data", this.onData);
		process.stderr.write(`${ESC}?25l`);
		process.once("exit", () => this.close());
	}

	close(): void {
		if (!process.stdin.isRaw) return;
		process.stdin.off("data", this.onData);
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stderr.write(`${ESC}?25h`);
	}

	key(): Promise<string> {
		const next = this.pending.shift();
		if (next !== undefined) return Promise.resolve(next);
		return new Promise((r) => (this.waiter = r));
	}

	/** Replace the previous frame in place. */
	draw(rows: string[]): void {
		let out = "";
		if (this.lines) out += `\r${ESC}${this.lines}A`;
		out += `\r${ESC}J${rows.join("\r\n")}\r\n`;
		this.lines = rows.length;
		process.stderr.write(out);
	}

	/** Leave the frame on screen and start fresh below it. */
	release(): void {
		this.lines = 0;
	}
}
