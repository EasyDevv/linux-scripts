#!/usr/bin/env bun

import { runCommand } from "./commands";
import { CliError } from "./utils";

async function main(): Promise<void> {
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
