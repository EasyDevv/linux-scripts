/* Big-O 3D room: the page widget that drives the generic 3D kit (ELI5.scene3d).
 * Floor = the toys (n cubes; above the cap, a demo floor of `cap` cubes stands in for n).
 * Haru (hero marker) walks the floor for the chosen method; pillars = steps per method on a log scale;
 * the translucent ceiling = n steps (O(n) touches it, O(n²) goes through).
 * Chapter buttons: <button data-set-n="100" data-room3d="o1" data-run> set n, pick the method, start. */
(function (root) {
  "use strict";
  const E = root.ELI5;
  const { h, icon, fill, press, reduced, reserve, done, CHIP } = E.kit;
  const D = E.kit.data;
  const store = E.store;
  const B = E.bigO;
  const ORDER = ["o1", "log", "n", "n2"];
  const COLOR = { o1: "--c-o1", log: "--c-log", n: "--c-n", n2: "--c-n2" };

  E.widget("room3d", (el) => {
    const { kinds, ui, room } = D();
    const cap = Number(el.dataset.cap || 900);
    const stage = h("div", { class: "ui-3d relative" });
    const status = h("p", { class: "ui-3d-hud", role: "status", "aria-live": "polite" });
    const scale = h("p", { class: "ui-3d-note" });
    const kindBtns = ORDER.map((id) => h("button", { type: "button", class: CHIP + " inline-flex items-center gap-1.5", onclick: () => pick(id) }, h("span", { class: "k-ink k-" + id }, icon(kinds[id].icon, "h-3.5 w-3.5")), kinds[id].label));
    const run = h("button", { type: "button", class: "ui-btn inline-flex items-center gap-1.5", onclick: () => play() }, icon("play", "h-3.5 w-3.5"), ui.run);
    el.append(stage, h("div", { class: "ui-toolbar mt-3" }, kindBtns, run), status, scale);

    const sc = E.scene3d && E.scene3d.create(stage, { cap });
    if (!sc || !sc.ok) {
      // no WebGL: the readout below the stage still shows every number
      stage.append(h("p", { class: "p-6 text-sm ui-ink-3" }, room.noWebgl));
      return;
    }
    const st = { kind: "n", m: 0, k: 0, T: 0, tr: [], target: 0, timer: 0, card: null };
    const maxLog = Math.log10(B.steps("n2", store.max) + 1);
    const hgt = (v) => Math.log10(v + 1) / maxLog;

    function frame() {
      const { kind, m, k, T, tr } = st;
      const cur = k > 0 && kind !== "n2" ? tr[k - 1] : null;
      const a = kind === "n2" && k > 0 ? Math.floor((k - 1) / m) : -1, b = kind === "n2" && k > 0 ? (k - 1) % m : -1;
      sc.paint((i) => {
        if (kind === "n2") return k >= T && T ? "seen" : i === a ? "hold" : i === b ? "seen" : i < a ? "off" : "base";
        if (cur && i === cur.at) return k >= T ? "hit" : "hold";
        if (kind === "log" && cur && (i < cur.lo || i > cur.hi)) return "off";
        if (kind === "n" && cur && i < cur.at) return "seen";
        if (kind === "o1") return i === 0 ? "first" : "base";
        return i === st.target ? "target" : "base";
      });
      sc.mark(kind === "n2" ? (a >= 0 && k < T ? b : null) : cur ? cur.at : 0);
      sc.render();
      const n = store.n, worst = B.steps(kind, n);
      status.textContent = k === 0 ? fill(room.ready, { m: kinds[kind].label, w: E.fmt(worst) }) : k >= T ? fill(room.done, { m: kinds[kind].label, k: E.fmt(T), w: E.fmt(B.steps(kind, st.m)) }) : fill(room.walk, { k: E.fmt(k), t: E.fmt(T) });
      if (k >= T && T) done(st.card || el, true);
    }
    function reset() {
      clearInterval(st.timer);
      st.k = 0;
      st.target = st.kind === "o1" ? 0 : Math.floor(st.m * 0.62);
      st.tr = st.kind === "n2" ? [] : B.trace(st.kind, st.m, st.target);
      st.T = st.kind === "n2" ? st.m * st.m : st.tr.length;
      kindBtns.forEach((b, i) => press(b, ORDER[i] === st.kind));
      frame();
    }
    function pick(id) {
      st.kind = id;
      reset();
    }
    function play() {
      reset();
      if (reduced()) { st.k = st.T; frame(); return; }
      const frames = Math.min(st.T, 180), per = Math.ceil(st.T / frames), ms = st.T <= 24 ? 260 : 22;
      st.timer = setInterval(() => {
        st.k = Math.min(st.T, st.k + per);
        frame();
        if (st.k >= st.T) clearInterval(st.timer);
      }, ms);
    }
    store.sub((n) => {
      st.m = Math.min(n, cap);
      sc.setItems(st.m);
      sc.setPillars(ORDER.map((id) => ({ color: COLOR[id], h: hgt(B.steps(id, n)) })));
      sc.setCeiling(hgt(n));
      scale.textContent = n > cap ? fill(room.scaleBig, { m: E.fmt(cap), n: E.fmt(n) }) : fill(room.scale, { n: E.fmt(n) });
      reset();
    });
    // the longest status and note keep their room, so nothing below moves while n changes
    reserve(status, [() => (status.textContent = fill(room.done, { m: "전부 비교", k: "810,000", w: "810,000" })), () => (status.textContent = fill(room.ready, { m: "절반 버리기", w: "1,000,000,000,000" }))], "y", frame);
    reserve(scale, [() => (scale.textContent = fill(room.scaleBig, { m: E.fmt(cap), n: E.fmt(store.max) }))], "y", () => (scale.textContent = store.n > cap ? fill(room.scaleBig, { m: E.fmt(cap), n: E.fmt(store.n) }) : fill(room.scale, { n: E.fmt(store.n) })));

    // chapter buttons drive the room: pick the method, optionally start, and bring the stage into view
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-room3d]");
      if (!b) return;
      st.card = b.closest("article");
      if (b.dataset.room3d) st.kind = b.dataset.room3d;
      // data-set-n is applied by the core handler first; run after it settles
      setTimeout(() => {
        if ("run" in b.dataset) play(); else reset();
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      }, 0);
    });
    reset();
  });
})(typeof window !== "undefined" ? window : globalThis);
