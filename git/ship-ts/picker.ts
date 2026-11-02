/* One-shot vertical picker: ↑/↓ j/k move, g/G first/last, Enter select, q/Esc/Ctrl-C abort.
   Paints on stderr. Callers check `canPick()` first and fall back to a default without a TTY. */

export type Key = "up" | "down" | "first" | "last" | "select" | "abort" | null;

export function classifyKey(chunk: string): Key {
	switch (chunk) {
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
		case "\x1bOH":
		case "\x1b[1~":
			return "first";
		case "G":
		case "\x1b[F":
		case "\x1bOF":
		case "\x1b[4~":
			return "last";
		case "\r":
		case "\n":
			return "select";
		case "q":
		case "\x1b":
		case "\x03":
			return "abort";
		default:
			return null;
	}
}

/** One read can carry several keys (fast typing, paste): split it into escape sequences and
 *  single characters. A lone `\x1b` at the end stays Esc. */
export function splitKeys(chunk: string): string[] {
	const keys: string[] = [];
	let i = 0;
	while (i < chunk.length) {
		const rest = chunk.slice(i);
		const sequence = /^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(rest);
		const key = sequence ? sequence[0] : rest[0];
		keys.push(key);
		i += key.length;
	}
	return keys;
}

export function move(index: number, key: Key, count: number): number {
	if (key === "up") return Math.max(0, index - 1);
	if (key === "down") return Math.min(count - 1, index + 1);
	if (key === "first") return 0;
	if (key === "last") return count - 1;
	return index;
}

export function canPick(): boolean {
	return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export type PickOptions = {
	title: string;
	items: { label: string; hint?: string }[];
	initial?: number;
	color?: boolean;
};

/** Resolves the chosen index, or null on abort. */
export function pick({ title, items, initial = 0, color = true }: PickOptions): Promise<number | null> {
	const sgr = (code: string) => (color ? `\x1b[${code}m` : "");
	const out = process.stderr;
	const stdin = process.stdin;
	let index = initial;
	let drawn = 0;

	const draw = () => {
		const lines = [
			`${sgr("1")}${title}${sgr("0")}`,
			...items.map((item, i) => {
				const hint = item.hint ? ` ${sgr("2")}${item.hint}${sgr("0")}` : "";
				return i === index
					? `${sgr("1;36")}> ${item.label}${sgr("0")}${hint}`
					: `  ${item.label}${hint}`;
			}),
			`${sgr("2")}↑/↓ move  enter select  q abort${sgr("0")}`,
		];
		if (drawn) out.write(`\x1b[${drawn}A\r`);
		out.write(lines.map((line) => `\x1b[2K${line}`).join("\r\n") + "\r\n");
		drawn = lines.length;
	};

	return new Promise((resolve) => {
		const finish = (result: number | null) => {
			stdin.off("data", onData);
			stdin.setRawMode(false);
			stdin.pause();
			out.write("\x1b[?25h");
			process.off("exit", restore);
			resolve(result);
		};
		const restore = () => {
			stdin.setRawMode(false);
			out.write("\x1b[?25h");
		};
		const onData = (data: Buffer) => {
			for (const chunk of splitKeys(data.toString())) {
				const key = classifyKey(chunk);
				if (key === "select") return finish(index);
				if (key === "abort") return finish(null);
				index = move(index, key, items.length);
			}
			draw();
		};

		process.on("exit", restore);
		out.write("\x1b[?25l");
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on("data", onData);
		draw();
	});
}
