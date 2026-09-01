export interface NormalizedInstance {
	name: string;
	dir: string;
	cmd: string;
	enabled: boolean;
	env: Record<string, string>;
}

export interface NormalizedConfig {
	readonly instances: ReadonlyMap<string, NormalizedInstance>;
	readonly disabled: ReadonlySet<string>;
	readonly restartTokens: ReadonlyMap<string, string>;
	getInstance(name: string): NormalizedInstance;
	hasInstance(name: string): boolean;
	isEnabled(name: string): boolean;
	getPort(name: string): string;
	instanceMatchingCwd(): string | null;
}

export type ManagedProcessState =
	| "stopped"
	| "starting"
	| "running"
	| "stopping"
	| "backoff"
	| "blocked";

export interface ManagedProcessExit {
	exitCode: number | null;
	signalCode: string | null;
	at: number;
}

export interface ManagedProcessSnapshot {
	name: string;
	state: ManagedProcessState;
	pid: number;
	startedAt: number | null;
	restartAttempts: number;
	nextRetryAt: number | null;
	lastExit: ManagedProcessExit | null;
	lastError: string | null;
}
