export function isViteCommand(command: string): boolean {
	return command.includes("vite") || command.includes("desktop:web");
}

export function viteReadyPattern(): string {
	return "ready in ";
}

async function viteVersion(dir: string): Promise<string> {
	const resolvedDir = dir.replace(/^~(?=\/|$)/, process.env.HOME ?? "");
	const file = Bun.file(
		`${resolvedDir}/apps/desktop/node_modules/vite/package.json`,
	);
	if (!(await file.exists())) {
		return "";
	}

	try {
		const pkg = (await file.json()) as { version?: unknown };
		return typeof pkg.version === "string" ? ` v${pkg.version}` : "";
	} catch {
		return "";
	}
}

export async function printViteReadyFallback(
	dir: string,
	name: string,
	port: string,
	elapsedMs: number,
): Promise<void> {
	console.log(`  VITE${await viteVersion(dir)}  ready in ${elapsedMs} ms`);
	console.log(`  ➜  Local:   http://${name}.localhost/`);
}
