import { basename, dirname, relative, resolve, sep } from "node:path";

export type DraftOpResult =
	| { ok: true; file?: string }
	| { ok: false; error: string; status: number };

export function draftsRootOf(projectRoot: string) {
	return resolve(projectRoot, ".drafts");
}

export function safeDraftPath(projectRoot: string, file: unknown) {
	if (typeof file !== "string" || !file.endsWith(".html")) return null;
	const rel = file.replace(/\\/g, "/");
	if (!rel || rel.startsWith("/") || rel.includes("\0") || rel.includes("..")) {
		return null;
	}
	const draftsRoot = draftsRootOf(projectRoot);
	const abs = resolve(draftsRoot, rel);
	const inside = relative(draftsRoot, abs);
	if (!inside || inside.startsWith("..") || inside.split(sep).includes("..")) {
		return null;
	}
	if (basename(abs) === "index.html" || basename(abs) === "preview.html") {
		return null;
	}
	if (inside.split(/[\\/]/).includes("archive")) return null;
	return { abs, rel: inside.replace(/\\/g, "/") };
}

export async function archiveDraft(
	projectRoot: string,
	file: unknown,
): Promise<DraftOpResult> {
	const target = safeDraftPath(projectRoot, file);
	if (!target) return { ok: false, error: "invalid file", status: 400 };
	if (!(await Bun.file(target.abs).exists())) {
		return { ok: false, error: "not found", status: 404 };
	}
	const destRel = `${dirname(target.rel)}/archive/${basename(target.rel)}`;
	const destAbs = resolve(draftsRootOf(projectRoot), destRel);
	await Bun.$`mkdir -p ${dirname(destAbs)}`.quiet();
	if (await Bun.file(destAbs).exists()) {
		return { ok: false, error: `${destRel} already exists`, status: 409 };
	}
	await Bun.$`mv ${target.abs} ${destAbs}`.quiet();
	return { ok: true, file: destRel };
}

export async function deleteDraft(
	projectRoot: string,
	file: unknown,
): Promise<DraftOpResult> {
	const target = safeDraftPath(projectRoot, file);
	if (!target) return { ok: false, error: "invalid file", status: 400 };
	if (!(await Bun.file(target.abs).exists())) {
		return { ok: false, error: "not found", status: 404 };
	}
	await Bun.$`rm ${target.abs}`.quiet();
	return { ok: true };
}
