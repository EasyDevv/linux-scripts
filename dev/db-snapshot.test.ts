import { test, expect, beforeAll, afterAll } from "bun:test";
import {
	mkdirSync,
	rmSync,
	existsSync,
	readlinkSync,
	readdirSync,
	writeFileSync,
	chmodSync,
} from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const tmpRoot = join("/tmp", `db-snapshot-test-${Date.now()}`);
const scriptPath = join(import.meta.dir, "db-snapshot.ts");

beforeAll(() => {
	mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
	rmSync(tmpRoot, { recursive: true, force: true });
});

function createTestDb(dir: string, name: string): string {
	const dbPath = join(dir, name);
	const db = new Database(dbPath);
	db.exec("CREATE TABLE t (v TEXT)");
	db.exec("INSERT INTO t VALUES ('hello')");
	db.exec("INSERT INTO t VALUES ('world')");
	db.close();
	return dbPath;
}

function createCorruptDb(dir: string, name: string): string {
	const dbPath = join(dir, name);
	const db = new Database(dbPath);
	db.exec("CREATE TABLE t (v TEXT)");
	db.exec("INSERT INTO t VALUES ('hello')");
	db.close();
	writeFileSync(dbPath, "BROKEN");
	return dbPath;
}

function runCli(args: string[]) {
	const result = Bun.spawnSync(["bun", "run", scriptPath, ...args], {
		env: { ...process.env },
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

test("creates snapshot beside the source db", () => {
	const dbDir = join(tmpRoot, "colloc1");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createTestDb(dbDir, "app.db");

	const { exitCode, stdout } = runCli([dbPath]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("snapshot:");

	const snapDir = join(dbDir, "snapshots");
	expect(existsSync(snapDir)).toBe(true);

	const latestLink = join(snapDir, "app-latest.db");
	expect(existsSync(latestLink)).toBe(true);
	const linkTarget = readlinkSync(latestLink);
	expect(linkTarget).toMatch(/^app-\d+\.db$/);
	const snapFile = join(snapDir, linkTarget);
	expect(existsSync(snapFile)).toBe(true);
});

test("warns and exits 0 for missing source", () => {
	const missingPath = join(tmpRoot, "nonexistent", "missing.db");

	const { exitCode, stderr } = runCli([missingPath]);

	expect(exitCode).toBe(0);
	expect(stderr).toContain("warning:");
});

test("fails for corrupt db", () => {
	const dbDir = join(tmpRoot, "corrupt1");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createCorruptDb(dbDir, "bad.db");

	const { exitCode, stderr } = runCli([dbPath]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("error:");
});

test("handles multiple dbs in same folder", () => {
	const dbDir = join(tmpRoot, "multi1");
	mkdirSync(dbDir, { recursive: true });
	const dbPath1 = createTestDb(dbDir, "app.db");
	const dbPath2 = createTestDb(dbDir, "import.db");

	const { exitCode, stdout } = runCli([dbPath1, dbPath2]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("snapshot:");

	const snapDir = join(dbDir, "snapshots");
	expect(existsSync(join(snapDir, "app-latest.db"))).toBe(true);
	expect(existsSync(join(snapDir, "import-latest.db"))).toBe(true);
});

test("enforces retention scoped per basename", () => {
	const dbDir = join(tmpRoot, "ret1");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createTestDb(dbDir, "ret.db");

	for (let i = 0; i < 5; i++) {
		runCli(["--retention", "3", dbPath]);
	}

	const snapDir = join(dbDir, "snapshots");
	const files = readdirSync(snapDir).filter(
		(f) => f.startsWith("ret-") && f.endsWith(".db") && f !== "ret-latest.db",
	);
	expect(files.length).toBe(3);
});

test("multiple basenames do not interfere with retention", () => {
	const dbDir = join(tmpRoot, "ret2");
	mkdirSync(dbDir, { recursive: true });
	const dbPath1 = createTestDb(dbDir, "alpha.db");
	const dbPath2 = createTestDb(dbDir, "beta.db");

	for (let i = 0; i < 5; i++) {
		runCli(["--retention", "2", dbPath1, dbPath2]);
	}

	const snapDir = join(dbDir, "snapshots");
	const alphaFiles = readdirSync(snapDir).filter(
		(f) =>
			f.startsWith("alpha-") && f.endsWith(".db") && f !== "alpha-latest.db",
	);
	const betaFiles = readdirSync(snapDir).filter(
		(f) => f.startsWith("beta-") && f.endsWith(".db") && f !== "beta-latest.db",
	);
	expect(alphaFiles.length).toBe(2);
	expect(betaFiles.length).toBe(2);
});

test("at least one source is required", () => {
	const { exitCode, stderr } = runCli([]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("at least one source");
});

test("unknown option fails", () => {
	const dbDir = join(tmpRoot, "unk1");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createTestDb(dbDir, "unk.db");

	const { exitCode, stderr } = runCli(["--bogus", dbPath]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("unknown option");
});

test("snapshot directory permissions are 0700", () => {
	const dbDir = join(tmpRoot, "perm1");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createTestDb(dbDir, "perm.db");

	runCli([dbPath]);

	const snapDir = join(dbDir, "snapshots");
	const stat = Bun.spawnSync(["stat", "-c", "%a", snapDir]);
	expect(stat.stdout.toString().trim()).toBe("700");
});

test("snapshot file permissions are 0600", () => {
	const dbDir = join(tmpRoot, "perm2");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createTestDb(dbDir, "perm.db");

	runCli([dbPath]);

	const snapDir = join(dbDir, "snapshots");
	const latestLink = join(snapDir, "perm-latest.db");
	const target = readlinkSync(latestLink);
	const snapFile = join(snapDir, target);
	const stat = Bun.spawnSync(["stat", "-c", "%a", snapFile]);
	expect(stat.stdout.toString().trim()).toBe("600");
});

test("enforces 0700 on pre-existing snapshots dir", () => {
	const dbDir = join(tmpRoot, "preperm");
	mkdirSync(dbDir, { recursive: true });
	const snapDir = join(dbDir, "snapshots");
	mkdirSync(snapDir, { recursive: true });
	chmodSync(snapDir, 0o777);

	const dbPath = createTestDb(dbDir, "pre.db");
	runCli([dbPath]);

	const st = Bun.spawnSync(["stat", "-c", "%a", snapDir]);
	expect(st.stdout.toString().trim()).toBe("700");
});

test("does not disrupt latest symlink on corrupt source", () => {
	const dbDir = join(tmpRoot, "nolinkbreak");
	mkdirSync(dbDir, { recursive: true });

	const goodPath = createTestDb(dbDir, "good.db");
	runCli([goodPath]);

	const snapDir = join(dbDir, "snapshots");
	const latestLink = join(snapDir, "good-latest.db");
	expect(existsSync(latestLink)).toBe(true);
	const beforeTarget = readlinkSync(latestLink);

	const corruptPath = createCorruptDb(dbDir, "corrupt.db");
	const { exitCode } = runCli([corruptPath]);
	expect(exitCode).toBe(1);

	expect(existsSync(latestLink)).toBe(true);
	const afterTarget = readlinkSync(latestLink);
	expect(afterTarget).toBe(beforeTarget);
});

test("no stale _tmp_ files after successful run", () => {
	const dbDir = join(tmpRoot, "notmpstale");
	mkdirSync(dbDir, { recursive: true });
	const dbPath = createTestDb(dbDir, "notmp.db");

	runCli([dbPath]);

	const snapDir = join(dbDir, "snapshots");
	const tmpFiles = readdirSync(snapDir).filter((f) => f.startsWith("_tmp_"));
	expect(tmpFiles).toHaveLength(0);
});
