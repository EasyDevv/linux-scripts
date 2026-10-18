/**
 * Durable daemon state under `$XDG_STATE_HOME/decision` (default `~/.local/state/decision`):
 * the daily spend ledger and the decision log (`log-YYMMDD.jsonl`, one JSON object per line).
 *
 * The log is the evidence `decision audit` and `decision eval` read later, so it records every
 * call — cached, failed, and unavailable ones included. It never holds a key; `state` is
 * stored as a hash, and features add their own `result` lines keyed by `decisionId`.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const STATE_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "decision");

export function dayStamp(date = new Date()): string {
	const y = String(date.getFullYear() % 100).padStart(2, "0");
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}${m}${d}`;
}

export interface DecisionLog {
	write(record: Record<string, unknown>): void;
}

export class FileLog implements DecisionLog {
	constructor(private readonly dir = STATE_DIR) {
		mkdirSync(dir, { recursive: true });
	}

	path(date = new Date()): string {
		return join(this.dir, `log-${dayStamp(date)}.jsonl`);
	}

	write(record: Record<string, unknown>): void {
		try {
			appendFileSync(this.path(), `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`);
		} catch {
			// A full disk must not take routing down; the decision itself already happened.
		}
	}
}

export interface Budget {
	exhausted(): boolean;
	spend(usd: number): void;
	snapshot(): { day: string; spentUsd: number; dailyUsd: number };
}

/** Daily USD cap shared by every caller of this daemon. `dailyUsd <= 0` blocks paid models. */
export class FileBudget implements Budget {
	private day = "";
	private spentUsd = 0;
	private readonly path: string;

	constructor(
		private readonly dailyUsd: number,
		dir = STATE_DIR,
	) {
		mkdirSync(dir, { recursive: true });
		this.path = join(dir, "budget.json");
		try {
			const saved = JSON.parse(readFileSync(this.path, "utf8")) as { day?: string; spentUsd?: number };
			this.day = saved.day ?? "";
			this.spentUsd = typeof saved.spentUsd === "number" ? saved.spentUsd : 0;
		} catch {
			// First run.
		}
	}

	private roll(): void {
		const today = dayStamp();
		if (this.day !== today) {
			this.day = today;
			this.spentUsd = 0;
		}
	}

	exhausted(): boolean {
		this.roll();
		return this.spentUsd >= this.dailyUsd;
	}

	spend(usd: number): void {
		if (!(usd > 0)) return;
		this.roll();
		this.spentUsd += usd;
		try {
			writeFileSync(this.path, JSON.stringify({ day: this.day, spentUsd: this.spentUsd }));
		} catch {
			// Kept in memory for this process.
		}
	}

	snapshot(): { day: string; spentUsd: number; dailyUsd: number } {
		this.roll();
		return { day: this.day, spentUsd: this.spentUsd, dailyUsd: this.dailyUsd };
	}
}
