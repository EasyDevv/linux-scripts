/**
 * 프록시가 보낼 수 있는 업체와 그 자격 증명.
 *
 * 키는 pi의 `~/.pi/agent/auth.json`을 그대로 쓴다(pi와 같은 계정·할당량). OAuth 토큰이 만료되면
 * pi와 같은 방식(`proper-lockfile`: `auth.json.lock` 디렉터리, 10초 지나면 stale)으로 잠그고 갱신해
 * 다시 쓴다. 회전된 refresh 토큰을 pi와 엇갈려 잃지 않기 위해서다.
 *
 * 업체 정의는 표 하나다. 라우팅 로직은 업체 이름으로 갈라지지 않고, 업체마다 다른 것은
 * 주소·인증 헤더·추가 헤더뿐이다.
 */
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Credential =
	| { type: "api_key"; key: string }
	| { type: "oauth"; access: string; refresh: string; expires: number; [extra: string]: unknown };

type OAuthRefresh = { tokenUrl: string; clientId: string };

export type Provider = {
	/** `/v1/messages`를 붙일 Anthropic 호환 주소(끝에 `/v1` 없음). */
	baseUrl: string;
	/** 자격 증명을 요청 헤더로. */
	auth: (credential: Credential) => Record<string, string>;
	/** 세션 ID가 필요한 업체의 추가 헤더. */
	headers?: (sessionId: string) => Record<string, string>;
	refresh?: OAuthRefresh;
};

const bearerOrKey = (credential: Credential): Record<string, string> =>
	credential.type === "api_key" ? { "x-api-key": credential.key } : { authorization: `Bearer ${credential.access}` };

export const PROVIDERS: Record<string, Provider> = {
	// OpenCode Go: 세션 헤더가 없으면 MissingSessionID로 거절한다(261111 실측).
	"opencode-go": {
		baseUrl: "https://opencode.ai/zen/go",
		auth: bearerOrKey,
		headers: (sessionId) => ({ "x-opencode-session": sessionId, "x-opencode-client": "claude-code" }),
	},
	// xAI: pi의 SuperGrok OAuth(device code) 토큰이 api.x.ai/v1/messages에 그대로 통한다.
	xai: {
		baseUrl: "https://api.x.ai",
		auth: bearerOrKey,
		refresh: { tokenUrl: "https://auth.x.ai/oauth2/token", clientId: "b1a00492-073a-47ea-816f-4c329264a828" },
	},
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

export function authPath(): string {
	return process.env.CC_PROXY_AUTH_FILE ?? join(homedir(), ".pi", "agent", "auth.json");
}

let cache: { mtime: number; data: Record<string, Credential> } | null = null;

function readAuth(): Record<string, Credential> {
	const path = authPath();
	const mtime = statSync(path).mtimeMs;
	if (cache?.mtime === mtime) return cache.data;
	const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, Credential>;
	cache = { mtime, data };
	return data;
}

const STALE_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** pi(`proper-lockfile`)와 같은 잠금. */
async function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
	const lock = `${authPath()}.lock`;
	for (let attempt = 0; ; attempt += 1) {
		try {
			mkdirSync(lock);
			break;
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
			try {
				if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmdirSync(lock);
			} catch {
				// 그 사이 풀렸다.
			}
			if (attempt > 100) throw new Error("auth.json is locked");
			await sleep(50);
		}
	}
	try {
		return await fn();
	} finally {
		try {
			rmdirSync(lock);
		} catch {
			// 이미 없다.
		}
	}
}

const refreshing = new Map<string, Promise<Credential>>();

async function refreshOAuth(name: string, spec: OAuthRefresh): Promise<Credential> {
	return withAuthLock(async () => {
		cache = null;
		const all = readAuth();
		const current = all[name];
		if (current?.type !== "oauth") throw new Error(`${name}: no OAuth login in pi`);
		// pi가 먼저 갱신했다.
		if (current.expires > Date.now()) return current;
		const response = await fetch(spec.tokenUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
			body: new URLSearchParams({ grant_type: "refresh_token", client_id: spec.clientId, refresh_token: current.refresh }),
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) throw new Error(`${name}: token refresh failed (${response.status}); run pi /login`);
		const body = (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
		const next: Credential = {
			...current,
			access: body.access_token,
			refresh: body.refresh_token ?? current.refresh,
			// pi와 같이 5분 일찍 만료로 본다.
			expires: Date.now() + (body.expires_in ?? 3600) * 1000 - 5 * 60_000,
		};
		const path = authPath();
		const tmp = `${path}.cc-proxy.tmp`;
		writeFileSync(tmp, JSON.stringify({ ...all, [name]: next }, null, 2), { mode: 0o600 });
		renameSync(tmp, path);
		cache = null;
		return next;
	});
}

/** 업체의 유효한 자격 증명. 없으면 이유를 던진다. */
export async function credentialFor(name: string): Promise<Credential> {
	const provider = PROVIDERS[name];
	if (!provider) throw new Error(`unknown provider ${name}`);
	const credential = readAuth()[name];
	if (!credential) throw new Error(`${name}: not logged in to pi`);
	if (credential.type !== "oauth" || credential.expires > Date.now()) return credential;
	if (!provider.refresh) throw new Error(`${name}: OAuth token expired`);
	let pending = refreshing.get(name);
	if (!pending) {
		pending = refreshOAuth(name, provider.refresh).finally(() => refreshing.delete(name));
		refreshing.set(name, pending);
	}
	return pending;
}

/** 이 업체에 pi 로그인이 있는가(GUI에서 고를 수 있는 업체 표시용). */
export function loggedIn(name: string): boolean {
	try {
		return Boolean(readAuth()[name]);
	} catch {
		return false;
	}
}
