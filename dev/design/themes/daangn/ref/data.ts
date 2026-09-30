export type PageId = "foundation" | "actions" | "selection" | "inputs" | "navigation" | "content" | "feedback" | "overlays";

export type NavEntry = { label: string; page?: PageId; id?: string };
export type NavGroup = { title: string; items: NavEntry[] };

/** Sidebar IA follows seed-design.io/react/components: every current (non-deprecated) component page
 *  maps to the catalogue page and anchor that renders its snippet. */
export const NAV: NavGroup[] = [
	{ title: "", items: [{ label: "Overview", page: "foundation" }] },
	{
		title: "Foundation",
		items: [
			{ label: "Color", page: "foundation", id: "color" },
			{ label: "Typography", page: "foundation", id: "typography" },
			{ label: "Radius · Shadow · Motion", page: "foundation", id: "tokens" },
		],
	},
	{
		title: "Components",
		items: [
			{ label: "Accordion", page: "content", id: "accordion" },
			{ label: "Action Button", page: "actions", id: "action-button" },
			{ label: "Alert Dialog", page: "overlays", id: "alert-dialog" },
			{ label: "App Bar", page: "navigation", id: "app-bar" },
			{ label: "Article", page: "content", id: "article" },
			{ label: "Aspect Ratio", page: "content", id: "aspect-ratio" },
			{ label: "Attachment Field", page: "inputs", id: "attachment-field" },
			{ label: "Avatar", page: "content", id: "avatar" },
			{ label: "Badge", page: "content", id: "badge" },
			{ label: "Bottom Sheet", page: "overlays", id: "bottom-sheet" },
			{ label: "Callout", page: "feedback", id: "callout" },
			{ label: "Checkbox", page: "selection", id: "checkbox" },
			{ label: "Chip", page: "selection", id: "chip" },
			{ label: "Chip Tabs", page: "navigation", id: "chip-tabs" },
			{ label: "Content Placeholder", page: "content", id: "content-placeholder" },
			{ label: "Contextual Floating Button", page: "actions", id: "contextual-floating-button" },
			{ label: "Dialog", page: "overlays", id: "dialog" },
			{ label: "Divider", page: "content", id: "divider" },
			{ label: "Field Button", page: "inputs", id: "field-button" },
			{ label: "Floating Action Button", page: "actions", id: "floating-action-button" },
			{ label: "Help Bubble", page: "feedback", id: "help-bubble" },
			{ label: "Identity Placeholder", page: "content", id: "identity-placeholder" },
			{ label: "Image Frame", page: "content", id: "image-frame" },
			{ label: "List", page: "content", id: "list" },
			{ label: "Manner Temp", page: "content", id: "manner-temp" },
			{ label: "Manner Temp Badge", page: "content", id: "manner-temp-badge" },
			{ label: "Menu", page: "overlays", id: "menu" },
			{ label: "Page Banner", page: "feedback", id: "page-banner" },
			{ label: "Pagination", page: "navigation", id: "pagination" },
			{ label: "Progress Circle", page: "feedback", id: "progress-circle" },
			{ label: "Quantity Picker", page: "inputs", id: "quantity-picker" },
			{ label: "Radio Group", page: "selection", id: "radio-group" },
			{ label: "Reaction Button", page: "actions", id: "reaction-button" },
			{ label: "Result Section", page: "content", id: "result-section" },
			{ label: "Scroll Fog", page: "navigation", id: "scroll-fog" },
			{ label: "Segmented Control", page: "selection", id: "segmented-control" },
			{ label: "Select", page: "inputs", id: "select" },
			{ label: "Select Box", page: "selection", id: "select-box" },
			{ label: "Side Panel", page: "overlays", id: "side-panel" },
			{ label: "Skeleton", page: "feedback", id: "skeleton" },
			{ label: "Slider", page: "inputs", id: "slider" },
			{ label: "Snackbar", page: "feedback", id: "snackbar" },
			{ label: "Swipeable Menu Sheet", page: "overlays", id: "menu-sheet" },
			{ label: "Switch", page: "selection", id: "switch" },
			{ label: "Tabs", page: "navigation", id: "tabs" },
			{ label: "Tag Group", page: "selection", id: "tag-group" },
			{ label: "Text Field", page: "inputs", id: "text-field" },
			{ label: "Toggle Button", page: "actions", id: "toggle-button" },
			{ label: "Wheel Picker", page: "inputs", id: "wheel-picker" },
		],
	},
];

export const PAGE_TITLE: Record<PageId, string> = {
	foundation: "Foundation",
	actions: "Actions",
	selection: "Selection",
	inputs: "Inputs",
	navigation: "Navigation",
	content: "Content",
	feedback: "Feedback",
	overlays: "Overlays",
};

export const draftHref = (page: PageId, id?: string) =>
	`/design/draft?file=${page}/page.svelte&project=theme-daangn&style=daangn${id ? `#${id}` : ""}`;
