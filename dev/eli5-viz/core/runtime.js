/* ELI5 core runtime. Plain JS; inline.ts puts it into the page, so the output stays one HTML file.
 * Generic only: shared state, DOM kit, icons, theme switch, Mermaid theming, and the widgets every
 * explainer can use (slider, numinput, quiz, flip, tabs). Document-specific widgets live in the page's
 * own script and register with ELI5.widget(name, fn). All copy comes from #eli5-data; nothing here is
 * language-bound. Reference: ~/.claude/skills/generate-eli5-html/references/core-api.md */
(function (root) {
  "use strict";

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  // a value that must fit a fixed slot: full digits while they fit, else the page language's compact form (1조, 1T)
  const fmtFit = (n, max, lang) => {
    const full = fmt(n);
    if (full.length <= max) return full;
    try {
      return new Intl.NumberFormat(lang || "en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    } catch (_) {
      return Number(n).toExponential(1);
    }
  };

  // ---- shared state: one number the whole page reacts to ----------------
  const store = {
    n: 1,
    min: 1,
    max: 1e6,
    log: true,
    subs: new Set(),
    config(o) {
      Object.assign(this, o || {});
      this.n = clamp(this.n, this.min, this.max);
    },
    set(v) {
      const n = clamp(Math.round(Number(v)) || this.min, this.min, this.max);
      if (n === this.n) return;
      this.n = n;
      this.subs.forEach((f) => f(n));
    },
    sub(f) {
      this.subs.add(f);
      f(this.n);
    },
  };
  // story places: data.store.places = [{ upTo: 10, label: "…", icon: "…" }, …] maps the number to where the story is
  const placeOf = (n) => (store.places || []).find((p) => n <= p.upTo) || (store.places || []).at(-1) || null;
  // slider position <-> value; log axis when the range spans orders of magnitude
  const toPos = (n) => (store.log ? Math.log10(Math.max(1, n)) : n);
  const fromPos = (p) => clamp(Math.round(store.log ? Math.pow(10, p) : p), store.min, store.max);

  // log/linear share of one track, floored so tiny values stay visible (unit-tested below via ELI5.barPct)
  const barPct = (v, max, log) => {
    if (!(max > 0)) return 2;
    if (log && max <= 1) return 100;
    const pct = log ? (Math.log10(Math.max(v, 1)) / Math.log10(max)) * 100 : (v / max) * 100;
    return clamp(pct, 2, 100);
  };

  const ELI5 = { clamp, fmt, fmtFit, barPct, store, toPos, fromPos, placeOf };
  if (typeof document === "undefined") {
    if (typeof module !== "undefined") module.exports = ELI5;
    root.ELI5 = ELI5;
    return;
  }

  // ---- data + DOM kit -----------------------------------------------------
  let DATA = null;
  const D = () => {
    if (!DATA) {
      const node = document.getElementById("eli5-data");
      DATA = node ? JSON.parse(node.textContent) : {};
      DATA.ui = DATA.ui || {};
    }
    return DATA;
  };
  const reduced = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  };
  const NS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    for (const c of kids) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  };
  const list = (el, key, fallback) => (el.dataset[key] ? el.dataset[key].split(",") : fallback);
  const fill = (str, vars) => String(str).replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const press = (b, on) => b.setAttribute("aria-pressed", String(on));
  // colors live in theme.css; widgets only name tones (tone-*) and kinds (k-*)
  const TONE = { pass: "tone-pass", go: "tone-go", stop: "tone-stop" };
  const TONE_IC = { pass: "circle-check", go: "circle-arrow-right", stop: "octagon-x" };
  const CHIP = "ui-chip";
  // Lucide icon from #eli5-data.icons (inline.ts fills it). Decorative unless a label is given.
  const icon = (name, cls, label) => {
    const el = s("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "ic " + (cls || "h-4 w-4") });
    if (label) {
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", label);
    } else el.setAttribute("aria-hidden", "true");
    for (const [t, a] of (D().icons || {})[name] || []) el.append(s(t, a));
    return el;
  };
  // tone mark: shape + color, the word for screen readers and as a tooltip
  const toneIcon = (tone, cls) => {
    const { ui } = D();
    return h("span", { class: "inline-flex tone-ink", style: "--tone:var(--" + tone + ")", title: (ui.toneHelp || {})[tone] || null }, icon(TONE_IC[tone], cls || "h-4 w-4", (ui.tone || {})[tone] || tone));
  };
  // reserve the largest box a live element will ever need, so updates never shift the layout.
  // render each variant, keep the max width/height as min-*, then restore() the current state.
  // Re-measured after load, fonts, and resize (Tailwind CDN styles arrive late; widths follow the viewport).
  const reserve = (el, renders, axis, restore) => {
    const run = () => {
      if (axis !== "y") el.style.minWidth = "";
      if (axis !== "x") el.style.minHeight = "";
      let w = 0, ht = 0;
      for (const r of renders) {
        r();
        const box = el.getBoundingClientRect();
        w = Math.max(w, box.width);
        ht = Math.max(ht, box.height);
      }
      if (axis !== "y" && w) el.style.minWidth = Math.ceil(w) + "px";
      if (axis !== "x" && ht) el.style.minHeight = Math.ceil(ht) + "px";
      if (restore) restore();
    };
    run();
    root.addEventListener("load", run);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
    let t = 0;
    root.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(run, 120); });
  };
  // a widget reached its "after" state (quiz answered, all rows flipped, animation finished):
  // the say line of the same chapter turns from the problem to the solution
  const done = (el, on = true) => el.dispatchEvent(new CustomEvent("eli5:done", { bubbles: true, detail: { on } }));
  ELI5.kit = { h, s, icon, toneIcon, list, fill, press, reduced, reserve, done, TONE, TONE_IC, CHIP, data: D };

  // ---- widgets ------------------------------------------------------------
  const widgets = {};
  ELI5.widget = (name, fn) => {
    widgets[name] = fn;
  };

  // the shared-number slider + preset chips. data-presets="10|label|icon;1000000|label|icon"
  // data-presets-wide: hide the chips on phones so a sticky bar stays one row.
  widgets.slider = (el) => {
    const { ui } = D();
    const lab = el.dataset.label || ui.storeLabel || "n";
    const range = h("input", { type: "range", min: String(toPos(store.min)), max: String(toPos(store.max)), step: store.log ? "0.01" : "1", "aria-label": lab, class: "ui-range w-full min-w-[160px]" });
    // the readout beside the range never changes width (widest value, widest place), so the range
    // under the pointer never resizes while dragging: a resize would move the thumb, change the
    // value, change the label, and oscillate at every place boundary (visible flicker)
    const out = h("output", { class: "font-mono text-xl tabular-nums" });
    const place = h("span", { class: "ui-place", "aria-live": "polite" });
    const presets = (el.dataset.presets || "").split(";").filter(Boolean).map((p) => {
      const [n, label, ic] = p.split("|");
      return { n: Number(n), label: label || "", ic };
    });
    const btns = presets.map((p) =>
      h("button", { type: "button", class: CHIP + " inline-flex items-center gap-1.5", title: p.label || null, onclick: () => store.set(p.n) }, p.ic ? icon(p.ic, "h-3.5 w-3.5") : p.label ? p.label + " " : "", p.ic && p.label ? h("span", { class: "sr-only" }, p.label) : null, h("span", { class: "font-mono" }, fmt(p.n))),
    );
    // many input events per frame collapse into one store update per frame
    let raf = 0, pending = 0;
    range.addEventListener("input", () => {
      pending = fromPos(Number(range.value));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; store.set(pending); });
    });
    el.append(
      h(
        "div",
        { class: "ui-slider" },
        // place first, then "n = value": the reserved slack sits at the end, next to the range, not mid-label
        h("label", { class: "ui-slider-read" }, h("span", { class: "ui-ink-3" }, icon("sliders-horizontal")), place, h("span", { class: "font-mono text-sm ui-ink-3" }, lab + " ="), out),
        range,
        h("div", { class: ("presetsWide" in el.dataset ? "hidden sm:flex" : "flex") + " flex-wrap gap-2" }, btns),
      ),
    );
    const drawPlace = (pl) => place.replaceChildren(pl && pl.icon ? icon(pl.icon, "h-3.5 w-3.5") : "", h("span", {}, pl ? pl.label : ""));
    // measured, not estimated: `ch` does not match the rendered digits in every font
    const widest = fmt(store.max);
    reserve(out, [() => (out.textContent = widest), () => (out.textContent = widest.replace(/\d/g, "8"))], "x", () => (out.textContent = fmt(store.n)));
    let shown = null;
    const places = store.places || [];
    if (places.length) reserve(place, places.map((pl) => () => drawPlace(pl)), "x", () => { shown = placeOf(store.n); drawPlace(shown); });
    store.sub((n) => {
      out.textContent = fmt(n);
      const pl = placeOf(n);
      if (pl !== shown) { shown = pl; drawPlace(pl); }
      place.hidden = !pl;
      if (document.activeElement !== range) range.value = String(toPos(n));
      presets.forEach((p, i) => press(btns[i], p.n === n));
    });
  };

  // <p data-w="say" data-say="step-1">: the chapter's narration line, owned by the controls.
  // data.say[key] = { by: "store", lines: [{ upTo, icon, t }] }   → line for the current number
  //              | { by: "done", before: { icon, t }, after: { icon, t } } → flips on eli5:done in its card
  // Text may use {n} (current number). Space is reserved for the longest line, so it never shifts.
  widgets.say = (el) => {
    const spec = (D().say || {})[el.dataset.say];
    if (!spec) return;
    el.classList.add("ui-say");
    el.setAttribute("aria-live", "polite");
    const draw = (line, n = store.n) => {
      el.replaceChildren(h("span", { class: "ui-say-ic" }, icon(line.icon || "circle-question-mark", "h-5 w-5")), h("span", {}, fill(line.t, { n: fmt(n) })));
      if (spec.by === "store") el.dataset.state = line.state || "";
    };
    const lines = spec.by === "store" ? spec.lines : [spec.before, spec.after];
    let cur = spec.by === "store" ? null : spec.before;
    const now = () => (spec.by === "store" ? spec.lines.find((l) => store.n <= l.upTo) || spec.lines.at(-1) : cur);
    // measured with the widest {n}, so the line height never changes while dragging
    reserve(el, lines.map((l) => () => draw(l, store.max)), "y", () => draw(now()));
    if (spec.by === "store") store.sub(() => draw(now()));
    else {
      const card = el.closest("article, section") || document;
      card.addEventListener("eli5:done", (e) => { cur = e.detail.on ? spec.after : spec.before; el.dataset.state = e.detail.on ? "after" : "before"; draw(cur); });
    }
  };

  // <span data-w="place"></span>: the story place for the current number, live (e.g. inside a card caption)
  widgets.place = (el) => {
    el.classList.add("ui-place");
    let shown;
    const draw = (pl, n) => el.replaceChildren(pl && pl.icon ? icon(pl.icon, "h-3.5 w-3.5") : "", h("span", {}, pl ? pl.label : fmt(n)));
    // widest place reserved, so a label change never rewraps the toolbar it sits in
    const places = store.places || [];
    if (places.length) reserve(el, places.map((pl) => () => draw(pl)), "x", () => { shown = placeOf(store.n); draw(shown, store.n); });
    store.sub((n) => {
      const pl = placeOf(n);
      if (pl && pl === shown) return;
      shown = pl;
      draw(pl, n);
    });
  };

  widgets.numinput = (el) => {
    const { ui } = D();
    const lab = el.dataset.label || ui.storeLabel || "n";
    const input = h("input", { type: "number", min: String(store.min), max: String(store.max), inputmode: "numeric", "aria-label": lab, class: "ui-input w-40 px-3 py-2 font-mono text-lg tabular-nums" });
    input.addEventListener("input", () => store.set(input.value));
    el.append(h("label", { class: "flex flex-wrap items-center gap-3" }, h("span", { class: "font-mono text-sm ui-ink-3" }, lab + " ="), input, h("span", { class: "text-xs ui-ink-3" }, fmt(store.min) + " – " + fmt(store.max))));
    store.sub((n) => {
      if (document.activeElement !== input) input.value = String(n);
    });
  };

  // failure habit vs success habit, row by row; the verdict follows. data: flip[], ui.flip*
  widgets.flip = (el) => {
    const { flip, ui } = D();
    const on = flip.map(() => false);
    const verdict = h("p", { class: "ui-r2 px-4 py-3 font-medium tone-ink", role: "status", "aria-live": "polite" });
    const cap = (t, ic) => h("span", { class: "mb-1 flex items-center gap-1.5 text-xs tone-ink" }, icon(ic, "h-3.5 w-3.5"), t);
    const rows = flip.map((p, i) => {
      const bad = h("button", { type: "button", onclick: () => { on[i] = false; draw(); } }, cap(ui.flipBad, "octagon-x"), p.bad);
      const good = h("button", { type: "button", onclick: () => { on[i] = true; draw(); } }, cap(ui.flipGood, "circle-check"), p.good);
      return { bad, good, row: h("div", { class: "grid grid-cols-2 gap-2" }, bad, good) };
    });
    el.append(h("div", { class: "space-y-2" }, rows.map((r) => r.row)), h("div", { class: "mt-4" }, verdict));
    const B = "ui-r2 px-4 py-3 text-left text-sm ";
    function draw() {
      rows.forEach((r, i) => {
        r.bad.className = B + (on[i] ? "flip-off" : "tone-stop");
        r.good.className = B + (on[i] ? "tone-pass" : "flip-off");
        press(r.bad, !on[i]);
        press(r.good, on[i]);
      });
      const left = on.filter((v) => !v).length;
      verdict.className = "ui-r2 px-4 py-3 font-medium " + (left ? "tone-stop" : "tone-pass");
      verdict.replaceChildren(h("span", { class: "flex items-center gap-2 tone-ink" }, icon(left ? "octagon-x" : "circle-check", "h-5 w-5"), left ? fill(ui.flipStop, { c: left }) : ui.flipPass));
      done(el, !left);
    }
    draw();
  };

  // one question, tap an answer, see why. data-q = key in data.quiz ("predict" = asked before the lesson)
  widgets.quiz = (el) => {
    const { quiz = {}, ui } = D();
    const q = quiz[el.dataset.q];
    if (!q) return;
    const why = h("p", { class: "text-sm leading-relaxed ui-ink-2", hidden: true });
    const retry = h("button", { type: "button", class: CHIP + " inline-flex items-center gap-1.5", hidden: true, onclick: () => draw(-1) }, icon("repeat", "h-3.5 w-3.5"), ui.quizRetry);
    const verdict = h("p", { class: "flex items-center gap-1.5 text-sm font-medium tone-ink", role: "status", "aria-live": "polite" });
    const opts = q.options.map((t, i) => h("button", { type: "button", onclick: () => draw(i) }, h("span", { class: "mark inline-flex" }), h("span", {}, t)));
    el.append(
      h("p", { class: "text-xs ui-ink-3" }, el.dataset.title || ui.quizTitle),
      h("p", { class: "mt-2 font-medium leading-relaxed" }, q.q),
      h("div", { class: "mt-3 grid gap-2 " + (q.options.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2") }, opts),
      h("div", { class: "mt-3 space-y-2" }, verdict, why, retry),
    );
    const B = "flex items-center gap-2 ui-r2 px-4 py-2.5 text-left text-sm ";
    function draw(pick) {
      const answered = pick >= 0;
      opts.forEach((b, i) => {
        const right = i === q.answer;
        b.className = B + (!answered ? "ui-opt" : right ? "tone-pass" : i === pick ? "tone-stop" : "flip-off");
        b.disabled = answered;
        b.querySelector(".mark").replaceChildren(answered && (right || i === pick) ? h("span", { class: "tone-ink" }, icon(right ? "check" : "x")) : "");
      });
      verdict.hidden = why.hidden = retry.hidden = !answered;
      if (!answered) return;
      const ok = pick === q.answer;
      verdict.style.setProperty("--tone", ok ? "var(--pass)" : "var(--stop)");
      verdict.replaceChildren(icon(ok ? "circle-check" : "lightbulb"), ok ? ui.quizRight : ui.quizWrong);
      why.textContent = q.why;
      done(el, true);
    }
    draw(-1);
  };

  // [data-tab] buttons switch [data-panel] siblings; [data-go=next|prev] steps through
  widgets.tabs = (el) => {
    const tabs = [...el.querySelectorAll(":scope [data-tab]")];
    const panels = [...el.querySelectorAll(":scope [data-panel]")];
    let cur = Math.max(0, tabs.findIndex((t) => t.dataset.tab === el.dataset.start));
    const show = (i) => {
      cur = clamp(i, 0, tabs.length - 1);
      tabs.forEach((t, j) => {
        t.setAttribute("aria-selected", String(j === cur));
        t.classList.toggle("tab-on", j === cur);
      });
      panels.forEach((p) => { p.hidden = p.dataset.panel !== tabs[cur].dataset.tab; });
      el.querySelectorAll(":scope [data-go=prev]").forEach((b) => (b.disabled = cur === 0));
      el.querySelectorAll(":scope [data-go=next]").forEach((b) => (b.disabled = cur === tabs.length - 1));
    };
    tabs.forEach((t, i) => t.addEventListener("click", () => show(i)));
    el.querySelectorAll(":scope [data-go]").forEach((b) => b.addEventListener("click", () => show(cur + (b.dataset.go === "next" ? 1 : -1))));
    show(cur);
  };

  // ---- static data widgets: fixed relations with no store subscription (never move during drags) ----
  // colors live in theme.css; `kind` needs a page-level `--c-<kind>` (see layout-bible), otherwise tone fills --k.
  const kindOf = (b) => (b.kind ? " k-" + b.kind : "");
  const toneStyleOf = (b) => (b.tone ? "--tone:var(--" + b.tone + ")" + (b.kind ? "" : ";--k:var(--" + b.tone + ")") : null);
  // fixed numbers on one shared track: <div data-w="bars" data-ids="a,b" data-log data-note="...">
  // data.bars = { a: { icon, label, term, value, story, tone, kind } }
  widgets.bars = (el) => {
    const { bars = {} } = D();
    const ids = list(el, "ids", Object.keys(bars));
    const log = "log" in el.dataset;
    const lang = document.documentElement.lang;
    const vals = ids.map((id) => Number(bars[id]?.value) || 0);
    const max = Math.max(...vals, 1);
    const rows = ids.map((id, i) => {
      const b = bars[id] || {};
      return h("div", { class: "ui-card p-4" + kindOf(b), style: toneStyleOf(b) },
        h("div", { class: "flex items-center justify-between gap-2 text-sm" },
          h("span", { class: "inline-flex items-center gap-1.5 font-medium" }, b.icon ? h("span", { class: "k-ink" }, icon(b.icon, "h-5 w-5")) : null, b.label || id, b.term ? h("span", { class: "font-mono text-xs font-normal ui-ink-3" }, b.term) : null),
          h("span", { class: "font-mono text-sm tabular-nums" }, fmtFit(vals[i], 9, lang))),
        h("div", { class: "bar-track mt-2 h-1.5" }, h("div", { class: "bar-fill h-1.5", style: "width:" + barPct(vals[i], max, log) + "%" })),
        b.story ? h("p", { class: "mt-2.5 border-t ui-line pt-2 text-xs ui-ink-3" }, b.story) : null);
    });
    el.append(h("div", { class: "space-y-3" }, rows));
    if ("note" in el.dataset) el.append(h("p", { class: "mt-3 text-xs ui-ink-3" }, el.dataset.note));
  };

  // icon + term + desc rows: <dl data-w="facts"></dl>, data.facts = [{ icon, term, desc }]
  widgets.facts = (el) => {
    const { facts = [] } = D();
    el.append(...facts.map((f) => h("div", { class: "flex items-center gap-3 border-b ui-line py-2" },
      h("dt", { class: "flex w-[7.5rem] items-center gap-2 font-mono text-sm" }, f.icon ? icon(f.icon, "h-4 w-4") : null, f.term),
      h("dd", { class: "text-sm" }, f.desc))));
  };

  // short ordered sequence: <div data-w="flow" data-steps="A;B;C" data-result="..."></div>
  widgets.flow = (el) => {
    const steps = (el.dataset.steps || "").split(";").filter(Boolean);
    el.append(
      h("p", { class: "font-mono text-[13px]" }, steps.join(" \u2192 ")),
      el.dataset.result ? h("p", { class: "mt-3 border-t ui-line pt-3 text-sm" }, el.dataset.result) : null);
  };

  // cast-style card grid: <div data-w="cards"></div>, data.cast = [{ icon, term, label, story, stat, tone, kind }]
  widgets.cards = (el) => {
    const { cast = [] } = D();
    el.append(h("div", { class: "grid grid-cols-2 gap-3 md:grid-cols-4" }, cast.map((c) =>
      h("div", { class: "ui-card p-4" + kindOf(c), style: toneStyleOf(c) },
        h("div", { class: "flex items-center justify-between" },
          h("span", {}, c.icon ? icon(c.icon, "h-7 w-7") : null),
          c.tone ? toneIcon(c.tone, "h-4 w-4") : null),
        h("p", { class: "mt-3 font-medium" }, c.label),
        h("p", { class: "whitespace-nowrap font-mono text-sm" }, c.term),
        h("p", { class: "mt-1.5 text-sm leading-snug ui-ink-2" }, c.story),
        h("p", { class: "mt-3 border-t ui-line pt-2 text-xs tabular-nums ui-ink-3" }, c.stat)))));
  };

  const renderMermaid = () => {
    const m = root.mermaid;
    const nodes = [...document.querySelectorAll(".mermaid")];
    if (!m || !nodes.length) return;
    const css = getComputedStyle(document.documentElement);
    const v = (k) => css.getPropertyValue(k).trim();
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: { background: v("--surface"), primaryColor: v("--inset"), primaryBorderColor: v("--line-2"), primaryTextColor: v("--text"), lineColor: v("--text-3"), textColor: v("--text"), fontFamily: v("--font-sans") },
    });
    nodes.forEach((n) => {
      if (!n.dataset.src) n.dataset.src = n.textContent;
      n.removeAttribute("data-processed");
      n.textContent = n.dataset.src;
    });
    m.run({ nodes });
  };
  root.addEventListener("mermaid-ready", renderMermaid);

  // ---- lexicon highlight (subculture coloring) -------------------------------
  // data.lexicon = [{ t: "하루", cls: "hl-hero" }, { t: "창고", cls: "hl-place" }, { t: "짝꿍 찾기", cls: "hl-k k-n2" }]
  // Every occurrence of a term gets the same color everywhere, including text widgets draw later.
  // Color only (no weight change), so highlighting never changes a reserved width.
  const SKIP = "script,style,code,svg,input,textarea,.font-mono,.mermaid,.ui-chip,[data-no-hl],.hl"; // chips: pressed = inverted ink
  let lexRe = null, lexCls = null;
  const highlight = (rootEl) => {
    if (!lexRe) return;
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (!t.nodeValue.trim() || (t.parentElement && t.parentElement.closest(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const t of nodes) {
      const v = t.nodeValue;
      lexRe.lastIndex = 0;
      if (!lexRe.test(v)) continue;
      lexRe.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = lexRe.exec(v))) {
        if (m.index > last) frag.append(v.slice(last, m.index));
        frag.append(h("span", { class: "hl " + lexCls.get(m[0]) }, m[0]));
        last = m.index + m[0].length;
      }
      if (last < v.length) frag.append(v.slice(last));
      const parent = t.parentElement, d = parent ? getComputedStyle(parent).display : "";
      if (/flex|grid/.test(d)) t.replaceWith(h("span", {}, frag)); // one flex item, as before
      else t.replaceWith(frag);
    }
  };
  const startLexicon = () => {
    const lex = (D().lexicon || []).filter((e) => e && e.t);
    if (!lex.length) return;
    lex.sort((a, b) => b.t.length - a.t.length); // longest first: "100만 개 창고" before "창고"
    lexCls = new Map(lex.map((e) => [e.t, e.cls]));
    lexRe = new RegExp(lex.map((e) => e.t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    const main = document.querySelector("main") || document.body;
    highlight(main);
    new MutationObserver((recs) => {
      for (const r of recs) for (const n of r.addedNodes) {
        if (n.nodeType === 3) { if (n.parentNode) highlight(n.parentNode); }
        else if (n.nodeType === 1 && !n.classList.contains("hl")) highlight(n);
      }
    }).observe(main, { childList: true, subtree: true });
  };

  // ---- mount ----------------------------------------------------------------
  ELI5.mount = () => {
    const html = document.documentElement;
    store.config(D().store);
    try {
      const t = localStorage.getItem("eli5-theme");
      if (t) html.dataset.theme = t;
    } catch (_) {}
    document.querySelectorAll("[data-theme-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem("eli5-theme", html.dataset.theme);
        } catch (_) {}
        renderMermaid();
      }),
    );
    // generic "set the shared number" buttons: <button data-set-n="10">
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-set-n]");
      if (b) store.set(b.dataset.setN);
    });
    const setters = [...document.querySelectorAll("[data-set-n]")];
    if (setters.length) store.sub((n) => setters.forEach((b) => press(b, Number(b.dataset.setN) === n)));
    // every widget first, tabs last (it only toggles visibility), so hidden panels still mount
    const order = Object.keys(widgets).filter((k) => k !== "tabs").concat("tabs");
    for (const name of order) document.querySelectorAll(`[data-w="${name}"]`).forEach((el) => widgets[name](el));
    const unknown = [...document.querySelectorAll("[data-w]")].map((el) => el.dataset.w).filter((n) => !widgets[n]);
    if (unknown.length) console.error("ELI5: no widget registered for " + [...new Set(unknown)].join(", "));
    startLexicon();
    renderMermaid();
  };
  root.ELI5 = ELI5;
})(typeof window !== "undefined" ? window : globalThis);
