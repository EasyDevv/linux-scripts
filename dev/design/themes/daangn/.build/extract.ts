// Build themes/daangn/spec.json from SEED Design's rootage tokens.
//
//   bun themes/daangn/.build/extract.ts [--seed ~/.ref/seed-design]
//   bun themes/daangn/.build/emit.ts
//
// SEED ships its tokens as data (packages/rootage/__generated__/*.json, modes
// theme-light / theme-dark), so nothing here is measured from pixels: every value
// is a rootage token, resolved once. Layers follow the linear / toss themes:
//   palette (--palette-*)  →  roles (--fg-* / --bg-* / --stroke-*, SEED's own names)
//   →  shadcn slots  →  component geometry (--control-*, --field-*, --list-row-* …)
//   →  type scale (--text-t1 … t14) and roles (--text-title …).
// Roles are declared as var(--palette-*) in both :root and .dark so a nested .dark
// subtree recomputes them against the dark ramp instead of inheriting light values.
import { resolve } from "node:path";
import { homedir } from "node:os";

type Scope = Record<string, string>;
type Value = { type: string; value: unknown };
type TokenFile = { data: { tokens: Record<string, { values: Record<string, Value> }> } };
type Comp = {
	data: { definitions: { variants: Record<string, string>; definitions: { states: string[]; slots: Record<string, Record<string, Value>> }[] }[] };
};

const argSeed = process.argv.indexOf("--seed");
const seed = argSeed > 0 ? process.argv[argSeed + 1] : resolve(homedir(), ".ref/seed-design");
const gen = resolve(seed, "packages/rootage/__generated__");
const here = import.meta.dir;
const theme = resolve(here, "..");

const load = async (name: string) => (await Bun.file(resolve(gen, `${name}.json`)).json()) as TokenFile;
const [color, dimension, fontSize, lineHeight, fontWeight, radius, shadow, duration, easing, scale, gradient] = await Promise.all(
	["color", "dimension", "font-size", "line-height", "font-weight", "radius", "shadow", "duration", "timing-function", "scale", "gradient"].map(load),
);
// __generated__ can lag the YAML sources (e.g. $color.bg.neutral-solid-muted): add YAML-only colour tokens.
{
	const yaml = Bun.YAML.parse(await Bun.file(resolve(seed, "packages/rootage/color.yaml")).text()) as {
		data: { tokens: Record<string, { values: Record<string, string> }> };
	};
	for (const [k, v] of Object.entries(yaml.data.tokens))
		color.data.tokens[k] ??= { values: Object.fromEntries(Object.entries(v.values).map(([m, x]) => [m, { type: "color", value: x }])) };
}
const all: Record<string, Record<string, Value>> = {};
for (const f of [color, dimension, fontSize, lineHeight, fontWeight, radius, shadow, duration, easing, scale, gradient])
	for (const [k, v] of Object.entries(f.data.tokens)) all[k] = v.values;

// ---------- value formatting ----------

const hex = (h: string) => {
	const s = h.replace("#", "");
	if (s.length === 6) return `#${s}`;
	const [r, g, b, a] = [0, 2, 4, 6].map((i) => Number.parseInt(s.slice(i, i + 2), 16));
	return `rgb(${r} ${g} ${b} / ${+(a / 255).toFixed(3)})`;
};
const dim = (v: { value: number; unit: string }) => `${v.value}${v.unit}`;

/** `$color.palette.carrot-600` → `--palette-carrot-600`; `$color.fg.brand` → `--fg-brand`. */
function varName(ref: string) {
	const [, group, ...rest] = ref.slice(1).split(".");
	const tail = rest.join("-").replace(/_/g, "-");
	if (ref.startsWith("$color.palette.")) return `--palette-${tail}`;
	if (ref.startsWith("$color.")) return `--${group}-${tail}`;
	if (ref.startsWith("$dimension.")) return `--dimension-${[group, ...rest].join("-").replace(/_/g, "-")}`;
	return `--${ref.slice(1).replace(/\./g, "-").replace(/_/g, "-")}`;
}

