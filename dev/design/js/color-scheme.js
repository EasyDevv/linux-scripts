(() => {
	const prefix = "draft-color-scheme:";
	const globalKey = "draft-color-scheme";

	const defaultOf = (slug, styles = window.DRAFT_STYLES ?? []) =>
		styles.find((style) => style.slug === slug)?.scheme === "dark"
			? "dark"
			: "light";

	const read = (slug, styles) => {
		const global = localStorage.getItem(globalKey);
		if (global === "light" || global === "dark") return global;
		const stored = localStorage.getItem(`${prefix}${slug}`);
		if (stored === "light" || stored === "dark") return stored;
		return defaultOf(slug, styles);
	};

	const write = (_slug, scheme) => {
		if (scheme === "light" || scheme === "dark") {
			localStorage.setItem(globalKey, scheme);
		}
	};

	const apply = (doc, scheme) => {
		if (!doc?.documentElement) return;
		doc.documentElement.classList.toggle("dark", scheme === "dark");
		doc.documentElement.style.colorScheme = scheme;
		doc.documentElement.dataset.scheme = scheme;
	};

	window.draftColorScheme = {
		prefix,
		globalKey,
		defaultOf,
		read,
		write,
		apply,
	};
})();
