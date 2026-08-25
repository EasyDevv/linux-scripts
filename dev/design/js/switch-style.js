(() => {
	const styles = window.DRAFT_STYLES ?? [];
	const params = new URLSearchParams(location.search);
	const fallback =
		document.documentElement.dataset.style || styles[0]?.slug || "linear";
	const requested = params.get("style");
	const current = styles.some((style) => style.slug === requested)
		? requested
		: fallback;


	const select = document.getElementById("draft-style-select");

	if (select && select.options.length === 0) {
		for (const style of styles) {
			const option = document.createElement("option");
			option.value = style.slug;
			option.textContent = style.label;
			select.append(option);
		}
	}

	const withStyle = (href, slug, scheme) => {
		const hashIndex = href.indexOf("#");
		const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
		const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
		const queryIndex = withoutHash.indexOf("?");
		const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
		const next = new URLSearchParams(
			queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "",
		);
		next.set("style", slug);
		if (scheme === "light" || scheme === "dark") next.set("scheme", scheme);
		return `${path}?${next.toString()}${hash}`;
	};

	const applyScheme = (scheme) => {
		window.draftColorScheme?.apply(document, scheme);
	};

	const apply = (slug, push) => {
		const sheets = document.querySelectorAll("style[data-draft-style]");
		for (const sheet of sheets) {
			sheet.disabled = sheet.dataset.draftStyle !== slug;
		}
		if (select) select.value = slug;
		document.documentElement.dataset.style = slug;
		const scheme = window.draftColorScheme?.read(slug, styles) || "light";
		applyScheme(scheme);
		const url = new URL(location.href);
		url.searchParams.set("style", slug);
		url.searchParams.set("scheme", scheme);
		history[push ? "pushState" : "replaceState"](null, "", url);
		for (const anchor of document.querySelectorAll("a[data-layout]")) {
			const href = anchor.getAttribute("href");
			if (href) anchor.setAttribute("href", withStyle(href, slug, scheme));
		}
	};

	apply(current, false);
	select?.addEventListener("change", () => apply(select.value, true));
	window.addEventListener("storage", (event) => {
		if (!event.key?.startsWith("draft-color-scheme:")) return;
		const slug = document.documentElement.dataset.style || current;
		applyScheme(window.draftColorScheme?.read(slug, styles) || "light");
	});
	window.addEventListener("message", (event) => {
		if (event.origin !== location.origin) return;
		if (event.data?.type !== "draft-color-scheme") return;
		const scheme = event.data.scheme;
		if (scheme === "light" || scheme === "dark") applyScheme(scheme);
	});
})();