/** A resolved literal for one mode; token refs are followed to their end value. */
function literal(ref: string, mode: string): string {
	const values = all[ref];
	if (!values) throw new Error(`unknown token ${ref}`);
	const v = values[mode] ?? values.default ?? Object.values(values)[0];
	if (typeof v.value === "string" && v.value.startsWith("$")) return literal(v.value, mode);
	return format(v, mode);
}

function format(v: Value, mode: string): string {
	const x = v.value as never;
	switch (v.type) {
		case "color":
			return typeof x === "string" && (x as string).startsWith("$") ? literal(x, mode) : hex(x);
		case "dimension":
		case "duration":
			return typeof x === "string" ? literal(x, mode) : dim(x);
		case "cubicBezier":
			return `cubic-bezier(${(x as number[]).join(", ")})`;
		case "shadow":
			return (x as { color: string; offsetX: never; offsetY: never; blur: never; spread: never }[])
				.map((s) => `${dim(s.offsetX)} ${dim(s.offsetY)} ${dim(s.blur)} ${dim(s.spread)} ${hex(s.color)}`)
				.join(", ");
		case "gradient":
			return (x as { color: string; position: number }[]).map((s) => `${hex(s.color)} ${+(s.position * 100).toFixed(1)}%`).join(", ");
		default:
			return String(x);
	}
}

/** Reference form: a palette ref stays var(--palette-*); anything else resolves. */
function ref(token: string, mode: string) {
	const v = all[token][mode];
	if (typeof v.value === "string" && v.value.startsWith("$color.palette.")) return `var(${varName(v.value)})`;
	return format(v, mode);
}

// ---------- component lookup ----------

const comps: Record<string, Comp> = {};
async function comp(name: string) {
	comps[name] ??= (await Bun.file(resolve(gen, `components/${name}.json`)).json()) as Comp;
	return comps[name];
}
/** One enabled-state property of a component variant, as a token reference or literal. */
async function spec(name: string, variants: string, slotProp: string, state = "enabled") {
	const want = variants ? Object.fromEntries(variants.split(",").map((p) => p.split("="))) : {};
	const [slot, prop] = slotProp.split(".");
	for (const d of (await comp(name)).data.definitions) {
		const keys = Object.keys(d.variants);
		if (keys.length !== Object.keys(want).length || keys.some((k) => d.variants[k] !== want[k])) continue;
		for (const s of d.definitions) {
			if (s.states.join("+") !== state) continue;
			const v = s.slots[slot]?.[prop];
			if (v) return v;
		}
	}
	throw new Error(`${name}[${variants}] ${slotProp} not found`);
}
/** A geometry value: token refs to foundation scales become var(), px literals stay. */
async function geo(name: string, variants: string, slotProp: string) {
	const v = await spec(name, variants, slotProp);
	if (typeof v.value === "string" && v.value.startsWith("$")) {
		const n = varName(v.value);
		if (n.startsWith("--dimension-spacing")) return `var(--spacing-${v.value.split(".").pop()})`;
		if (n.startsWith("--dimension-")) return literal(v.value, "default");
		if (n.startsWith("--radius-")) return `var(${n})`;
		if (n.startsWith("--font-size-")) return `var(--text-${v.value.split(".").pop()})`;
		if (n.startsWith("--line-height-")) return `var(--text-${v.value.split(".").pop()}--line-height)`;
		if (n.startsWith("--font-weight-")) return literal(v.value, "default");
		return `var(${n})`;
	}
	return format(v, "theme-light");
}
/** A colour role of a component: the SEED role var, never a literal. */
async function tone(name: string, variants: string, slotProp: string, state = "enabled") {
	const v = await spec(name, variants, slotProp, state);
	return typeof v.value === "string" ? `var(${varName(v.value)})` : hex(v.value as string);
}

// ---------- palette + roles ----------

const root: Scope = {};
const dark: Scope = {};
const prims: Scope = {};
const utils: Scope = {};
const comments: Record<string, Record<string, string>> = { projectPrimitives: {}, dark: {}, projectUtilities: {} };
const note = (section: string, token: string, text: string) => {
	comments[section][token] = text;
};

