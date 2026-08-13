#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	chmodSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { join, resolve, basename, extname, dirname } from "node:path";

const DEFAULT_RETENTION = 10;

function sqlQuotePath(p: string): string {
	return `'${p.replace(/'/g, "''")}'`;
}

function snapshotPrefix(dbName: string): string {
	return `${dbName}-`;
}

function isSnapshotFile(name: string, prefix: string): boolean {
	if (name === `${prefix}latest.db`) return false;
	if (name.startsWith("_tmp_")) return false;
	return name.startsWith(prefix) && name.endsWith(".db");
}

interface Args {
	retention: number;
	sources: string[];
}

function parseArgs(argv: string[]): Args {
	let retention = DEFAULT_RETENTION;
	const sources: string[] = [];

	let i = 0;
	while (i < argv.length) {
		if (argv[i] === "--retention" && i + 1 < argv.length) {
			retention = parseInt(argv[i + 1], 10);
			if (isNaN(retention) || retention < 0) {
				console.error("error: --retention must be a non-negative integer");
				process.exit(1);
			}
			i += 2;
		} else if (argv[i].startsWith("--")) {
			console.error(`error: unknown option ${argv[i]}`);
			process.exit(1);
		} else {
			sources.push(argv[i]);
			i++;
		}
	}

	if (sources.length === 0) {
		console.error("error: at least one source DB path is required");
		process.exit(1);
	}

	return { retention, sources };
}

function cleanupOldSnapshots(dir: string, prefix: string, retention: number) {
	const files = readdirSync(dir)
		.filter((f) => isSnapshotFile(f, prefix))
		.sort();

	const toDelete = files.slice(0, Math.max(0, files.length - retention));
	for (const f of toDelete) {
		unlinkSync(join(dir, f));
	}
}

function snapshotSource(
	sourcePath: string,
	retention: number,
): { ok: true; dest: string } | { ok: false; status: string } {
	const sourceDir = dirname(sourcePath);
	const dbName = basename(sourcePath, extname(sourcePath));
	const snapDir = join(sourceDir, "snapshots");
	const prefix = snapshotPrefix(dbName);

	mkdirSync(snapDir, { recursive: true, mode: 0o700 });
	chmodSync(snapDir, 0o700);

	const timestamp = Date.now();
	const tmpPath = join(snapDir, `_tmp_${dbName}-${timestamp}.db`);
	const finalPath = join(snapDir, `${prefix}${timestamp}.db`);
	const latestPath = join(snapDir, `${prefix}latest.db`);

	let db: Database | null = null;
	let vdb: Database | null = null;

	try {
		db = new Database(sourcePath, { readonly: true });

		const qc = db.query("PRAGMA quick_check").get() as Record<string, unknown>;
		const qcValue = Object.values(qc)[0];
		if (qcValue !== "ok") {
			return { ok: false, status: `corrupt: ${qcValue}` };
		}

		db.exec(`VACUUM INTO ${sqlQuotePath(tmpPath)}`);
		db.close();
		db = null;

		vdb = new Database(tmpPath, { readonly: true });
		const vqc = vdb.query("PRAGMA quick_check").get() as Record<
			string,
			unknown
		>;
		const vqcValue = Object.values(vqc)[0];
		if (vqcValue !== "ok") {
			vdb.close();
			vdb = null;
			unlinkSync(tmpPath);
			return { ok: false, status: `verify-failed: ${vqcValue}` };
		}
		vdb.close();
		vdb = null;

		chmodSync(tmpPath, 0o600);
		renameSync(tmpPath, finalPath);

		try {
			unlinkSync(latestPath);
		} catch {
			/* first snapshot, no prior latest */
		}
		symlinkSync(`${prefix}${timestamp}.db`, latestPath);

		cleanupOldSnapshots(snapDir, prefix, retention);

		return { ok: true, dest: finalPath };
	} catch (err) {
		if (existsSync(tmpPath)) {
			try {
				unlinkSync(tmpPath);
			} catch {
				/* best-effort */
			}
		}
		return { ok: false, status: `${err}` };
	} finally {
		if (db) db.close();
		if (vdb) vdb.close();
	}
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	let hadMissing = false;
	let hadError = false;

	for (const source of args.sources) {
		const sourcePath = resolve(process.cwd(), source);

		if (!existsSync(sourcePath)) {
			console.warn(`warning: source not found: ${sourcePath}`);
			hadMissing = true;
			continue;
		}

		const result = snapshotSource(sourcePath, args.retention);
		if (result.ok) {
			console.log(`snapshot: ${sourcePath} -> ${result.dest}`);
		} else {
			console.error(`error: ${sourcePath}: ${result.status}`);
			hadError = true;
		}
	}

	if (hadError) process.exit(1);
	if (hadMissing) process.exit(0);
}

if (import.meta.main) {
	main();
}
