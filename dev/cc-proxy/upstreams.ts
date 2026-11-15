/**
 * 프록시가 보낼 수 있는 업체와 그 자격 증명.
 *
 * 키는 중앙 auth(`dev/auth`, `~/.config/auth/credentials.json`)에서 읽는다. pi의 `auth.json`과는
 * 무관하다. 로그인·갱신은 Go `auth` 도구만 하고(만료된 OAuth는 `auth refresh`), 여기서는 쓰지 않는다.
 *
 * 업체 정의는 표 하나다. 라우팅 로직은 업체 이름으로 갈라지지 않고, 업체마다 다른 것은
 * 주소·인증 헤더·추가 헤더뿐이다.
 */
import { CentralAuth, type Credential } from "../auth/client/central-auth.ts";

export type { Credential };

export type Provider = {
	/** `/v1/messages`를 붙일 Anthropic 호환 주소(끝에 `/v1` 없음). */
	baseUrl: string;
	/** 자격 증명을 요청 헤더로. */
	auth: (credential: Credential) => Record<string, string>;
	/** 세션 ID가 필요한 업체의 추가 헤더. */
	headers?: (sessionId: string) => Record<string, string>;
};

const bearerOrKey = (credential: Credential): Record<string, string> =>
	credential.type === "api_key" ? { "x-api-key": credential.key ?? "" } : { authorization: `Bearer ${credential.access}` };

export const PROVIDERS: Record<string, Provider> = {
	// OpenCode Go: 세션 헤더가 없으면 MissingSessionID로 거절한다(261111 실측).
	"opencode-go": {
		baseUrl: "https://opencode.ai/zen/go",
		auth: bearerOrKey,
		headers: (sessionId) => ({ "x-opencode-session": sessionId, "x-opencode-client": "claude-code" }),
	},
	// OpenRouter: `/api/v1/messages`가 Anthropic 형식을 받는다.
	openrouter: {
		baseUrl: "https://openrouter.ai/api",
		auth: (credential) => ({ authorization: `Bearer ${credential.type === "api_key" ? credential.key : credential.access}` }),
	},
	// xAI: SuperGrok OAuth(device code) 토큰이 api.x.ai/v1/messages에 그대로 통한다. `auth login xai`.
	xai: {
		baseUrl: "https://api.x.ai",
		auth: bearerOrKey,
	},
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

const central = new CentralAuth();

/** 업체의 유효한 자격 증명. 없으면 이유를 던진다. 만료된 OAuth는 `auth refresh`가 갱신한다. */
export async function credentialFor(name: string): Promise<Credential> {
	if (!PROVIDERS[name]) throw new Error(`unknown provider ${name}`);
	const credential = await central.get(name);
	if (!credential) throw new Error(`${name}: not signed in; run \`auth login ${name}\``);
	return credential;
}

/** 중앙 auth에 이 업체의 로그인이 있는가(GUI에서 고를 수 있는 업체 표시용). */
export function loggedIn(name: string): boolean {
	return central.has(name);
}
