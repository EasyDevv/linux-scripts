import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { archiveDraft, deleteDraft } from "./drafts-mutate.ts";
import { listDrafts } from "./list-drafts.ts";
import {
	addProject,
	draftsRootOf,
	findProject,
	listProjects,
	projectRootOf,
} from "./projects.ts";

const designDir = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const port = Number(valueFor("--port") ?? 4177);
const hostname = valueFor("--host") ?? "127.0.0.1";

function json(data: unknown, status = 200) {
	return Response.json(data, { status });
}

async function readBody(request: Request) {
	try {
		return (await request.json()) as {
			file?: string;
			path?: string;
			name?: string;
			project?: string;
		};
	} catch {
		return {};
	}
}

async function catalog() {
	const styles = (await Bun.file(
		resolve(designDir, "js/draft-styles.json"),
	).json()) as { slug: string; label: string; scheme?: string }[];
	const projects = await listProjects();
	const drafts: Array<{
		project: string;
		href: string;
		route: string;
		title: string;
		file: string;
	}> = [];
	for (const project of projects) {
		const draftsRoot = draftsRootOf(project);
		if (!existsSync(draftsRoot)) continue;
		try {
			for (const draft of await listDrafts(draftsRoot)) {
				drafts.push({
					...draft,
					project: project.id,
					href: `/p/${project.id}/${draft.file}`,
				});
			}
		} catch {
			// unreadable .drafts stays empty
		}
	}
	return { projects, styles, drafts };
}

async function managerHtml() {
	const [indexCss, schemeJs, indexJs] = await Promise.all([
		Bun.file(resolve(designDir, "css/draft-index.css")).text(),
		Bun.file(resolve(designDir, "js/color-scheme.js")).text(),
		Bun.file(resolve(designDir, "js/draft-index.js")).text(),
	]);
	return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Drafts</title>
  <style>
${indexCss.trim()}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="nav">
      <div class="nav-head">
        <h1>Drafts</h1>
        <p id="draft-count"></p>
      </div>
      <nav id="draft-nav" class="nav-list" aria-label="draft files"></nav>
      <form id="draft-add" class="add-project">
        <label class="visually-hidden" for="draft-add-path">project path</label>
        <input id="draft-add-path" name="path" type="text" placeholder="~/dev/product/app" autocomplete="off" />
        <button type="submit">add project</button>
      </form>
    </aside>
    <section class="stage">
      <header id="draft-toolbar" class="toolbar" hidden>
        <div id="draft-title" class="file"></div>
        <div class="actions">
          <label class="style-switch">
            <span class="visually-hidden">style</span>
            <select id="draft-style" aria-label="style"></select>
          </label>
          <div class="scheme-switch" role="group" aria-label="color scheme">
            <button type="button" id="draft-scheme-light" aria-pressed="false" title="light">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              <span class="visually-hidden">light</span>
            </button>
            <button type="button" id="draft-scheme-dark" aria-pressed="false" title="dark">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
              </svg>
              <span class="visually-hidden">dark</span>
            </button>
          </div>
          <button type="button" id="draft-archive">archive</button>
          <button type="button" id="draft-delete" class="danger">delete</button>
        </div>
      </header>
      <div class="pane">
        <iframe id="draft-frame" class="frame" title="draft preview" hidden></iframe>
        <div id="draft-empty" class="empty"></div>
      </div>
      <p id="draft-status" class="status" hidden></p>
    </section>
  </div>
  <script>
${schemeJs.trim()}
${indexJs.trim()}
  </script>
</body>
</html>
`;
}

async function projectFile(projectId: string, rel: string) {
	const project = await findProject(projectId);
	if (!project) return null;
	const draftsRoot = draftsRootOf(project);
	const file = resolve(draftsRoot, rel);
	const inside = relative(draftsRoot, file);
	if (!inside || inside.startsWith("..")) return null;
	return file;
}

async function mutate(
	action: "archive" | "delete",
	projectId: string | undefined,
	file: string | undefined,
) {
	if (!projectId || !file) return json({ error: "project and file required" }, 400);
	const project = await findProject(projectId);
	if (!project) return json({ error: "unknown project" }, 404);
	const result =
		action === "archive"
			? await archiveDraft(projectRootOf(project), file)
			: await deleteDraft(projectRootOf(project), file);
	if (!result.ok) return json({ error: result.error }, result.status);
	return json({ ok: true, file: result.file });
}

const server = Bun.serve({
	port,
	hostname,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/__drafts/catalog" && request.method === "GET") {
			return json(await catalog());
		}
		if (url.pathname === "/__drafts/projects" && request.method === "POST") {
			const body = await readBody(request);
			const result = await addProject(body.path ?? "", body.name);
			if (!result.ok) return json({ error: result.error }, result.status);
			return json({ ok: true, project: result.project, created: result.created });
		}
		if (url.pathname === "/__drafts/archive" && request.method === "POST") {
			const body = await readBody(request);
			return mutate("archive", body.project, body.file);
		}
		if (url.pathname === "/__drafts/delete" && request.method === "POST") {
			const body = await readBody(request);
			return mutate("delete", body.project, body.file);
		}
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(await managerHtml(), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		const served = url.pathname.match(/^\/p\/([^/]+)\/(.+)$/);
		if (served) {
			const file = await projectFile(
				decodeURIComponent(served[1]),
				decodeURIComponent(served[2]),
			);
			if (!file) return new Response("Not found", { status: 404 });
			const bunFile = Bun.file(file);
			if (!(await bunFile.exists())) return new Response("Not found", { status: 404 });
			return new Response(bunFile);
		}

		return new Response("Not found", { status: 404 });
	},
});

process.stdout.write(`drafts http://${hostname}:${server.port}/\n`);
