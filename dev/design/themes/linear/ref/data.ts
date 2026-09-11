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
			{ id: "EAS-2", title: "Connect your tools", date: "Sep 6" },
			{ id: "EAS-6", title: "test 01", date: "Sep 9" },
			{ id: "EAS-5", title: "test", date: "Sep 9" },
		],
	},
	{
		id: "todo",
		label: "Todo",
		tone: "neutral" as const,
		count: 1,
		issues: [{ id: "EAS-1", title: "Get familiar with Linear", date: "Sep 6" }],
	},
	{
		id: "done",
		label: "Done",
		tone: "highlight" as const,
		count: 1,
		selected: "EAS-4",
		issues: [{ id: "EAS-4", title: "Set up your teams", date: "Sep 6" }],
	},
	{
		id: "canceled",
		label: "Canceled",
		tone: "danger" as const,
		count: 1,
		checkable: true,
		issues: [{ id: "EAS-3", title: "Import your data", date: "Sep 6" }],
	},
];

export const overview = {
	title: "Test",
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
