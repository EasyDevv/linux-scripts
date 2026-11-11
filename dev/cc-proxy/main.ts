#!/usr/bin/env bun
/**
 * cc-proxy — Claude Code 별칭(haiku/sonnet/…)을 다른 업체 모델로 보내는 로컬 Anthropic 프록시.
 *
 *   cc-proxy serve        systemd(`cc-proxy.service`)가 띄운다
 *   cc-proxy status       켜짐 여부, 오늘 호출 수, 쿨다운
 *   cc-proxy on | off     라우팅 켜기/끄기(꺼도 Claude Code 요청은 그대로 Anthropic으로 통과)
 */
import { PORT } from "./config.ts";
import { serve } from "./server.ts";

const base = `http://127.0.0.1:${PORT}/_proxy`;

async function call(path: string, init?: RequestInit) {
	const response = await fetch(base + path, { ...init, headers: { "content-type": "application/json" } });
	if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
	return response.json() as Promise<Record<string, any>>;
}

const [command = "status"] = process.argv.slice(2);
switch (command) {
	case "serve":
		serve();
		break;
	case "on":
	case "off": {
		await call("/enabled", { method: "POST", body: JSON.stringify({ enabled: command === "on" }) });
		console.log(`cc-proxy ${command}`);
		break;
	}
	case "status": {
		try {
			const stats = await call("/stats");
			const day = stats.day.bucket;
			console.log(`cc-proxy ${stats.enabled ? "on" : "off"} · today ${day.proxied} proxied · ${day.native} native · ${day.fallbacks} fallbacks · ${day.errors} errors`);
			for (const [target, counter] of Object.entries<any>(day.targets)) {
				console.log(`  ${target}: ${counter.calls} calls · ${counter.errors} errors · ${counter.input}/${counter.output} tok`);
			}
			for (const cooling of stats.cooldowns) console.log(`  cooling ${cooling.target} until ${new Date(cooling.until).toLocaleTimeString()}`);
		} catch {
			console.log("cc-proxy is not running (systemctl --user start cc-proxy)");
			process.exitCode = 1;
		}
		break;
	}
	default:
		console.error("usage: cc-proxy serve | status | on | off");
		process.exitCode = 2;
}
