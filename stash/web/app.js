document.addEventListener("DOMContentLoaded", () => {
	const THEME_STORAGE_KEY = "stashTheme";
	const themeToggle = document.getElementById("theme-toggle");
	const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

	function savedTheme() {
		try {
			const value = localStorage.getItem(THEME_STORAGE_KEY);
			return value === "light" || value === "dark" ? value : null;
		} catch {
			return null;
		}
	}

	function currentTheme() {
		return (
			document.documentElement.dataset.theme ||
			(themeMedia.matches ? "dark" : "light")
		);
	}

	function renderThemeToggle() {
		if (!themeToggle) return;
		const isDark = currentTheme() === "dark";
		const icon = themeToggle.querySelector("i");
		if (icon) icon.className = `bi bi-${isDark ? "sun" : "moon"}`;
		themeToggle.title = isDark ? "Use light mode" : "Use dark mode";
		themeToggle.setAttribute(
			"aria-label",
			isDark ? "Use light mode" : "Use dark mode",
		);
		themeToggle.setAttribute("aria-pressed", String(isDark));
	}

	if (themeToggle) {
		renderThemeToggle();
		themeToggle.addEventListener("click", () => {
			const nextTheme = currentTheme() === "dark" ? "light" : "dark";
			document.documentElement.dataset.theme = nextTheme;
			try {
				localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
			} catch {}
			renderThemeToggle();
		});
		themeMedia.addEventListener("change", () => {
			if (!savedTheme()) renderThemeToggle();
		});
	}

	const downloadLimit = document.getElementById("download-limit");
	if (downloadLimit) {
		fetch("/stash/scheduler/settings")
			.then((response) => (response.ok ? response.json() : null))
			.then((settings) => {
				if (settings)
					downloadLimit.value = String(settings.max_concurrent_jobs);
			})
			.catch(() => {});
		downloadLimit.addEventListener("change", async () => {
			downloadLimit.disabled = true;
			try {
				const response = await fetch("/stash/scheduler/settings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						max_concurrent_jobs: Number(downloadLimit.value),
					}),
				});
				if (!response.ok) throw new Error("could not update download limit");
				const settings = await response.json();
				downloadLimit.value = String(settings.max_concurrent_jobs);
			} finally {
				downloadLimit.disabled = false;
			}
		});
	}

	const pane = document.getElementById("jobs-pane");
	const splitter = document.getElementById("splitter");
	if (pane && splitter) {
		const saved = localStorage.getItem("stashJobsH");
		if (saved) pane.style.height = saved;

		splitter.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			const startY = e.clientY;
			const startH = pane.offsetHeight;
			const onMove = (ev) => {
				const newH = Math.max(
					150,
					Math.min(window.innerHeight - 150, startH + (ev.clientY - startY)),
				);
				pane.style.height = newH + "px";
				localStorage.setItem("stashJobsH", pane.style.height);
			};
			const onUp = () => {
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
			};
			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
		});
	}

	const tables = Array.from(document.querySelectorAll(".table-pane")).map(
		(pane) => ({
			pane,
			list: document.getElementById(pane.dataset.listId),
			checkboxName: pane.dataset.checkboxName,
			selectAll: document.getElementById(pane.dataset.selectAllId),
			selected: new Set(),
			sortKey: pane.dataset.defaultSort,
			sortDirection: pane.dataset.defaultDirection || "asc",
		}),
	);
	const tablesByListId = new Map(
		tables.map((table) => [table.list?.id, table]),
	);
	tables.forEach((table) => {
		table.pane.querySelectorAll("th[data-sort-key]").forEach((header) => {
			header.tabIndex = 0;
		});
	});
	const hlsLevel = document.getElementById("hls-level");
	const hlsConcurrency = document.getElementById("hls-concurrency");

	function renderHlsSettings(settings) {
		if (!hlsLevel) return;
		hlsLevel.querySelectorAll("[data-hls-level]").forEach((button) => {
			button.classList.toggle(
				"active",
				Number(button.dataset.hlsLevel) === Number(settings.level),
			);
		});
		if (hlsConcurrency) {
			hlsConcurrency.textContent = `${settings.concurrency}x`;
		}
	}

	async function loadHlsSettings() {
		try {
			const response = await fetch("/stash/browser-hls/settings");
			if (response.ok) renderHlsSettings(await response.json());
		} catch {}
	}

	if (hlsLevel) {
		hlsLevel.addEventListener("click", async (e) => {
			const button = e.target.closest("[data-hls-level]");
			if (!button) return;
			try {
				const response = await fetch("/stash/browser-hls/settings", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ level: Number(button.dataset.hlsLevel) }),
				});
				if (response.ok) renderHlsSettings(await response.json());
			} catch {}
		});
		loadHlsSettings();
		setInterval(loadHlsSettings, 5000);
	}

	function syncTableState(table) {
		if (!table.list) return;
		table.list
			.querySelectorAll(`input[name="${table.checkboxName}"]`)
			.forEach((checkbox) => {
				checkbox.checked = table.selected.has(checkbox.value);
			});
		const checkboxes = table.list.querySelectorAll(
			`input[name="${table.checkboxName}"]`,
		);
		const checked = table.list.querySelectorAll(
			`input[name="${table.checkboxName}"]:checked`,
		);
		if (table.selectAll) {
			table.selectAll.checked =
				checked.length > 0 && checked.length === checkboxes.length;
			table.selectAll.indeterminate =
				checked.length > 0 && checked.length < checkboxes.length;
		}
		table.pane.querySelectorAll(".bulk-action").forEach((button) => {
			button.disabled = checked.length === 0;
		});
	}

	function applyTableSort(table) {
		if (!table.list || !table.sortKey) return;
		const header = table.pane.querySelector(
			`th[data-sort-key="${table.sortKey}"]`,
		);
		if (!header) return;
		const numeric = header.dataset.sortType === "number";
		const attribute = `data-sort-${table.sortKey}`;
		const direction = table.sortDirection === "desc" ? -1 : 1;
		const rows = Array.from(table.list.querySelectorAll(`tr[${attribute}]`));
		rows.sort((a, b) => {
			const aValue = a.getAttribute(attribute) || "";
			const bValue = b.getAttribute(attribute) || "";
			if (!aValue && bValue) return 1;
			if (aValue && !bValue) return -1;
			if (!aValue && !bValue) return 0;
			const comparison = numeric
				? Number(aValue) - Number(bValue)
				: aValue.localeCompare(bValue, undefined, {
						numeric: true,
						sensitivity: "base",
					});
			return comparison * direction;
		});
		rows.forEach((row) => table.list.appendChild(row));
		table.pane.querySelectorAll("th[data-sort-key]").forEach((th) => {
			th.setAttribute(
				"aria-sort",
				th === header
					? table.sortDirection === "desc"
						? "descending"
						: "ascending"
					: "none",
			);
		});
	}

	function isJobsListRequest(event) {
		const target = event.detail?.ctx?.target;
		return target?.id === "jobs-list";
	}

	function showJobsLoadError() {
		const list = document.getElementById("jobs-list");
		if (!list) return;
		if (list.querySelector("tr[data-job-id]")) return;
		if (!list.textContent.includes("Loading")) return;
		list.innerHTML =
			'<tr><td colspan="11" class="empty empty-error">Jobs unavailable. Retrying...</td></tr>';
	}

	const speedHistory = new Map();
	const speedDisplayCache = new Map();

	function fmtSpeed(bytesPerSec) {
		if (bytesPerSec <= 0) return "";
		const units = ["B", "KB", "MB", "GB"];
		let v = bytesPerSec;
		let i = 0;
		while (v >= 1024 && i + 1 < units.length) {
			v /= 1024;
			i++;
		}
		return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + units[i] + "/s";
	}

	function updateSpeeds() {
		const now = Date.now();
		document.querySelectorAll("#jobs-list tr[data-job-id]").forEach((tr) => {
			const id = tr.dataset.jobId;
			const status = tr.dataset.status;
			const downloaded = Number(tr.dataset.downloaded);
			const updated = Number(tr.dataset.updated) * 1000;
			const prev = speedHistory.get(id);
			const cell = tr.querySelector(".speed-cell");
			if (!cell) return;
			if (status !== "running") {
				cell.textContent = "";
				speedDisplayCache.delete(id);
				speedHistory.delete(id);
				return;
			}

			let text = "";
			let speedValue = 0;
			if (prev && prev.downloaded >= 0 && now - updated < 20000) {
				const dt = Math.max(now - prev.timestamp, 1000);
				const dd = downloaded - prev.downloaded;
				if (dd > 0) {
					const speed = Math.round((dd / dt) * 1000);
					text = fmtSpeed(speed);
					speedValue = speed;
					prev.lastSpeed = speed;
					prev.lastSpeedTime = now;
				} else if (prev.lastSpeed && now - prev.lastSpeedTime < 15000) {
					text = fmtSpeed(prev.lastSpeed);
					speedValue = prev.lastSpeed;
				}
			}
			cell.textContent = text;
			tr.dataset.sortSpeed = text ? String(speedValue) : "";
			speedDisplayCache.set(id, text);
			speedHistory.set(id, {
				downloaded,
				timestamp: now,
				lastSpeed: prev?.lastSpeed || 0,
				lastSpeedTime: prev?.lastSpeedTime || 0,
			});
		});
		const jobsTable = tablesByListId.get("jobs-list");
		if (jobsTable?.sortKey === "speed") applyTableSort(jobsTable);
	}

	document.addEventListener("htmx:after:swap", (e) => {
		const t = e.detail?.ctx?.target;
		if (!t) return;
		if (t.id === "jobs-list") {
			// Restore speed text from cache to avoid flicker
			t.querySelectorAll("tr[data-job-id]").forEach((tr) => {
				const id = tr.dataset.jobId;
				if (tr.dataset.status !== "running") return;
				const cell = tr.querySelector(".speed-cell");
				if (cell && speedDisplayCache.has(id)) {
					cell.textContent = speedDisplayCache.get(id);
				}
			});
		}
		const table = tablesByListId.get(t.id);
		if (!table) return;
		syncTableState(table);
		applyTableSort(table);
	});

	["htmx:error", "htmx:response:error"].forEach((eventName) => {
		document.addEventListener(eventName, (e) => {
			if (isJobsListRequest(e)) showJobsLoadError();
		});
	});

	// ── Column resize ────────────────────────────────────────────
	// Widths are stored per viewport bucket so manual resizes survive
	// breakpoint changes. Buckets: lg (≥1200), sm (≥800), xs (<800).
	const COL_STORAGE_KEY = "stashColWidths";

	function currentBreakpoint() {
		const w = window.innerWidth;
		if (w < 800) return "xs";
		if (w < 1200) return "sm";
		return "lg";
	}

	function loadColWidths() {
		const raw = JSON.parse(localStorage.getItem(COL_STORAGE_KEY) || "{}");
		// Migrate legacy flat {key: width} into the lg bucket.
		if (
			raw &&
			typeof raw === "object" &&
			Object.values(raw).some((v) => typeof v === "string")
		) {
			return { lg: raw };
		}
		return raw && typeof raw === "object" ? raw : {};
	}

	const colWidths = loadColWidths();

	function saveColWidth(key, val) {
		const bp = currentBreakpoint();
		colWidths[bp] = colWidths[bp] || {};
		colWidths[bp][key] = val;
		localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(colWidths));
	}

	function applyColWidths() {
		const bucket = colWidths[currentBreakpoint()] || {};
		document.querySelectorAll("colgroup col[data-col-key]").forEach((col) => {
			const key = col.dataset.colKey;
			if (bucket[key]) {
				col.style.width = bucket[key];
			} else {
				col.style.width = "";
			}
		});
	}

	function initColumnResize() {
		applyColWidths();
		document.querySelectorAll(".table-scroll table").forEach((table) => {
			const cols = Array.from(table.querySelectorAll("colgroup col"));
			const headers = Array.from(table.querySelectorAll("thead th"));
			headers.forEach((th, index) => {
				if (index === 0 || index === headers.length - 1) return;
				if (getComputedStyle(th).display === "none") return;
				if (th.querySelector(".col-resize-handle")) return;
				const key = th.dataset.colKey;
				const col = cols[index];
				if (!key || !col) return;
				const handle = document.createElement("div");
				handle.className = "col-resize-handle";
				th.appendChild(handle);

				handle.addEventListener("pointerdown", (e) => {
					e.preventDefault();
					e.stopPropagation();

					const startX = e.clientX;
					const startWidth = col.getBoundingClientRect().width;
					const overlay = document.createElement("div");
					overlay.className = "col-resize-overlay";
					document.body.appendChild(overlay);

					function onMove(ev) {
						const diff = ev.clientX - startX;
						const newWidth = Math.max(startWidth + diff, 48);
						col.style.width = `${Math.round(newWidth)}px`;
					}

					function onUp() {
						overlay.remove();
						document.removeEventListener("pointermove", onMove);
						document.removeEventListener("pointerup", onUp);
						saveColWidth(key, col.style.width);
					}

					document.addEventListener("pointermove", onMove);
					document.addEventListener("pointerup", onUp);
				});
			});
		});
	}

	initColumnResize();

	let lastBreakpoint = currentBreakpoint();
	let resizeDebounce;
	window.addEventListener("resize", () => {
		clearTimeout(resizeDebounce);
		resizeDebounce = setTimeout(() => {
			const bp = currentBreakpoint();
			if (bp === lastBreakpoint) return;
			lastBreakpoint = bp;
			document
				.querySelectorAll(".col-resize-handle")
				.forEach((h) => h.remove());
			initColumnResize();
		}, 120);
	});

	setInterval(updateSpeeds, 1000);

	function toggleTableSort(header) {
		const table = tables.find((candidate) => candidate.pane.contains(header));
		if (!table) return;
		const key = header.dataset.sortKey;
		if (table.sortKey === key) {
			table.sortDirection = table.sortDirection === "asc" ? "desc" : "asc";
		} else {
			table.sortKey = key;
			table.sortDirection = header.dataset.sortDefault || "asc";
		}
		applyTableSort(table);
	}

	document.addEventListener("click", (e) => {
		const header = e.target.closest("th[data-sort-key]");
		if (!header || e.target.closest(".col-resize-handle")) return;
		toggleTableSort(header);
	});

	document.addEventListener("keydown", (e) => {
		const header = e.target.closest("th[data-sort-key]");
		if (!header || (e.key !== "Enter" && e.key !== " ")) return;
		e.preventDefault();
		toggleTableSort(header);
	});

	document.addEventListener("change", (e) => {
		const table = tables.find(
			(candidate) =>
				candidate.selectAll === e.target ||
				(candidate.pane.contains(e.target) &&
					e.target.name === candidate.checkboxName),
		);
		if (!table) return;
		if (table.selectAll === e.target) {
			table.list
				.querySelectorAll(`input[name="${table.checkboxName}"]`)
				.forEach((checkbox) => {
					checkbox.checked = e.target.checked;
					if (e.target.checked) table.selected.add(checkbox.value);
					else table.selected.delete(checkbox.value);
				});
		} else if (e.target.checked) {
			table.selected.add(e.target.value);
		} else {
			table.selected.delete(e.target.value);
		}
		syncTableState(table);
	});
});
