export type RefMenuItem = {
	label: string;
	icon?: string;
	kbd?: string;
	color?: string;
	heading?: boolean;
	bullet?: boolean;
	separatorAfter?: boolean;
	items?: RefMenuItem[];
};

export const workspaceMenu: RefMenuItem[] = [
	{ label: "Settings", kbd: "G then S" },
	{ label: "Invite and manage members", separatorAfter: true },
	{
		label: "Switch workspace",
		kbd: "O then W",
		separatorAfter: true,
		items: [{ label: "EasyDev" }],
	},
	{ label: "Log out", kbd: "Alt ⇧ Q" },
];

export const moreMenu: RefMenuItem[] = [
	{ label: "Members", icon: "users" },
	{ label: "Teams", icon: "layers" },
	{ label: "Customize sidebar", icon: "sliders-horizontal" },
];

export const helpMenu: RefMenuItem[] = [
	{ label: "Docs", icon: "book" },
	{ label: "Contact us", icon: "message-square" },
	{ label: "Keyboard shortcuts", icon: "keyboard", kbd: "Ctrl /" },
	{ label: "Linear status", icon: "circle-check" },
	{ label: "Download apps", icon: "monitor" },
	{ label: "Settings", icon: "settings", kbd: "G then S" },
	{ label: "Slack community", icon: "sparkles", separatorAfter: true },
	{ label: "What's new", heading: true },
	{ label: "Priority inbox", bullet: true },
	{ label: "Coding sessions: environments, browser use, and …", bullet: true },
	{ label: "Full changelog", bullet: true },
];

export const projectActions: RefMenuItem[] = [
	{
		label: "Copy",
		icon: "file",
		separatorAfter: true,
		items: [
			{ label: "Copy URL", icon: "link" },
			{ label: "Copy markdown", icon: "file-text" },
			{ label: "Copy ID", icon: "hash" },
		],
	},
	{ label: "Favorite", icon: "star", kbd: "Alt F" },
	{
		label: "Subscribe",
		icon: "bell",
		items: [{ label: "Subscribe", icon: "bell" }, { label: "Unsubscribe", icon: "bell-off" }],
	},
	{
		label: "Remind me",
		icon: "clock",
		kbd: "⇧ H",
		separatorAfter: true,
		items: [{ label: "Tomorrow" }, { label: "Next week" }, { label: "Custom…" }],
	},
	{ label: "Change update schedule…", icon: "clock" },
	{ label: "Configure Slack notifications…", icon: "sparkles", separatorAfter: true },
	{ label: "Show description history", icon: "undo-2" },
	{ label: "Show updates and activity", icon: "square-check", kbd: "Ctrl U", separatorAfter: true },
	{ label: "Delete", icon: "trash" },
];

export const resourceMenu: RefMenuItem[] = [
	{ label: "Create new document…", icon: "file-plus" },
	{ label: "Add a link…", icon: "link", kbd: "Ctrl Alt L" },
];

export const milestoneActions: RefMenuItem[] = [
	{ label: "Edit…", icon: "file-text" },
	{ label: "Set target date…", icon: "calendar" },
	{
		label: "Copy",
		icon: "copy",
		items: [{ label: "Copy name" }, { label: "Copy ID" }],
	},
	{
		label: "Move milestone to",
		icon: "folder-kanban",
		items: [{ label: "Test" }],
	},
	{ label: "Convert to project", icon: "box", separatorAfter: true },
	{ label: "Delete…", icon: "trash", kbd: "Ctrl ⌫" },
];

export const slackMenu: RefMenuItem[] = [
	{ label: "Connect channel", icon: "hash" },
	{ label: "Manage Slack settings…", icon: "settings" },
];

export const viewMenu: RefMenuItem[] = [
	{ label: "List", icon: "list" },
	{ label: "Board", icon: "layout-grid" },
	{ label: "Timeline", icon: "columns-3" },
];

export const statuses = ["Backlog", "Planned", "In Progress", "Completed", "Canceled"] as const;
export const priorities = ["No priority", "Urgent", "High", "Medium", "Low"] as const;
export const dateGrains = ["Day", "Month", "Quarter", "Half-year", "Year"] as const;
export const members = [
	{ id: "none", name: "No lead" },
	{ id: "lb", name: "Lemon Blue" },
] as const;

export const statusItems: RefMenuItem[] = [
	{ label: "Backlog", icon: "circle-dashed", color: "rgb(231, 146, 71)", kbd: "1" },
	{ label: "Planned", icon: "circle", color: "rgb(149, 162, 179)", kbd: "2" },
	{ label: "In Progress", icon: "circle-dot", color: "rgb(233, 186, 1)", kbd: "3" },
	{ label: "Completed", icon: "circle-check", color: "rgb(187, 135, 252)", kbd: "4" },
	{ label: "Canceled", icon: "circle-x", color: "rgb(149, 162, 179)", kbd: "5" },
];

export const priorityItems: RefMenuItem[] = [
	{ label: "No priority", icon: "ellipsis", kbd: "0" },
	{ label: "Urgent", icon: "circle-alert", color: "rgb(235, 87, 87)", kbd: "1" },
	{ label: "High", icon: "signal", kbd: "2" },
	{ label: "Medium", icon: "signal", kbd: "3" },
	{ label: "Low", icon: "signal", kbd: "4" },
];

export const notifyOptions = [
	"An issue is added to the project",
	"An issue is marked completed or canceled",
	"Comments and changes to project description",
	"New project update is posted",
] as const;

export const agentPrompts = [
	"Create a new project",
	"Research a topic",
	"Set up new team",
	"Skills",
] as const;
