export type PageId = "foundation" | "button" | "controls" | "inputs" | "lists" | "content" | "overlays" | "feedback";

export type NavEntry = { label: string; page?: PageId; id?: string };
export type NavGroup = { title: string; items: NavEntry[] };

/** Sidebar IA follows the live docs nav (tossmini-docs.toss.im): every TDS Mobile component
 *  route maps to the catalogue page and anchor that renders its snippet. */
export const NAV: NavGroup[] = [
	{ title: "", items: [{ label: "소개" }, { label: "시작하기" }] },
	{
		title: "파운데이션",
		items: [
			{ label: "Colors", page: "foundation", id: "colors" },
			{ label: "Typography", page: "foundation", id: "typography" },
			{ label: "Tokens", page: "foundation", id: "tokens" },
		],
	},
	{
		title: "컴포넌트",
		items: [
			{ label: "Agreement", page: "content", id: "agreement" },
			{ label: "Asset", page: "content", id: "asset" },
			{ label: "Badge", page: "controls", id: "badge" },
			{ label: "BarChart", page: "content", id: "bar-chart" },
			{ label: "Board Row", page: "lists", id: "board-row" },
			{ label: "Border", page: "lists", id: "border" },
			{ label: "Bottom Info", page: "content", id: "bottom-info" },
			{ label: "BottomCTA", page: "feedback", id: "bottom-cta" },
			{ label: "BottomSheet", page: "overlays", id: "bottom-sheet" },
			{ label: "Bubble", page: "content", id: "bubble" },
			{ label: "Button", page: "button" },
			{ label: "Checkbox", page: "controls", id: "checkbox" },
			{ label: "Dialog", page: "overlays", id: "dialog" },
			{ label: "GridList", page: "lists", id: "grid-list" },
			{ label: "Highlight", page: "content", id: "highlight" },
			{ label: "Icon Button", page: "controls", id: "icon-button" },
			{ label: "Keypad", page: "feedback", id: "keypad" },
			{ label: "ListFooter", page: "lists", id: "list-footer" },
			{ label: "ListHeader", page: "lists", id: "list-header" },
			{ label: "ListRow", page: "lists", id: "list-row" },
			{ label: "Loader", page: "feedback", id: "loader" },
			{ label: "Menu", page: "overlays", id: "menu" },
			{ label: "Modal", page: "overlays", id: "modal" },
			{ label: "Numeric Spinner", page: "inputs", id: "numeric-spinner" },
			{ label: "Paragraph", page: "content", id: "paragraph" },
			{ label: "Post", page: "content", id: "post" },
			{ label: "ProgressBar", page: "feedback", id: "progress-bar" },
			{ label: "ProgressStepper", page: "feedback", id: "progress-stepper" },
			{ label: "Rating", page: "inputs", id: "rating" },
			{ label: "Result", page: "content", id: "result" },
			{ label: "SearchField", page: "inputs", id: "search-field" },
			{ label: "Segmented Control", page: "controls", id: "segmented-control" },
			{ label: "Skeleton", page: "feedback", id: "skeleton" },
			{ label: "Slider", page: "inputs", id: "slider" },
			{ label: "Stepper", page: "lists", id: "stepper" },
			{ label: "Switch", page: "controls", id: "switch" },
			{ label: "Tab", page: "controls", id: "tab" },
			{ label: "TableRow", page: "lists", id: "table-row" },
			{ label: "Text Button", page: "controls", id: "text-button" },
			{ label: "TextField", page: "inputs", id: "text-field" },
			{ label: "Toast", page: "overlays", id: "toast" },
			{ label: "Tooltip", page: "overlays", id: "tooltip" },
			{ label: "Top", page: "content", id: "top" },
		],
	},
];

export const PAGE_TITLE: Record<PageId, string> = {
	foundation: "Foundation",
	button: "Button",
	controls: "Controls",
	inputs: "Inputs",
	lists: "Lists",
	content: "Content",
	overlays: "Overlays",
	feedback: "Feedback & Actions",
};

export const draftHref = (page: PageId, id?: string) =>
	`/design/draft?file=${page}/page.svelte&project=theme-toss&style=toss${id ? `#${id}` : ""}`;
