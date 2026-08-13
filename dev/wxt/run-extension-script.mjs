#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function findWorkspaceRoot(startDir, relativeScriptPath) {
	let currentDir = path.resolve(startDir);

	while (true) {
		const candidate = path.join(currentDir, relativeScriptPath);
		if (existsSync(candidate)) {
			return { workspaceRoot: currentDir, scriptPath: candidate };
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	throw new Error(
		`Could not find ${relativeScriptPath} from ${startDir} or any parent directory.`,
	);
}

function run(command, args, cwd) {
	const child = spawn(command, args, {
		cwd,
		stdio: "inherit",
		env: process.env,
	});

	child.on("error", (error) => {
		console.error(error.message);
		process.exit(1);
	});

	child.on("close", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}

		process.exit(code ?? 0);
	});
}

export function runRepoNodeScript(
	relativeScriptPath,
	extraArgs = process.argv.slice(2),
) {
	const { workspaceRoot, scriptPath } = findWorkspaceRoot(
		process.cwd(),
		relativeScriptPath,
	);
	run(process.execPath, [scriptPath, ...extraArgs], workspaceRoot);
}

export function runRepoBashScript(
	relativeScriptPath,
	extraArgs = process.argv.slice(2),
) {
	const { workspaceRoot, scriptPath } = findWorkspaceRoot(
		process.cwd(),
		relativeScriptPath,
	);
	run("bash", [scriptPath, ...extraArgs], workspaceRoot);
}
