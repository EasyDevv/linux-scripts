import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";

export type DraftProject = {
	id: string;
	name: string;
	root: string;
};

type Store = { projects: DraftProject[] };

const designDir = resolve(import.meta.dir, "..");
const storePath = resolve(designDir, "projects.json");

export function expandHome(path: string) {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return resolve(path);
}

function slugify(value: string) {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "project";
}

function uniqueId(base: string, used: Set<string>) {
	if (!used.has(base)) return base;
	let index = 2;
	while (used.has(`${base}-${index}`)) index += 1;
	return `${base}-${index}`;
}

async function readStore(): Promise<Store> {
	if (!(await Bun.file(storePath).exists())) return { projects: [] };
	try {
		const parsed = (await Bun.file(storePath).json()) as Store;
		if (!parsed || !Array.isArray(parsed.projects)) return { projects: [] };
		return {
			projects: parsed.projects.filter(
				(project): project is DraftProject =>
					typeof project?.id === "string" &&
					typeof project?.name === "string" &&
					typeof project?.root === "string",
			),
		};
	} catch {
		return { projects: [] };
	}
}

async function writeStore(store: Store) {
	await Bun.write(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

export async function listProjects(): Promise<DraftProject[]> {
	return (await readStore()).projects;
}

export function projectRootOf(project: DraftProject) {
	return expandHome(project.root);
}

export function draftsRootOf(project: DraftProject) {
	return resolve(projectRootOf(project), ".drafts");
}

export async function findProject(id: string) {
	return (await listProjects()).find((project) => project.id === id) ?? null;
}

export async function addProject(rawPath: string, rawName?: string) {
	const trimmed = rawPath.trim();
	if (!trimmed) return { ok: false as const, error: "path required", status: 400 };

	const root = expandHome(trimmed);
	if (!existsSync(root)) {
		return { ok: false as const, error: "path not found", status: 404 };
	}
	if (!statSync(root).isDirectory()) {
		return { ok: false as const, error: "path is not a directory", status: 400 };
	}

	const store = await readStore();
	const existing = store.projects.find(
		(project) => projectRootOf(project) === root,
	);
	if (existing) {
		await mkdir(draftsRootOf(existing), { recursive: true });
		return { ok: true as const, project: existing, created: false };
	}

	const used = new Set(store.projects.map((project) => project.id));
	const name = rawName?.trim() || basename(root);
	const project: DraftProject = {
		id: uniqueId(slugify(name), used),
		name,
		root: root.startsWith(homedir())
			? `~/${relativeHome(root)}`
			: root,
	};
	store.projects.push(project);
	await mkdir(draftsRootOf(project), { recursive: true });
	await writeStore(store);
	return { ok: true as const, project, created: true };
}

function relativeHome(abs: string) {
	return abs.slice(homedir().length).replace(/^\/+/, "");
}
