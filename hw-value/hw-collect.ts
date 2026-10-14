#!/usr/bin/env bun
// hw-collect.ts — per-domain used-market search collector. One process = one domain = one own CDP tab,
// so several domains can run in parallel without fighting over a shared tab.
// Usage:
//   bun hw-collect.ts <domain> <keywordsFile> <outFile>     domain: 2cpu | joongna | bunjang | dmall | daangn
//   bun hw-collect.ts merge <outFile> <in1.json> [in2.json ...] [--grep <regex>]
// keywordsFile: one keyword per line. Output: [{domain, keyword, id, url, title, price}]
// CDP domains open a fresh tab on CDP_HOST (default http://localhost:9222, the logged-in profile) and close it when done.
// 2cpu needs the CDP browser profile to be logged in. daangn uses plain fetch (JSON-LD), no browser.
export {};

const CDP_HOST = process.env.CDP_HOST ?? "http://localhost:9222";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = encodeURIComponent;

type Item = { domain: string; keyword: string; id: string; url: string; title: string; price: string };

const SITES: Record<string, { url: (k: string) => string; expr: string }> = {
  "2cpu": {
    url: (k) => `https://www.2cpu.co.kr/sell?page=1&sfl=wr_subject%7C%7Cwr_content&sop=and&stx=${q(k)}`,
    expr: `[...document.querySelectorAll('a')].filter(a=>/\\/sell\\/\\d+/.test(a.href)).map(a=>{
      const r=a.closest('tr'); return {url:a.href.split('?')[0], title:(r?r.innerText:a.innerText).replace(/\\s+/g,' ').trim()}})`,
  },
  joongna: {
    url: (k) => `https://web.joongna.com/search/${q(k)}`,
    expr: `[...document.querySelectorAll('a[href*="/product/"]')].filter(a=>/\\/product\\/\\d+/.test(a.href))
      .map(a=>({url:a.href.split('?')[0], title:a.innerText.replace(/\\s+/g,' ').trim()}))`,
  },
  bunjang: {
    url: (k) => `https://m.bunjang.co.kr/search/products?q=${q(k)}&order=date`,
    expr: `[...document.querySelectorAll('a[href*="/products/"]')].filter(a=>/\\/products\\/\\d+/.test(a.href))
      .map(a=>({url:a.href.split('?')[0], title:a.innerText.replace(/\\s+/g,' ').trim()}))`,
  },
  dmall: {
    url: (k) => `https://dmall.danawa.com/v3/?controller=sale&methods=search&searchKeyword=${q(k)}&searchField=sProdN&localeCode=0`,
    expr: `[...document.querySelectorAll('#goodsListContainer li, #goodsListContainer tr')].map(r=>{
      const a=r.querySelector('a[href]'); return {url:a?a.href:'', title:r.innerText.replace(/\\s+/g,' ').trim()}}).filter(x=>x.url&&x.title.length>10)`,
  },
};

const priceOf = (t: string) => (t.match(/\d{1,3}(?:,\d{3})+\s*원|\d+\s*만원?/) ?? [""])[0];
const idOf = (u: string) => (u.match(/(\d{6,})(?:\D*$)/) ?? u.match(/-([a-z0-9]{12})\/?$/) ?? ["", u])[1]!;

