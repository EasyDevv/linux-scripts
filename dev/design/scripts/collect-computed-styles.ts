import { write } from "bun";

type CDPMessage = {
	id?: number;
	result?: unknown;
	error?: { message: string };
};

const args = Bun.argv.slice(2);
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
const compact = args.includes("--compact");
const targets = parseTargets("--target");
const xpaths = parseTargets("--xpath");
const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(
	(response) => response.json(),
);
const tab = tabs.find(
	(candidate: { type: string }) => candidate.type === "page",
);

if (!tab?.webSocketDebuggerUrl) {
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
	await command("Page.navigate", { url: targetUrl });
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
	const visible = (element) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
	};
	const cleanText = (element) => (element.innerText || element.value || element.placeholder || "")
		.trim().replace(/\s+/g, " ").slice(0, 140);
	const inspect = (element) => {
		if (!element) return null;
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
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
			box: {
				x: rect.x, y: rect.y, width: rect.width, height: rect.height,
				clientWidth: element.clientWidth, clientHeight: element.clientHeight,
				offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight
			},
			style: {
				...Object.fromEntries(properties.map((property) => [property, style[property]])),
				display: style.display, boxSizing: style.boxSizing, zoom: style.zoom,
				padding: style.padding, margin: style.margin, gap: style.gap,
				border: style.border, borderRadius: style.borderRadius,
				backgroundColor: style.backgroundColor, boxShadow: style.boxShadow
			},
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
	const buttons = [...document.querySelectorAll("a,button")].filter(visible).filter((element) => {
		const style = getComputedStyle(element);
		return element.tagName === "BUTTON" || style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.borderTopWidth !== "0px";
	}).map((element, index) => {
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
