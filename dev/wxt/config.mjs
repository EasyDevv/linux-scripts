import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(SCRIPT_DIR, "wxtu.config.json");

export const WXTU_CONFIG_PATH = path.resolve(
	process.env.WXTU_CONFIG || DEFAULT_CONFIG_PATH,
);

function failConfig(message) {
	throw new Error(`wxtu config error: ${message}`);
}

function loadConfig() {
	if (!existsSync(WXTU_CONFIG_PATH)) {
		failConfig(`config file not found: ${WXTU_CONFIG_PATH}`);
	}

	let parsed;
	try {
		parsed = JSON.parse(readFileSync(WXTU_CONFIG_PATH, "utf8"));
	} catch (error) {
		failConfig(`failed to parse ${WXTU_CONFIG_PATH}: ${error.message}`);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		failConfig(`top-level JSON value must be an object: ${WXTU_CONFIG_PATH}`);
	}

	return parsed;
}

export const WXTU_CONFIG = loadConfig();
