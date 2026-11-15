import { isDeepStrictEqual } from "node:util";

export type Workload = "read" | "code" | "worker" | "summary";
export type Phase = "screen" | "final";

export interface Attempt {
  benchmarkVersion: string;
  workload: Workload;
  phase: Phase;
  caseId: string;
  name: string;
  route: string;
  effort: string;
  allowance5h: number;
  elapsedMs: number;
  success: boolean;
  quality: number;
  error?: string;
}

export interface ScoreRow {
  workload: Workload;
  name: string;
  route: string;
  effort: string;
  allowance5h: number;
  attempts: number;
  successRate: number;
  qualityScore: number;
  medianMs: number | null;
  latencyScore: number;
  allowanceScore: number;
  totalScore: number;
}

const round = (value: number) => Math.round(value * 100) / 100;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Deterministic partial credit: exact object shape is 15 points; expected fields share 85. */
export function structuredQuality(actual: unknown, expected: Record<string, unknown>): number {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return 0;
  const record = actual as Record<string, unknown>;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(record);
  const shape = expectedKeys.length === actualKeys.length && expectedKeys.every((key) => actualKeys.includes(key)) ? 15 : 0;
  const matched = expectedKeys.filter((key) => isDeepStrictEqual(record[key], expected[key])).length;
  return round(shape + (85 * matched) / expectedKeys.length);
}

/** Test behavior is 90 points; preserving the requested local CommonJS shape is 10. */
export function codeQuality(
  result: { pass: number; total: number },
  source: Record<string, string>,
  requiredFiles: string[],
  requiredPatterns: Record<string, string[]> = {},
): number {
  if (!result.total) return 0;
  const behavior = 90 * (result.pass / result.total);
  const complete = requiredFiles.every((file) => typeof source[file] === "string" && source[file].trim().length > 0);
  const main = source["main.cjs"] ?? "";
  const localOnly = !Array.from(main.matchAll(/require\(["']([^"']+)["']\)/g)).some((match) => !match[1].startsWith("./"));
  const namedExport = /exports\.solve\s*=/.test(main) || /module\.exports\s*=\s*\{[^}]*\bsolve\b/.test(main);
  const patternsMatch = Object.entries(requiredPatterns).every(([file, patterns]) => patterns.every((pattern) => new RegExp(pattern).test(source[file] ?? "")));
  const contract = complete && namedExport && localOnly && patternsMatch ? 10 : 0;
  return round(behavior + contract);
}

export function aggregateScores(attempts: Attempt[], eligibleMaxAllowance5h?: number): ScoreRow[] {
  const groups = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const key = [attempt.workload, attempt.route, attempt.effort].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }

  const provisional = [...groups.values()].map((rows) => {
    const first = rows[0];
    const successfulMs = rows.filter((row) => row.success).map((row) => row.elapsedMs);
    return {
      workload: first.workload,
      name: first.name,
      route: first.route,
      effort: first.effort,
      allowance5h: first.allowance5h,
      attempts: rows.length,
      successRate: (100 * rows.filter((row) => row.success).length) / rows.length,
      qualityScore: rows.reduce((sum, row) => sum + row.quality, 0) / rows.length,
      medianMs: median(successfulMs),
    };
  });

  return provisional.map((row) => {
    const peers = provisional.filter((peer) => peer.workload === row.workload);
    const fastest = Math.min(...peers.flatMap((peer) => (peer.medianMs === null ? [] : [peer.medianMs])));
    const maxAllowance = eligibleMaxAllowance5h ?? Math.max(...peers.map((peer) => peer.allowance5h));
    const latencyScore = row.medianMs === null || !Number.isFinite(fastest) ? 0 : Math.min(100, (100 * fastest) / row.medianMs);
    const allowanceScore = 100 * Math.sqrt(row.allowance5h / maxAllowance);
    const totalScore = 0.35 * row.successRate + 0.3 * row.qualityScore + 0.2 * latencyScore + 0.15 * allowanceScore;
    return {
      ...row,
      successRate: round(row.successRate),
      qualityScore: round(row.qualityScore),
      medianMs: row.medianMs === null ? null : round(row.medianMs),
      latencyScore: round(latencyScore),
      allowanceScore: round(allowanceScore),
      totalScore: round(totalScore),
    };
  }).sort((a, b) => a.workload.localeCompare(b.workload) || b.totalScore - a.totalScore);
}

/** Keep the three strongest variants plus every model's strongest route/effort for the full run. */
export function selectFinalists(rows: ScoreRow[]): ScoreRow[] {
  const selected = new Map<string, ScoreRow>();
  for (const workload of ["read", "code", "worker", "summary"] as const) {
    const ranked = rows.filter((row) => row.workload === workload).sort((a, b) => b.totalScore - a.totalScore);
    for (const row of ranked.slice(0, 3)) selected.set(`${workload}\u0000${row.route}\u0000${row.effort}`, row);
    const byModel = new Map<string, ScoreRow>();
    for (const row of ranked) if (!byModel.has(row.name)) byModel.set(row.name, row);
    for (const row of byModel.values()) selected.set(`${workload}\u0000${row.route}\u0000${row.effort}`, row);
  }
  return [...selected.values()];
}
