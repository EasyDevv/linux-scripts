/** Minimal `--name value` / `--name=value` / `--bool` parsing shared by the eval, audit, and promote commands. */

export interface Flags {
	values: Record<string, string>;
	positional: string[];
}

/** `booleans` names flags that take no value. A flag missing its value throws. */
export function parseFlags(argv: readonly string[], booleans: readonly string[] = []): Flags {
	const values: Record<string, string> = {};
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}
		const eq = arg.indexOf("=");
		const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
		if (eq >= 0) values[name] = arg.slice(eq + 1);
		else if (booleans.includes(name)) values[name] = "true";
		else {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) throw new Error(`--${name} needs a value`);
			values[name] = next;
			i++;
		}
	}
	return { values, positional };
}

export function positiveInt(value: string | undefined, name: string): number | undefined {
	if (value === undefined) return undefined;
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
	return n;
}
