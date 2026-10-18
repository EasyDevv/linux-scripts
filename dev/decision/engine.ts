/**
 * Decision engine: one typed-question batch in, typed answers out.
 *
 * Walks a ladder of System One classifiers (Jev: newest free SKU, then paid) and returns the
 * first success. Every failure is a step down, never a throw:
 * the last step is `status: "unavailable"`, which callers treat as "change nothing".
 * Identical in-flight requests share one call; answers are cached by feature, prompt version
 * and state. A failed backend cools down so the next call does not pay its latency again.
 * Spend counts against one daily cap shared by every harness; free models are never capped.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ClassifierAnswer, ClassifierQuestion, ClassifierResult, JsonObject } from "@earendil-works/pi-ai";
import type { Budget, DecisionLog } from "./state.ts";

export interface Backend {
	kind: "classifier";
	/** `provider/model` */
	model: string;
}

export interface DecideRequest {
	feature: string;
	version: string;
	state: JsonObject;
	questions: Readonly<Record<string, ClassifierQuestion>>;
	harness?: string;
	sessionId?: string;
}

export interface Decision {
	status: "ok" | "unavailable";
	decisionId: string;
	backend?: string;
	calibrated: boolean;
	answers: Record<string, ClassifierAnswer>;
	latencyMs: number;
	costUsd: number;
	cached: boolean;
	/** Backends that failed before the answer, with a short reason. */
	skipped: string[];
}

/** The slice of pi-ai `Models` the engine calls; tests pass a fake. */
export interface ModelsPort {
	classify(
		model: string,
		state: JsonObject,
		questions: Readonly<Record<string, ClassifierQuestion>>,
		signal: AbortSignal,
	): Promise<ClassifierResult>;
	/** Catalog input price per MTok; 0 means free. Undefined when the model is unknown. */
	inputPrice(model: string): number | undefined;
}

export interface EngineOptions {
	models: ModelsPort;
	backends: () => readonly Backend[];
	budget: Budget;
	log: DecisionLog;
	cacheTtlMs?: number;
	timeoutMs?: number;
	now?: () => number;
}

const RETRYABLE_COOLDOWN_MS = 60_000;
const HARD_COOLDOWN_MS = 10 * 60_000;

export function stateHash(feature: string, version: string, state: JsonObject, questions: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify([feature, version, state, questions]))
		.digest("hex")
		.slice(0, 16);
}

export class Engine {
	private readonly cache = new Map<string, { at: number; decision: Decision }>();
	private readonly inflight = new Map<string, Promise<Decision>>();
	private readonly cooldown = new Map<string, { until: number; reason: string }>();
	private readonly now: () => number;

	constructor(private readonly options: EngineOptions) {
		this.now = options.now ?? Date.now;
	}

	/** Backends with their cooldown state, for `/health`. */
	status(): { model: string; kind: string; coolingUntil?: number; reason?: string }[] {
		return this.options.backends().map((b) => {
			const cool = this.cooldown.get(b.model);
			return cool && cool.until > this.now()
				? { model: b.model, kind: b.kind, coolingUntil: cool.until, reason: cool.reason }
				: { model: b.model, kind: b.kind };
		});
	}

	async decide(request: DecideRequest): Promise<Decision> {
		const key = stateHash(request.feature, request.version, request.state, request.questions);
		const hit = this.cache.get(key);
		const ttl = this.options.cacheTtlMs ?? 10 * 60_000;
		if (hit && this.now() - hit.at < ttl) {
			const decision = { ...hit.decision, decisionId: randomUUID(), cached: true, latencyMs: 0, costUsd: 0 };
			this.options.log.write({ type: "decide", key, ...meta(request), ...decision });
			return decision;
		}
		const pending = this.inflight.get(key);
		if (pending) return pending;
		const run = this.walk(request, key).finally(() => this.inflight.delete(key));
		this.inflight.set(key, run);
		return run;
	}

	private async walk(request: DecideRequest, key: string): Promise<Decision> {
		const started = this.now();
		const skipped: string[] = [];
		for (const backend of this.options.backends()) {
			const cool = this.cooldown.get(backend.model);
			if (cool && cool.until > this.now()) {
				skipped.push(`${backend.model}: cooling (${cool.reason})`);
				continue;
			}
			const price = this.options.models.inputPrice(backend.model);
			if (price === undefined) {
				skipped.push(`${backend.model}: not in catalog`);
				continue;
			}
			if (price > 0 && this.options.budget.exhausted()) {
				skipped.push(`${backend.model}: daily budget reached`);
				continue;
			}
			const outcome = await this.attempt(backend, request);
			if ("error" in outcome) {
				this.cooldown.set(backend.model, {
					until: this.now() + (outcome.retryable ? RETRYABLE_COOLDOWN_MS : HARD_COOLDOWN_MS),
					reason: outcome.error,
				});
				skipped.push(`${backend.model}: ${outcome.error}`);
				continue;
			}
			this.cooldown.delete(backend.model);
			this.options.budget.spend(outcome.costUsd);
			const decision: Decision = {
				status: "ok",
				decisionId: randomUUID(),
				backend: backend.model,
				calibrated: true,
				answers: outcome.answers,
				latencyMs: this.now() - started,
				costUsd: outcome.costUsd,
				cached: false,
				skipped,
			};
			this.cache.set(key, { at: this.now(), decision });
			this.options.log.write({ type: "decide", key, ...meta(request), ...decision });
			return decision;
		}
		const decision: Decision = {
			status: "unavailable",
			decisionId: randomUUID(),
			calibrated: false,
			answers: {},
			latencyMs: this.now() - started,
			costUsd: 0,
			cached: false,
			skipped,
		};
		this.options.log.write({ type: "decide", key, ...meta(request), ...decision });
		return decision;
	}

	private async attempt(
		backend: Backend,
		request: DecideRequest,
	): Promise<{ answers: Record<string, ClassifierAnswer>; costUsd: number } | { error: string; retryable: boolean }> {
		const signal = AbortSignal.timeout(this.options.timeoutMs ?? 4_000);
		try {
			const result = await this.options.models.classify(backend.model, request.state, request.questions, signal);
			// ClassifierResult carries no structured status, so a classifier error always takes
			// the short cooldown: a 429 on the free SKU must not park it for ten minutes.
			if (result.stopReason !== "stop") {
				const detail = (result as { errorMessage?: string }).errorMessage?.slice(0, 80);
				return { error: detail ? `${result.stopReason}: ${detail}` : result.stopReason, retryable: true };
			}
			for (const id of Object.keys(request.questions)) {
				if (!result.answers[id]) return { error: `missing answer ${id}`, retryable: false };
			}
			return { answers: result.answers, costUsd: result.usage?.cost.total ?? 0 };
		} catch (error) {
			return { error: error instanceof Error ? error.message.slice(0, 120) : "failed", retryable: signal.aborted };
		}
	}
}

function meta(request: DecideRequest): Record<string, unknown> {
	return { feature: request.feature, version: request.version, harness: request.harness, sessionId: request.sessionId };
}
