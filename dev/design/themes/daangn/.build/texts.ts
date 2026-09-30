// Print the leaf texts (and their seed class) of live census previews, for exact example content.
//   bun themes/daangn/.build/texts.ts <page> [index,...] [--scheme light]
export {};
const [page, which] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const scheme = process.argv.includes("--scheme") ? process.argv[process.argv.indexOf("--scheme") + 1] : "light";
const data = await Bun.file(new URL(`../../../ref/seed-design.io/census/${scheme}/${page}.json`, import.meta.url)).json();
const pick = which ? which.split(",").map(Number) : data.previews.map((p: { index: number }) => p.index);
for (const i of pick) {
	const p = data.previews[i];
	const texts = p.nodes
		.filter((n: { text: string }) => n.text)
		.map((n: { cls: string; text: string; box: number[] }) => `${n.cls.split(" ")[0].replace("seed-", "")}:"${n.text}"(${n.box[2]})`);
	console.log(`#${i} ${p.heading} [${p.rect[2]}x${p.rect[3]}] ${texts.join("  ")}`);
}