async function cdpTab(url: string) {
  const t = await (await fetch(`${CDP_HOST}/json/new?${url}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map<number, (v: any) => void>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String((ev as MessageEvent).data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result ?? { error: m.error }); pending.delete(m.id); }
  });
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  const send = (method: string, params: any = {}) =>
    new Promise<any>((resolve) => {
      const cur = id++;
      pending.set(cur, resolve);
      setTimeout(() => pending.has(cur) && (pending.delete(cur), resolve({ error: "timeout" })), 20000);
      ws.send(JSON.stringify({ id: cur, method, params }));
    });
  const close = async () => { ws.close(); await fetch(`${CDP_HOST}/json/close/${t.id}`).catch(() => {}); };
  return { send, close };
}

async function collectCdp(domain: string, keywords: string[]): Promise<Item[]> {
  const site = SITES[domain]!;
  const tab = await cdpTab("about:blank");
  const out: Item[] = [];
  try {
    await tab.send("Page.enable");
    if (domain === "2cpu") {
      await tab.send("Page.navigate", { url: "https://www.2cpu.co.kr/" }); await sleep(2500);
      const r = await tab.send("Runtime.evaluate", { expression: `!!document.querySelector('a[href*="logout"]')`, returnByValue: true });
      if (!r?.result?.value) throw new Error(`2CPU not logged in on ${CDP_HOST} — log in there, or run browse-site scripts/2cpu.ts (it waits for login)`);
    }
    for (const k of keywords) {
      await tab.send("Page.navigate", { url: site.url(k) });
      // wait until the result list renders and stops growing (max ~12s); an empty result is allowed
      let rows: any[] = [], prev = -1;
      for (let i = 0; i < 24; i++) {
        await sleep(500);
        const r = await tab.send("Runtime.evaluate", { expression: site.expr, returnByValue: true });
        rows = r?.result?.value ?? [];
        if (i >= 4 && rows.length === prev) break;
        prev = rows.length;
      }
      for (const r of rows) out.push({ domain, keyword: k, id: idOf(r.url), url: r.url, title: r.title.slice(0, 300), price: priceOf(r.title) });
      console.error(`${domain} ${k}: ${rows.length}`);
    }
  } finally { await tab.close(); }
  return out;
}

async function collectDaangn(keywords: string[]): Promise<Item[]> {
  const out: Item[] = [];
  for (const k of keywords) {
    const html = await (await fetch(`https://www.daangn.com/kr/buy-sell/?search=${q(k)}`, { headers: { "User-Agent": UA } })).text();
    let n = 0;
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let j: any; try { j = JSON.parse(m[1]!); } catch { continue; }
      if (j["@type"] !== "ItemList") continue;
      for (const e of j.itemListElement ?? []) {
        const it = e.item;
        if (!String(it.offers?.availability).endsWith("InStock")) continue;
        out.push({ domain: "daangn", keyword: k, id: idOf(it.url), url: it.url, title: `${it.name} | ${String(it.description ?? "").replace(/\s+/g, " ").slice(0, 200)}`, price: `${Number(it.offers.price).toLocaleString()}원` });
        n++;
      }
    }
    console.error(`daangn ${k}: ${n}`);
  }
  return out;
}

const [cmd, ...rest] = Bun.argv.slice(2);
if (cmd === "merge") {
  const gi = rest.indexOf("--grep");
  const re = gi >= 0 ? new RegExp(rest[gi + 1]!, "i") : null;
  const files = (gi >= 0 ? rest.slice(0, gi) : rest);
  const [outFile, ...ins] = files;
  const seen = new Map<string, Item>();
  for (const f of ins) for (const it of (await Bun.file(f).json()) as Item[]) {
    if (re && !re.test(it.title)) continue;
    const key = `${it.domain}:${it.id}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  const all = [...seen.values()];
  await Bun.write(outFile!, JSON.stringify(all, null, 2));
  for (const it of all) console.log(`${it.domain}\t${it.price}\t${it.title.slice(0, 110)}\t${it.url}`);
  console.error(`MERGED ${all.length} -> ${outFile}`);
} else if (cmd && (cmd in SITES || cmd === "daangn")) {
  const [kwFile, outFile] = rest;
  const keywords = (await Bun.file(kwFile!).text()).split("\n").map((s) => s.trim()).filter(Boolean);
  const items = cmd === "daangn" ? await collectDaangn(keywords) : await collectCdp(cmd, keywords);
  await Bun.write(outFile!, JSON.stringify(items, null, 2));
  console.error(`WROTE ${items.length} -> ${outFile}`);
} else {
  console.error("usage: hw-collect.ts <2cpu|joongna|bunjang|dmall|daangn> <keywordsFile> <outFile>\n       hw-collect.ts merge <outFile> <in.json...> [--grep <regex>]");
  process.exit(1);
}
