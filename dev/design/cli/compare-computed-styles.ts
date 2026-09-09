import { write } from "bun";

type InspectedElement = {
	style?: Record<string, string>;
	box?: Record<string, number>;
	icons?: Array<{
		style?: Record<string, string>;
		box?: Record<string, number>;
	}>;
};

type ComputedReport = {
	url?: string;
	viewport?: Record<string, number>;
	selected?: Record<string, InspectedElement>;
};

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

const referencePath = valueFor("--reference");
const localPath = valueFor("--local");
const outputPath = valueFor("--out");
const failOnDiff = args.includes("--fail-on-diff");
const requestedRoles = valueFor("--roles")
	?.split(",")
	.map((role) => role.trim())
	.filter(Boolean);
const ignored = new Set(
	valueFor("--ignore")
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean) ?? [],
);
const mode = valueFor("--mode") ?? "typography";

if (!referencePath || !localPath) {
	throw new Error(
		"Usage: compare-computed-styles.ts --reference <json> --local <json> [--roles role,...] [--mode typography|control] [--ignore role.property,...] [--out <json>] [--fail-on-diff]",
	);
}
if (mode !== "typography" && mode !== "control") {
	throw new Error(`Unsupported mode: ${mode}`);
}

const reference = (await Bun.file(referencePath).json()) as ComputedReport;
const local = (await Bun.file(localPath).json()) as ComputedReport;
const referenceSelected = reference.selected ?? {};
const localSelected = local.selected ?? {};
const roles =
	requestedRoles ??
	Object.keys(referenceSelected).filter((role) => role in localSelected);

if (!roles.length) throw new Error("No shared named roles to compare");

const missingRoles = roles.filter(
	(role) => !referenceSelected[role] || !localSelected[role],
);
if (missingRoles.length)
	throw new Error(
		`Named roles missing from one report: ${missingRoles.join(", ")}`,
	);

const typographyProperties = [
	"fontFamily",
	"fontSize",
	"fontWeight",
	"fontStyle",
	"lineHeight",
	"letterSpacing",
	"textTransform",
	"textDecorationLine",
	"color",
];
const controlProperties = [
	...typographyProperties,
	"display",
	"padding",
	"margin",
	"gap",
	"border",
	"borderRadius",
	"backgroundColor",
	"boxShadow",
];
const properties =
	mode === "control" ? controlProperties : typographyProperties;

const mismatches: Array<{
	role: string;
	property: string;
	reference: string | number | undefined;
	local: string | number | undefined;
}> = [];
const ignoredDifferences: typeof mismatches = [];

const recordDifference = (difference: (typeof mismatches)[number]) => {
	if (
		ignored.has(difference.property) ||
		ignored.has(`${difference.role}.${difference.property}`)
	) {
		ignoredDifferences.push(difference);
	} else {
		mismatches.push(difference);
	}
};

for (const role of roles) {
	const expected = referenceSelected[role];
	const actual = localSelected[role];
	for (const property of properties) {
		if (expected.style?.[property] !== actual.style?.[property]) {
			recordDifference({
				role,
				property,
				reference: expected.style?.[property],
				local: actual.style?.[property],
			});
		}
	}
	if (mode === "control") {
		for (const property of ["width", "height"] as const) {
			if (expected.box?.[property] !== actual.box?.[property]) {
				recordDifference({
					role,
					property: `box.${property}`,
					reference: expected.box?.[property],
					local: actual.box?.[property],
				});
			}
		}
		const expectedIcons = expected.icons ?? [];
		const actualIcons = actual.icons ?? [];
		if (expectedIcons.length !== actualIcons.length) {
			recordDifference({
				role,
				property: "icons.count",
				reference: expectedIcons.length,
				local: actualIcons.length,
			});
		}
		for (
			let index = 0;
			index < Math.min(expectedIcons.length, actualIcons.length);
			index += 1
		) {
			for (const property of ["width", "height"] as const) {
				if (
					expectedIcons[index].box?.[property] !==
					actualIcons[index].box?.[property]
				) {
					recordDifference({
						role,
						property: `icons.${index}.box.${property}`,
						reference: expectedIcons[index].box?.[property],
						local: actualIcons[index].box?.[property],
					});
				}
			}
		}
	}
}

const environmentMismatches = ["width", "height", "devicePixelRatio"].flatMap(
	(property) =>
		reference.viewport?.[property] === local.viewport?.[property]
			? []
			: [
					{
						property,
						reference: reference.viewport?.[property],
						local: local.viewport?.[property],
					},
				],
);
const report = {
	reference: { path: referencePath, url: reference.url },
	local: { path: localPath, url: local.url },
	mode,
	roles,
	ignored: [...ignored],
	environmentMismatches,
	ignoredDifferences,
	mismatches,
	passed: environmentMismatches.length === 0 && mismatches.length === 0,
};
const json = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) await write(outputPath, json);
else process.stdout.write(json);

if (failOnDiff && !report.passed) process.exitCode = 1;
