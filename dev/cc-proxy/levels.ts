/**
 * pi와 공유하는 두 가지: 모델이 thinking off를 받는지(pi 카탈로그), 다른 업체로 보낼 때 system 끝에 붙일
 * 공통 층(easy-harness `sources/common.md`).
 *
 * off: pi의 `models-store.json`에 `models.json` `modelOverrides`를 겹친 `thinkingLevelMap.off`를 본다.
 * `null`이면 그 모델은 off가 없다(xAI grok-4.7은 `thinking: disabled`를 200으로 받지만 무시하고 생각한다,
 * 261111 실측). 그러면 pi `clampThinkingLevel`처럼 low로 올린다. 업체 이름이 아니라 카탈로그로 판단한다.
 *
 * 공통 층: deepseek-v4.1-flash에서 추론 −53%, grok-4.7에서 출력 −12%(정답 수 같음,
 * `~/.pi/agent/docs/provider/261111-pi-flash-thinking-bench.md`). 문구는 pi와 같은 파일 하나다.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Effort } from "./config.ts";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** 카탈로그(store + overrides)에서 그 모델의 off 지원 여부. 모르는 모델은 false(low로 안전하게). */
export function offAllowed(store: unknown, overrides: unknown, provider: string, id: string): boolean {
	const models = isRecord(store) && isRecord(store[provider]) ? store[provider].models : undefined;
	const model = Array.isArray(models) ? models.find((entry) => isRecord(entry) && entry.id === id) : undefined;
	if (!isRecord(model)) return false;
	const providers = isRecord(overrides) && isRecord(overrides.providers) ? overrides.providers : {};
	const entry = isRecord(providers[provider]) ? providers[provider] : {};
	const patch = isRecord(entry.modelOverrides) && isRecord(entry.modelOverrides[id]) ? entry.modelOverrides[id] : {};
	if ((typeof patch.reasoning === "boolean" ? patch.reasoning : model.reasoning) === false) return true;
	const patchMap = isRecord(patch.thinkingLevelMap) ? patch.thinkingLevelMap : {};
	const map = isRecord(model.thinkingLevelMap) ? model.thinkingLevelMap : {};
	const off = "off" in patchMap ? patchMap.off : map.off;
	return off !== null;
}

/** 보낼 effort: off를 못 받는 모델이면 low. */
export function sendEffort(effort: Effort | undefined, allowsOff: boolean): Effort | undefined {
	return effort === "off" && !allowsOff ? "low" : effort;
}

const piDir = () => process.env.CC_PROXY_PI_DIR ?? join(homedir(), ".pi", "agent");

function cached<T>(paths: () => string[], build: (texts: (string | undefined)[]) => T): () => T {
	let key = "";
	let value: T | undefined;
	return () => {
		const files = paths();
		const next = files.map((path) => (existsSync(path) ? `${statSync(path).mtimeMs}` : "-")).join("|");
		if (value === undefined || next !== key) {
			key = next;
			value = build(files.map((path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined)));
		}
		return value;
	};
}

const parse = (text: string | undefined): unknown => {
	try {
		return text ? JSON.parse(text) : undefined;
	} catch {
		return undefined;
	}
};

const catalog = cached(
	() => [join(piDir(), "models-store.json"), join(piDir(), "models.json")],
	([store, overrides]) => ({ store: parse(store), overrides: parse(overrides) }),
);

/** I/O: 지금 카탈로그로 `offAllowed`. 파일이 바뀌면 다시 읽는다. */
export function catalogAllowsOff(provider: string, id: string): boolean {
	const { store, overrides } = catalog();
	return offAllowed(store, overrides, provider, id);
}

export function commonPath(): string {
	return process.env.CC_PROXY_COMMON_FILE ?? join(piDir(), "extensions", "easy-harness", "sources", "common.md");
}

const common = cached(
	() => [commonPath()],
	([text]) => text?.trim() ?? "",
);

/** I/O: 공통 층 문구. 파일이 없으면 "" (층 없음). */
export function commonText(): string {
	return common();
}
