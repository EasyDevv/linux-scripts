export const DEFAULT_LOCALE = "en-US";

export type ResolvedLocale = {
	appLocale: string;
	acceptLanguages: string;
	languageEnv: string;
};

export function resolveLocale(value: string | undefined): ResolvedLocale {
	const appLocale = normalizeLocale(value, DEFAULT_LOCALE);
	const acceptLanguages = normalizeAcceptLanguages(undefined, appLocale);
	const languageEnv = toChromiumLanguageEnv(appLocale);
	return { appLocale, acceptLanguages, languageEnv };
}

function normalizeLocale(value: string | undefined, fallback: string): string {
	const raw = String(value ?? fallback).trim();
	if (!raw) return fallback;
	const primary = raw.split(",")[0]?.split(":")[0]?.trim() ?? "";
	const normalized = primary.replace(/_/g, "-");
	return normalized || fallback;
}

function normalizeAcceptLanguages(
	value: string | undefined,
	appLocale: string,
): string {
	const raw = String(value ?? "").trim();
	return raw.length > 0 ? raw.replace(/\s+/g, "") : `${appLocale},en`;
}

function toChromiumLanguageEnv(appLocale: string): string {
	const [language, region] = appLocale.split("-", 2);
	return region ? `${language}_${region}:${language}` : language;
}

export function localeLaunchArgs(locale: ResolvedLocale): string[] {
	return [
		`--lang=${locale.appLocale}`,
		`--accept-lang=${locale.acceptLanguages}`,
	];
}

export function localeSpawnEnv(locale: ResolvedLocale): Record<string, string> {
	const env: Record<string, string> = { LANGUAGE: locale.languageEnv };
	if (process.env.LANG) env.LANG = process.env.LANG;
	if (process.env.LC_ALL) env.LC_ALL = process.env.LC_ALL;
	return env;
}

export async function primeChromiumProfile(
	profileDir: string,
	locale: ResolvedLocale,
	options: { force?: boolean } = {},
): Promise<void> {
	const { mkdir, readFile, writeFile } = await import("node:fs/promises");
	const { join } = await import("node:path");

	const defaultDir = join(profileDir, "Default");
	await mkdir(defaultDir, { recursive: true });

	const acceptOnly = (intl: Record<string, any>) => {
		intl.accept_languages = locale.acceptLanguages;
		intl.selected_languages = locale.acceptLanguages;
	};
	const appLocale = (intl: Record<string, any>) => {
		intl.app_locale = locale.appLocale;
	};

	await updateJsonFile(join(defaultDir, "Preferences"), (preferences) => {
		const intl = (preferences.intl ??= {});
		acceptOnly(intl);
	});

	await updateJsonFile(join(profileDir, "Local State"), (localState) => {
		const intl = (localState.intl ??= {});
		if (options.force || typeof intl.app_locale !== "string") {
			appLocale(intl);
		}
	});

	async function updateJsonFile(
		filePath: string,
		mutate: (json: Record<string, any>) => void,
	): Promise<void> {
		let json: Record<string, any> = {};
		try {
			json = JSON.parse(await readFile(filePath, "utf8")) as Record<
				string,
				any
			>;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			if (code !== "ENOENT") throw error;
		}
		mutate(json);
		await writeFile(filePath, JSON.stringify(json), "utf8");
	}
}
