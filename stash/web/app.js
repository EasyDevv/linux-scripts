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
	const concurrencyMode = document.getElementById("concurrency-mode");
	function applySchedulerSettings(settings) {
		if (!settings) return;
		if (downloadLimit && settings.max_concurrent_jobs)
			downloadLimit.value = String(settings.max_concurrent_jobs);
		if (concurrencyMode && settings.concurrency_mode)
			concurrencyMode.value = settings.concurrency_mode;
	}
	async function saveSchedulerSettings() {
		const controls = [downloadLimit, concurrencyMode].filter(Boolean);
		controls.forEach((control) => {
			control.disabled = true;
		});
		try {
			const response = await fetch("/stash/scheduler/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					max_concurrent_jobs: Number(downloadLimit?.value || 3),
					concurrency_mode: concurrencyMode?.value || "src_domain",
				}),
			});
			if (!response.ok) throw new Error("could not update download limit");
			applySchedulerSettings(await response.json());
		} finally {
			controls.forEach((control) => {
				control.disabled = false;
			});
		}
	}
	if (downloadLimit || concurrencyMode) {
		fetch("/stash/scheduler/settings")
			.then((response) => (response.ok ? response.json() : null))
			.then(applySchedulerSettings)
			.catch(() => {});
		downloadLimit?.addEventListener("change", () => {
			void saveSchedulerSettings();
		});
		concurrencyMode?.addEventListener("change", () => {
			void saveSchedulerSettings();
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

	const TABLE_LIVE_JOBS_LIMIT = 50;
	const TABLE_LIVE_FILES_LIMIT = 100;
	const MIN_COMPLETED_FILE_BYTES = 1024 * 1024;

	function fmtLiveSize(bytes) {
		const units = ["B", "KB", "MB", "GB"];
		let v = Number(bytes) || 0;
		let i = 0;
		while (v > 1024 && i + 1 < units.length) {
			v /= 1024;
			i++;
		}
		return i === 0 ? `${v.toFixed(0)}${units[i]}` : `${v.toFixed(1)}${units[i]}`;
	}

	function fmtLivePct(downloaded, total) {
		if (!total) return "\u2014";
		const pct = (downloaded / total) * 100;
		if (pct >= 99.95) return "100%";
		if (pct >= 10) return `${pct.toFixed(0)}%`;
		return `${pct.toFixed(1)}%`;
	}

	function fmtLiveRelativeTime(ts) {
		const stamp = Number(ts) || 0;
		if (!stamp) return "\u2014";
		const diff = Math.max(0, Math.floor(Date.now() / 1000) - stamp);
		if (diff < 60) return `${diff}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	}

	function setLiveCellText(row, cell, text) {
		const el = row.querySelector(`[data-cell="${cell}"]`);
		if (el && el.textContent !== text) el.textContent = text;
	}

	function createTableLive(options) {
		const {
			listId,
			countId,
			jsonUrl,
			partialUrl,
			identityAttr,
			itemId,
			applyHot,
			isBusy,
			emptyHtml,
			errorHtml,
			hotMs = 500,
			idleMs = 2000,
			sortMs = 1000,
			hotSortKeys = ["pct", "speed", "size"],
		} = options;
		let timer = 0;
		let inflight = false;
		let pending = false;
		let stopped = false;
		let lastSortAt = 0;

		function listEl() {
			return document.getElementById(listId);
		}

		function countEl() {
			return document.getElementById(countId);
		}

		function tableState() {
			return tablesByListId.get(listId);
		}

		function rowById(list, id) {
			return list.querySelector(`[${identityAttr}="${CSS.escape(id)}"]`);
		}

		async function fetchItems() {
			const response = await fetch(jsonUrl);
			if (!response.ok) throw new Error(listId);
			const data = await response.json();
			return data.results || [];
		}

		async function fetchRowElements() {
			const response = await fetch(partialUrl);
			if (!response.ok) throw new Error(`${listId} partial`);
			const html = await response.text();
			const box = document.createElement("tbody");
			box.innerHTML = html;
			return [...box.querySelectorAll(`[${identityAttr}]`)];
		}

		async function reconcile() {
			if (inflight) {
				pending = true;
				return;
			}
			const list = listEl();
			if (!list) return;
			inflight = true;
			clearTimeout(timer);
			let busy = false;
			try {
				const items = await fetchItems();
				const count = countEl();
				if (count) count.textContent = String(items.length);

				if (items.length === 0) {
					list.innerHTML = emptyHtml;
					busy = false;
					return;
				}

				const want = new Set(items.map(itemId));
				const existing = [...list.querySelectorAll(`[${identityAttr}]`)];
				let membershipChanged = false;
				const table = tableState();

				for (const row of existing) {
					const id = row.getAttribute(identityAttr);
					if (!want.has(id)) {
						row.remove();
						table?.selected.delete(id);
						membershipChanged = true;
					}
				}

				const missing = [...want].filter((id) => !rowById(list, id));
				if (missing.length) {
					const fresh = await fetchRowElements();
					list
						.querySelectorAll(`tr:not([${identityAttr}])`)
						.forEach((row) => row.remove());
					for (const row of fresh) {
						const id = row.getAttribute(identityAttr);
						if (!want.has(id) || rowById(list, id)) continue;
						list.appendChild(row);
						if (window.htmx) htmx.process(row);
						membershipChanged = true;
					}
				}

				for (const item of items) {
					const row = rowById(list, itemId(item));
					if (row) applyHot(row, item);
				}

				if (table) {
					syncTableState(table);
					const hotSort = hotSortKeys.includes(table.sortKey);
					const now = Date.now();
					if (membershipChanged || (hotSort && now - lastSortAt >= sortMs)) {
						applyTableSort(table);
						lastSortAt = now;
					}
				}

				busy = typeof isBusy === "function" ? isBusy(items) : false;
			} catch {
				const list = listEl();
				if (list && !list.querySelector(`[${identityAttr}]`)) {
					list.innerHTML = errorHtml;
				}
				busy = false;
			} finally {
				inflight = false;
				if (pending) {
					pending = false;
					void reconcile();
				} else {
					scheduleNext(busy);
				}
			}
		}

		function scheduleNext(busy) {
			if (stopped) return;
			clearTimeout(timer);
			timer = setTimeout(() => {
				void reconcile();
			}, busy ? hotMs : idleMs);
		}

		return {
			start() {
				stopped = false;
				void reconcile();
			},
			invalidate() {
				if (stopped) return;
				clearTimeout(timer);
				void reconcile();
			},
			stop() {
				stopped = true;
				clearTimeout(timer);
			},
		};
	}

	function jobIsBrowserHls(job) {
		return (job.headers_json || "").includes("browser-hls");
	}

	function jobIsHls(job) {
		if (jobIsBrowserHls(job)) return true;
		const src = job.src_url || "";
		try {
			const path = new URL(src).pathname.toLowerCase();
			return (
				path.endsWith(".m3u8") ||
				path.endsWith(".m3u") ||
				(path.includes(".urlset/") && path.endsWith(".txt"))
			);
		} catch {
			const lower = src.toLowerCase();
			return lower.includes(".m3u8") || lower.endsWith(".m3u");
		}
	}

	function jobStatusLabel(status, error) {
		const err = String(error || "").toLowerCase();
		if (
			(status === "failed" || status === "retry_wait") &&
			(err.includes("vpn") || err.includes("adguardvpn"))
		) {
			return "VPN Error";
		}
		switch (status) {
			case "running":
				return "Downloading";
			case "finalizing":
			case "assembling":
			case "remuxing":
				return "Finalizing";
			case "queued":
				return "Queued";
			case "retry_wait":
				return "Retrying";
			case "resource_wait":
				return "Waiting for disk space";
			case "completed":
				return "Completed";
			case "failed":
				return "Failed";
			case "cancelled":
				return "Cancelled";
			default:
				return status || "";
		}
	}

	function jobBadgeClass(status) {
		switch (status) {
			case "running":
				return "badge-running";
			case "finalizing":
			case "assembling":
			case "remuxing":
				return "badge-finalizing";
			case "queued":
				return "badge-queued";
			case "retry_wait":
			case "resource_wait":
				return "badge-retry_wait";
			case "completed":
				return "badge-completed";
			case "failed":
				return "badge-failed";
			case "cancelled":
				return "badge-cancelled";
			default:
				return "badge-queued";
		}
	}

	function jobPctText(job) {
		const status = job.status;
		if (
			status === "finalizing" ||
			status === "assembling" ||
			status === "remuxing"
		) {
			if (job.phase === "prepare") return "Preparing";
			if (job.phase === "mux") return "Muxing";
			return "Finalizing";
		}
		if (status === "running" && jobIsBrowserHls(job)) {
			return fmtLivePct(job.uploaded_segments || 0, job.total_segments || 0);
		}
		return fmtLivePct(job.downloaded_bytes || 0, job.total_bytes || 0);
	}

	function jobPctSort(job) {
		if (job.status === "running" && jobIsHls(job) && job.total_segments > 0) {
			return (job.uploaded_segments || 0) / job.total_segments;
		}
		if (job.total_bytes > 0) return job.downloaded_bytes / job.total_bytes;
		return 0;
	}

	function jobSegmentHtml(job) {
		if (!jobIsHls(job)) return null;
		const completed = job.uploaded_segments || 0;
		const total = job.total_segments || 0;
		if (total > 0) {
			return `<span class="segment-completed">${completed}</span>/<span class="segment-total">${total}</span>`;
		}
		if (job.uploaded_segments != null) {
			return `<span class="segment-completed">${completed}</span>/<span class="segment-total">?</span>`;
		}
		return "\u2014";
	}

	function syncJobActions(row, job) {
		const canCancel = [
			"running",
			"queued",
			"retry_wait",
			"resource_wait",
			"finalizing",
			"assembling",
			"remuxing",
		].includes(job.status);
		const terminal = ["completed", "failed", "cancelled"].includes(job.status);
		const cell = row.querySelector(".actions-cell");
		if (!cell) return;
		const id = job.id;
		let html = "";
		if (canCancel) {
			html += `<button class="btn-icon btn-danger btn-sm" title="Cancel + Clear" hx-post="/ui/jobs/${id}/cancel" hx-swap="none" hx-confirm="Cancel and clear this job?"><i class="bi bi-x-circle"></i></button>`;
		}
		if (terminal) {
			html += `<button class="btn-icon btn-primary btn-sm" title="Retry" hx-post="/ui/jobs/${id}/retry" hx-swap="none"><i class="bi bi-arrow-clockwise"></i></button>`;
			html += `<button class="btn-icon btn-sm" title="Clear" hx-post="/ui/jobs/${id}/clear" hx-swap="none" hx-confirm="Clear this job?"><i class="bi bi-eraser"></i></button>`;
		}
		if (cell.innerHTML !== html) {
			cell.innerHTML = html;
			if (window.htmx) htmx.process(cell);
		}
	}

	function applyJobHot(row, job) {
		const prevStatus = row.dataset.status;
		row.dataset.status = job.status;
		row.dataset.downloaded = String(job.downloaded_bytes || 0);
		row.dataset.updated = String(
			job.updated_at || Math.floor(Date.now() / 1000),
		);
		row.dataset.sortStatus = job.status;
		row.dataset.sortPct = String(jobPctSort(job));
		row.dataset.sortSegment = String(job.uploaded_segments || 0);
		row.dataset.sortSize = String(job.downloaded_bytes || 0);
		if (job.error && job.error !== "cancelled") {
			row.title = job.error;
		} else {
			row.removeAttribute("title");
		}

		const badge = row.querySelector(":scope > td > span.badge");
		if (badge) {
			badge.className = `badge ${jobBadgeClass(job.status)}`;
			const label = jobStatusLabel(job.status, job.error);
			if (badge.textContent !== label) badge.textContent = label;
		}

		const restartNeeded = Number(job.retry_count) > 0;
		let restart = row.querySelector(":scope > td > .badge-stale");
		if (restartNeeded) {
			if (!restart && badge) {
				restart = document.createElement("span");
				restart.className = "badge badge-stale";
				badge.after(restart);
			}
			if (restart) {
				restart.title = `Stale restart #${job.retry_count}`;
				restart.textContent = `\u21bb${job.retry_count}`;
			}
		} else if (restart) {
			restart.remove();
		}

		setLiveCellText(row, "pct", jobPctText(job));
		const seg = row.querySelector('[data-cell="segment"]');
		if (seg) {
			const html = jobSegmentHtml(job);
			if (html == null) {
				if (seg.textContent !== "\u2014") seg.textContent = "\u2014";
				seg.title = "Direct download; segments do not apply";
			} else {
				seg.removeAttribute("title");
				if (seg.innerHTML !== html) seg.innerHTML = html;
			}
		}
		setLiveCellText(row, "size", fmtLiveSize(job.downloaded_bytes || 0));
		setLiveCellText(row, "updated", fmtLiveRelativeTime(job.updated_at || 0));

		if (prevStatus !== job.status) syncJobActions(row, job);
	}

	function fileStatus(file) {
		if (!file.exists) return { badge: "badge-failed", label: "Missing" };
		if ((file.size || 0) < MIN_COMPLETED_FILE_BYTES) {
			return { badge: "badge-failed", label: "Invalid" };
		}
		return { badge: "badge-completed", label: "Present" };
	}

	function applyFileHot(row, file) {
		const status = fileStatus(file);
		row.dataset.sortStatus = status.label.toLowerCase();
		row.dataset.sortSize = String(file.size || 0);
		row.dataset.sortTime = String(file.downloaded_at || 0);
		const badge = row.querySelector(":scope > td > span.badge");
		if (badge) {
			badge.className = `badge ${status.badge}`;
			if (badge.textContent !== status.label) badge.textContent = status.label;
		}
		setLiveCellText(row, "size", fmtLiveSize(file.size || 0));
		setLiveCellText(row, "time", fmtLiveRelativeTime(file.downloaded_at || 0));
	}

	function jobIsBusy(items) {
		return items.some((job) =>
			[
				"running",
				"queued",
				"retry_wait",
				"resource_wait",
				"finalizing",
				"assembling",
				"remuxing",
			].includes(job.status),
		);
	}

	const jobsLive = createTableLive({
		listId: "jobs-list",
		countId: "jobs-count",
		jsonUrl: `/stash/jobs?limit=${TABLE_LIVE_JOBS_LIMIT}`,
		partialUrl: "/ui/partials/jobs",
		identityAttr: "data-job-id",
		itemId: (job) => job.id,
		applyHot: applyJobHot,
		isBusy: jobIsBusy,
		emptyHtml: '<tr><td colspan="11" class="empty">No jobs yet</td></tr>',
		errorHtml:
			'<tr><td colspan="11" class="empty empty-error">Jobs unavailable. Retrying...</td></tr>',
		hotSortKeys: ["pct", "speed", "size"],
	});

	const filesLive = createTableLive({
		listId: "files-section",
		countId: "files-count",
		jsonUrl: `/stash/files?limit=${TABLE_LIVE_FILES_LIMIT}`,
		partialUrl: "/ui/partials/files",
		identityAttr: "data-file-path",
		itemId: (file) => file.path,
		applyHot: applyFileHot,
		isBusy: () => false,
		emptyHtml:
			'<tr><td colspan="9" class="empty">No downloaded files yet</td></tr>',
		errorHtml:
			'<tr><td colspan="9" class="empty empty-error">Files unavailable. Retrying...</td></tr>',
		hotMs: 2000,
		idleMs: 2000,
		hotSortKeys: ["size", "time"],
	});

	function invalidateLiveTables() {
		jobsLive.invalidate();
		filesLive.invalidate();
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


	document.addEventListener("htmx:after:request", (e) => {
		const detail = e.detail || {};
		const xhr = detail.xhr;
		if (xhr && xhr.status >= 400) return;
		if (detail.successful === false) return;
		const method = (
			detail.requestConfig?.verb ||
			detail.xhr?.method ||
			""
		).toUpperCase();
		if (method && method !== "POST") return;
		const path =
			detail.pathInfo?.requestPath ||
			detail.requestConfig?.path ||
			"";
		const elt = detail.elt;
		const liveRelated =
			(typeof path === "string" &&
				(path.includes("/ui/jobs") || path.includes("/ui/files"))) ||
			(elt &&
				elt.closest &&
				(elt.closest("#jobs-pane") || elt.closest("#files-pane")));
		if (liveRelated) invalidateLiveTables();
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
	jobsLive.start();
	filesLive.start();
});
