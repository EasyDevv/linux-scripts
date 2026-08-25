(() => {
	const nav = document.getElementById("draft-nav");
	const countEl = document.getElementById("draft-count");
	const toolbar = document.getElementById("draft-toolbar");
	const title = document.getElementById("draft-title");
	const frame = document.getElementById("draft-frame");
	const empty = document.getElementById("draft-empty");
	const status = document.getElementById("draft-status");
	const archiveBtn = document.getElementById("draft-archive");
	const deleteBtn = document.getElementById("draft-delete");
	const styleSelect = document.getElementById("draft-style");
	const schemeLight = document.getElementById("draft-scheme-light");
	const schemeDark = document.getElementById("draft-scheme-dark");
	const addForm = document.getElementById("draft-add");
	const addPath = document.getElementById("draft-add-path");

	let projects = [];
	let drafts = [];
	let styles = [];
	let currentProject = "";
	let currentFile = "";

	const fileName = (file) => file.split("/").pop() || file;

	const params = () => new URLSearchParams(location.search);

	const selectedStyle = () => {
		const requested = params().get("style");
		if (styles.some((style) => style.slug === requested)) return requested;
		return styles[0]?.slug || "";
	};

	const currentScheme = (slug = selectedStyle()) =>
		window.draftColorScheme?.read(slug, styles) || "light";

	const applyFrameScheme = (scheme) => {
		const doc = frame?.contentDocument;
		if (doc && doc.location?.origin === location.origin) {
			window.draftColorScheme?.apply(doc, scheme);
		}
	};

	const syncSchemeControls = () => {
		const slug = selectedStyle();
		const scheme = currentScheme(slug);
		const fallback = window.draftColorScheme?.defaultOf(slug, styles) || "light";
		for (const [button, value] of [
			[schemeLight, "light"],
			[schemeDark, "dark"],
		]) {
			if (!button) continue;
			button.setAttribute("aria-pressed", value === scheme ? "true" : "false");
			button.toggleAttribute("data-default", value === fallback);
			button.title = value === fallback ? `${value} (default)` : value;
		}
		applyFrameScheme(scheme);
	};

	const withStyle = (href, slug) => {
		if (!slug) return href;
		const url = new URL(href, location.origin);
		url.searchParams.set("style", slug);
		url.searchParams.set("scheme", currentScheme(slug));
		return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
	};

	const setStatus = (message) => {
		if (!status) return;
		status.hidden = !message;
		status.textContent = message || "";
	};

	const setQuery = ({ project, file, style, push }) => {
		const url = new URL(location.href);
		if (project) url.searchParams.set("project", project);
		else url.searchParams.delete("project");
		if (file) url.searchParams.set("file", file);
		else url.searchParams.delete("file");
		if (style) url.searchParams.set("style", style);
		else url.searchParams.delete("style");
		history[push ? "pushState" : "replaceState"](null, "", url);
		currentProject = project || "";
		currentFile = file || "";
		render();
	};

	const fillStyles = () => {
		if (!styleSelect) return;
		styleSelect.replaceChildren();
		for (const style of styles) {
			const option = document.createElement("option");
			option.value = style.slug;
			option.textContent = style.label;
			styleSelect.append(option);
		}
	};

	const openKey = (kind, id) => `draft-open:${kind}:${id}`;

	const isOpen = (kind, id, fallback) => {
		const stored = localStorage.getItem(openKey(kind, id));
		if (stored === "1") return true;
		if (stored === "0") return false;
		return fallback;
	};

	const persistOpen = (kind, id, open) => {
		localStorage.setItem(openKey(kind, id), open ? "1" : "0");
	};

	const renderCount = () => {
		if (!countEl) return;
		countEl.textContent = `${projects.length} projects · ${drafts.length} html`;
	};

	const renderNav = () => {
		if (!nav) return;
		nav.replaceChildren();
		for (const project of projects) {
			const items = drafts.filter((draft) => draft.project === project.id);
			const projectEl = document.createElement("details");
			projectEl.className = "project";
			projectEl.open = isOpen(
				"project",
				project.id,
				project.id === currentProject || projects[0]?.id === project.id,
			);
			projectEl.addEventListener("toggle", () => {
				persistOpen("project", project.id, projectEl.open);
			});

			const projectSummary = document.createElement("summary");
			projectSummary.textContent = project.name;
			projectEl.append(projectSummary);

			const routes = new Map();
			for (const draft of items) {
				const list = routes.get(draft.route) ?? [];
				list.push(draft);
				routes.set(draft.route, list);
			}

			for (const [route, routeDrafts] of routes) {
				const routeEl = document.createElement("details");
				routeEl.className = "route";
				const routeId = `${project.id}/${route}`;
				routeEl.open = isOpen(
					"route",
					routeId,
					project.id === currentProject &&
						routeDrafts.some((draft) => draft.file === currentFile),
				);
				routeEl.addEventListener("toggle", () => {
					persistOpen("route", routeId, routeEl.open);
				});
				const routeSummary = document.createElement("summary");
				routeSummary.textContent = route;
				const list = document.createElement("ul");
				for (const draft of routeDrafts) {
					const item = document.createElement("li");
					const link = document.createElement("a");
					link.href = `?project=${encodeURIComponent(project.id)}&file=${encodeURIComponent(draft.file)}`;
					link.textContent = fileName(draft.file);
					if (
						draft.project === currentProject &&
						draft.file === currentFile
					) {
						link.setAttribute("aria-current", "page");
					}
					link.addEventListener("click", (event) => {
						event.preventDefault();
						setQuery({
							project: project.id,
							file: draft.file,
							style: selectedStyle(),
							push: true,
						});
					});
					item.append(link);
					list.append(item);
				}
				routeEl.append(routeSummary, list);
				projectEl.append(routeEl);
			}

			if (items.length === 0) {
				const vacant = document.createElement("p");
				vacant.className = "vacant";
				vacant.textContent = "no drafts";
				projectEl.append(vacant);
			}

			nav.append(projectEl);
		}
	};

	const renderStage = () => {
		const draft = drafts.find(
			(item) => item.project === currentProject && item.file === currentFile,
		);
		const slug = selectedStyle();
		if (styleSelect && slug) styleSelect.value = slug;
		syncSchemeControls();
		if (!draft) {
			if (toolbar) toolbar.hidden = true;
			if (frame) {
				frame.hidden = true;
				frame.removeAttribute("src");
			}
			if (empty) empty.hidden = false;
			return;
		}
		if (toolbar) toolbar.hidden = false;
		if (title) title.textContent = `${draft.project}/${draft.file}`;
		if (empty) empty.hidden = true;
		if (frame) {
			frame.hidden = false;
			const next = withStyle(draft.href, slug);
			if (frame.getAttribute("src") !== next) frame.src = next;
		}
	};

	const render = () => {
		renderCount();
		renderNav();
		renderStage();
	};

	const applySelection = () => {
		const query = params();
		currentProject = query.get("project") || "";
		currentFile = query.get("file") || "";
		if (
			currentProject &&
			currentFile &&
			drafts.some(
				(draft) =>
					draft.project === currentProject && draft.file === currentFile,
			)
		) {
			return;
		}
		const first = drafts[0];
		currentProject = first?.project || projects[0]?.id || "";
		currentFile = first?.file || "";
	};

	const loadCatalog = async () => {
		const response = await fetch("/__drafts/catalog");
		if (!response.ok) throw new Error("catalog failed");
		const payload = await response.json();
		projects = Array.isArray(payload.projects) ? payload.projects : [];
		drafts = Array.isArray(payload.drafts) ? payload.drafts : [];
		styles = Array.isArray(payload.styles) ? payload.styles : [];
		window.DRAFT_STYLES = styles;
		fillStyles();
		applySelection();
		render();
	};

	const mutate = async (action) => {
		if (!currentProject || !currentFile) return;
		const draft = drafts.find(
			(item) => item.project === currentProject && item.file === currentFile,
		);
		if (!draft) return;
		const confirmText =
			action === "archive"
				? `${draft.file} 를 ${draft.route}/archive 로 옮길까요?`
				: `${draft.file} 을 삭제할까요?`;
		if (!window.confirm(confirmText)) return;
		setStatus("");
		const response = await fetch(`/__drafts/${action}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ project: currentProject, file: currentFile }),
		}).catch(() => null);
		if (!response || !response.ok) {
			const error = response ? await response.json().catch(() => null) : null;
			setStatus(error?.error || `${action} failed`);
			return;
		}
		const index = drafts.findIndex(
			(item) => item.project === currentProject && item.file === currentFile,
		);
		const fallback = drafts[index + 1] || drafts[index - 1] || null;
		currentProject = fallback?.project || "";
		currentFile = fallback?.file || "";
		await loadCatalog();
		setQuery({
			project: currentProject,
			file: currentFile,
			style: selectedStyle(),
			push: true,
		});
	};

	archiveBtn?.addEventListener("click", () => mutate("archive"));
	deleteBtn?.addEventListener("click", () => mutate("delete"));
	styleSelect?.addEventListener("change", () => {
		setQuery({
			project: currentProject,
			file: currentFile,
			style: styleSelect.value,
			push: true,
		});
	});
	const chooseScheme = (scheme) => {
		const slug = selectedStyle();
		if (!slug) return;
		window.draftColorScheme?.write(slug, scheme, styles);
		syncSchemeControls();
		frame?.contentWindow?.postMessage(
			{ type: "draft-color-scheme", scheme },
			location.origin,
		);
	};
	schemeLight?.addEventListener("click", () => chooseScheme("light"));
	schemeDark?.addEventListener("click", () => chooseScheme("dark"));
	frame?.addEventListener("load", () => syncSchemeControls());
	addForm?.addEventListener("submit", async (event) => {
		event.preventDefault();
		const path = addPath?.value.trim();
		if (!path) return;
		setStatus("");
		const response = await fetch("/__drafts/projects", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path }),
		}).catch(() => null);
		if (!response || !response.ok) {
			const error = response ? await response.json().catch(() => null) : null;
			setStatus(error?.error || "add project failed");
			return;
		}
		if (addPath) addPath.value = "";
		const payload = await response.json();
		await loadCatalog();
		setQuery({
			project: payload.project?.id || currentProject,
			file:
				drafts.find((draft) => draft.project === payload.project?.id)?.file ||
				"",
			style: selectedStyle(),
			push: true,
		});
	});
	window.addEventListener("popstate", () => {
		applySelection();
		render();
	});

	loadCatalog().catch(() => {
		setStatus("draft 서버 카탈로그를 읽지 못했습니다.");
		render();
	});
})();
