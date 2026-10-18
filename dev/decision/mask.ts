/**
 * Text that leaves the daemon's own state (eval reports, audit reports, candidate cases) goes
 * through here: secrets masked first, then whitespace collapsed and the length capped, so a
 * truncation can never cut a secret in half and leave its tail readable.
 */

export const MAX_TEXT = 300;

const PATTERNS: [RegExp, string][] = [
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private key]"],
	[/\b(authorization|proxy-authorization)\s*[:=]\s*(bearer|basic|token)?\s*[^\s"',;]+/gi, "$1: [masked]"],
	[/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [masked]"],
	[
		/\b[A-Za-z0-9_]*(?:api[_-]?key|token|secret|passwd|password|credential)s?\b["']?\s*[:=]\s*["']?[^\s"',;]{4,}/gi,
		"[masked assignment]",
	],
	[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[jwt]"],
	[/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[key]"],
	[/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[key]"],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[key]"],
	[/\bAKIA[0-9A-Z]{16}\b/g, "[key]"],
	[/\bAIza[0-9A-Za-z_-]{30,}/g, "[key]"],
	[/\b[A-Fa-f0-9]{40,}\b|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{48,}\b/g, "[long token]"],
];

export function maskSecrets(text: string): string {
	let out = text;
	for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
	return out;
}

/** Mask, collapse whitespace, cap at `max` characters (ellipsis included). */
export function clip(text: string, max = MAX_TEXT): string {
	const flat = maskSecrets(text).replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
