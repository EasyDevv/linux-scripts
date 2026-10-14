// market-lib.ts — shared helpers for the per-site used-market collectors
// (browse-site skill scripts 2cpu.ts / joongna.ts / bunjang.ts / daangn.ts / danawa.ts).
// - CDP: the logged-in browser on CDP_HOST (default http://localhost:9222). Each run opens its own tab.
// - Spec regex: capacity + speed, including the PC4-xxxxx alias (2933 = PC4-23400).
// - DIMM type: UDIMM / SODIMM / LRDIMM / RDIMM / check (conflicting words) / unknown.
export const CDP_HOST = process.env.CDP_HOST ?? "http://localhost:9222";
export const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Row = {
  site: string; keyword?: string; id: string; url: string; title: string;
  price: number | null;          // KRW per listing as posted (lot price stays lot price; see qty/unit)
  unit?: number | null;          // KRW per stick when the post says 개당/장당 or lot ÷ qty is explicit
  qty?: number | null; type?: string; posted?: string; status?: string; seller?: string; note?: string;
};

export async function cdpVersion(): Promise<void> {
  const r = await fetch(`${CDP_HOST}/json/version`).catch(() => null);
  if (!r?.ok) throw new Error(`CDP ${CDP_HOST} not reachable — start the logged-in Chrome on that port`);
}

export async function openTab(url = "about:blank") {
  await cdpVersion();
  const t = await (await fetch(`${CDP_HOST}/json/new?${url}`, { method: "PUT" })).json();
  return attach(t.webSocketDebuggerUrl, t.id);
}

export async function attach(wsUrl: string, closeId?: string) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map<number, (v: any) => void>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String((ev as MessageEvent).data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.result ?? { error: m.error }); pending.delete(m.id); }
  });
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  const send = (method: string, params: any = {}) => new Promise<any>((resolve) => {
    const cur = id++;
    pending.set(cur, resolve);
    setTimeout(() => pending.has(cur) && (pending.delete(cur), resolve({ error: "timeout" })), 25000);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });
  const evaluate = async (expression: string) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))?.result?.value;
  const goto = async (url: string, settleMs = 1500) => { await send("Page.navigate", { url }); await sleep(settleMs); };
  // poll an expression until it returns a non-empty array/string that stops growing
  const waitStable = async (expression: string, maxMs = 12000) => {
    let v: any = null, prev = -1;
    for (let t = 0; t < maxMs; t += 500) {
      await sleep(500);
      v = await evaluate(expression);
      const n = Array.isArray(v) ? v.length : String(v ?? "").length;
      if (t >= 2000 && n === prev) break;
      prev = n;
    }
    return v;
  };
  const close = async () => { ws.close(); if (closeId) await fetch(`${CDP_HOST}/json/close/${closeId}`).catch(() => {}); };
  await send("Page.enable"); await send("Runtime.enable");
  return { send, evaluate, goto, waitStable, close };
}

export const PC4: Record<string, string> = { "2133": "17000", "2400": "19200", "2666": "21300", "2933": "23400", "3200": "25600" };

// --spec 32GB:2933 → matches "32GB … 2933" / "32기가 … PC4-23400" in either order
export function specRegex(spec?: string): RegExp | null {
  if (!spec) return null;
  const [cap, speed] = spec.toUpperCase().replace("GB", "").split(":");
  const c = cap ? `${cap}\\s*(?:GB|G|기가)` : "";
  const s = speed ? `(?:${speed}${PC4[speed] ? `|${PC4[speed]}` : ""})` : "";
  if (c && s) return new RegExp(`${c}[\\s\\S]*${s}|${s}[\\s\\S]*${c}`, "i");
  return new RegExp(c || s, "i");
}

export function dimmType(text: string): string {
  const t = text.toUpperCase();
  const desk = /데스크탑|데스크톱|DESKTOP|UDIMM|NON-?ECC|M378|-U[AB]\d/.test(t);
  const so = /SODIMM|SO-DIMM|M471|노트북\s*용|노트북\s*(?:램|메모리)/.test(t);
  const lr = /LRDIMM|LR-DIMM|M386|4DRX4|8RX4|-L[ABCDE]\d/.test(t);
  const reg = /RDIMM|ECC\s*\/?\s*REG|REGISTERED|\bREG\b|서버용|서버\s*램|서버\s*메모리|M393|-R[ABCDE]\d/.test(t);
  if (so && !reg && !desk) return "SODIMM";
  if (desk && (reg || lr)) return "check";
  if (desk) return "UDIMM";
  if (lr) return "LRDIMM";
  if (reg) return "RDIMM";
  return "unknown";
}

export const won = (s: string | number | null | undefined): number | null => {
  if (s == null) return null;
  if (typeof s === "number") return s;
  const m = s.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/) ?? s.match(/(\d+(?:\.\d+)?)\s*만/);
  if (!m) return null;
  return /만/.test(m[0]) ? Math.round(parseFloat(m[1]!) * 10000) : Number(m[1]!.replace(/,/g, ""));
};

// "8개 있습니다", "수량 10", "16개 팝니다", "2개 일괄" → number
export function qtyOf(text: string): number | null {
  const m = text.match(/수량\s*:?\s*(\d+)/) ?? text.match(/(\d+)\s*(?:개|장|EA|ea)\s*(?:있|보유|재고|일괄|팝니다|판매|남)/);
  return m ? Number(m[1]) : null;
}

export const readLines = async (f: string) =>
  (await Bun.file(f).text()).split("\n").map((s) => s.trim()).filter(Boolean);

export function printRows(rows: Row[]) {
  for (const r of rows)
    console.log([r.site, r.price ?? "", r.unit ?? "", r.qty ?? "", r.type ?? "", r.posted ?? "", r.status ?? "", r.title.slice(0, 80), r.url].join("\t"));
}

export async function writeRows(out: string, rows: Row[]) {
  await Bun.write(out, JSON.stringify(rows, null, 2));
  console.error(`WROTE ${rows.length} -> ${out}`);
}

export function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {}; const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i]!.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[argv[i]!.slice(2)] = "1";
      else flags[argv[i]!.slice(2)] = next, i++;
    }
    else pos.push(argv[i]!);
  }
  return { flags, pos };
}
