// Capture a daangn ref page (or any URL) at 1440x900 dsf 1 in one CDP session and report
// console errors. Optional --section <id> crops that section's preview block.
//
//   bun themes/daangn/.build/shot.ts <page|url> <out.png> [--scheme light|dark] [--section id] [--full]
//        [--eval "<js expression>"]   (printed as JSON after the page settles)
export {};
const [target, out] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const arg = (n: string) => {
	const i = process.argv.indexOf(n);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const scheme = arg("--scheme") ?? "light";
const section = arg("--section");
const full = process.argv.includes("--full");
const evalExpr = arg("--eval");
const port = Number(arg("--port") ?? 9222);
const url = target.startsWith("http")
	? target
	: `http://dashboard.localhost/design/draft?file=${target}/page.svelte&project=theme-daangn&style=daangn&scheme=${scheme}`;

const tab = (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json())) as {
	id: string;
	webSocketDebuggerUrl: string;
};
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let id = 0;
const issues: string[] = [];
const waiters = new Map<number, (m: { result?: never; error?: { message: string } }) => void>();
ws.onmessage = (e) => {
	const m = JSON.parse(String(e.data));
	if (m.id && waiters.has(m.id)) {
		waiters.get(m.id)?.(m);
		waiters.delete(m.id);
	} else if (m.method === "Runtime.exceptionThrown") issues.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
	else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
		issues.push(`${m.params.type}: ${m.params.args.map((a: { value?: string; description?: string }) => a.value ?? a.description).join(" ")}`.slice(0, 300));
	else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") issues.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
};
const send = <T = never>(method: string, params: object = {}) =>
	new Promise<T>((ok, bad) => {
		const i = ++id;
		const timer = setTimeout(() => bad(new Error(`${method}: timed out`)), 45000);
		waiters.set(i, (m) => {
			clearTimeout(timer);
			m.error ? bad(new Error(`${method}: ${m.error.message}`)) : ok(m.result as T);
		});
		ws.send(JSON.stringify({ id: i, method, params }));
	});

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.navigate", { url });
await Bun.sleep(4500);

const js = async <T>(expression: string) =>
	(await send<{ result: { value: T } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
if (section) {
	// Draft pages render in the document itself; scroll the section's preview into view and crop it.
	const rect = await js<number[] | null>(`(() => {
		const s = document.getElementById(${JSON.stringify(section)});
		const box = s && (s.querySelector('[data-role=preview]') || s);
		if (!box) return null;
		box.scrollIntoView({ block: 'center' });
		const r = box.getBoundingClientRect();
		return [r.x, r.y, r.width, r.height];
	})()`);
	await Bun.sleep(400);
	if (rect) clip = { x: rect[0], y: rect[1], width: rect[2], height: rect[3], scale: 1 };
	else issues.push(`section ${section}: not found`);
}
if (evalExpr) console.log(JSON.stringify(await js(evalExpr), null, 1));
const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}), ...(full ? { captureBeyondViewport: true } : {}) });
await Bun.write(out, Buffer.from(shot.data, "base64"));
ws.close();
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
console.log(JSON.stringify({ url, out, issues }));
process.exit(0);
