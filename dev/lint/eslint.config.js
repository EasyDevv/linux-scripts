// Shared lint for every project: generic JS/TS/Svelte rules plus the shadcn design-system rules.
// components/ui is the design-system anchor: never linted or fixed here; the shadcn rules only read it for variants.
import js from "@eslint/js";
import { plugin as shadcn } from "@shadcn/lint";
import { defineConfig } from "eslint/config";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default defineConfig([
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/target/**",
			"**/.svelte-kit/**",
			"**/build/**",
			"**/.output/**",
			"**/.wxt/**",
			"**/coverage/**",
			"**/components/ui/**",
		],
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	{ languageOptions: { globals: { ...globals.browser, ...globals.node } } },
	{
		files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
		languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: [".svelte"] } },
	},
	{ files: ["**/*.{ts,mts,cts,svelte}"], rules: { "no-undef": "off" } },
	{
		files: ["**/*.{js,mjs,cjs,ts,mts,cts,svelte}"],
		plugins: { shadcn },
		settings: {
			shadcn: {
				note: "components/ui is the read-only design-system anchor: use an existing variant, size, or layout class here. If none fits, ask the user before changing components/ui.",
			},
		},
		rules: {
			"shadcn/no-restyle": ["error", { allow: ["layout"] }],
			"shadcn/no-raw-colors": "error",
			"shadcn/no-arbitrary-values": ["error", { allow: ["layout"] }],
			"shadcn/no-inline-styles": "error",
			"shadcn/require-static-classes": "error",
			"shadcn/no-unknown-classes": "warn",
		},
	},
]);
