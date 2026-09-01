import { basename, dirname, resolve } from "node:path";

const markerStart = "<!-- draft-data -->";
const markerEnd = "<!-- /draft-data -->";

type Price = {
	kind: "sale" | "jeonse" | "monthly" | "rent" | string;
	prefix: string;
	amount: string;
	unit?: string;
};

type Unit = {
	identity: string;
	dong?: string;
	icon?: string;
	favorite?: boolean;
	important?: boolean;
	status: string;
	tags?: string[];
	spec?: string;
	memo?: string;
	updated?: string;
	prices?: Price[];
};

type Building = {
	name: string;
	road?: string;
	jibun?: string;
	neighborhood?: string;
	useType?: string;
	facts?: string;
	ageYears?: number;
	parking?: string;
	units: Unit[];
};

type Listings = {
	lede?: string;
	buildings: Building[];
};

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function allUnits(data: Listings) {
	return data.buildings.flatMap((building) =>
		building.units.map((unit) => ({ building, unit })),
	);
}

function filters(data: Listings) {
	const rows = allUnits(data);
	return [
		{ label: "전체", count: rows.length, current: true },
		{
			label: "공실",
			count: rows.filter(({ unit }) => unit.status === "공실").length,
		},
		{
			label: "만기",
			count: rows.filter(({ unit }) =>
				(unit.tags ?? []).some((tag) => tag.startsWith("D-")),
			).length,
		},
		{
			label: "즐겨찾기",
			count: rows.filter(({ unit }) => unit.favorite).length,
		},
	].filter((item) => item.count > 0 || item.current);
}

function priceHtml(price: Price, unitClass: string) {
	const unit = price.unit
		? `<span class="${unitClass}">${escapeHtml(price.unit)}</span>`
		: "";
	return `${escapeHtml(price.prefix)} ${escapeHtml(price.amount)}${unit}`;
}

function chipClass(tag: string) {
	if (tag === "공실") return "chip ok";
	if (tag === "NEW") return "chip new";
	if (tag.startsWith("D-")) return "chip due";
	return "chip";
}

function lucide(name: string, className = "size-4 shrink-0") {
	return `<iconify-icon icon="lucide:${name}" class="${className}"></iconify-icon>`;
}

function parseSpec(spec?: string) {
	return {
		pyeong: spec?.match(/(\d+(?:\.\d+)?)평/)?.[1],
		rooms: spec?.match(/방(\d+)/)?.[1],
		baths: spec?.match(/욕(\d+)/)?.[1],
	};
}

function statusTone(label: string) {
	if (label === "공실" || label === "NEW") return "text-primary";
	if (label.startsWith("D-")) return "text-destructive";
	return "text-muted-foreground";
}

function statusIcon(label: string) {
	if (label === "공실") return "circle-check";
	if (label === "세입자") return "user";
	if (label === "주인거주") return "house";
	if (label === "통임대") return "key-round";
	if (label === "NEW") return "sparkles";
	if (label === "올수리") return "hammer";
	if (label.startsWith("D-")) return "clock";
	return "tag";
}

function factItems(building: Building) {
	const items: Array<{ icon: string; text: string }> = [];
	if (building.useType) items.push({ icon: "building-2", text: building.useType });
	if (building.ageYears !== undefined) {
		items.push({ icon: "calendar", text: `${building.ageYears}년` });
	}
	const households = building.facts?.match(/(\d+)세대/)?.[1];
	if (households) items.push({ icon: "users", text: `${households}세대` });
	if (building.parking) {
		items.push({ icon: "car", text: `주차 ${building.parking}` });
	}
	const elevator = building.facts?.match(/승강기\s*([^·]+)/)?.[1]?.trim();
	if (elevator) items.push({ icon: "arrow-up-down", text: `승강기 ${elevator}` });
	return items;
}

