#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const TARGETS = {
	build: [
		{ name: "chrome", args: ["build"] },
		{ name: "firefox", args: ["build", "-b", "firefox"] },
	],
	zip: [
		{ name: "chrome", args: ["zip"] },
		{ name: "firefox", args: ["zip", "-b", "firefox"] },
	],
};

const ANSI = {
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	reset: "\x1b[0m",
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const operation = process.argv[2];
const browserFilter = process.argv[3];
const allJobs = TARGETS[operation];
const jobs = browserFilter
	? allJobs.filter((j) => j.name === browserFilter)
	: allJobs;
const rootDir = process.cwd();
const wxtBin = path.join(rootDir, "node_modules/.bin/wxt");
const rootLicensePath = path.join(rootDir, "LICENSE");
const stagedLicensePath = path.join(rootDir, "public", "LICENSE");

if (!jobs) {
	console.error(
		`Usage: node scripts/run-wxt-targets.mjs <${Object.keys(TARGETS).join("|")}>`,
	);
	process.exit(1);
}

const labelWidth = Math.max(...jobs.map((job) => job.name.length));
const childProcesses = [];

function colorize(text, color) {
	if (!useColor) {
		return text;
	}

	return `${color}${text}${ANSI.reset}`;
}

function formatDuration(milliseconds) {
	if (milliseconds < 1000) {
		return `${milliseconds}ms`;
	}

	if (milliseconds < 10_000) {
		return `${(milliseconds / 1000).toFixed(2)}s`;
	}

	return `${(milliseconds / 1000).toFixed(1)}s`;
}

function targetPrefix(name) {
	const padded = name.padEnd(labelWidth, " ");
	const color = name === "chrome" ? ANSI.blue : ANSI.magenta;
	return `[${colorize(padded, color)}]`;
}

function emitLine(name, line, stream) {
	if (line.trim().length === 0) {
		return;
	}

	const output = `${targetPrefix(name)} ${line}\n`;
	stream.write(output);
}

function emitInfo(message) {
	process.stdout.write(`${colorize("==>", ANSI.cyan)} ${message}\n`);
}

function pipeStream(job, source, stream) {
	const decoder = new StringDecoder("utf8");
	let buffered = "";

	source.on("data", (chunk) => {
		buffered += decoder.write(chunk);
		const lines = buffered.split(/\r\n|\n|\r/g);
		buffered = lines.pop() ?? "";

		for (const line of lines) {
			emitLine(job.name, line, stream);
		}
	});

	source.on("end", () => {
		buffered += decoder.end();
		if (buffered.length > 0) {
			emitLine(job.name, buffered, stream);
		}
	});
}

function runJob(job) {
	const startedAt = Date.now();
	const child = spawn(wxtBin, job.args, {
		env: {
			...process.env,
			CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? "1",
			FORCE_COLOR: process.env.FORCE_COLOR ?? (useColor ? "1" : "0"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	childProcesses.push(child);

	pipeStream(job, child.stdout, process.stdout);
	pipeStream(job, child.stderr, process.stderr);

	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled) {
				return;
			}

			settled = true;
			resolve(result);
		};

		child.on("error", (error) => {
			emitLine(
				job.name,
				`failed to start wxt: ${error.message}`,
				process.stderr,
			);
			finish({
				...job,
				code: 1,
				duration: Date.now() - startedAt,
				signal: null,
			});
		});

		child.on("close", (code, signal) => {
			finish({
				...job,
				code: code ?? (signal ? 1 : 0),
				duration: Date.now() - startedAt,
				signal,
			});
		});
	});
}

function stopChildren(signal) {
	for (const child of childProcesses) {
		if (!child.killed) {
			child.kill(signal);
		}
	}
}

async function readOptionalFile(filePath) {
	try {
		return await readFile(filePath);
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return null;
		}

		throw error;
	}
}

async function stageZipLicense() {
	if (operation !== "zip") {
		return null;
	}

	const rootLicense = await readOptionalFile(rootLicensePath);
	if (rootLicense === null) {
		return null;
	}

	const existingPublicLicense = await readOptionalFile(stagedLicensePath);
	await writeFile(stagedLicensePath, rootLicense);
	emitInfo("Staged root LICENSE into zip inputs");

	return async () => {
		if (existingPublicLicense === null) {
			await rm(stagedLicensePath, { force: true });
			return;
		}

		await writeFile(stagedLicensePath, existingPublicLicense);
	};
}

process.on("SIGINT", () => {
	stopChildren("SIGINT");
	process.exit(130);
});

process.on("SIGTERM", () => {
	stopChildren("SIGTERM");
	process.exit(143);
});

if (browserFilter && jobs.length === 0) {
	console.error(`wxtu: unknown browser "${browserFilter}"`);
	process.exit(1);
}

const startedAt = Date.now();
const targetList = browserFilter || "chrome and firefox";
const inParallel = browserFilter ? "" : " in parallel";
emitInfo(`Running ${operation} for ${targetList}${inParallel}`);

const cleanup = await stageZipLicense();
let results;

try {
	results = await Promise.all(jobs.map(runJob));
} finally {
	await cleanup?.();
}

const totalDuration = Date.now() - startedAt;
const failed = results.filter((result) => result.code !== 0);

console.log("");
console.log(colorize("Summary", ANSI.cyan));

for (const result of results) {
	const status =
		result.code === 0
			? colorize("ok", ANSI.green)
			: colorize("failed", ANSI.red);
	console.log(
		`${targetPrefix(result.name)} ${status} ${colorize(`(${formatDuration(result.duration)})`, ANSI.dim)}` +
			(result.signal
				? ` ${colorize(`[signal:${result.signal}]`, ANSI.red)}`
				: ""),
	);
}

console.log(
	`${colorize("total", ANSI.cyan)} ${colorize(`(${formatDuration(totalDuration)})`, ANSI.dim)}`,
);

if (failed.length > 0) {
	process.exit(1);
}
