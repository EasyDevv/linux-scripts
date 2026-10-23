#!/usr/bin/env bun

import { join } from "node:path";
import {
	clearRecordStop,
	readRecordState,
	shouldStopRecording,
	writeRecordState,
} from "./browser-record.ts";
import { CDP, die, getWsUrl } from "./cdp.ts";

type Options = {
	port: number;
	tabIndex: number;
	frames: number | null;
	format: "png" | "jpeg";
	outputDir: string;
};

function parseArgs(argv: string[]): Options {
	const options: Partial<Options> = {
		port: 9222,
		tabIndex: 0,
		frames: null,
		format: "png",
	};

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--port":
				options.port = +(argv[++i] ?? die("Usage: --port <N>"));
				break;
			case "--tab":
				options.tabIndex = +(argv[++i] ?? die("Usage: --tab <N>"));
				break;
			case "--frames":
				options.frames = +(argv[++i] ?? die("Usage: --frames <N>"));
				break;
			case "--until-stop":
				options.frames = null;
				break;
			case "--format": {
				const value = (argv[++i] ??
					die("Usage: --format <png|jpeg>")) as string;
				if (value !== "png" && value !== "jpeg")
					die("--format must be png or jpeg");
				options.format = value;
				break;
			}
			case "--output-dir":
				options.outputDir = argv[++i] ?? die("Usage: --output-dir <dir>");
				break;
			default:
				die(`Unknown option: ${argv[i]}`);
		}
	}

	if (!options.outputDir) die("Usage: --output-dir <dir>");
	if (!Number.isInteger(options.port) || options.port <= 0)
		die("Port must be a positive integer");
	if (!Number.isInteger(options.tabIndex) || options.tabIndex < 0)
		die("Tab index must be a non-negative integer");
	if (
		options.frames !== null &&
		(!Number.isInteger(options.frames) || options.frames <= 0)
	)
		die("Frames must be a positive integer");

	return options as Options;
}

async function updateState(port: number, patch: Record<string, unknown>) {
	const current = await readRecordState(port);
	if (!current) return;
	await writeRecordState({
		...current,
		...patch,
		updatedAt: new Date().toISOString(),
	});
}

async function shouldExitWorker(port: number): Promise<boolean> {
	const current = await readRecordState(port);
	return (
		!current ||
		current.pid !== process.pid ||
		(current.status !== "starting" && current.status !== "recording")
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	await updateState(options.port, {
		pid: process.pid,
		status: "recording",
		error: undefined,
	});

	const wsUrl = await getWsUrl(options.port, options.tabIndex);
	const cdp = await CDP.connect(wsUrl);
	let framesCaptured = 0;
	let lastFramePath: string | undefined;
	const captureUntilStopped = options.frames === null;

	try {
		while (true) {
			if (await shouldExitWorker(options.port)) return;
			if (await shouldStopRecording(options.port)) {
				await updateState(options.port, {
					status: "stopped",
					framesCaptured,
					lastFramePath,
					stoppedAt: new Date().toISOString(),
				});
				return;
			}

			const shot = await cdp.send("Page.captureScreenshot", {
				format: options.format,
			});
			framesCaptured += 1;
			lastFramePath = join(
				options.outputDir,
				`frame-${String(framesCaptured).padStart(4, "0")}.${options.format}`,
			);
			await Bun.write(
				lastFramePath,
				Buffer.from(shot.data as string, "base64"),
			);
			await updateState(options.port, {
				framesCaptured,
				lastFramePath,
				status: "recording",
			});

			if (!captureUntilStopped && framesCaptured >= options.frames) break;
			await Bun.sleep(250);
		}

		await updateState(options.port, {
			status: "completed",
			framesCaptured,
			lastFramePath,
			stoppedAt: new Date().toISOString(),
		});
	} catch (error) {
		await updateState(options.port, {
			status: "failed",
			framesCaptured,
			lastFramePath,
			stoppedAt: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		await clearRecordStop(options.port);
		cdp.close();
	}
}

if (import.meta.main) {
	main().catch((error) =>
		die(error instanceof Error ? error.message : String(error)),
	);
}