const tokens = Object.keys(color.data.tokens);
const palette = tokens.filter((t) => t.startsWith("$color.palette."));
note("projectPrimitives", varName(palette[0]), "SEED palette (rootage color.yaml). gray-00 … 1000 and every hue 100 … 1000 are adaptive: .dark swaps the ramp, static-* stays.");
note("dark", varName(palette[0]), "SEED theme-dark palette. Only steps that differ from theme-light are redeclared.");
for (const t of palette) {
	const light = literal(t, "theme-light");
	const dk = literal(t, "theme-dark");
	prims[varName(t)] = light;
	if (dk !== light) dark[varName(t)] = dk;
}

const roleGroups: [string, string][] = [
	["$color.fg.", "Foreground roles ($color.fg.*): ink by emphasis, then tone"],
	["$color.bg.", "Background roles ($color.bg.*): layer-basement < layer-default < layer-floating, tone solid / weak, pressed pairs"],
	["$color.stroke.", "Stroke roles ($color.stroke.*): neutral-muted is the hairline, neutral-weak the field outline, focus-ring blue-600"],
	["$color.manner-temp.", "Daangn-only: 매너온도 levels l1 … l10 (bg / text)"],
	["$color.banner.", "Daangn-only: banner tints"],
];
for (const [prefix, text] of roleGroups) {
	const group = tokens.filter((t) => t.startsWith(prefix));
	note("projectPrimitives", varName(group[0]), text);
	for (const t of group) {
		prims[varName(t)] = ref(t, "theme-light");
		dark[varName(t)] = ref(t, "theme-dark");
	}
}

// ---------- shadcn slots (both schemes point at the same roles) ----------

const shadcn: Scope = {
	"--background": "var(--bg-layer-basement)",
	"--foreground": "var(--fg-neutral)",
	"--card": "var(--bg-layer-default)",
	"--card-foreground": "var(--fg-neutral)",
	"--popover": "var(--bg-layer-floating)",
	"--popover-foreground": "var(--fg-neutral)",
	"--primary": "var(--bg-brand-solid)",
	"--primary-foreground": "var(--palette-static-white)",
	"--secondary": "var(--bg-neutral-weak)",
	"--secondary-foreground": "var(--fg-neutral)",
	"--muted": "var(--bg-layer-fill)",
	"--muted-foreground": "var(--fg-neutral-subtle)",
	"--accent": "var(--bg-transparent-pressed)",
	"--accent-foreground": "var(--fg-neutral)",
	"--destructive": "var(--bg-critical-solid)",
	"--destructive-foreground": "var(--palette-static-white)",
	"--border": "var(--stroke-neutral-muted)",
	"--input": "var(--stroke-neutral-weak)",
	"--ring": "var(--stroke-focus-ring)",
	"--chart-1": "var(--palette-carrot-600)",
	"--chart-2": "var(--palette-blue-600)",
	"--chart-3": "var(--palette-green-600)",
	"--chart-4": "var(--palette-yellow-500)",
	"--chart-5": "var(--palette-purple-600)",
	"--sidebar": "var(--bg-layer-default)",
	"--sidebar-foreground": "var(--fg-neutral)",
	"--sidebar-primary": "var(--bg-brand-solid)",
	"--sidebar-primary-foreground": "var(--palette-static-white)",
	"--sidebar-accent": "var(--bg-transparent-pressed)",
	"--sidebar-accent-foreground": "var(--fg-neutral)",
	"--sidebar-border": "var(--stroke-neutral-muted)",
	"--sidebar-ring": "var(--stroke-focus-ring)",
};
Object.assign(root, shadcn);
Object.assign(dark, shadcn);

// SEED CSS order (--seed-font-family). Pretendard is loaded from jsDelivr like seed-design.io (imports below),
// so platforms without Apple faces render Pretendard, as the docs previews do.
const fontStack = `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard Variable", Pretendard, "Noto Sans KR", "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`;
const shadows = ["s1", "s2", "s3"].map((s) => `$shadow.${s}`);
Object.assign(root, {
	"--font-sans": fontStack,
	"--radius": literal("$radius.r3", "default"),
	"--shadow-2xs": "var(--shadow-s1)",
	"--shadow-xs": "var(--shadow-s1)",
	"--shadow-sm": "var(--shadow-s1)",
	"--shadow": "var(--shadow-s2)",
	"--shadow-md": "var(--shadow-s2)",
	"--shadow-lg": "var(--shadow-s3)",
	"--shadow-xl": "var(--shadow-s3)",
	"--shadow-2xl": "var(--shadow-s3)",
	"--spacing": "0.25rem",
});

