#!/usr/bin/env bun
/**
 * Look up a live URL in {DESIGN_THEMES}/ref/{host}/ before recapturing.
 * Exit 0 on hit, 1 on miss, 2 on usage error.
 */

import { join } from "node:path";
import { designRefRoot } from "./paths.ts";
import {
	fileExists,
	listRefHosts,
	loadRefIndex,
	matchPage,
	parseTarget,
	relativize,
	snapshotPath,
} from "./ref-store.ts";

const args = Bun.argv.slice(2);
const json = args.includes("--json");
const list = args.includes("--list");
const targetArg = args.find((arg) => !arg.startsWith("--"));

if (list) {
	const hosts = await listRefHosts();
	if (json) process.stdout.write(`${JSON.stringify({ hosts, root: designRefRoot() })}\n`);
	else process.stdout.write(hosts.length ? `${hosts.join("\n")}\n` : "");
	process.exit(hosts.length ? 0 : 1);
}

if (!targetArg) {
	console.error("usage: resolve-ref.ts <url-or-host> [--json]");
	console.error("       resolve-ref.ts --list [--json]");
	process.exit(2);
}

const target = parseTarget(targetArg);
const { dir, indexPath, index } = await loadRefIndex(target.host);
const dirHit = await fileExists(dir);

if (!dirHit) {
	const payload = {
		hit: false,
		host: target.host,
		dir,
		reason: "missing-host",
	};
	if (json) process.stdout.write(`${JSON.stringify(payload)}\n`);
	else process.stderr.write(`miss ${target.host} (no ${dir})\n`);
	process.exit(1);
}

const page = target.url && index ? matchPage(index, target.url) : null;
const snapshot = page ? snapshotPath(dir, page.id) : null;
const snapshotHit = snapshot ? await fileExists(snapshot) : false;
const files = (index?.files ?? [])
	.filter((file) => (page ? file.page === page.id : true))
	.map((file) => ({
		...file,
		file: relativize(dir, file.file),
		abs: join(dir, relativize(dir, file.file)),
	}));

const payload = {
	hit: true,
	host: target.host,
	dir,
	index: index ? indexPath : null,
	page,
	files,
	snapshot: snapshotHit && snapshot ? relativize(dir, snapshot) : null,
};

if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
else {
	process.stdout.write(`${dir}\n`);
	if (page) process.stdout.write(`page ${page.id} ${page.url}\n`);
	if (payload.snapshot) process.stdout.write(`snapshot ${payload.snapshot}\n`);
	for (const file of files) process.stdout.write(`${file.viewport} ${file.file}\n`);
}
process.exit(0);
