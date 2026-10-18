/**
 * Backend ladder and the pi-ai adapter behind the engine's `ModelsPort`.
 *
 * Default ladder: the newest Jev on OpenRouter (`typesafe/jev-X.Y`, paid per token, read from the
 * pi-ai catalog because OpenRouter's public listing omits classifiers), then the newest Jev the
 * OpenCode Zen account serves — its free SKU, then the paid one. Only decision models answer:
 * there is no chat-model fallback, so a ladder with no answer means `unavailable` and every
 * harness changes nothing. "Newest" is read from Zen's
 * live `/v1/models` (refreshed every 6 h), so `jev-1.14-free` replaces `jev-1.13-free` the day
 * Zen lists it, with no config edit. The pi-ai catalog is the fallback when the listing fails.
 * `config.json` `backends` pins an explicit ladder instead.
 */

import type { ClassifierApi, ClassifierModel, JsonObject, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinClassifierModels } from "@earendil-works/pi-ai/providers/all";
import type { PiAuthStore } from "./auth.ts";
import type { Backend, ModelsPort } from "./engine.ts";

const ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const REFRESH_MS = 6 * 60 * 60_000;

/** Parse `jev-<major>.<minor>[-free]` (OpenRouter prefixes `typesafe/`); other ids are not Jev SKUs. */
export function jevVersion(id: string): { major: number; minor: number; free: boolean } | undefined {
	const match = /^(?:typesafe\/)?jev-(\d+)\.(\d+)(-free)?$/.exec(id);
	if (!match) return undefined;
	return { major: Number(match[1]), minor: Number(match[2]), free: Boolean(match[3]) };
}

/** Newest version's free SKU, then its paid SKU. Older versions are dropped. */
export function latestJev(ids: readonly string[]): string[] {
	const parsed = ids.flatMap((id) => {
		const version = jevVersion(id);
		return version ? [{ id, ...version }] : [];
	});
	if (parsed.length === 0) return [];
	const top = parsed.reduce((best, v) =>
		v.major > best.major || (v.major === best.major && v.minor > best.minor) ? v : best,
	);
	return parsed
		.filter((v) => v.major === top.major && v.minor === top.minor)
		.sort((a, b) => Number(b.free) - Number(a.free))
		.map((v) => v.id);
}

export class BackendLadder {
	private jevIds: string[] = [];
	private readonly openrouterIds = latestJev(getBuiltinClassifierModels("openrouter").map((m) => m.id));
	private refreshedAt = 0;

	constructor(
		private readonly auth: PiAuthStore,
		private readonly pinned: readonly Backend[] | undefined,
	) {
		this.jevIds = latestJev(getBuiltinClassifierModels("opencode").map((m) => m.id));
	}

	/** Re-read Zen's listing when stale; keeps the last good list on failure. */
	async refresh(force = false): Promise<void> {
		if (this.pinned || (!force && Date.now() - this.refreshedAt < REFRESH_MS)) return;
		this.refreshedAt = Date.now();
		const credential = await this.auth.read("opencode");
		const key = credential?.type === "api_key" ? credential.key : undefined;
		if (!key) return;
		try {
			const res = await fetch(ZEN_MODELS_URL, {
				headers: { Authorization: `Bearer ${key}` },
				signal: AbortSignal.timeout(5_000),
			});
			if (!res.ok) return;
			const body = (await res.json()) as { data?: { id?: unknown }[] };
			const ids = (body.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : []));
			const latest = latestJev(ids);
			if (latest.length > 0) this.jevIds = latest;
		} catch {
			// Offline: keep the previous list.
		}
	}

	list(): Backend[] {
		if (this.pinned) return [...this.pinned];
		return [
			...this.openrouterIds.map((id): Backend => ({ kind: "classifier", model: `openrouter/${id}` })),
			...this.jevIds.map((id): Backend => ({ kind: "classifier", model: `opencode/${id}` })),
		];
	}
}

function splitRef(ref: string): [string, string] {
	const slash = ref.indexOf("/");
	return slash < 0 ? ["", ref] : [ref.slice(0, slash), ref.slice(slash + 1)];
}

/** pi-ai `Models` behind the engine's port; zen classifier SKUs Zen lists but the catalog lacks are synthesized. */
export class PiModels implements ModelsPort {
	readonly models: MutableModels;

	constructor(auth: PiAuthStore) {
		this.models = builtinModels({ credentials: auth });
	}

	private classifier(ref: string): ClassifierModel<ClassifierApi> | undefined {
		const [provider, id] = splitRef(ref);
		const known = this.models.getModelOfType("classifier", provider, id);
		if (known) return known;
		// A newer Jev the catalog has not caught up with: same API and price class as its siblings.
		const sibling = this.models
			.getModelsOfType("classifier", provider)
			.find((m) => jevVersion(m.id)?.free === jevVersion(id)?.free);
		return sibling && jevVersion(id) ? { ...sibling, id, name: id } : undefined;
	}

	inputPrice(ref: string): number | undefined {
		const [provider, id] = splitRef(ref);
		const model = this.classifier(ref) ?? this.models.getModel(provider, id);
		return model?.cost.input;
	}

	classify(ref: string, state: JsonObject, questions: Parameters<ModelsPort["classify"]>[2], signal: AbortSignal) {
		const model = this.classifier(ref);
		if (!model) throw new Error(`unknown classifier ${ref}`);
		return this.models.classify(model, { state, questions: { ...questions } }, { signal });
	}
}
