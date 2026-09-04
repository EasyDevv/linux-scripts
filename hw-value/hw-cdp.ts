#!/usr/bin/env bun
// hw-cdp.ts — CDP board scraper for hardware price research.
// Usage:
//   bun hw-cdp.ts list   <ws|auto:match> <urlsFile> <outFile>
//   bun hw-cdp.ts detail <ws|auto:match> <urlsFile> <outFile>
//   bun hw-cdp.ts eval   <ws|auto:match> <jsFile>
//   bun hw-cdp.ts back   <ws|auto:match> <url>        (navigate back to a base page, e.g. 2CPU sell)
// "auto:<match>" resolves the page id via http://localhost:9201/json/list (e.g. auto:2cpu).
export {};

const CDP_HOST = process.env.CDP_HOST ?? "http://localhost:9201";

async function resolveWs(wsOrAuto: string): Promise<string> {
  if (!wsOrAuto.startsWith("auto:")) return wsOrAuto;
  const match = wsOrAuto.slice(5);
  const list: any[] = await (await fetch(`${CDP_HOST}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && (t.url ?? "").includes(match));
  if (!page) throw new Error(`no page matching "${match}"`);
  return page.webSocketDebuggerUrl;
}

function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map<number, { resolve: any; reject: any }>();
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String((ev as MessageEvent).data));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    } catch {}
  });
  function send(method: string, params: any = {}, timeoutMs = 25000) {
    const cur = id++;
    return new Promise<any>((resolve, reject) => {
      pending.set(cur, { resolve, reject });
      setTimeout(() => {
        if (pending.has(cur)) { pending.delete(cur); reject(new Error("timeout " + method)); }
      }, timeoutMs);
      ws.send(JSON.stringify({ id: cur, method, params }));
    });
  }
  const ready = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("connect timeout")), 10000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true } as any);
    ws.addEventListener("error", (e) => { clearTimeout(t); reject(e); }, { once: true } as any);
  });
  return { ws, send, ready };
}

const LIST_EXPR = `(() => {
  const anchors=[...document.querySelectorAll('a')].filter(a=>/\\/(sell|buy)\\/\\d+/.test(a.href||''));
  const seen=new Set(); const items=[];
  for (const a of anchors){
    const href=(a.href||'').split('?')[0].split('&')[0];
    if(seen.has(href)) continue; seen.add(href);
    const row=a.closest('tr');
    const rowText=row?(row.innerText||'').replace(/\\s+/g,' ').trim(): '';
    items.push({title:(a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,300), href, rowText: rowText.slice(0,300)});
  }
  // fallback for non-2CPU boards (joongna etc.)
  if (!items.length) {
    const body = document.body.innerText || '';
    return {url:location.href, title:document.title, items:[],
      prices:[...body.matchAll(/(\\d{1,3}(,\\d{3})+\\s*원|\\d+\\s*만원)/g)].map(m=>m[0]).slice(0,60),
      cards:[...document.querySelectorAll('a')].map(a=>(a.innerText||'').replace(/\\s+/g,' ').trim()).filter(t=>/GB/i.test(t)&&t.length>5&&t.length<220).slice(0,50)};
  }
  return {url:location.href, title:document.title, items:items.slice(0,60)};
})()`;

const DETAIL_EXPR = `(() => {
  return {url: location.href, title: document.title, body: (document.body.innerText||'').slice(0,15000)};
})()`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cmd = Bun.argv[2];

if (cmd === "eval") {
  const [wsArg, jsFile] = Bun.argv.slice(3);
  const { ws, send, ready } = connect(await resolveWs(wsArg!));
  await ready;
  await send("Runtime.enable");
  const expr = await Bun.file(jsFile!).text();
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(res.result?.value ?? res, null, 2).slice(0, 200000));
  ws.close();
} else if (cmd === "back") {
  const [wsArg, url] = Bun.argv.slice(3);
  const { ws, send, ready } = connect(await resolveWs(wsArg!));
  await ready;
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(4000);
  console.log("BACK TO " + url);
  ws.close();
} else if (cmd === "list" || cmd === "detail") {
  const [wsArg, urlFile, outFile] = Bun.argv.slice(3);
  const urls: string[] = (await Bun.file(urlFile!).text()).split("\n").map((s: string) => s.trim()).filter(Boolean);
  const { ws, send, ready } = connect(await resolveWs(wsArg!));
  await ready;
  await send("Page.enable");
  await send("Runtime.enable");
  const expr = cmd === "list" ? LIST_EXPR : DETAIL_EXPR;
  const all: any[] = [];
  for (const url of urls) {
    await send("Page.navigate", { url });
    await sleep(cmd === "list" ? 5500 : 5500);
    try {
      const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      const val = res.result?.value;
      all.push(cmd === "list" ? { url, list: val } : { url, data: val });
      console.error(`OK ${url} len=${JSON.stringify(val)?.length ?? 0}`);
    } catch (e: any) {
      all.push({ url, error: String(e) });
      console.error(`FAIL ${url} ${e}`);
    }
  }
  await Bun.write(outFile!, JSON.stringify(all, null, 2));
  console.error("WROTE " + outFile);
  ws.close();
} else {
  console.error("usage: hw-cdp.ts <list|detail|eval|back> ...");
  process.exit(1);
}
