/**
 * cc-proxy 설정 — `~/.config/cc-proxy/config.json`.
 *
 * Claude Code 별칭(haiku/sonnet/opus/fable)마다 프록시 대상 체인을 둔다. 체인 앞에서부터 시도하고,
 * 모두 실패하면 원래 Claude 모델(Anthropic 직행)로 간다. 체인이 비면 그 별칭은 그대로 Anthropic이다.
 * `enabled: false`면 모든 요청이 그대로 Anthropic으로 간다(Claude Code는 세션 중에도 프록시를 거친다).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const ALIASES = ["haiku", "sonnet", "opus", "fable"] as const;
export type Alias = (typeof ALIASES)[number];
/** `off` = `thinking: {type: "disabled"}`. pi 카탈로그에 off가 없는 모델이면 low로 보낸다(`levels.ts`). */
export const EFFORTS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** 체인 한 칸: `provider/model`. `effort`가 있으면 Claude Code가 보낸 effort 대신 이 값을 보낸다. */
export type Target = { model: string; effort?: Effort };
/** `common: false`면 그 별칭은 공통 층(`levels.ts` `commonText`)을 붙이지 않는다. 기본은 붙인다. */
export type Route = { chain: Target[]; common?: false };
export type Config = {
	enabled: boolean;
	routes: Record<Alias, Route>;
	/** 429·5xx·연결·인증 실패 뒤 그 대상을 건너뛰는 시간. */
	cooldownSeconds: number;
	/** true(기본)면 서브에이전트 요청(`x-claude-code-agent-id` 헤더)만 체인을 탄다. 메인 대화와 보조 호출은
	 *  모델이 무엇이든 Anthropic 직행이다(`proxiable`). */
	subagentsOnly: boolean;
};

export const PORT = Number(process.env.CC_PROXY_PORT ?? 45870);

/** Claude Code 2.1.322는 서브에이전트의 API 요청에만 `x-claude-code-agent-id`를 붙인다(메인에는 없음, 261111 실측). */
export const AGENT_HEADER = "x-claude-code-agent-id";

/** 체인을 탈 요청인가: `subagentsOnly`면 서브에이전트 요청만. */
export function proxiable(config: Config, headers: Headers): boolean {
	return !config.subagentsOnly || headers.has(AGENT_HEADER);
}

export const DEFAULT_CONFIG: Config = {
	enabled: true,
	routes: {
		haiku: { chain: [{ model: "opencode-go/deepseek-v4.1-flash" }] },
		sonnet: { chain: [{ model: "xai/grok-4.7" }] },
		opus: { chain: [] },
		fable: { chain: [] },
	},
	cooldownSeconds: 60,
	subagentsOnly: true,
};

export function configDir(): string {
	return process.env.CC_PROXY_CONFIG_DIR ?? join(homedir(), ".config", "cc-proxy");
}

/** Claude 모델 ID(`claude-haiku-5-5`, `claude-opus-5-5[1m]`)의 별칭. Claude가 아니면 null. */
export function aliasOf(model: unknown): Alias | null {
	if (typeof model !== "string") return null;
	const match = /^claude-(haiku|sonnet|opus|fable)\b/.exec(model.toLowerCase());
	return (match?.[1] as Alias | undefined) ?? null;
}

/** `provider/model` → 둘로. 형식이 틀리면 null. */
export function splitTarget(model: string): { provider: string; id: string } | null {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) return null;
	return { provider: model.slice(0, slash), id: model.slice(slash + 1) };
}

/** 검증하고 빠진 칸은 기본값으로 채운다. 틀리면 이유를 던진다. */
export function validate(input: unknown, providers: readonly string[]): Config {
	if (!input || typeof input !== "object") throw new Error("config must be an object");
	const raw = input as Partial<Config> & { routes?: Partial<Record<string, Partial<Route>>> };
	const routes = {} as Record<Alias, Route>;
	for (const alias of ALIASES) {
		const chain = raw.routes?.[alias]?.chain ?? DEFAULT_CONFIG.routes[alias].chain;
		if (!Array.isArray(chain)) throw new Error(`${alias}: chain must be a list`);
		if (chain.length > 8) throw new Error(`${alias}: at most 8 targets`);
		const seen = new Set<string>();
		const common = raw.routes?.[alias]?.common;
		if (common !== undefined && typeof common !== "boolean") throw new Error(`${alias}: common is true/false`);
		routes[alias] = {
			...(common === false ? { common: false as const } : {}),
			chain: chain.map((target) => {
				if (!target || typeof target.model !== "string") throw new Error(`${alias}: target needs a model`);
				const split = splitTarget(target.model);
				if (!split) throw new Error(`${alias}: ${target.model} is not provider/model`);
				if (!providers.includes(split.provider)) {
					throw new Error(`${alias}: provider ${split.provider} is not supported (${providers.join(", ")})`);
				}
				if (seen.has(target.model)) throw new Error(`${alias}: ${target.model} is listed twice`);
				seen.add(target.model);
				if (target.effort !== undefined && !EFFORTS.includes(target.effort)) {
					throw new Error(`${alias}: effort is ${EFFORTS.join("/")}`);
				}
				return target.effort ? { model: target.model, effort: target.effort } : { model: target.model };
			}),
		};
	}
	const cooldownSeconds = raw.cooldownSeconds ?? DEFAULT_CONFIG.cooldownSeconds;
	if (!(Number.isFinite(cooldownSeconds) && cooldownSeconds >= 0 && cooldownSeconds <= 3600)) {
		throw new Error("cooldownSeconds is 0–3600");
	}
	const subagentsOnly = raw.subagentsOnly ?? DEFAULT_CONFIG.subagentsOnly;
	if (typeof subagentsOnly !== "boolean") throw new Error("subagentsOnly is true/false");
	return { enabled: raw.enabled ?? DEFAULT_CONFIG.enabled, routes, cooldownSeconds, subagentsOnly };
}

/** 파일 버전: 저장할 때 읽은 버전과 다르면(그 사이 손으로 고쳤으면) 거절한다. */
export function versionOf(path: string): string {
	try {
		const stat = statSync(path);
		return `${stat.mtimeMs}-${stat.size}`;
	} catch {
		return "missing";
	}
}

export function configPath(): string {
	return join(configDir(), "config.json");
}

export function readConfig(providers: readonly string[]): { config: Config; version: string; error?: string } {
	const path = configPath();
	const version = versionOf(path);
	if (!existsSync(path)) return { config: DEFAULT_CONFIG, version };
	try {
		return { config: validate(JSON.parse(readFileSync(path, "utf8")), providers), version };
	} catch (cause) {
		return { config: DEFAULT_CONFIG, version, error: cause instanceof Error ? cause.message : String(cause) };
	}
}

export function writeConfig(config: Config): string {
	const path = configPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(config, null, "\t")}\n`);
	renameSync(tmp, path);
	return versionOf(path);
}
