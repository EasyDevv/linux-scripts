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
