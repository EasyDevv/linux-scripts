import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const tmpDir = join("/tmp", `executor-config-test-${Date.now()}`);
const origXdg = process.env.XDG_CONFIG_HOME;
const origRuntime = process.env.XDG_RUNTIME_DIR;

beforeAll(() => {
	process.env.XDG_CONFIG_HOME = tmpDir;
	process.env.XDG_RUNTIME_DIR = join(tmpDir, "runtime");
	mkdirSync(join(tmpDir, "systemd", "user"), { recursive: true });
});

afterAll(() => {
	if (origXdg) {
		process.env.XDG_CONFIG_HOME = origXdg;
	} else {
		delete process.env.XDG_CONFIG_HOME;
	}
	if (origRuntime) {
		process.env.XDG_RUNTIME_DIR = origRuntime;
	} else {
		delete process.env.XDG_RUNTIME_DIR;
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

function configPath(): string {
	return join(tmpDir, "systemd", "user", "executor.json");
}

test("readConfig returns instances from config file", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: { dir: "/tmp/foo", cmd: "node server.js" },
			bar: { dir: "/home/bar", cmd: "bun run dev", enabled: false },
		}),
	);

	const config = await readConfig();
	expect(config).not.toBeNull();
	expect(config!.hasInstance("foo")).toBe(true);
	expect(config!.hasInstance("bar")).toBe(true);
	expect(config!.hasInstance("nonexistent")).toBe(false);
});

test("getPort parses --port from command", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			web: { dir: "/tmp/web", cmd: "moon run desktop:web -- --port 5180" },
			api: { dir: "/tmp/api", cmd: "bun run dev --port 4173 --host" },
			noport: { dir: "/tmp/noport", cmd: "node server.js" },
			$control: { restart: {} },
		}),
	);

	const config = await readConfig();
	expect(config!.getPort("web")).toBe("5180");
	expect(config!.getPort("api")).toBe("4173");
	expect(config!.getPort("noport")).toBe("");
});

test("getPort prefers --client-port over --port", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			client: {
				dir: "/tmp/client",
				cmd: "bun run dev -- --client-port 5181 --server-port 3011",
			},
			both: {
				dir: "/tmp/both",
				cmd: "bun run dev --client-port 5182 --port 9999",
			},
			$control: { restart: {} },
		}),
	);

	const config = await readConfig();
	expect(config!.getPort("client")).toBe("5181");
	expect(config!.getPort("both")).toBe("5182");
});

test("getPort prefers --web-port over --client-port and --port", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			stack: {
				dir: "/tmp/stack",
				cmd: "dev-stack --web-port 5183 --client-port 9999 --port 1111",
			},
		}),
	);

	const config = await readConfig();
	expect(config!.getPort("stack")).toBe("5183");
});

test("non-executor metadata is passed as env", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: {
				dir: "/tmp/foo",
				cmd: "echo foo",
				browser: false,
				"browser-cdp": "9222",
				CUSTOM_ENV: "value",
			},
			$control: { restart: {} },
		}),
	);

	const config = await readConfig();
	const instance = config!.getInstance("foo");
	expect(instance.env).toHaveProperty("browser", "false");
	expect(instance.env).toHaveProperty("browser-cdp", "9222");
	expect(instance.env).toHaveProperty("CUSTOM_ENV", "value");
});

test("isEnabled works with disabled instances", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			enabled: { dir: "/tmp/a", cmd: "echo a" },
			disabled_field: { dir: "/tmp/b", cmd: "echo b", enabled: false },
			disabled_control: { dir: "/tmp/c", cmd: "echo c" },
			$control: { disabled: ["disabled_control"], restart: {} },
		}),
	);

	const config = await readConfig();
	expect(config!.isEnabled("enabled")).toBe(true);
	expect(config!.isEnabled("disabled_field")).toBe(false);
	expect(config!.isEnabled("disabled_control")).toBe(false);
});

test("getInstance throws on missing name", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: { dir: "/tmp/foo", cmd: "echo foo" },
			$control: { restart: {} },
		}),
	);

	const config = await readConfig();
	expect(() => config!.getInstance("nonexistent")).toThrow(
		"Unknown executor item",
	);
});

test("writeConfig persists enabled mutation", async () => {
	const { readConfig, writeConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: { dir: "/tmp/foo", cmd: "echo foo", enabled: true },
			$control: { restart: {} },
		}),
	);

	await writeConfig((m) => m.setEnabled("foo", false));

	const config = await readConfig();
	expect(config!.isEnabled("foo")).toBe(false);
});

test("writeRestartToken stores restart state outside executor.json", async () => {
	const { readConfig, writeRestartToken } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: { dir: "/tmp/foo", cmd: "echo foo" },
		}),
	);

	await writeRestartToken("foo", "abc123");

	const config = await readConfig();
	expect(config!.restartTokens.get("foo")).toBe("abc123");
	expect(readFileSync(configPath(), "utf8")).not.toContain("$control");
});

test("malformed JSON throws", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(configPath(), "not json");

	await expect(readConfig()).rejects.toThrow("Invalid config file");
});

test("missing dir field throws", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({ foo: { cmd: "echo foo" }, $control: { restart: {} } }),
	);

	await expect(readConfig()).rejects.toThrow("Missing string dir");
});

test("missing cmd field throws", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({ foo: { dir: "/tmp/foo" }, $control: { restart: {} } }),
	);

	await expect(readConfig()).rejects.toThrow("Missing string cmd");
});

test("non-object $control throws", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: { dir: "/tmp/foo", cmd: "echo foo" },
			$control: "bad",
		}),
	);

	await expect(readConfig()).rejects.toThrow("must be an object");
});

test("$control.disabled with non-array throws", async () => {
	const { readConfig } = await import("./config");

	writeFileSync(
		configPath(),
		JSON.stringify({
			foo: { dir: "/tmp/foo", cmd: "echo foo" },
			$control: { disabled: "bad" },
		}),
	);

	await expect(readConfig()).rejects.toThrow("must contain only strings");
});
