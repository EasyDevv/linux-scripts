#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

type ChildName = "web" | "api";

interface Options {
	webPort: number;
	apiPort: number;
	webDir?: string;
	apiDir?: string;
	webCmd?: string;
	apiCmd?: string;
	secrets: "env" | "infisical";
	tag?: string;
}

const ROOT = process.cwd();

function usage(): never {
	console.error(`Usage: dev-stack [options]
  --web-port <port>       Web dev server port (default: 5173)
  --api-port <port>       API server port (default: 3000)
  --web-dir <path>        Web app directory (default: apps/web, apps/client)
  --api-dir <path>        API app directory (default: apps/api, apps/server)
  --web-cmd <cmd>         Web command. {webPort}/{apiPort} placeholders supported
  --api-cmd <cmd>         API command. {webPort}/{apiPort} placeholders supported
  --secrets env|infisical Wrap child commands with infisical run (default: env)
  --tag <journal-tag>     Base journal tag (default: EXECUTOR_TAG or dev-stack/<cwd>)

Aliases: --client-port, --server-port, --client-dir, --server-dir`);
	process.exit(1);
}

function parsePort(raw: string | undefined, label: string): number {
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
		console.error(`[dev-stack] invalid ${label}: ${raw ?? ""}`);
		process.exit(1);
	}
	return value;
}

function parseArgs(args: string[]): Options {
	const options: Options = {
		webPort: 5173,
		apiPort: 3000,
		secrets: "env",
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = () => args[++i] ?? usage();

		if (arg === "--web-port" || arg === "--client-port") {
			options.webPort = parsePort(next(), arg);
		} else if (arg === "--api-port" || arg === "--server-port") {
			options.apiPort = parsePort(next(), arg);
		} else if (arg === "--web-dir" || arg === "--client-dir") {
			options.webDir = next();
		} else if (arg === "--api-dir" || arg === "--server-dir") {
			options.apiDir = next();
		} else if (arg === "--web-cmd") {
			options.webCmd = next();
		} else if (arg === "--api-cmd") {
			options.apiCmd = next();
		} else if (arg === "--secrets") {
			const value = next();
			if (value !== "env" && value !== "infisical") usage();
			options.secrets = value;
		} else if (arg === "--tag") {
			options.tag = next();
		} else if (arg === "-h" || arg === "--help") {
			usage();
		} else {
			console.error(`[dev-stack] unknown option: ${arg}`);
			usage();
		}
	}

	return options;
}

function resolveDir(value: string): string {
	return isAbsolute(value) ? value : resolve(ROOT, value);
}

function firstExisting(candidates: string[], label: string): string {
	for (const candidate of candidates) {
		const full = resolveDir(candidate);
		if (existsSync(full)) return full;
	}

	console.error(
		`[dev-stack] ${label} directory not found: ${candidates.join(", ")}`,
	);
	process.exit(1);
}

function expandCommand(template: string, options: Options): string {
	return template
		.replaceAll("{webPort}", String(options.webPort))
		.replaceAll("{apiPort}", String(options.apiPort));
}

function commandArgs(command: string, secrets: Options["secrets"]): string[] {
	const shell = ["/bin/sh", "-lc", command];
	return secrets === "infisical" ? ["infisical", "run", "--", ...shell] : shell;
}

function portInUse(port: number): boolean {
	const result = Bun.spawnSync(["ss", "-tlnH", `sport = :${port}`], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	return result.stdout.toString().trim().length > 0;
}

async function journalLine(tag: string, line: string): Promise<void> {
	const proc = Bun.spawn(["/usr/bin/systemd-cat", "-t", tag], {
		stdin: Buffer.from(`${line}\n`),
		stdout: "ignore",
		stderr: "ignore",
	});
	await proc.exited;
}

async function pipeLines(
	stream: ReadableStream<Uint8Array> | null,
	name: ChildName,
	tag: string,
): Promise<void> {
	if (!stream) return;

	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).replace(/\r$/, "");
			buffer = buffer.slice(newline + 1);
			if (line.length > 0) {
				const output = `[${name}] ${line}`;
				console.log(output);
				void journalLine(tag, output);
			}
			newline = buffer.indexOf("\n");
		}
	}

	const tail = buffer.trimEnd();
	if (tail) {
		const output = `[${name}] ${tail}`;
		console.log(output);
		void journalLine(tag, output);
	}
}

