import { basename, dirname, join } from "node:path";

const home = process.env.HOME ?? "";
const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp";

export const controlKey = "$control";
export const configFile = join(
	xdgConfigHome,
	"systemd",
	"user",
	"executor.json",
);
export const configDir = dirname(configFile);
export const configName = basename(configFile);
export const stateDir = join(xdgRuntimeDir, "executor");
export const controlFile = join(stateDir, "control.json");
export const runtimeStateFile = join(stateDir, "runtime.json");
export const serviceName = "executor.service";
/** Kept for callers that used the old polling constant. */
export const pollIntervalMs = 2_000;
export const safetyPollIntervalMs = 30_000;
export const configWatchDebounceMs = 75;

export function expandHome(value: string): string {
	if (value === "~") {
		return home;
	}

	if (value.startsWith("~/")) {
		return join(home, value.slice(2));
	}

	return value;
}
