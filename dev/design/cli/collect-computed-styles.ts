import { write } from "bun";

type CDPMessage = {
	id?: number;
	result?: unknown;
	error?: { message: string };
};

type ChromeTab = {
	type: string;
	url?: string;
	title?: string;
	webSocketDebuggerUrl?: string;
};

const args = Bun.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	process.stdout.write(`collect-computed-styles.ts

  --port <N>          CDP port (default 9222)
  --ws <url>          Pin a tab WebSocket (required when several pages are open)
  --url <href>        Navigate, or select the tab whose url matches
  --compact           Omit typography inventory
  --target name::css  Named CSS selector
  --xpath name::path  Named XPath
  --out <file>        Write JSON (default stdout)

Report fields: selected[].paintOwner + paintChain, style.backgroundRgb / colorRgb,
roles.pills, roles.filledSurfaces. Do not trust a transparent target background.
`);
	process.exit(0);
}

const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};
const valuesFor = (flag: string) =>
	args.flatMap((arg, index) =>
		arg === flag && args[index + 1] ? [args[index + 1]] : [],
	);

function parseTargets(flag: "--target" | "--xpath") {
	return valuesFor(flag).map((value, index) => {
		const separator = value.indexOf("::");
		return separator < 0
			? { name: `${flag.slice(2)}-${index + 1}`, query: value }
			: { name: value.slice(0, separator), query: value.slice(separator + 2) };
	});
}

const port = Number(valueFor("--port") ?? 9222);
const output = valueFor("--out");
const targetUrl = valueFor("--url");
const wsFlag = valueFor("--ws");
const compact = args.includes("--compact");
const targets = parseTargets("--target");
const xpaths = parseTargets("--xpath");
const tabs = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
	response.json(),
)) as ChromeTab[];
const pages = tabs.filter((candidate) => candidate.type === "page");

function pickTab(): ChromeTab {
	if (wsFlag) {
		const hit = pages.find((page) => page.webSocketDebuggerUrl === wsFlag);
		if (hit) return hit;
		return { type: "page", webSocketDebuggerUrl: wsFlag };
	}
	if (targetUrl) {
		const needle = targetUrl.split("#")[0] ?? targetUrl;
		const hit = pages.find((page) => (page.url ?? "").split("#")[0] === needle)
			?? pages.find((page) => (page.url ?? "").includes(needle));
		if (hit) return hit;
	}
	if (pages.length === 1 && pages[0]) return pages[0];
	const listing = pages
		.map((page, index) => `  [${index}] ${page.title ?? ""} ${page.url ?? ""}`)
		.join("\n");
	throw new Error(
		`Multiple CDP pages on port ${port}; pass --ws <webSocketDebuggerUrl>.\n${listing}`,
	);
}

const tab = pickTab();
if (!tab.webSocketDebuggerUrl) {
	throw new Error(`No page target found on CDP port ${port}`);
}

const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
	socket.addEventListener("open", () => resolve(), { once: true });
	socket.addEventListener(
		"error",
		() => reject(new Error("Unable to connect to Chrome")),
		{ once: true },
	);
});

let sequence = 0;
const pending = new Map<
	number,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
socket.addEventListener("message", (event) => {
	const message = JSON.parse(String(event.data)) as CDPMessage;
	if (!message.id || !pending.has(message.id)) return;
	const request = pending.get(message.id);
	if (!request) return;
	pending.delete(message.id);
	if (message.error) request.reject(new Error(message.error.message));
	else request.resolve(message.result);
});

function command(method: string, params: Record<string, unknown> = {}) {
	const id = ++sequence;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise<unknown>((resolve, reject) =>
		pending.set(id, { resolve, reject }),
	);
}

if (targetUrl) {
	const here = (
		(await command("Runtime.evaluate", {
			expression: "location.href",
			returnByValue: true,
		})) as { result?: { value?: string } }
	).result?.value;
	const want = targetUrl.split("#")[0];
	if (!here || here.split("#")[0] !== want) {
		await command("Page.navigate", { url: targetUrl });
	}
}

