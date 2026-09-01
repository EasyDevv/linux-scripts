#!/usr/bin/env bun

import { runCommand } from "./commands";
import { CliError } from "./utils";

async function main(): Promise<void> {
	if (!Bun.version.startsWith("1.4.")) {
		throw new CliError(
			`Unsupported Bun version ${Bun.version}; executor requires Bun 1.4.x`,
		);
	}

	const [command, ...args] = process.argv.slice(2);
	await runCommand(command, args);
}

main().catch((error) => {
	if (error instanceof CliError) {
		if (error.message) {
			console.error(error.message);
		}
		process.exit(error.exitCode);
	}

	console.error(error);
	process.exit(1);
});