// ---------- foundation scales ----------

note("projectPrimitives", "--shadow-s1", "Elevation ($shadow.s1 … s3); .dark redeclares the heavier theme-dark shadows");
note("dark", "--shadow-s1", "SEED theme-dark shadows");
for (const s of shadows) {
	prims[varName(s)] = literal(s, "theme-light");
	dark[varName(s)] = literal(s, "theme-dark");
}

const radii = Object.keys(radius.data.tokens);
note("projectPrimitives", varName(radii[0]), "Radius scale ($radius.r0_5 … r6, full). --radius is r3 (12px), so shadcn sm/md/lg/xl land on r2 / r2_5 / r3 / r4.");
for (const r of radii) prims[varName(r)] = literal(r, "default");

note("projectPrimitives", "--spacing-global-gutter", "Spacing roles ($dimension.spacing-x / spacing-y). The 4px grid itself is Tailwind's --spacing.");
for (const t of Object.keys(dimension.data.tokens).filter((t) => t.includes(".spacing-")))
	prims[`--spacing-${t.split(".").pop()}`] = literal(t, "default");

note("projectPrimitives", "--dimension-x0-5", "Dimension scale ($dimension.x0_5 … x16). Component snippets read these exactly as SEED recipes do.");
for (const t of Object.keys(dimension.data.tokens).filter((t) => !t.includes(".spacing-"))) prims[varName(t)] = literal(t, "default");

note("projectPrimitives", "--duration-d1", "Motion ($duration.*, $timing-function.*, $scale.* pressed feedback)");
for (const t of Object.keys(duration.data.tokens)) prims[varName(t)] = literal(t, "default");
for (const t of Object.keys(easing.data.tokens)) prims[`--ease-${t.split(".").pop()}`] = literal(t, "default");
for (const t of Object.keys(scale.data.tokens)) prims[varName(t)] = String(all[t].preferred.value);
prims["--sidebar-collapse-duration"] = "var(--duration-d6)";
prims["--sidebar-collapse-ease"] = "var(--ease-easing)";

note("projectPrimitives", "--feedback-scale", "Pressed scale feedback (base.css): 1 at rest; .seed-scale-feedback derives (h - 2) / h from --seed-element-height set by components/scale-feedback.ts. Safe areas for sheets and bottom bars.");
Object.assign(prims, {
	"--feedback-scale": "1",
	"--feedback-scale-transition": "scale var(--duration-pressed-scale) var(--ease-pressed-scale)",
	"--safe-area-top": "env(safe-area-inset-top, 0px)",
	"--safe-area-bottom": "env(safe-area-inset-bottom, 0px)",
	// base.css: how far rem type may scale from its -static px value (clamp bounds; iOS narrows max to 1.35)
	"--font-size-limit-min": "0.8",
	"--font-size-limit-max": "1.5",
	"--line-height-limit-min": "0.8",
	"--line-height-limit-max": "1.5",
});

note("projectPrimitives", "--gradient-fade-mask", "Gradients (stop lists; wrap in linear-gradient(<angle>, …))");
note("dark", "--gradient-fade-mask", "SEED theme-dark gradients");
for (const t of Object.keys(gradient.data.tokens)) {
	prims[varName(t)] = literal(t, "theme-light");
	const dk = literal(t, "theme-dark");
	if (dk !== prims[varName(t)]) dark[varName(t)] = dk;
}

note("projectPrimitives", "--breakpoint-sm", "Viewport widths (css/breakpoints): base 0, sm 480, md 768, lg 1280, xl 1440");
Object.assign(prims, { "--breakpoint-sm": "480px", "--breakpoint-md": "768px", "--breakpoint-lg": "1280px", "--breakpoint-xl": "1440px" });

