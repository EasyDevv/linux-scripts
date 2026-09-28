export type PageId = "button" | "components" | "foundation";

export type NavEntry = { label: string; page?: PageId; id?: string };
export type NavGroup = { title: string; items: NavEntry[] };

/** Sidebar IA copied from the live docs nav (tossmini-docs.toss.im). */
export const NAV: NavGroup[] = [
	{ title: "", items: [{ label: "소개" }, { label: "시작하기" }] },
	{
		title: "파운데이션",
		items: [{ label: "Colors", page: "foundation" }, { label: "Typography", page: "foundation" }],
	},
	{
		title: "컴포넌트",
		items: [
			{ label: "Badge", id: "badge" },
			{ label: "Board Row", id: "board-row" },
			{ label: "Bottom Sheet", id: "bottom-sheet" },
			{ label: "Button", page: "button" },
			{ label: "Checkbox", id: "checkbox" },
			{ label: "Grid List", id: "grid-list" },
			{ label: "Icon Button", id: "icon-button" },
			{ label: "List Footer", id: "list-footer" },
			{ label: "List Header", id: "list-header" },
			{ label: "Paragraph", id: "paragraph" },
			{ label: "Search Field", id: "search-field" },
			{ label: "Segmented Control", id: "segmented-control" },
			{ label: "Stepper", id: "stepper" },
			{ label: "Switch", id: "switch" },
			{ label: "Tab", id: "tab" },
			{ label: "Text Button", id: "text-button" },
			{ label: "TextField", id: "text-field" },
		],
	},
];

/** TDS Button usage examples, transcribed from /components/button/ prose tables. */
export const BUTTON_SECTIONS = [
	{ id: "fill", title: "fill", rows: [{ label: "fill", tone: "fill" as const }] },
	{
		id: "weak",
		title: "weak",
		rows: [
			{ label: "weak", tone: "weak" as const },
			{ label: "weak + disabled", tone: "weak" as const, disabled: true },
		],
	},
	{
		id: "size",
		title: "크기",
		rows: [
			{ label: "Small", size: "small" as const },
			{ label: "Medium", size: "medium" as const },
			{ label: "Large", size: "large" as const },
		],
	},
	{
		id: "danger",
		title: "danger",
		rows: [
			{ label: "danger", tone: "danger" as const },
			{ label: "danger + weak", tone: "danger-weak" as const },
		],
	},
];
