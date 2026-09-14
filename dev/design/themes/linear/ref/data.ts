export type PageId = "projects-all" | "team-all" | "project-overview";

export const workspace = {
	initials: "EA",
	name: "EasyDev",
	team: "EasyDev",
};

export const projects = [
	{
		id: "test",
		name: "Test",
		milestone: "01 First Target",
		health: "On track",
		healthHint: "4h",
		priority: "---",
		issues: 0,
		status: "0%",
	},
];

export const issueGroups = [
	{
		id: "progress",
		label: "In Progress",
		tone: "info" as const,
		count: 3,
		issues: [
			{ id: "EAS-2", title: "Connect your tools", priority: "No priority", date: "Sep 6" },
			{ id: "EAS-6", title: "test 01", priority: "No priority", date: "Sep 9" },
			{ id: "EAS-5", title: "test", priority: "No priority", date: "Sep 9" },
		],
	},
	{
		id: "todo",
		label: "Todo",
		tone: "neutral" as const,
		count: 1,
		issues: [{ id: "EAS-1", title: "Get familiar with Linear", priority: "No priority", date: "Sep 6" }],
	},
	{
		id: "done",
		label: "Done",
		tone: "highlight" as const,
		count: 1,
		selected: "EAS-4",
		issues: [{ id: "EAS-4", title: "Set up your teams", priority: "No priority", date: "Sep 6" }],
	},
	{
		id: "canceled",
		label: "Canceled",
		tone: "danger" as const,
		count: 1,
		checkable: true,
		issues: [{ id: "EAS-3", title: "Import your data", priority: "No priority", date: "Sep 6" }],
	},
];

/** Card fields visible on the board (measurement in the same order as the live capture). */
export type BoardCard = {
	id: string;
	title: string;
	tone: "backlog" | "todo" | "progress" | "done" | "canceled" | "duplicate";
	priority: "none" | "high";
	/** "Created Sep 10" footer. */
	date: string;
	/** Parent issue shown next to the identifier (sub-issues). */
	parent?: string;
	project?: string;
	labels?: { name: string; color: string }[];
	/** Sub-issue progress, e.g. "0/1". */
	progress?: string;
	avatar?: { initials: string; color: string };
};

/**
 * Board view state at capture time (ref/linear.app/desktop/team-board.png, 2026-09-14).
 * Kept separate from `issueGroups`: the list page reproduces the 2026-09-10 capture, which
 * predates EAS-7/EAS-8 and the Backlog column.
 */
export const boardColumns: {
	id: string;
	label: string;
	tone: BoardCard["tone"];
	count: number;
	cards: BoardCard[];
}[] = [
	{
		id: "backlog",
		label: "Backlog",
		tone: "backlog",
		count: 1,
		cards: [
			{ id: "EAS-7", title: "Test issue", tone: "backlog", priority: "none", project: "Test", date: "Sep 10" },
		],
	},
	{
		id: "todo",
		label: "Todo",
		tone: "todo",
		count: 2,
		cards: [
			{ id: "EAS-1", title: "Get familiar with Linear", tone: "todo", priority: "none", date: "Sep 6" },
			{ id: "EAS-8", title: "test", tone: "todo", priority: "none", parent: "test 01", date: "Sep 11" },
		],
	},
	{
		id: "progress",
		label: "In Progress",
		tone: "progress",
		count: 3,
		cards: [
			{
				id: "EAS-5",
				title: "test",
				tone: "progress",
				priority: "high",
				labels: [
					{ name: "Bug", color: "rgb(235, 87, 87)" },
					{ name: "Feature", color: "rgb(187, 135, 252)" },
				],
				avatar: { initials: "LB", color: "var(--board-avatar-user)" },
				date: "Sep 9",
			},
			{ id: "EAS-2", title: "Connect your tools", tone: "progress", priority: "none", date: "Sep 6" },
			{ id: "EAS-6", title: "test 01", tone: "progress", priority: "none", progress: "0/1", date: "Sep 9" },
		],
	},
	{
		id: "done",
		label: "Done",
		tone: "done",
		count: 1,
		cards: [{ id: "EAS-4", title: "Set up your teams", tone: "done", priority: "none", date: "Sep 6" }],
	},
	{
		id: "canceled",
		label: "Canceled",
		tone: "canceled",
		count: 1,
		cards: [{ id: "EAS-3", title: "Import your data", tone: "canceled", priority: "none", date: "Sep 6" }],
	},
];

/** Trailing rail of the board: statuses hidden by "Show empty columns: off". */
export const hiddenColumns: { label: string; tone: BoardCard["tone"]; count: number }[] = [
	{ label: "Duplicate", tone: "duplicate", count: 0 },
];

export const overview = {	title: "Test",
	summary: "testing app",
	health: "On track",
	updateTitle: "Updating Project!",
	updateAge: "14h ago",
	code: `demo_client_secret = ''

client_id = ''
client_secret = ''

public_key = ''

# 코드에프 인스턴스 생성
codef = Codef()
codef.public_key = public_key

# 데모 클라이언트 정보 설정
# - 데모 서비스 가입 후 코드에프 홈페이지에서 확인 (https://codef.io/#/account/keys)
# - 데모 서비스 상품 조회 요청시 필수 입력 항목
codef.set_demo_client_info(demo_client_id, demo_client_secret)

# 정식 클라이언트 정보 설정
# - 정식 서비스 가입 후 코드에프 홈페이지에서 확인 (https://codef.io/#/account/keys)
# - 정식 서비스 상품 조회 요청시 필수 입력 항목
codef.set_client_info(client_id, client_secret)

# 토큰 발급 요청
token = codef.request_token(ServiceType.SANDBOX)

# 결과 출력
print(token)`,
	milestone: {
		name: "01 First Target",
		issues: "0 issues",
		pct: "0%",
		description: "My Description",
	},
	activity: [
		{ kind: "milestone", text: "Lemon Blue added milestone 01 First Target", date: "Sep 10" },
		{ kind: "update", text: "Lemon Blue posted an update", date: "Sep 10" },
		{ kind: "create", text: "Lemon Blue created the project", date: "Sep 6" },
	],
};
