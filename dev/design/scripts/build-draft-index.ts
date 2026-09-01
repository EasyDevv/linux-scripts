import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { injectDraftChromeInto } from "./inject-draft-chrome.ts";
import { listDrafts } from "./list-drafts.ts";
import { renderDraftData } from "./render-draft-data.ts";
import { addProject, expandHome, listProjects } from "./projects.ts";

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

async function rebuild(projectRoot: string, label = projectRoot, force = false) {
	const draftsRoot = resolve(projectRoot, ".draft");
	await mkdir(draftsRoot, { recursive: true });
	await renderDraftData(draftsRoot);
	const injected = await injectDraftChromeInto(draftsRoot, { force });
	const drafts = await listDrafts(draftsRoot);
	process.stdout.write(
		`${label}: ${drafts.length} drafts, chrome ${injected.written} written, ${injected.skipped} unchanged\n`,
	);
	return drafts.length;
}

const all = args.includes("--all");
const force = args.includes("--force");
const rootFlag = valueFor("--root");

if (all) {
	const projects = await listProjects();
	if (projects.length === 0) {
		process.stderr.write("no projects in projects.json\n");
		process.exitCode = 1;
	} else {
		for (const project of projects) {
			await rebuild(expandHome(project.root), project.id, force);
		}
	}
} else {
	const root = resolve(rootFlag ?? ".");
	const registered = await addProject(root);
	if (!registered.ok) {
		process.stderr.write(`${registered.error}\n`);
		process.exitCode = 1;
	} else {
		await rebuild(root, registered.project.id, force);
	}
}