function startChild(
	name: ChildName,
	cwd: string,
	command: string,
	tag: string,
	env: Record<string, string>,
): Bun.Subprocess {
	const proc = Bun.spawn(
		commandArgs(command, env.DEV_STACK_SECRETS as Options["secrets"]),
		{
			cwd,
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	console.log(
		`[sys] ${name} started pid=${proc.pid} cwd=${cwd} cmd=${command}`,
	);
	void journalLine(
		tag,
		`[sys] started pid=${proc.pid} cwd=${cwd} cmd=${command}`,
	);
	void pipeLines(proc.stdout, name, tag);
	void pipeLines(proc.stderr, name, tag);
	return proc;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const webDir = resolveDir(
		options.webDir ?? firstExisting(["apps/web", "apps/client"], "web"),
	);
	const apiDir = resolveDir(
		options.apiDir ?? firstExisting(["apps/api", "apps/server"], "api"),
	);
	const webCmd = expandCommand(
		options.webCmd ??
			"bun run dev -- --host 127.0.0.1 --port {webPort} --strictPort",
		options,
	);
	const apiCmd = expandCommand(options.apiCmd ?? "cargo run", options);
	const tag =
		options.tag ?? process.env.EXECUTOR_TAG ?? `dev-stack/${basename(ROOT)}`;
	const appUrl = process.env.EXECUTOR_NAME
		? `http://${process.env.EXECUTOR_NAME}.localhost`
		: `http://localhost:${options.webPort}`;

	if (portInUse(options.webPort)) {
		console.error(`[dev-stack] web port ${options.webPort} is already in use`);
		process.exit(1);
	}
	if (portInUse(options.apiPort)) {
		console.error(`[dev-stack] api port ${options.apiPort} is already in use`);
		process.exit(1);
	}

	const baseEnv = Object.fromEntries(
		Object.entries(process.env).map(([key, value]) => [key, value ?? ""]),
	);
	const env: Record<string, string> = {
		...baseEnv,
		WEB_PORT: String(options.webPort),
		API_PORT: String(options.apiPort),
		CLIENT_PORT: String(options.webPort),
		SERVER_PORT: String(options.apiPort),
		PORT: String(options.apiPort),
		PUBLIC_API_URL: `http://localhost:${options.apiPort}`,
		CORS_ORIGIN: appUrl,
		DEV_STACK_SECRETS: options.secrets,
	};

	console.log(
		`[sys] root=${ROOT} web=${options.webPort} api=${options.apiPort} tag=${tag}`,
	);
	console.log(`[web] ready-pending ${appUrl}`);
	console.log(`[api] ready-pending http://localhost:${options.apiPort}`);

	const api = startChild("api", apiDir, apiCmd, `${tag}/api`, env);
	const web = startChild("web", webDir, webCmd, `${tag}/web`, env);
	const children = [api, web];

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("[sys] shutting down");
		for (const child of children) {
			try {
				child.kill("SIGTERM");
			} catch {}
		}
		await Bun.sleep(5_000);
		for (const child of children) {
			try {
				child.kill("SIGKILL");
			} catch {}
		}
	}

	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());

	const result = await Promise.race([
		api.exited.then((code) => ({ name: "api", code })),
		web.exited.then((code) => ({ name: "web", code })),
	]);

	console.log(`[sys] ${result.name} exited code=${result.code}`);
	await shutdown();
	process.exit(result.code ?? 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