function renderBuildingGroup(data: Listings) {
	const filterHtml = filters(data)
		.map(
			(item) =>
				`<span class="rounded-full px-2.5 py-1 text-body-base text-muted-foreground aria-[current=true]:bg-secondary aria-[current=true]:text-foreground"${item.current ? ' aria-current="true"' : ""}>${escapeHtml(item.label)} ${item.count}</span>`,
		)
		.join("\n      ");

	const cards = data.buildings
		.map((building, buildingIndex) => {
			const address = [building.road, building.jibun].filter(Boolean).join(" · ");
			const facts = factItems(building)
				.map(
					(item) =>
						`<span class="inline-flex items-center gap-1 text-body-base text-muted-foreground">${lucide(item.icon, "size-5 shrink-0")}<span>${escapeHtml(item.text)}</span></span>`,
				)
				.join("");
			const rows = building.units
				.map((unit, unitIndex) => {
					const roles = buildingIndex === 0 && unitIndex === 0;
					const spec = parseSpec(unit.spec);
					const marks = [
						unit.favorite
							? `<span class="text-primary" title="즐겨찾기"${roles ? " data-role=\"icon\"" : ""}>${lucide("star", "size-6 shrink-0")}</span>`
							: "",
						unit.important
							? `<span class="text-destructive" title="중요">${lucide("bookmark", "size-5 shrink-0")}</span>`
							: "",
					]
						.filter(Boolean)
						.join("");
					const identity = `<p class="m-0 text-lg font-semibold tracking-tight"${roles ? ' data-role="identity"' : ""}>${escapeHtml(unit.identity)}</p>`;
					const dong = unit.dong
						? `<p class="m-0 text-body-base text-muted-foreground">${escapeHtml(unit.dong)}</p>`
						: "";
					const statusBits = [unit.status, ...(unit.tags ?? [])].filter(Boolean);
					const status = statusBits
						.map((label, index) => {
							const tone = statusTone(label);
							return `<span class="inline-flex items-center gap-1 text-body-base font-medium ${tone}"${roles && index === 0 ? ' data-role="chip"' : ""}>${lucide(statusIcon(label))}<span>${escapeHtml(label)}</span></span>`;
						})
						.join("");
					const amenities = [
						spec.pyeong
							? `${lucide("square", "size-5 shrink-0")} ${escapeHtml(spec.pyeong)}평`
							: "",
						spec.rooms
							? `${lucide("door-closed", "size-5 shrink-0")} 방 ${escapeHtml(spec.rooms)}`
							: "",
						spec.baths
							? `${lucide("bath", "size-5 shrink-0")} 욕 ${escapeHtml(spec.baths)}`
							: "",
					]
						.filter(Boolean)
						.map(
							(item) =>
								`<span class="inline-flex items-center gap-1 text-body-base text-muted-foreground">${item}</span>`,
						)
						.join(`<span class="text-muted-foreground/50">·</span>`);
					const memo = unit.memo
						? `<p class="mt-1.5 m-0 text-body-base text-muted-foreground"${roles ? ' data-role="body"' : ""}>${escapeHtml(unit.memo)}</p>`
						: "";
					const prices = (unit.prices ?? [])
						.map((price, index) => {
							return `<span class="text-base font-medium tabular-nums"${roles && index === 0 ? ' data-role="price"' : ""}>${priceHtml(price, "text-[0.7em] font-medium opacity-70")}</span>`;
						})
						.join("");
					return `<li class="grid gap-4 px-4 py-4 md:grid-cols-[8rem_1fr_auto] md:items-center">
            <div class="flex gap-3">
              ${marks}
              <div>
                ${identity}
                ${dong}
              </div>
            </div>
            <div class="flex gap-6 items-start">
              <div class="flex shrink-0 flex-col gap-1.5">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  ${status}
                </div>
                ${amenities ? `<div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">${amenities}</div>` : ""}
              </div>
              <div class="min-w-0 flex-1">
                ${memo}
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              ${prices}
            </div>
          </li>`
				})
				.join("\n");
			return `<section class="overflow-hidden rounded-lg border border-border bg-card">
        <header class="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <h2 class="m-0 text-heading-sm"${buildingIndex === 0 ? ' data-role="group"' : ""}>${escapeHtml(building.name)}</h2>
            ${address ? `<p class="mt-1 m-0 inline-flex items-center gap-1 text-body-base text-muted-foreground"${buildingIndex === 0 ? ' data-role="muted"' : ""}>${lucide("map-pin")}<span>${escapeHtml(address)}</span></p>` : ""}
          </div>
          ${facts ? `<div class="flex flex-wrap justify-end gap-x-3 gap-y-1">${facts}</div>` : ""}
        </header>
        <ul class="m-0 list-none divide-y divide-border p-0">
          ${rows}
        </ul>
      </section>`;
		})
		.join("\n\n      ");

	const lede = data.lede
		? `<p class="mb-4 inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-body-base text-muted-foreground">${lucide("clock")}<span>${escapeHtml(data.lede)}</span></p>`
		: "";
	return `${lede}

    <div class="mb-4 flex flex-wrap gap-2">
      ${filterHtml}
    </div>

    <div class="flex flex-col gap-3">
      ${cards}
    </div>`;
}

function renderEditorialScan(data: Listings) {
	const articles = allUnits(data)
		.map(({ building, unit }) => {
			const where = unit.dong
				? `${unit.dong} ${unit.identity} · ${building.neighborhood ?? ""}`
				: `${unit.identity} · ${building.neighborhood ?? building.jibun ?? ""}`;
			const chips = [
				building.useType
					? `<span class="chip">${escapeHtml(building.useType)}</span>`
					: "",
				unit.status
					? `<span class="${chipClass(unit.status)}">${escapeHtml(unit.status)}</span>`
					: "",
				...(unit.tags ?? []).map(
					(tag) =>
						`<span class="${chipClass(tag)}">${escapeHtml(tag)}</span>`,
				),
				unit.spec ? `<span>${escapeHtml(unit.spec)}</span>` : "",
			]
				.filter(Boolean)
				.join("");
			const foot = [
				unit.favorite ? "★" : "",
				unit.important ? "중요" : "",
				building.ageYears !== undefined ? `${building.ageYears}년` : "",
				building.parking ? `주차 ${building.parking}` : "",
				unit.updated ?? "",
			]
				.filter(Boolean)
				.join(" · ");
			const prices = (unit.prices ?? [])
				.map(
					(price) =>
						`<b class="${escapeHtml(price.kind)}">${priceHtml(price, "u")}</b>`,
				)
				.join("");
			return `<article>
        <div class="who">
          <h2>${escapeHtml(building.name)}</h2>
          <p class="unit">${escapeHtml(where.trim().replace(/ · $/, ""))}</p>
          <div class="meta">
            ${chips}
          </div>
          ${unit.memo ? `<p class="memo">${escapeHtml(unit.memo)}</p>` : ""}
          ${foot ? `<p class="foot">${escapeHtml(foot)}</p>` : ""}
        </div>
        <div class="pay">
          ${prices}
        </div>
      </article>`;
		})
		.join("\n\n      ");
	return `<section class="feed">
      ${articles}
    </section>`;
}

function layoutFor(file: string, html: string) {
	if (/building-group/.test(file)) {
		return "building-group";
	}
	if (/editorial/.test(file) || html.includes('class="feed"')) {
		return "editorial-scan";
	}
	return null;
}

export async function renderDraftData(draftsRoot: string) {
	const htmlGlob = new Bun.Glob("**/*.html");
	const skipped = /(^|\/)(index\.html|archive\/)/;
	let count = 0;
	for await (const rel of htmlGlob.scan({ cwd: draftsRoot, onlyFiles: true })) {
		if (skipped.test(rel) || dirname(rel) === ".") continue;
		const abs = resolve(draftsRoot, rel);
		const dataPath = resolve(draftsRoot, dirname(rel), "data/listings.json");
		if (!(await Bun.file(dataPath).exists())) continue;
		const prev = await Bun.file(abs).text();
		let html = prev;
		const layout = layoutFor(basename(rel), html);
		if (!layout) continue;
		const data = (await Bun.file(dataPath).json()) as Listings;
		const body =
			layout === "building-group"
				? renderBuildingGroup(data)
				: renderEditorialScan(data);
		const block = `${markerStart}\n    ${body}\n    ${markerEnd}`;
		if (html.includes(markerStart) && html.includes(markerEnd)) {
			html = html.replace(
				new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`),
				block,
			);
		} else {
			html = html.replace(
				/<main>([\s\S]*?)<\/main>/,
				`<main>\n    $1\n    ${block}\n  </main>`,
			);
		}
		if (html === prev) continue;
		await Bun.write(abs, html);
		count += 1;
	}
	return count;
}

if (import.meta.main) {
	const root = resolve(
		Bun.argv.includes("--root")
			? Bun.argv[Bun.argv.indexOf("--root") + 1]
			: ".",
	);
	const count = await renderDraftData(resolve(root, ".draft"));
	process.stdout.write(`rendered data into ${count} drafts\n`);
}
