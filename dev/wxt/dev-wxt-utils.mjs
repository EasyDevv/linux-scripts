#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadWxtCreateServer() {
	const modulePath = path.join(
		process.cwd(),
		"node_modules",
		"wxt",
		"dist",
		"index.mjs",
	);
	const moduleUrl = pathToFileURL(modulePath).href;
	const { createServer } = await import(moduleUrl);
	return createServer;
}

export function consumeCommonDevArg(args, index, state) {
	const arg = args[index];

	if (arg === "--host") {
		if (state) state.serverOptions.host = args[index + 1];
		return index + 1;
	}
	if (arg === "--port" || arg === "-p") {
		if (state) state.serverOptions.port = parseInt(args[index + 1], 10);
		return index + 1;
	}
	if (arg === "--config" || arg === "-c") {
		if (state) state.configFile = args[index + 1];
		return index + 1;
	}
	if (arg === "--mode" || arg === "-m") {
		if (state) state.mode = args[index + 1];
		return index + 1;
	}
	if (arg === "--mv2") {
		if (state) state.manifestVersion = 2;
		return index;
	}
	if (arg === "--mv3") {
		if (state) state.manifestVersion = 3;
		return index;
	}
	if (arg === "--debug") {
		if (state) state.debug = true;
		return index;
	}
	if (arg === "--filter-entrypoint" || arg === "-e") {
		if (state) state.filterEntrypoints.push(args[index + 1]);
		return index + 1;
	}

	return null;
}

export function parseCommonDevArgs(args, label) {
	const state = {
		serverOptions: {},
		filterEntrypoints: [],
		root: undefined,
		mode: undefined,
		configFile: undefined,
		debug: false,
		manifestVersion: undefined,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const consumedIndex = consumeCommonDevArg(args, i, state);
		if (consumedIndex != null) {
			i = consumedIndex;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unsupported WXT flag for wxtu dev ${label}: ${arg}`);
		} else if (state.root == null) {
			state.root = arg;
		} else {
			throw new Error(
				`Unsupported extra argument for wxtu dev ${label}: ${arg}`,
			);
		}
	}

	return {
		root: state.root,
		mode: state.mode,
		configFile: state.configFile,
		debug: state.debug,
		manifestVersion: state.manifestVersion,
		filterEntrypoints: state.filterEntrypoints,
		dev:
			Object.keys(state.serverOptions).length > 0
				? { server: state.serverOptions }
				: undefined,
	};
}

export async function runWxtDevServer(inlineConfig) {
	const createServer = await loadWxtCreateServer();
	const server = await createServer(inlineConfig);

	let stopping = false;
	const stopServer = async (code = 0) => {
		if (stopping) return;
		stopping = true;
		await server.stop().catch(() => {});
		process.exit(code);
	};

	process.on("SIGINT", () => void stopServer(0));
	process.on("SIGTERM", () => void stopServer(0));

	await server.start();
}
