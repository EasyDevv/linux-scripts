/**
 * pi glue for the shared skill-flag policy in `core.ts`. The factory syncs before pi scans skills
 * (startup and `/reload`), `session_start` watches the user roots and the current project so a skill
 * added in-session is hidden within a debounce, and `/sync-hidden-skills` re-runs everything.
 *
 * The watcher covers the current project only; skills in other project roots are flagged when the
 * factory runs (every `pi` invocation). Claude Code gets the same pass from the `agents-rules`
 * SessionStart hook, which runs `sync.ts`.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";
import { formatSyncResult, skillRoots, syncSkillFlags, watchTargets, type SyncSkillFlagsResult } from "./core.ts";

const WATCH_DEBOUNCE_MS = 200;

/** The subset of pi's extension types this file uses, so the module needs no pi package. */
interface SkillFlagsContext {
	cwd: string;
	hasUI: boolean;
	reload(): Promise<void>;
	ui: { notify(message: string, level?: "info" | "warning"): void };
}

interface SkillFlagsPi {
	registerCommand(
		name: string,
		options: { description: string; handler: (args: string, ctx: SkillFlagsContext) => Promise<void> | void },
	): void;
	on(
		event: "session_start" | "session_shutdown",
		handler: (event: unknown, ctx: SkillFlagsContext) => Promise<void> | void,
	): void;
}

export default function (pi: SkillFlagsPi) {
	let lastResult: SyncSkillFlagsResult = syncSkillFlags();
	const watchers = new Map<string, FSWatcher>();
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let applying = false;
	let ctx: SkillFlagsContext | undefined;
	let watchRoots: string[] = [];

	const stopWatch = () => {
		if (debounce) {
			clearTimeout(debounce);
			debounce = undefined;
		}
		for (const watcher of watchers.values()) watcher.close();
		watchers.clear();
	};

	const reconcileWatches = () => {
		const wanted = watchTargets(watchRoots);
		for (const [dir, watcher] of watchers) {
			if (!wanted.has(dir)) {
				watcher.close();
				watchers.delete(dir);
			}
		}
		for (const [dir, kind] of wanted) {
			if (watchers.has(dir) || !existsSync(dir)) continue;
			try {
				const watcher = watch(dir, { recursive: false }, (_eventType, filename) => {
					if (kind === "skill" && filename !== "SKILL.md") return;
					if (filename?.startsWith(".")) return;
					if (debounce) clearTimeout(debounce);
					debounce = setTimeout(() => {
						if (applying) return;
						applying = true;
						try {
							lastResult = syncSkillFlags({ roots: watchRoots });
							reconcileWatches();
							if (lastResult.changed.length === 0) return;
							if (ctx?.hasUI) ctx.ui.notify(formatSyncResult(lastResult, true), "info");
						} finally {
							applying = false;
						}
					}, WATCH_DEBOUNCE_MS);
				});
				watchers.set(dir, watcher);
			} catch (error) {
				if (ctx?.hasUI) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Could not watch ${dir}: ${message}`, "warning");
				}
			}
		}
	};

	const startWatch = () => {
		stopWatch();
		watchRoots = skillRoots({ cwd: ctx?.cwd });
		reconcileWatches();
	};

	pi.registerCommand("sync-hidden-skills", {
		description: "Set disable-model-invocation on every managed skill and reload",
		handler: async (_args, commandCtx) => {
			ctx = commandCtx;
			applying = true;
			try {
				lastResult = syncSkillFlags();
				if (commandCtx.hasUI) commandCtx.ui.notify(formatSyncResult(lastResult), "info");
			} finally {
				applying = false;
			}
			if (lastResult.changed.length > 0) await commandCtx.reload();
		},
	});

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		if (lastResult.changed.length > 0 && sessionCtx.hasUI) {
			sessionCtx.ui.notify(formatSyncResult(lastResult), "info");
		}
		startWatch();
	});

	pi.on("session_shutdown", async () => {
		stopWatch();
	});
}