// ---------- type scale (runtime values; @theme only points at them) ----------

const steps = Array.from({ length: 14 }, (_, i) => `t${i + 1}`);
note("projectPrimitives", "--text-t1", "Type scale t1 … t14 ($font-size / $line-height). rem steps follow the user's font scale (SEED clamps them at 0.8 … 1.5x); -static steps are fixed px.");
for (const s of steps) {
	prims[`--text-${s}`] = literal(`$font-size.${s}`, "default");
	prims[`--text-${s}--line-height`] = literal(`$line-height.${s}`, "default");
}
for (const s of steps) {
	prims[`--text-${s}-static`] = literal(`$font-size.${s}-static`, "default");
	prims[`--text-${s}-static--line-height`] = literal(`$line-height.${s}-static`, "default");
}
const W = { regular: "400", medium: "500", bold: "700" };
Object.assign(prims, { "--font-weight-regular": W.regular, "--font-weight-medium": W.medium, "--font-weight-bold": W.bold });

// Roles: SEED textStyle names where one exists, otherwise the component default that owns the size.
const roles: [string, string, string, string, string][] = [
	["--text-title", "t10", "t10", W.bold, "screenTitle"],
	["--text-heading-lg", "t8", "t8", W.bold, "Dialog / BottomSheet title"],
	["--text-heading", "t6", "t6", W.bold, "TopNavigation title"],
	["--text-heading-sm", "t5", "t5", W.bold, "Tab, SegmentedControl, FieldLabel bold"],
	["--text-article", "t5", "t6", W.regular, "articleBody"],
	["--text-body", "t5", "t5", W.regular, "ListItem title, TextInput large, MenuItem"],
	["--text-note", "t4", "t5", W.regular, "articleNote"],
	["--text-body-sm", "t4", "t4", W.regular, "TextInput medium, Snackbar, Callout"],
	["--text-label", "t4", "t4", W.medium, "Chip / ControlChip, ListHeader"],
	["--text-control", "t4", "t4", W.bold, "ActionButton small / medium"],
	["--text-control-lg", "t6", "t6", W.bold, "ActionButton large"],
	["--text-control-xs", "t3", "t3", W.bold, "ActionButton xsmall"],
	["--text-caption", "t3", "t3", W.regular, "ListItem detail, MenuItem description"],
	["--text-caption-sm", "t2", "t2", W.regular, "TopNavigation subtitle, Badge large"],
	["--text-micro", "t1", "t1", W.bold, "Badge medium"],
];
note("projectPrimitives", roles[0][0], "Type roles: SEED textStyle (screenTitle / articleBody / articleNote) + component label defaults");
for (const [name, size, lh, weight] of roles) {
	prims[name] = `var(--text-${size})`;
	prims[`${name}--line-height`] = `var(--text-${lh}--line-height)`;
	prims[`${name}--font-weight`] = weight;
}

// ---------- component geometry ----------

const g = geo;
const control = {
	"--control-height-xs": await g("action-button", "size=xsmall", "root.minHeight"),
	"--control-height-sm": await g("action-button", "size=small", "root.minHeight"),
	"--control-height": await g("action-button", "size=medium", "root.minHeight"),
	"--control-height-lg": await g("action-button", "size=large", "root.minHeight"),
	"--control-radius-xs": await g("action-button", "size=xsmall", "root.cornerRadius"),
	"--control-radius-sm": await g("action-button", "size=small", "root.cornerRadius"),
	"--control-radius": await g("action-button", "size=medium", "root.cornerRadius"),
	"--control-radius-lg": await g("action-button", "size=large", "root.cornerRadius"),
	"--control-padding-inline-sm": await g("action-button", "size=small,layout=withText", "root.paddingX"),
	"--control-padding-inline": await g("action-button", "size=medium,layout=withText", "root.paddingX"),
	"--control-padding-inline-lg": await g("action-button", "size=large,layout=withText", "root.paddingX"),
	"--control-gap": await g("action-button", "size=medium,layout=withText", "root.gap"),
	"--control-icon": await g("action-button", "size=medium,layout=withText", "prefixIcon.size"),
	"--control-icon-lg": await g("action-button", "size=large,layout=withText", "prefixIcon.size"),
	"--control-stroke-width": await g("action-button", "variant=neutralOutline", "root.strokeWidth"),
};
note("projectPrimitives", "--control-height-xs", "ActionButton xsmall 32 (pill) / small 36 / medium 40 / large 52; label bold");
Object.assign(prims, control);

