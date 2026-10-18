#!/usr/bin/env bun
/**
 * decision — typed routing decisions for pi and Claude Code.
 *
 *   decision serve                    run the daemon in the foreground (systemd ExecStart)
 *   decision status                   daemon health: backends, key origin, budget
 *   decision route <text>             ask model_route for a prompt and print the result
 *   decision eval --feature <f> --version vN [--against vM] [--backend <provider/jev-sku>] [--cases path] [--limit n]
 *                                     score a prompt version on evals/<f>.jsonl; report in docs/eval/
 *   decision audit [--since 7d] [--harness pi|claude|all] [--feature f]
 *                                     join the log with pi/Claude transcripts; report in docs/audit/
 *   decision promote <feature> <vN>   point the daemon at prompts/<feature>/vN.json (then service restart)
 *   decision service install|uninstall|restart|status|logs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { auditCommand } from "./audit.ts";
import { evalCommand } from "./eval.ts";
import { promoteCommand } from "./promote.ts";
import { readConfig, startServer } from "./server.ts";

const UNIT = "decision.service";
const UNIT_PATH = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", UNIT);

function baseUrl(): string {
	return process.env.DECISION_URL || `http://127.0.0.1:${readConfig().port}`;
}

/** proto's version-independent link, so a bun upgrade does not strand the unit on a removed path. */
function stableBun(): string {
	const link = join(homedir(), ".proto", "bin", "bun");
	return process.execPath.includes("/.proto/tools/") && existsSync(link) ? link : process.execPath;
}

export function unitText(bun = stableBun(), entry = join(import.meta.dir, "main.ts")): string {
	return [
		"[Unit]",
		"Description=decision daemon (typed routing for pi and Claude Code)",
		"After=network-online.target",
		"",
		"[Service]",
		"Type=simple",
		`ExecStart=${bun} ${entry} serve`,
		"Restart=on-failure",
		"RestartSec=2",
		"",
		"[Install]",
		"WantedBy=default.target",
		"",
	].join("\n");
}

function systemctl(...args: string[]): number {
	return Bun.spawnSync(["systemctl", "--user", ...args], { stdout: "inherit", stderr: "inherit" }).exitCode;
}

async function getJson(path: string, init?: RequestInit): Promise<unknown> {
	const res = await fetch(`${baseUrl()}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
	return res.json();
}

async function main(argv: string[]): Promise<number> {
	const [cmd, ...rest] = argv;
	switch (cmd) {
		case "serve": {
			const { server } = startServer();
			console.log(`decision listening on http://${server.hostname}:${server.port}`);
			return await new Promise<number>(() => {});
		}
		case "status":
			console.log(JSON.stringify(await getJson("/health"), null, 2));
			return 0;
		case "route": {
			const prompt = rest.join(" ").trim();
			if (!prompt) {
				console.error("usage: decision route <text>");
				return 2;
			}
			const result = await getJson("/v1/model_route", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ prompt, harness: "cli" }),
			});
			console.log(JSON.stringify(result, null, 2));
			return 0;
		}
		case "eval":
			return await evalCommand(rest);
		case "audit":
			return auditCommand(rest);
		case "promote":
			return promoteCommand(rest);
		case "service": {
			const action = rest[0];
			if (action === "install") {
				mkdirSync(dirname(UNIT_PATH), { recursive: true });
				writeFileSync(UNIT_PATH, unitText());
				console.log(`wrote ${UNIT_PATH}`);
				return systemctl("daemon-reload") || systemctl("enable", "--now", UNIT);
			}
			if (action === "uninstall") {
				systemctl("disable", "--now", UNIT);
				rmSync(UNIT_PATH, { force: true });
				return systemctl("daemon-reload");
			}
			if (action === "restart") return systemctl("restart", UNIT);
			if (action === "status") return systemctl("status", "--no-pager", UNIT);
			if (action === "logs") {
				return Bun.spawnSync(["journalctl", "--user", "-u", UNIT, "--no-pager", "-n", rest[1] ?? "50"], {
					stdout: "inherit",
					stderr: "inherit",
				}).exitCode;
			}
			console.error("usage: decision service install|uninstall|restart|status|logs [lines]");
			return 2;
		}
		default:
			console.log(
				[
					"usage: decision serve | status | route <text> | service install|uninstall|restart|status|logs [lines]",
					"       decision eval --feature <f> --version vN [--against vM] [--backend <provider/jev-sku>] [--cases path] [--limit n]",
					"       decision audit [--since 7d] [--harness pi|claude|all] [--feature f]",
					"       decision promote <feature> <vN>",
				].join("\n"),
			);
			return cmd ? 2 : 0;
	}
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