const deadline = Date.now() + 15_000;
let ready = false;
while (Date.now() < deadline) {
	const readiness = (await command("Runtime.evaluate", {
		expression:
			"document.readyState === 'complete' && document.fonts.status === 'loaded'",
		returnByValue: true,
	})) as { result: { value: boolean } };
	if (readiness.result.value) {
		ready = true;
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready)
	throw new Error("Page or web fonts did not become ready within 15 seconds");

const targetConfig = JSON.stringify({ targets, xpaths });

const expression = String.raw`(() => {
	const targetConfig = ${targetConfig};
	const properties = [
		"fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
		"letterSpacing", "textTransform", "textDecorationLine", "color"
	];
	const spacingProperties = [
		"marginTop", "marginRight", "marginBottom", "marginLeft",
		"paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
		"rowGap", "columnGap"
	];
	const selector = "h1,h2,h3,h4,h5,h6,p,span,a,button,li,blockquote,strong,label,input,textarea";
	const rgbOf = (value) => {
		if (!value) return value;
		try {
			const ctx = document.createElement("canvas").getContext("2d");
			if (!ctx) return value;
			ctx.fillStyle = "#000000";
			ctx.fillStyle = value;
			return ctx.fillStyle;
		} catch {
			return value;
		}
	};
	const opaqueBg = (value) =>
		Boolean(value) && value !== "rgba(0, 0, 0, 0)" && value !== "transparent";
	const visible = (element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
	};
	const cleanText = (element) => (element.innerText || element.value || element.placeholder || "")
		.trim().replace(/\s+/g, " ").slice(0, 140);
	const paintChain = (element, max = 8) => {
		const out = [];
		let node = element;
		let depth = 0;
		while (node && node !== document.documentElement && depth < max) {
			const style = getComputedStyle(node);
			out.push({
				depth,
				tag: node.tagName.toLowerCase(),
				className: typeof node.className === "string" ? node.className.slice(0, 80) : undefined,
				backgroundColor: style.backgroundColor,
				backgroundRgb: rgbOf(style.backgroundColor),
				color: style.color,
				colorRgb: rgbOf(style.color),
				borderColor: style.borderTopColor,
				borderRgb: rgbOf(style.borderTopColor),
				borderWidth: style.borderTopWidth,
				borderRadius: style.borderRadius,
				boxShadow: style.boxShadow,
				height: style.height,
				width: style.width,
				padding: style.padding,
				opaque: opaqueBg(style.backgroundColor),
			});
			node = node.parentElement;
			depth += 1;
		}
		return out;
	};
	const inspect = (element) => {
		if (!element) return null;
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		const chain = paintChain(element);
		const icons = [...element.querySelectorAll("svg, img")].map((icon) => {
			const iconStyle = getComputedStyle(icon);
			const iconRect = icon.getBoundingClientRect();
			return {
				tag: icon.tagName.toLowerCase(),
				box: { x: iconRect.x, y: iconRect.y, width: iconRect.width, height: iconRect.height },
				style: {
					width: iconStyle.width, height: iconStyle.height, color: iconStyle.color,
					strokeWidth: iconStyle.strokeWidth, display: iconStyle.display,
					visibility: iconStyle.visibility, opacity: iconStyle.opacity
				}
			};
		});
		return {
			tag: element.tagName.toLowerCase(), text: cleanText(element),
			href: element.href || undefined,
			ariaExpanded: element.getAttribute("aria-expanded") || undefined,
			ariaPressed: element.getAttribute("aria-pressed") || undefined,
			box: {
				x: rect.x, y: rect.y, width: rect.width, height: rect.height,
				clientWidth: element.clientWidth, clientHeight: element.clientHeight,
				offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight
			},
			style: {
				...Object.fromEntries(properties.map((property) => [property, style[property]])),
				colorRgb: rgbOf(style.color),
				display: style.display, boxSizing: style.boxSizing, zoom: style.zoom,
				padding: style.padding, margin: style.margin, gap: style.gap,
				border: style.border, borderRadius: style.borderRadius,
				backgroundColor: style.backgroundColor,
				backgroundRgb: rgbOf(style.backgroundColor),
				boxShadow: style.boxShadow
			},
			paintChain: chain,
			paintOwner: chain.find((layer) => layer.opaque) || chain[0] || null,
			icons
		};
	};
	const entries = [...document.querySelectorAll(selector)].filter(visible).map((element) => {
		const style = getComputedStyle(element);
		return {
			tag: element.tagName.toLowerCase(),
			text: cleanText(element),
			style: Object.fromEntries(properties.map((property) => [property, style[property]]))
		};
	}).filter((entry) => entry.text);
	const groups = new Map();
	for (const entry of entries) {
		const key = JSON.stringify(entry.style);
		const group = groups.get(key) || { style: entry.style, count: 0, samples: [] };
		group.count += 1;
		if (group.samples.length < 6) group.samples.push({ tag: entry.tag, text: entry.text });
		groups.set(key, group);
	}
	const buttons = [...document.querySelectorAll("a,button")].filter(visible).map((element, index) => {
		return { index, ...inspect(element) };
	});
	const fields = [...document.querySelectorAll("input,textarea,select")]
		.filter(visible)
		.map((element, index) => {
			const style = getComputedStyle(element);
			const placeholderStyle = getComputedStyle(element, "::placeholder");
			return {
				index,
				type: element.type || undefined,
				name: element.name || undefined,
				placeholder: element.placeholder || undefined,
				...inspect(element),
				fieldStyle: {
					minHeight: style.minHeight,
					resize: style.resize,
					appearance: style.appearance,
					caretColor: style.caretColor
				},
				placeholderStyle: {
					fontFamily: placeholderStyle.fontFamily,
					fontSize: placeholderStyle.fontSize,
					fontWeight: placeholderStyle.fontWeight,
					lineHeight: placeholderStyle.lineHeight,
					letterSpacing: placeholderStyle.letterSpacing,
					color: placeholderStyle.color,
					opacity: placeholderStyle.opacity
				}
			};
		});
	const spacingGroups = new Map();
	for (const element of [...document.body.querySelectorAll("*")].filter(visible)) {
		const style = getComputedStyle(element);
		const values = Object.fromEntries(spacingProperties.map((property) => [property, style[property]]));
		if (!Object.values(values).some((value) => value !== "0px" && value !== "normal")) continue;
		const key = JSON.stringify(values);
		const group = spacingGroups.get(key) || { style: values, count: 0, samples: [] };
		group.count += 1;
		if (group.samples.length < 6) group.samples.push({
			tag: element.tagName.toLowerCase(),
			text: cleanText(element),
			className: typeof element.className === "string" ? element.className : undefined
		});
		spacingGroups.set(key, group);
	}
	const parsePx = (value) => Number.parseFloat(value) || 0;
	const pills = buttons.filter((item) => {
		const height = item?.box?.height ?? 0;
		const radius = item?.style?.borderRadius ?? "";
		return height >= 24 && height <= 36 && (radius.includes("9999") || radius === "50%" || parsePx(radius) >= height / 2 - 1);
	}).slice(0, 24);
	const filledSurfaces = [...document.body.querySelectorAll("div,section,aside,article")]
		.filter(visible)
		.map((element) => inspect(element))
		.filter((item) => {
			const owner = item.paintOwner;
			if (!owner?.opaque) return false;
			const height = parsePx(owner.height);
			const width = parsePx(owner.width);
			const radius = parsePx(owner.borderRadius);
			const border = parsePx(owner.borderWidth);
			const shadowed = owner.boxShadow && owner.boxShadow !== "none";
			return height >= 72 && width >= 160 && width <= 480 && radius >= 6 && (border > 0 || shadowed);
		})
		.slice(0, 16);
	const selected = Object.fromEntries([
		...targetConfig.targets.map(({ name, query }) => [name, inspect(document.querySelector(query))]),
		...targetConfig.xpaths.map(({ name, query }) => [name, inspect(document.evaluate(query, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue)])
	]);
	return {
		url: location.href,
		viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
		fonts: [...document.fonts].filter((font) => font.status === "loaded").map((font) => ({ family: font.family, weight: font.weight, style: font.style })),
		typography: ${compact} ? undefined : [...groups.values()].sort((left, right) => right.count - left.count),
		buttons,
		fields,
		spacing: [...spacingGroups.values()].sort((left, right) => right.count - left.count),
		roles: { pills, filledSurfaces },
		selected
	};
})()`;

const result = await command("Runtime.evaluate", {
	expression,
	returnByValue: true,
	awaitPromise: true,
});
const report = (result as { result: { value: unknown } }).result.value;
const missingTargets = Object.entries(
	(report as { selected?: Record<string, unknown> }).selected ?? {},
)
	.filter(([, value]) => value === null)
	.map(([name]) => name);
if (missingTargets.length) {
	socket.close();
	throw new Error(`Named targets did not match: ${missingTargets.join(", ")}`);
}
const json = `${JSON.stringify(report, null, 2)}\n`;

if (output) await write(output, json);
else process.stdout.write(json);

socket.close();