note("projectPrimitives", "--field-height", "TextInput / SelectTrigger outline: medium 40 r8, large 52 r12; stroke 1px → 2px on focus / invalid");
Object.assign(prims, {
	"--field-height": await g("text-input", "variant=outline,size=medium", "root.minHeight"),
	"--field-height-lg": await g("text-input", "variant=outline,size=large", "root.minHeight"),
	"--field-radius": await g("text-input", "variant=outline,size=medium", "root.cornerRadius"),
	"--field-radius-lg": await g("text-input", "variant=outline,size=large", "root.cornerRadius"),
	"--field-padding-inline": await g("text-input", "variant=outline,size=medium", "root.paddingX"),
	"--field-padding-inline-lg": await g("text-input", "variant=outline,size=large", "root.paddingX"),
	"--field-stroke-width": await g("text-input", "variant=outline", "root.strokeWidth"),
	"--field-stroke-width-focus": format(await spec("text-input", "variant=outline", "root.strokeWidth", "focused"), "default"),
	"--field-multiline-height": await g("text-input", "type=multiline,size=medium", "root.minHeight"),
	"--field-gap": await g("field", "", "root.gap"),
});

note("projectPrimitives", "--chip-height-sm", "Chip small 32 / medium 36 / large 40, pill; ControlChip / ActionChip 32 / 36");
Object.assign(prims, {
	"--chip-height-sm": await g("chip", "size=small", "root.height"),
	"--chip-height": await g("chip", "size=medium", "root.height"),
	"--chip-height-lg": await g("chip", "size=large", "root.height"),
	"--chip-padding-inline": await g("control-chip", "size=small,layout=withText", "root.paddingX"),
	"--chip-padding-inline-md": await g("control-chip", "size=medium,layout=withText", "root.paddingX"),
	"--chip-gap": "var(--spacing-between-chips)",
});

note("projectPrimitives", "--list-row-padding-y", "ListItem: 12px block, --spacing-global-gutter inline; pressed paints a r10 pill inset 6px");
Object.assign(prims, {
	"--list-row-padding-y": await g("list-item", "", "root.paddingY"),
	"--list-row-padding-x": await g("list-item", "", "root.paddingX"),
	"--list-row-gap": await g("list-item", "", "body.gap"),
	"--list-row-pressed-inset": literal("$dimension.x1_5", "default"),
	"--list-row-pressed-radius": literal("$dimension.x2_5", "default"),
	"--list-header-padding-y": await g("list-header", "", "root.paddingY"),
});

note("projectPrimitives", "--tab-height", "Tabs: medium 44 / small 40, 2px indicator; SegmentedControl 4px track, 34 items, pill");
Object.assign(prims, {
	"--tab-height": await g("tablist", "size=medium", "root.height"),
	"--tab-height-sm": await g("tablist", "size=small", "root.height"),
	"--tab-padding-inline": await g("tab", "size=medium", "root.paddingX"),
	"--tab-indicator-height": await g("tablist", "", "indicator.height"),
	"--segmented-padding": await g("segmented-control", "", "root.padding"),
	"--segmented-item-height": await g("segmented-control-item", "", "root.minHeight"),
	"--segmented-item-padding-inline": await g("segmented-control-item", "", "root.paddingX"),
	"--top-nav-height": await g("top-navigation", "", "root.height"),
	"--top-nav-padding-inline": await g("top-navigation", "", "root.paddingX"),
});

