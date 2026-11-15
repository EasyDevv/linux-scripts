/**
 * Backend ladder and the pi-ai adapter behind the engine's `ModelsPort`.
 *
 * Which classifiers exist comes from the central model catalog (`dev/models-catalog`, written by
 * the dashboard server, the same list Settings › Models shows); pi-ai's built-in list only covers
 * a machine whose catalog is missing, because it trails OpenRouter (it lacked `pplx-decider-v1.3`).
 * pi-ai still runs the call and the credentials come from the central auth store.
 *
 * Default ladder: the newest Jev on OpenRouter (`typesafe/jev-X.Y`, paid per token). OpenCode Zen's Jev SKUs
 * are no longer in the default (261018, the owner's call); `config.json` `backends` (the dashboard's
 * Settings › Models › Jev) pins an explicit ladder instead, tried in order. Only decision models
 * answer: there is no chat-model fallback, so a ladder with no answer means `unavailable` and every
 * harness changes nothing.
 */

import type { ClassifierApi, ClassifierModel, JsonObject, MutableModels } from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinClassifierModels } from "@earendil-works/pi-ai/providers/all";
import { CentralCatalog } from "../models-catalog/central-catalog.ts";
import type { CentralAuthStore } from "./auth.ts";
import type { Backend, ModelsPort } from "./engine.ts";

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

/** The pinned `config.json` ladder, else the newest Jev on OpenRouter (central catalog, else built-in). */
export class BackendLadder {
	constructor(
		private readonly pinned: readonly Backend[] | undefined,
		private readonly catalog: CentralCatalog = new CentralCatalog(),
	) {}

	list(): Backend[] {
		if (this.pinned) return [...this.pinned];
		const central = this.catalog.models("openrouter", "classifier").map((m) => m.id);
		const ids = central.length > 0 ? central : getBuiltinClassifierModels("openrouter").map((m) => m.id);
		return latestJev(ids).map((id): Backend => ({ kind: "classifier", model: `openrouter/${id}` }));
	}
}

function splitRef(ref: string): [string, string] {
	const slash = ref.indexOf("/");
	return slash < 0 ? ["", ref] : [ref.slice(0, slash), ref.slice(slash + 1)];
}

/**
 * pi-ai `Models` behind the engine's port. A classifier is looked up in the central catalog, then in
 * pi-ai's built-in list; a pinned Jev SKU neither has is synthesized from its siblings.
 */
export class PiModels implements ModelsPort {
	readonly models: MutableModels;

	constructor(
		auth: CentralAuthStore,
		private readonly catalog: CentralCatalog = new CentralCatalog(),
	) {
		this.models = builtinModels({ credentials: auth });
	}

	private classifier(ref: string): ClassifierModel<ClassifierApi> | undefined {
		const [provider, id] = splitRef(ref);
		const central = this.catalog.model(provider, id, "classifier");
		if (central) return { ...central, provider } as unknown as ClassifierModel<ClassifierApi>;
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
