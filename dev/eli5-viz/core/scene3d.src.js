/* ELI5 3D kit (three.js, tree-shaken). Build: `bun run build:3d` → core/scene3d.js (static, inlined by
 * inline.ts only when a page has a [data-3d] element). Generic, not Big-O specific:
 *   a field of n items (instanced cubes), the protagonist marker, up to ~6 measurement pillars,
 *   and a ceiling plane. Colors come from theme.css tokens and follow the theme switch.
 * Renders on demand (no endless loop); drag rotates the view; reduced motion skips tweens. */
import {
  AmbientLight, BoxGeometry, Color, DirectionalLight, DynamicDrawUsage, Group, InstancedMesh, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene,
  SphereGeometry, CylinderGeometry, WebGLRenderer, DoubleSide,
} from "three";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
const col = (v) => new Color(v.startsWith("--") ? css(v) : v);

function create(host, opts = {}) {
  const cap = opts.cap || 900;
  // three.js colors drop alpha, so every state maps to a solid token (rgba line tokens would turn white)
  const STATE = { base: "--3d-base", seen: "--c-n", off: "--3d-off", hit: "--pass", hold: "--hero", target: "--stop", first: "--text", ...(opts.states || {}) };
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (_) {
    return { ok: false };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.append(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1.6, 0.1, 100);
  const world = new Group();
  scene.add(world);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  // floor + items (left), pillars + ceiling (right)
  const FLOOR = 4, PX = 3.2;
  const floor = new Mesh(new PlaneGeometry(FLOOR + 0.4, FLOOR + 0.4), new MeshStandardMaterial({ color: 0x888888, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-1.6, 0, 0);
  world.add(floor);
  const box = new BoxGeometry(1, 1, 1);
  const items = new InstancedMesh(box, new MeshStandardMaterial({ roughness: 0.6 }), cap);
  items.instanceMatrix.setUsage(DynamicDrawUsage);
  world.add(items);
  const marker = new Mesh(new SphereGeometry(0.16, 24, 16), new MeshStandardMaterial({ roughness: 0.35 }));
  world.add(marker);
  const pillarsG = new Group();
  pillarsG.position.set(PX, 0, 0);
  world.add(pillarsG);
  const ceiling = new Mesh(new PlaneGeometry(1, 1.2), new MeshBasicMaterial({ transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false }));
  ceiling.rotation.x = -Math.PI / 2;
  world.add(ceiling);
  const edge = new Mesh(new BoxGeometry(1, 0.012, 0.012), new MeshBasicMaterial());
  world.add(edge);

  const st = { m: 0, side: 1, cell: 1, paint: () => "base", pillars: [], ceil: null, mark: null, markPos: null, yaw: -0.35, H: 3.4, raf: 0 };
  const dummy = new Object3D();
  const pos = (i) => {
    const r = Math.floor(i / st.side), c = i % st.side, off = ((st.side - 1) * st.cell) / 2;
    return [-1.6 + c * st.cell - off, 0, r * st.cell - off];
  };

  function layoutItems() {
    st.side = Math.max(1, Math.ceil(Math.sqrt(st.m)));
    st.cell = FLOOR / st.side;
    const s = st.cell * 0.78;
    for (let i = 0; i < cap; i++) {
      if (i < st.m) {
        const [x, , z] = pos(i);
        dummy.position.set(x, s / 2, z);
        dummy.scale.set(s, s, s);
      } else dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      items.setMatrixAt(i, dummy.matrix);
    }
    items.count = cap;
    items.instanceMatrix.needsUpdate = true;
  }
  function paintItems() {
    const cache = {};
    for (let i = 0; i < st.m; i++) {
      const k = st.paint(i) || "base";
      items.setColorAt(i, cache[k] || (cache[k] = col(STATE[k] || k)));
    }
    if (items.instanceColor) items.instanceColor.needsUpdate = true;
  }
  function layoutPillars() {
    pillarsG.clear();
    const n = st.pillars.length, gap = 0.78;
    st.pillars.forEach((p, i) => {
      const h = Math.max(0.03, p.h) * st.H;
      const m = new Mesh(new CylinderGeometry(0.28, 0.28, 1, 32), new MeshStandardMaterial({ color: col(p.color), roughness: 0.45 }));
      m.scale.set(1, h, 1);
      m.position.set((i - (n - 1) / 2) * gap, h / 2, 0);
      pillarsG.add(m);
    });
    const width = n * gap + 0.3;
    ceiling.visible = edge.visible = st.ceil != null;
    if (st.ceil != null) {
      const y = Math.max(0.03, st.ceil) * st.H;
      ceiling.scale.set(width, 1, 1);
      ceiling.position.set(PX, y, 0);
      ceiling.material.color = col("--accent");
      edge.scale.set(width, 1, 1);
      edge.position.set(PX, y, 0.6);
      edge.material.color = col("--accent");
    }
  }
  function themeColors() {
    floor.material.color = col("--inset");
    marker.material.color = col("--hero");
    marker.material.emissive = col("--hero").multiplyScalar(0.25);
    paintItems();
    layoutPillars();
  }
  function placeMarker(i) {
    if (i == null || i >= st.m) {
      marker.visible = false;
      return;
    }
    marker.visible = true;
    const [x, , z] = pos(i), s = st.cell * 0.78;
    marker.position.set(x, s + 0.2, z);
  }

  let w = 0, h = 0;
  function size() {
    const nw = host.clientWidth, nh = Math.round(nw * (nw < 520 ? 0.78 : 0.56));
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = h + "px";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function aim() {
    // narrow (portrait-ish) stages pull the camera back so the whole floor and every pillar stay in frame
    const k = Math.max(1, 1.5 / camera.aspect), R = 10 * k, x = Math.sin(st.yaw) * R, z = Math.cos(st.yaw) * R;
    camera.position.set(x + 0.8, 4.4 * k, z);
    camera.lookAt(0.8, 1.35, 0); // the scene sits in the middle of the canvas, pillars have headroom
  }
  function render() {
    size();
    aim();
    renderer.render(scene, camera);
  }

  // drag to look around (yaw only): exploration without a camera-control dependency
  let drag = null;
  renderer.domElement.style.touchAction = "pan-y";
  renderer.domElement.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, yaw: st.yaw }; renderer.domElement.setPointerCapture(e.pointerId); });
  renderer.domElement.addEventListener("pointermove", (e) => { if (!drag) return; st.yaw = Math.max(-1.2, Math.min(1.2, drag.yaw + (e.clientX - drag.x) * 0.006)); render(); });
  renderer.domElement.addEventListener("pointerup", () => { drag = null; });
  new ResizeObserver(() => render()).observe(host);
  new MutationObserver(() => { themeColors(); render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  themeColors();
  return {
    ok: true,
    canvas: renderer.domElement,
    setItems(m) { st.m = Math.max(0, Math.min(cap, Math.round(m))); layoutItems(); paintItems(); placeMarker(st.mark); },
    paint(fn) { st.paint = fn || (() => "base"); paintItems(); },
    mark(i) { st.mark = i; placeMarker(i); },
    setPillars(list) { st.pillars = list; layoutPillars(); },
    setCeiling(v) { st.ceil = v; layoutPillars(); },
    render,
  };
}

window.ELI5 = window.ELI5 || {};
window.ELI5.scene3d = { create };