note("projectPrimitives", "--switch-width", "Selection marks: Switch 52x32 (thumb 26, 3px inset); Checkbox / Radio 20 medium, 24 large, r4");
Object.assign(prims, {
	"--switch-width": await g("switchmark", "size=32", "root.width"),
	"--switch-height": await g("switchmark", "size=32", "root.height"),
	"--switch-thumb": await g("switchmark", "size=32", "thumb.width"),
	"--switch-inset": await g("switchmark", "size=32", "root.paddingX"),
	"--switch-width-sm": await g("switchmark", "size=24", "root.width"),
	"--switch-height-sm": await g("switchmark", "size=24", "root.height"),
	"--switch-thumb-sm": await g("switchmark", "size=24", "thumb.width"),
	"--checkbox-size": await g("checkmark", "size=medium", "root.size"),
	"--checkbox-size-lg": await g("checkmark", "size=large", "root.size"),
	"--checkbox-radius": await g("checkmark", "size=medium", "root.cornerRadius"),
});

note("projectPrimitives", "--badge-height", "Badge medium 20 (r4, 6px) / large 24 (r6, 8px)");
Object.assign(prims, {
	"--badge-height": await g("badge", "size=medium", "root.minHeight"),
	"--badge-radius": await g("badge", "size=medium", "root.cornerRadius"),
	"--badge-padding-inline": await g("badge", "size=medium", "root.paddingX"),
	"--badge-height-lg": await g("badge", "size=large", "root.minHeight"),
	"--badge-radius-lg": await g("badge", "size=large", "root.cornerRadius"),
	"--badge-padding-inline-lg": await g("badge", "size=large", "root.paddingX"),
});

note("projectPrimitives", "--dialog-radius", "Overlays: Dialog r20 max 480, AlertDialog 272, BottomSheet top r24 max 480, Menu r20 240 / s3, Snackbar r8");
Object.assign(prims, {
	"--dialog-radius": await g("dialog", "", "content.cornerRadius"),
	"--dialog-width": await g("dialog", "size=medium", "content.maxWidth"),
	"--dialog-width-lg": await g("dialog", "size=large", "content.maxWidth"),
	"--dialog-padding": await g("dialog", "", "header.paddingX"),
	"--alert-dialog-width": await g("alert-dialog", "", "content.maxWidth"),
	"--alert-dialog-padding": await g("alert-dialog", "", "header.paddingX"),
	"--sheet-radius": await g("bottom-sheet", "", "content.topCornerRadius"),
	"--sheet-width": await g("bottom-sheet", "", "content.maxWidth"),
	"--menu-radius": await g("menu", "", "root.cornerRadius"),
	"--menu-width": await g("menu", "size=medium", "root.width"),
	"--menu-width-sm": await g("menu", "size=small", "root.width"),
	"--menu-padding-y": await g("menu", "", "root.paddingY"),
	"--menu-item-padding-x": await g("menu-item", "size=medium", "root.paddingX"),
	"--menu-item-padding-y": await g("menu-item", "size=medium", "root.paddingY"),
	"--menu-item-padding-y-sm": await g("menu-item", "size=small", "root.paddingY"),
	"--snackbar-radius": await g("snackbar", "", "root.cornerRadius"),
	"--snackbar-height": await g("snackbar", "", "root.minHeight"),
	"--snackbar-width": await g("snackbar", "", "root.maxWidth"),
	"--callout-radius": await g("callout", "", "root.cornerRadius"),
	"--callout-padding": await g("callout", "", "root.paddingX"),
	"--hairline-width": await g("divider", "", "root.thickness"),
	"--content-narrow": await g("bottom-sheet", "", "content.maxWidth"),
});

