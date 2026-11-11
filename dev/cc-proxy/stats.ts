/**
 * 호출 집계 — 전체(오늘 · 누적)와 Claude Code 세션별(`x-claude-code-session-id`).
 *
 * 한 번의 `/v1/messages` 요청은 결과 하나로 센다: 어느 대상이 받았는지(`provider/model` 또는
 * `native/<claude id>`), 앞 대상이 실패해 넘어간 횟수(fallback), 토큰. `~/.local/state/cc-proxy/stats.json`에
 * 몇 초마다 저장해 재시작해도 남는다. 세션은 최근 200개만 둔다.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Counter = { calls: number; errors: number; fallbacks: number; input: number; output: number; cacheRead: number };
export type Bucket = {
	/** 프록시 대상(`native/…` 아닌 것)이 받은 요청 수. */
	proxied: number;
	/** Anthropic이 받은 요청 수(체인 없는 별칭, 꺼짐, 마지막 fallback). */
	native: number;
	fallbacks: number;
	errors: number;
	/** 받은 대상별. */
	targets: Record<string, Counter>;
	/** 별칭별(haiku/sonnet/…, Claude가 아닌 모델은 other). */
	aliases: Record<string, { proxied: number; native: number }>;
	updatedAt: number;
};
export type Stats = {
	total: Bucket;
	day: { date: string; bucket: Bucket };
	sessions: Record<string, Bucket>;
	/** 실패해서 쿨다운 중인 대상과 끝나는 시각, 마지막 실패. */
	recentFailures: { at: number; target: string; status: number | string; message: string }[];
};

export const emptyBucket = (): Bucket => ({
	proxied: 0,
	native: 0,
	fallbacks: 0,
	errors: 0,
	targets: {},
	aliases: {},
	updatedAt: 0,
});
const emptyCounter = (): Counter => ({ calls: 0, errors: 0, fallbacks: 0, input: 0, output: 0, cacheRead: 0 });
const today = () => new Date().toLocaleDateString("sv-SE");

export function statsPath(): string {
	return process.env.CC_PROXY_STATS_FILE ?? join(homedir(), ".local", "state", "cc-proxy", "stats.json");
}

export function load(): Stats {
	try {
		const parsed = JSON.parse(readFileSync(statsPath(), "utf8")) as Stats;
		if (parsed.total && parsed.day && parsed.sessions) return { ...parsed, recentFailures: parsed.recentFailures ?? [] };
	} catch {
		// 처음이거나 깨졌다: 새로 센다.
	}
	return { total: emptyBucket(), day: { date: today(), bucket: emptyBucket() }, sessions: {}, recentFailures: [] };
}

export type Outcome = {
	session?: string;
	alias: string;
	/** 받은 대상. 모두 실패했으면 undefined. */
	target?: string;
	/** 받기 전 실패한 대상 수. */
	fallbacks: number;
	usage?: { input: number; output: number; cacheRead: number };
};

function apply(bucket: Bucket, outcome: Outcome) {
	const native = outcome.target?.startsWith("native/") ?? false;
	const alias = (bucket.aliases[outcome.alias] ??= { proxied: 0, native: 0 });
	bucket.fallbacks += outcome.fallbacks;
	bucket.updatedAt = Date.now();
	if (!outcome.target) {
		bucket.errors += 1;
		return;
	}
	if (native) {
		bucket.native += 1;
		alias.native += 1;
	} else {
		bucket.proxied += 1;
		alias.proxied += 1;
	}
	const counter = (bucket.targets[outcome.target] ??= emptyCounter());
	counter.calls += 1;
	counter.fallbacks += outcome.fallbacks;
	counter.input += outcome.usage?.input ?? 0;
	counter.output += outcome.usage?.output ?? 0;
	counter.cacheRead += outcome.usage?.cacheRead ?? 0;
}

export function record(stats: Stats, outcome: Outcome) {
	if (stats.day.date !== today()) stats.day = { date: today(), bucket: emptyBucket() };
	apply(stats.total, outcome);
	apply(stats.day.bucket, outcome);
	if (outcome.session) {
		apply((stats.sessions[outcome.session] ??= emptyBucket()), outcome);
		const ids = Object.keys(stats.sessions);
		if (ids.length > 200) {
			ids.sort((a, b) => stats.sessions[a]!.updatedAt - stats.sessions[b]!.updatedAt);
			for (const id of ids.slice(0, ids.length - 200)) delete stats.sessions[id];
		}
	}
}

/** 대상이 실패했다: 그 대상 카운터의 errors와 최근 실패 목록. */
export function recordFailure(stats: Stats, target: string, status: number | string, message: string) {
	for (const bucket of [stats.total, stats.day.bucket]) (bucket.targets[target] ??= emptyCounter()).errors += 1;
	stats.recentFailures = [{ at: Date.now(), target, status, message: message.slice(0, 300) }, ...stats.recentFailures].slice(0, 20);
}

export function save(stats: Stats) {
	const path = statsPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(stats));
	renameSync(tmp, path);
}
