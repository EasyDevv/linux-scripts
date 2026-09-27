/**
 * 컴포저 입력창의 `/명령`·`@경로` 토큰이다.
 *
 * 캐럿 앞의 토큰 하나만 읽고, 목록을 열고 거르고 넣는 일이 모두 여기서 나온다. 화면은 토큰이
 * 무엇인지 모른 채 이 함수들만 부른다.
 */

export type TokenSigil = "/" | "@";

/** 캐럿 앞의 토큰 한 조각. `start`는 시길 위치, `text`는 시길을 포함한 조각이다. */
export type TokenHit = { start: number; text: string; sigil: TokenSigil; query: string };

/** 목록에 실릴 수 있는 항목. `token`은 시길을 뺀 값이라 질의와 같은 자로 잰다. */
export type TokenItem = { id: string; sigil: TokenSigil; token: string; label: string };

/** 비교용으로 대소문자·공백·구분자를 지운다. `/apps-client`와 `apps/client`가 같은 규칙으로 맞도록. */
export function foldText(text: string) {
	return text.toLowerCase().replace(/[\s→>/_-]+/g, "");
}

/** 토큰은 줄 시작이나 공백 뒤에서만 시작한다. 시길은 `/` 또는 `@`다. */
const TOKEN = /(?:^|\s)([/@][^\s]*)$/;

/** 캐럿 앞의 토큰을 찾는다. 캐럿이 토큰 밖이면 `null`이라 목록도 닫힌다. */
export function tokenAt(value: string, caret: number): TokenHit | null {
	const upto = value.slice(0, Math.max(0, Math.min(caret, value.length)));
	const match = TOKEN.exec(upto);
	if (!match) return null;
	const text = match[1];
	return {
		start: match.index + match[0].length - text.length,
		text,
		sigil: text[0] as TokenSigil,
		query: text.slice(1),
	};
}

function scoreOf(item: TokenItem, needle: string) {
	const token = foldText(item.token);
	const label = foldText(item.label);
	if (token.startsWith(needle)) return 0;
	if (label.startsWith(needle)) return 1;
	if (token.includes(needle)) return 2;
	if (label.includes(needle)) return 3;
	return -1;
}

/**
 * 질의와 맞는 항목만 남긴다. 접두 일치가 먼저 오고, 같은 점수는 목록 순서를 지킨다.
 * 라벨이 긴 문장이면 부분 일치가 넓게 걸린다 — `Plan with Pi` 꼴 라벨은 `p` 한 글자에 모두 남는다.
 */
export function matchTokens<T extends TokenItem>(items: T[], query: string): T[] {
	const needle = foldText(query);
	if (!needle) return items;
	return items
		.map((item, index) => ({ item, index, score: scoreOf(item, needle) }))
		.filter((row) => row.score >= 0)
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.map((row) => row.item);
}

/**
 * 토큰 자리를 `{시길}{별칭} `로 바꾸고 캐럿을 그 뒤로 둔다. `lead`는 토큰 없이 목록을 연 경우
 * (버튼으로 연 팔레트)에 앞말과 명령을 떼어 놓는 한 칸이다.
 */
export function insertToken(value: string, hit: TokenHit, alias: string, lead = "") {
	const before = value.slice(0, hit.start);
	const after = value.slice(hit.start + hit.text.length);
	const head = `${before}${lead}${hit.sigil}${alias} `;
	return { text: `${head}${after}`, caret: head.length };
}