// Component colour roles that are not already a shadcn slot.
note("projectPrimitives", "--field-stroke", "Component colour roles (SEED component specs, never a palette literal)");
Object.assign(prims, {
	"--field-stroke": await tone("text-input", "", "root.strokeColor"),
	"--field-stroke-focus": await tone("text-input", "", "root.strokeColor", "focused"),
	"--field-stroke-invalid": await tone("text-input", "", "root.strokeColor", "invalid"),
	"--field-placeholder": await tone("text-input", "", "placeholder.color"),
	"--overlay-dim": await tone("dialog", "", "backdrop.color"),
	"--chip-fill": await tone("chip", "variant=solid", "root.color"),
	"--chip-fill-pressed": await tone("chip", "variant=solid", "root.color", "pressed"),
	"--chip-fill-selected": await tone("chip", "variant=solid", "root.color", "selected"),
	"--chip-ink-selected": await tone("chip", "variant=solid", "label.color", "selected"),
	"--tab-ink": await tone("tab", "", "label.color"),
	"--tab-ink-selected": await tone("tab", "", "label.color", "selected"),
	"--tab-indicator": await tone("tablist", "", "indicator.color"),
	"--segmented-track": await tone("segmented-control", "", "root.color"),
	"--segmented-thumb": await tone("segmented-control-indicator", "", "root.color"),
	"--switch-track": await tone("switchmark", "", "root.color"),
	"--list-row-pressed": await tone("list-item", "", "root.color", "pressed"),
	"--list-row-highlight": await tone("list-item", "", "root.color", "highlighted"),
	"--snackbar-fill": await tone("snackbar", "", "root.color"),
	"--snackbar-ink": await tone("snackbar", "", "message.color"),
	"--snackbar-action": await tone("snackbar", "", "actionButton.color"),
});
// Roles that alias palette steps flip in .dark only when redeclared there.
for (const k of ["--segmented-thumb", "--switch-track"]) dark[k] = prims[k];

// ---------- @theme inline utilities ----------

note("projectUtilities", "--color-fg-neutral", "SEED role utilities (same names as @seed-design/tailwind4-theme: text-fg-neutral, bg-bg-layer-default, border-stroke-neutral-muted)");
for (const t of tokens.filter((t) => !t.startsWith("$color.palette."))) utils[`--color-${varName(t).slice(2)}`] = `var(${varName(t)})`;
note("projectUtilities", `--color-${varName(palette[0]).slice(2)}`, "Palette utilities (bg-palette-carrot-600). Prefer a role.");
for (const t of palette) utils[`--color-${varName(t).slice(2)}`] = `var(${varName(t)})`;
utils["--color-overlay-dim"] = "var(--overlay-dim)";
utils["--color-field-stroke"] = "var(--field-stroke)";
utils["--color-field-placeholder"] = "var(--field-placeholder)";

note("projectUtilities", varName(radii[0]), "Radius utilities (rounded-r2 …)");
for (const r of radii) utils[varName(r)] = `var(${varName(r)})`;
note("projectUtilities", "--ease-easing", "Motion utilities (ease-enter, duration via --duration-*)");
for (const t of Object.keys(easing.data.tokens)) utils[`--ease-${t.split(".").pop()}`] = `var(--ease-${t.split(".").pop()})`;
note("projectUtilities", "--spacing-global-gutter", "Spacing utilities (px-global-gutter, gap-between-chips)");
for (const t of Object.keys(dimension.data.tokens).filter((t) => t.includes(".spacing-"))) {
	const n = `--spacing-${t.split(".").pop()}`;
	utils[n] = `var(${n})`;
}
note("projectUtilities", "--text-t1", "Type scale + roles: text-t5, text-title, text-body … (runtime values live in :root)");
for (const s of steps) {
	utils[`--text-${s}`] = `var(--text-${s})`;
	utils[`--text-${s}--line-height`] = `var(--text-${s}--line-height)`;
}
for (const [name] of roles) {
	utils[name] = `var(${name})`;
	utils[`${name}--line-height`] = `var(${name}--line-height)`;
	utils[`${name}--font-weight`] = `var(${name}--font-weight)`;
}
utils["--font-heading"] = "var(--font-sans)";

// root (shadcn + fonts/radius/shadows) + primitives → spec
const out = {
	slug: "daangn",
	liveUrl: "https://github.com/daangn/seed-design (packages/rootage)",
	imports: [
		'@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css");',
		'@import "tailwindcss";', '@import "tw-animate-css";', '@import "shadcn-svelte/tailwind.css";'],
	root,
	dark,
	projectPrimitives: prims,
	projectUtilities: utils,
	comments,
};
await Bun.write(resolve(theme, "spec.json"), `${JSON.stringify(out, null, "\t")}\n`);
console.log(`${resolve(theme, "spec.json")}: root ${Object.keys(root).length}, primitives ${Object.keys(prims).length}, dark ${Object.keys(dark).length}, utilities ${Object.keys(utils).length}`);
