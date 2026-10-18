/**
 * `decision promote <feature> <vN>`: move a feature's `current` prompt pointer.
 *
 * The pointer is `prompts[feature]` in `~/.config/decision/config.json`, which the daemon reads at
 * start. Promotion is an explicit act: this module only checks that the version exists and loads,
 * warns when no passing eval report backs it, rewrites that one key, and leaves every other key
 * alone. The running daemon keeps its old version until `decision service restart`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVAL_DOCS_DIR, PACKAGE_DIR, type EvalReport } from "./eval.ts";
import { feature as findFeature, FEATURES } from "./features/index.ts";
import { CONFIG_PATH } from "./runtime.ts";

export interface PromoteOptions {
	configPath?: string;
	promptsDir?: string;
	evalDir?: string;
}

export interface PromoteResult {
	feature: string;
	version: string;
	previous?: string;
	configPath: string;
	warnings: string[];
}

/** Newest eval report for this exact feature and version, if any. */
function latestReport(evalDir: string, feature: string, version: string): EvalReport | undefined {
	if (!existsSync(evalDir)) return undefined;
	const marker = `-${feature}-${version}`;
	const names = readdirSync(evalDir)
		.filter((n) => n.endsWith(".json") && n.includes(marker))
		.sort();
	for (const name of names.reverse()) {
		try {
			const report = JSON.parse(readFileSync(join(evalDir, name), "utf8")) as EvalReport;
			if (report.feature === feature && report.version === version) return report;
		} catch {
			// Unreadable report: keep looking.
		}
	}
	return undefined;
}

export function promoteVersion(feature: string, version: string, options: PromoteOptions = {}): PromoteResult {
	const configPath = options.configPath ?? CONFIG_PATH;
	const promptsDir = options.promptsDir ?? join(PACKAGE_DIR, "prompts");
	const def = findFeature(feature);
	if (!def) throw new Error(`unknown feature ${feature} (have ${FEATURES.map((f) => f.name).join(", ")})`);
	if (!/^v\d+$/.test(version)) throw new Error(`version must look like v2, got ${version}`);
	const file = join(promptsDir, feature, `${version}.json`);
	if (!existsSync(file)) throw new Error(`no prompt file ${file}`);
	if (options.promptsDir === undefined) {
		// The feature's own loader is the authority on whether the file is usable.
		def.load(version);
	} else {
		JSON.parse(readFileSync(file, "utf8"));
	}

	let root: Record<string, unknown> = {};
	if (existsSync(configPath)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(configPath, "utf8"));
		} catch {
			throw new Error(`${configPath} is not valid JSON; fix it before promoting`);
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error(`${configPath} is not a JSON object`);
		}
		root = parsed as Record<string, unknown>;
	}
	const existing = root.prompts;
	const prompts: Record<string, unknown> =
		typeof existing === "object" && existing !== null && !Array.isArray(existing) ? { ...existing } : {};
	const previous = typeof prompts[feature] === "string" ? (prompts[feature] as string) : undefined;

	const warnings: string[] = [];
	const report = latestReport(options.evalDir ?? EVAL_DOCS_DIR, feature, version);
	if (!report)
		warnings.push(
			`no eval report for ${feature} ${version}; run \`decision eval --feature ${feature} --version ${version}\``,
		);
	else if (!report.verdict.holds)
		warnings.push(
			`latest eval of ${feature} ${version} did not meet the promotion rule (${report.verdict.reasons.join("; ") || "see report"})`,
		);

	root.prompts = { ...prompts, [feature]: version };
	mkdirSync(dirname(configPath), { recursive: true });
	const tmp = `${configPath}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(root, null, "\t")}\n`);
	renameSync(tmp, configPath);
	return { feature, version, previous, configPath, warnings };
}

export function promoteCommand(argv: string[]): number {
	const [feature, version, ...extra] = argv;
	if (!feature || !version || extra.length > 0) {
		console.error("usage: decision promote <feature> <vN>");
		return 2;
	}
	try {
		const result = promoteVersion(feature, version);
		for (const warning of result.warnings) console.error(`warning: ${warning}`);
		console.log(`${result.feature}: ${result.previous ?? "v1 (default)"} → ${result.version} in ${result.configPath}`);
		console.log("run `decision service restart` for the daemon to pick it up");
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
