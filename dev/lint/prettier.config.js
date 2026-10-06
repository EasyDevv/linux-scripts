// Shared formatting for every project; mirrors the former Biome style (tabs, 120 columns, double quotes).
import { fileURLToPath } from "node:url";

export default {
	useTabs: true,
	printWidth: 120,
	plugins: [fileURLToPath(import.meta.resolve("prettier-plugin-svelte"))],
	overrides: [{ files: "*.svelte", options: { parser: "svelte" } }],
};
