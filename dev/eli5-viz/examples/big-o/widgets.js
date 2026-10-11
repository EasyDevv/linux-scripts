/* Big-O example: the document-specific part of the page. The core runtime (core/runtime.js) owns
 * state, icons, quiz, flip, slider and the theme; this file only adds what Big-O needs: the step-count
 * math and six widgets (readout, chart, table, toyrow, speed, halve). Pattern for any new document:
 * pure math at the top (exported for tests), widgets registered with ELI5.widget(name, fn). */
(function (root) {
  "use strict";

  const IDS = ["o1", "log", "n", "n2"];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  // ---- pure math -------------------------------------------------------
  const steps = (id, n) =>
    id === "o1" ? 1 : id === "log" ? Math.ceil(Math.log2(n + 1)) : id === "n" ? n : n * n;
  const curve = (id, x) =>
    id === "o1" ? 1 : id === "log" ? Math.log2(x + 1) : id === "n" ? x : x * x;
  // log-scale bar so 1 and 1,000,000,000,000 fit one track
  const barPct = (id, n) => clamp((Math.log10(Math.max(steps(id, n), 1)) / 12) * 100, 2, 100);
  const fmtSec = (s) => {
    if (s < 1e-3) return (s * 1e6).toFixed(s < 1e-5 ? 1 : 0) + " µs";
    if (s < 1) return (s * 1e3).toFixed(s < 0.01 ? 1 : 0) + " ms";
    if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + " s";
    if (s < 3600) return (s / 60).toFixed(0) + " min";
    if (s < 86400) return (s / 3600).toFixed(1) + " h";
    if (s < 86400 * 365) return (s / 86400).toFixed(1) + " d";
    return (s / (86400 * 365)).toFixed(1) + " y";
  };
  const fmtRatio = (r) => (r >= 1 ? "×" + fmt(r) : "÷" + fmt(1 / r));
  // probe order for the three searches that have a target; each entry is the
  // probed index plus the live window [lo, hi] before that probe
  const trace = (id, n, target) => {
    if (id === "o1") return [{ at: 0, lo: 0, hi: n - 1 }];
    if (id === "n") {
      const out = [];
      for (let i = 0; i <= target; i++) out.push({ at: i, lo: 0, hi: n - 1 });
      return out;
    }
    const out = [];
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      out.push({ at: mid, lo, hi });
      if (mid === target) break;
      if (mid < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return out;
  };

  // n, ceil(n/2), ... 1: each arrow is one cut; cuts ≈ the log-n probe count
  const halving = (n) => {
    const out = [Math.max(1, Math.round(n))];
    while (out.at(-1) > 1) out.push(Math.ceil(out.at(-1) / 2));
    return out;
  };


  const BigO = { IDS, steps, curve, barPct, fmtSec, fmtRatio, trace, halving };
  if (typeof document === "undefined") {
    if (typeof module !== "undefined") module.exports = BigO;
    return;
  }

  const E = root.ELI5;
  E.bigO = BigO; // shared with other Big-O pages (the 3D room)
  const { h, s, icon, toneIcon, list, fill, press, reduced, reserve, done, TONE, CHIP } = E.kit;
  const D = E.kit.data;
  const store = E.store;
  const fmtFit = E.fmtFit;
  const widgets = {};

  // one row per kind: steps(n), log-scale bar, tone word.
  // data-compact: four tiles in a row (a glance next to a chart).
  // data-bullets: the kind's three source bullets sit inside its row (no separate pane).
  widgets.readout = (el) => {
    const { kinds, ui } = D();
    const ids = list(el, "focus", IDS);
    const compact = "compact" in el.dataset;
    const bullets = "bullets" in el.dataset;
    const lang = document.documentElement.lang;
    const rows = ids.map((id) => {
      const k = kinds[id];
      const count = h("span", { class: "min-w-0 truncate font-mono tabular-nums " + (compact ? "text-lg" : "text-lg sm:text-xl") });
      const bar = h("div", { class: "bar-fill h-1.5", style: "width:2%" });
      const tag = h("span", { class: "flex flex-none items-center gap-1.5 text-xs tone-ink" });
      const hint = h("span", { class: "mt-0.5 block text-xs ui-ink-3" });
      // compact tiles drop the term (the chart labels carry it); full rows keep it
      const name = h("span", { class: "inline-flex items-center gap-1.5 font-medium", title: k.term }, h("span", { class: "k-ink k-" + id }, icon(k.icon)), k.label, compact ? null : h("span", { class: "font-mono text-xs font-normal ui-ink-3" }, k.term));
      const row = compact
        ? h("div", { class: "ui-inset k-" + id + " px-3 py-2.5", style: "--tone:var(--" + k.tone + ")" },
            h("div", { class: "text-sm" }, name),
            h("div", { class: "mt-1 flex items-center justify-between gap-2" }, count, tag),
            h("div", { class: "bar-track mt-2 h-1.5" }, bar))
        : bullets
          ? h("div", { class: "ui-r2 px-4 py-3 k-" + id + " " + TONE[k.tone] },
              h("div", { class: "flex items-center justify-between gap-3" }, name, h("span", { class: "flex items-center gap-2" }, count, tag)),
              h("div", { class: "bar-track mt-2.5 h-1.5" }, bar),
              h("ul", { class: "mt-3 space-y-1 border-t ui-line pt-3 text-sm ui-ink-2" }, k.bullets.map((b) => h("li", { class: "flex gap-2" }, h("span", { class: "ui-ink-3", "aria-hidden": "true" }, "·"), b))))
          : // one line per kind on a shared track, so lengths compare by eye (common scale)
            h("div", { class: "ui-row border-t ui-line py-3 first:border-t-0 k-" + id, style: "--tone:var(--" + k.tone + ")" },
              h("div", {}, h("div", { class: "text-sm" }, name), hint),
              h("div", { class: "ui-row-bar bar-track h-1.5" }, bar),
              h("div", { class: "flex items-center justify-end gap-2" }, count, tag));
      return { id, count, bar, tag, hint, row };
    });
    // every slot is sized once for its widest value, so dragging n never resizes the shared grid
    rows.forEach((r) => {
      if (compact || bullets) return;
      r.count.classList.add("ui-count");
      if (r.id !== "n2") r.hint.hidden = true;
      else r.hint.textContent = ui.hidden;
    });
    const note = h("p", { class: "mt-3 flex items-start gap-1.5 text-xs ui-ink-3", "aria-live": "polite" });
    const grid = compact ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : bullets ? "grid gap-3 sm:grid-cols-2" : "ui-rows";
    el.append(h("div", { class: grid }, rows.map((r) => r.row)), note);
    // data-quiet: inside a chapter the say line already narrates small/large n; keep only the * footnote
    const quiet = "quiet" in el.dataset;
    const noteOf = (n) => (quiet ? (ids.includes("log") && ids.length > 1 ? ui.noteLog : "") : n <= 10 ? ui.noteSmall : n >= 1e5 ? ui.noteBig : ids.includes("log") ? ui.noteLog : "");
    const drawNote = (msg) => note.replaceChildren(msg && msg !== ui.noteLog ? icon("triangle-alert", "mt-px h-3.5 w-3.5") : "", msg || "\u00a0");
    reserve(note, [1, 100, 1e6].map((n) => () => drawNote(noteOf(n))), "y", () => drawNote(noteOf(store.n)));
    const paintCount = (r, n) => {
      // slots are sized for the largest n: tiles hold ~9 chars, bullet cards ~11, full rows the whole number
      const c = steps(r.id, n), star = r.id === "log" && ids.length > 1 ? "*" : "";
      if (compact || bullets) {
        let shown = fmtFit(c, compact ? 9 : 11, lang);
        r.count.textContent = shown + star;
        // tiles shrink in narrow columns: if the digits still do not fit, use the compact form
        if (r.count.scrollWidth > r.count.clientWidth + 1 && shown === fmt(c)) { shown = fmtFit(c, 1, lang); r.count.textContent = shown + star; }
        r.count.title = shown === fmt(c) ? "" : fmt(c);
      } else {
        // full rows: every digit on wide screens (the size is the lesson), compact form on phones
        const fit = fmtFit(c, 11, lang);
        r.count.replaceChildren(h("span", { class: fit === fmt(c) ? "" : "only-wide" }, fmt(c) + star), fit === fmt(c) ? "" : h("span", { class: "only-narrow", title: fmt(c) }, fit + star));
      }
    };
    // the widest text is not always at the largest n (phones switch to 1조 / 1T there), so sample the range
    const lo = Math.log10(Math.max(1, store.min)), hiLog = Math.log10(store.max);
    const samples = Array.from({ length: 25 }, (_, i) => Math.round(Math.pow(10, lo + ((hiLog - lo) * i) / 24)));
    if (!compact && !bullets) rows.forEach((r) => reserve(r.count, samples.map((n) => () => paintCount(r, n)), "x", () => paintCount(r, store.n)));
    store.sub((n) => {
      for (const r of rows) {
        paintCount(r, n);
        r.bar.style.width = barPct(r.id, n) + "%";
        const hide = r.id === "n2" && n <= 10;
        r.tag.replaceChildren(toneIcon(kinds[r.id].tone, "h-4 w-4"));
        // replace, never append: this runs on every n change
        if (r.id === "n2") r.hint.style.visibility = hide ? "visible" : "hidden";
      }
      drawNote(noteOf(n));
    });
  };

  // x = 0..n, y = 0..n. n^2 hits the top wall at sqrt(n): the wall moves left as n grows
  widgets.chart = (el) => {
    const { kinds, ui } = D();
    const ids = list(el, "focus", IDS);
    // viewBox = rendered width, so 11px labels stay 11px on a phone and on a desktop column
    const W = clamp(Math.round(el.clientWidth || 680), 300, 720), H = W < 480 ? 256 : 296, L = 8, R = 84, T = 14, B = 46;
    const pw = W - L - R, ph = H - T - B;
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "block w-full h-auto", role: "img", "aria-label": ui.chartLabel });
    el.append(svg);
    const ink = (v) => ({ style: "fill:var(" + v + ")" });
    store.sub((N) => {
      svg.replaceChildren();
      const X = (x) => L + (x / N) * pw;
      const Y = (y) => T + ph - (Math.min(y, N) / N) * ph;
      svg.append(s("rect", { x: L, y: T, width: pw, height: ph, rx: 6, style: "fill:var(--inset);stroke:var(--line-2)" }));
      for (let i = 1; i < 4; i++) svg.append(s("line", { x1: L, x2: L + pw, y1: T + (ph * i) / 4, y2: T + (ph * i) / 4, style: "stroke:var(--line)" }));
      // axis row (0 … n) and the y-axis note on its own row, so neither collides at any width or n
      svg.append(s("text", { x: L, y: H - 26, "font-size": 11, ...ink("--text-3") }, "0"));
      svg.append(s("text", { x: L + pw, y: H - 26, "font-size": 11, "text-anchor": "end", ...ink("--text-3") }, "n = " + fmt(N)));
      svg.append(s("text", { x: L, y: H - 6, "font-size": 11, ...ink("--text-3") }, ui.yLabel));
      const labels = [];
      for (const id of ids) {
        const pts = [];
        for (let i = 0; i <= 160; i++) {
          const x = (N * i) / 160;
          pts.push(`${X(x).toFixed(1)},${Y(curve(id, x)).toFixed(1)}`);
        }
        svg.append(s("polyline", { points: pts.join(" "), fill: "none", style: "stroke:var(--c-" + id + ")", "stroke-width": id === "n2" ? 2.75 : 2, "stroke-dasharray": id === "log" ? "6 4" : "0", "stroke-linejoin": "round", "stroke-linecap": "round" }));
        // n² exits through the top at sqrt(n); when that is at the right edge (tiny n) it labels like the rest
        const exits = id === "n2" && Math.sqrt(N) < N * 0.8;
        const endX = exits ? X(Math.sqrt(N)) : X(N);
        const endY = exits ? T : Y(curve(id, N));
        labels.push({ id, exits, x: exits ? endX + 6 : L + pw + 8, y: exits ? endY + 14 : endY + 4 });
      }
      const placed = labels.filter((l) => !l.exits).sort((a, b) => a.y - b.y);
      for (let i = 1; i < placed.length; i++) if (placed[i].y - placed[i - 1].y < 16) placed[i].y = placed[i - 1].y + 16;
      for (const l of labels) {
        const k = kinds[l.id];
        svg.append(s("text", { x: l.x, y: l.y, "font-size": 12, "font-weight": 600, ...ink("--c-" + l.id) }, k.term));
        if (l.exits) svg.append(s("text", { x: Math.min(l.x + 40, L + pw - 6), y: l.y, "font-size": 11, "text-anchor": l.x + 40 > L + pw - 6 ? "end" : "start", ...ink("--c-n2") }, ui.exit));
      }
    });
  };

  // rows of fixed n values; click a row to move the shared n
  widgets.table = (el) => {
    const { kinds, ui } = D();
    const ns = list(el, "ns", ["10", "100", "1000"]).map(Number);
    const head = h("tr", { class: "text-left text-xs ui-ink-3" }, h("th", { class: "py-2 pr-4 font-normal" }, ui.colN), IDS.map((id) => h("th", { class: "py-2 pr-4 font-normal" }, h("span", { class: "mb-1 block k-ink k-" + id }, icon(kinds[id].icon, "h-5 w-5")), h("span", { class: "block ui-ink-2" }, kinds[id].label), h("span", { class: "font-mono k-ink k-" + id }, kinds[id].term))));
    const body = ns.map((n) =>
      h(
        "tr",
        { class: "border-t ui-line" },
        h("td", { class: "py-2.5 pr-4" }, h("button", { type: "button", class: "ui-link font-mono", onclick: () => store.set(n) }, fmt(n))),
        IDS.map((id) => h("td", { class: "py-2.5 pr-4 font-mono tabular-nums" }, (id === "log" ? ui.approx + " " : "") + fmt(steps(id, n)))),
      ),
    );
    el.append(h("div", { class: "overflow-x-auto" }, h("table", { class: "w-full text-sm" }, h("thead", {}, head), h("tbody", {}, body))), h("p", { class: "mt-3 flex items-center gap-1.5 text-xs ui-ink-3" }, icon("triangle-alert", "h-3.5 w-3.5"), ui.tableNote));
    store.sub((n) => body.forEach((tr, i) => tr.classList.toggle("row-on", ns[i] === n)));
  };

  // step-by-step search animation on a grid of cells
  widgets.toyrow = (el) => {
    const { kinds, ui } = D();
    const ids = list(el, "kinds", IDS);
    const sizes = list(el, "sizes", ["10", "30", "100"]).map(Number);
    const st = { id: ids[0], size: sizes[0], target: 0, k: 0, timer: 0 };
    const kindBtns = ids.map((id) => h("button", { type: "button", class: CHIP + " inline-flex items-center gap-1.5", onclick: () => { st.id = id; reset(); } }, icon(kinds[id].icon, "h-3.5 w-3.5"), kinds[id].label, h("span", { class: "font-mono text-xs" }, kinds[id].term)));
    const sizeBtns = sizes.map((n) => h("button", { type: "button", class: CHIP, onclick: () => { st.size = n; reset(); } }, h("span", { class: "font-mono" }, "n = " + n)));
    const run = h("button", { type: "button", class: "ui-btn inline-flex items-center gap-1.5", onclick: () => play() }, icon("play", "h-3.5 w-3.5"), ui.run);
    const shuffle = h("button", { type: "button", class: CHIP + " inline-flex items-center gap-1.5", onclick: () => reset(true) }, icon("shuffle", "h-3.5 w-3.5"), ui.shuffle);
    const grid = h("div", { class: "ui-inset flex min-h-[120px] flex-wrap content-start gap-1 p-3" });
    const status = h("p", { class: "mt-3 text-sm tabular-nums", role: "status", "aria-live": "polite" });
    const legend = h("p", { class: "mt-1 text-xs ui-ink-3" });
    el.append(
      h("div", { class: "flex flex-wrap items-center gap-2" }, kindBtns, h("span", { class: "mx-1 h-4 w-px", style: "background:var(--line-2)" }), sizeBtns),
      h("div", { class: "mt-3 flex flex-wrap items-center gap-2" }, run, shuffle),
      h("div", { class: "mt-3" }, grid),
      status,
      legend,
    );
    const total = () => (st.id === "n2" ? st.size * st.size : trace(st.id, st.size, st.target).length);
    function reset(reroll) {
      clearInterval(st.timer);
      st.k = 0;
      if (reroll || st.target >= st.size) st.target = Math.floor(Math.random() * st.size);
      if (st.id === "o1") st.target = 0;
      paint();
    }
    function play() {
      clearInterval(st.timer);
      st.k = 0;
      const T = total();
      if (reduced()) { st.k = T; paint(); return; }
      const slow = T <= 20;
      const per = slow ? 1 : Math.ceil(T / 150);
      st.timer = setInterval(() => {
        st.k = Math.min(T, st.k + per);
        paint();
        if (st.k >= T) clearInterval(st.timer);
      }, slow ? 320 : 18);
    }
    function paint() {
      kindBtns.forEach((b, i) => press(b, ids[i] === st.id));
      sizeBtns.forEach((b, i) => press(b, sizes[i] === st.size));
      const n = st.size, k = st.k, T = total();
      const tr = st.id === "n2" ? [] : trace(st.id, n, st.target);
      const cur = k > 0 ? tr[k - 1] : null;
      const cells = [];
      for (let i = 0; i < n; i++) {
        let c = "";
        if (st.id === "n2") {
          const a = k > 0 ? Math.floor((k - 1) / n) : -1;
          const b = k > 0 ? (k - 1) % n : -1;
          if (k >= T || i < a) c = "cell-done";
          if (k < T && i === a) c = "cell-hold";
          if (k < T && i === b && i !== a) c = "cell-seen";
        } else {
          if (st.id !== "o1" && i === st.target) c = "cell-target";
          if (st.id === "o1" && i === 0) c = "cell-first";
          if (cur && st.id === "log" && (i < cur.lo || i > cur.hi)) c += " cell-off";
          if (cur && i <= cur.at && st.id === "n") c = "cell-seen";
          if (cur && i === cur.at) c = k >= T ? "cell-hit" : "cell-hold";
        }
        cells.push(h("div", { class: "cell flex h-7 w-7 items-center justify-center rounded text-[10px] font-mono " + c }, st.id === "log" ? String(i + 1) : ""));
      }
      grid.replaceChildren(...cells);
      const worst = steps(st.id, n);
      done(el, k >= T && T > 0);
      status.textContent = k === 0 ? fill(ui.ready, { w: fmt(worst) }) : k >= T ? fill(ui.done, { k: fmt(T), w: fmt(worst) }) : fill(ui.probe, { k: fmt(k), t: fmt(T) });
      legend.textContent = ui.legend[st.id] + (st.id === "log" ? " · " + fill(ui.secret, { t: st.target + 1 }) : "");
    }
    reset(true);
  };

  // same step counts, different machine: seconds move, shape does not
  widgets.speed = (el) => {
    const { kinds, ui } = D();
    let exp = 8;
    const range = h("input", { type: "range", min: "3", max: "10", step: "0.1", value: String(exp), "aria-label": ui.machine, class: "ui-range min-w-[140px] flex-1" });
    const out = h("output", { class: "font-mono text-sm tabular-nums text-right" });
    const td = "py-2.5 pr-4 font-mono tabular-nums";
    const rows = IDS.map((id) => ({ id, steps: h("td", { class: td + " ui-ink-2" }), sec: h("td", { class: td }), ratio: h("td", { class: td + " tone-ink", style: "--tone:var(--pass)" }) }));
    const table = h(
      "table",
      { class: "w-full min-w-[34rem] table-fixed text-sm" },
      h("thead", {}, h("tr", { class: "text-left text-xs ui-ink-3" }, h("th", { class: "w-[34%] py-2 pr-4 font-normal" }, ""), h("th", { class: "py-2 pr-4 font-normal" }, h("span", { class: "inline-flex items-center gap-1" }, icon("hash", "h-3.5 w-3.5"), ui.colSteps)), h("th", { class: "py-2 pr-4 font-normal" }, h("span", { class: "inline-flex items-center gap-1" }, icon("timer", "h-3.5 w-3.5"), ui.colSec)), h("th", { class: "py-2 font-normal tone-ink", style: "--tone:var(--pass)" }, h("span", { class: "inline-flex items-center gap-1" }, icon("scale", "h-3.5 w-3.5"), ui.colRatio)))),
      h("tbody", {}, rows.map((r) => h("tr", { class: "border-t ui-line" }, h("td", { class: "py-2.5 pr-4" }, h("span", { class: "inline-flex items-center gap-1.5" }, h("span", { class: "k-ink k-" + r.id }, icon(kinds[r.id].icon)), kinds[r.id].label, h("span", { class: "font-mono text-xs k-ink k-" + r.id }, kinds[r.id].term))), r.steps, r.sec, r.ratio))),
    );
    el.append(
      h("div", { class: "flex flex-wrap items-center gap-3" }, h("span", { class: "inline-flex items-center gap-1.5 text-sm font-medium" }, icon("cpu"), ui.machine), h("span", { class: "ui-ink-3", title: ui.slow }, icon("turtle", "h-5 w-5", ui.slow)), range, h("span", { class: "ui-ink-3", title: ui.fast }, icon("rabbit", "h-5 w-5", ui.fast)), out),
      h("div", { class: "mt-3 overflow-x-auto" }, table),
    );
    const draw = () => {
      const n = store.n, rate = Math.pow(10, exp);
      out.textContent = fmt(rate) + " " + ui.perSec;
      for (const r of rows) {
        const c = steps(r.id, n);
        r.steps.textContent = fmt(c);
        r.sec.textContent = fmtSec(c / rate);
        r.ratio.textContent = fmtRatio(c / steps("n", n));
      }
    };
    range.addEventListener("input", () => { exp = Number(range.value); draw(); });
    const widest = fmt(1e10) + " " + ui.perSec;
    reserve(out, [() => (out.textContent = widest), () => (out.textContent = widest.replace(/\d/g, "8"))], "x", draw);
    store.sub(draw);
  };

  // n → n/2 → … → 1 as chips with a cut between each; follows the shared n
  widgets.halve = (el) => {
    const { tutor } = D();
    const row = h("div", { class: "flex flex-wrap content-start items-center gap-x-1 gap-y-2" });
    const count = h("p", { class: "mt-3 flex items-center gap-2 font-medium tone-ink", style: "--tone:var(--c-log)" });
    el.append(row, count);
    const draw = (n) => {
      const chain = halving(n);
      const kids = [];
      chain.forEach((v, i) => {
        if (i) kids.push(h("span", { class: "inline-flex", style: "color:var(--c-log)" }, icon("scissors", "h-3.5 w-3.5")));
        kids.push(h("span", { class: "rounded-md px-2 py-0.5 font-mono text-sm tabular-nums " + (i === chain.length - 1 ? "tone-pass" : "ui-inset") }, fmt(v)));
      });
      row.replaceChildren(...kids);
      count.replaceChildren(icon("scissors"), fill(tutor.halveCount, { k: chain.length - 1 }));
    };
    reserve(row, [() => draw(store.max)], "y", () => draw(store.n));
    store.sub(draw);
  };

  for (const [name, fn] of Object.entries(widgets)) E.widget(name, fn);
})(typeof window !== "undefined" ? window : globalThis);
