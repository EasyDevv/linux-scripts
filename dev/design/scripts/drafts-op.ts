#!/usr/bin/env bun
import { homedir } from "node:os";
import { resolve } from "node:path";
import { archiveDraft, deleteDraft } from "./drafts-mutate.ts";

const scheme = "drafts-op";
const scriptPath = resolve(import.meta.dir, "drafts-op.ts");
const bunPath = process.execPath;
const desktopPath = resolve(
	homedir(),
	".local/share/applications/drafts-op.desktop",
);

const args = Bun.argv.slice(2);
const valueFor = (flag: string) => {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
};

function parseOp(raw: string) {
	const url = new URL(raw);
	if (url.protocol !== `${scheme}:`) return null;
	const action = url.hostname || url.pathname.replace(/^\//, "");
	if (action !== "archive" && action !== "delete") return null;
	return {
		action: action as "archive" | "delete",
		root: url.searchParams.get("root") ?? "",
		file: url.searchParams.get("file") ?? "",
	};
}

async function install() {
	const desktop = `[Desktop Entry]
Type=Application
Name=Drafts Op
Exec="${bunPath}" "${scriptPath}" "%u"
StartupNotify=false
MimeType=x-scheme-handler/${scheme};
NoDisplay=true
`;
	await Bun.write(desktopPath, desktop);
	await Bun.$`xdg-mime default drafts-op.desktop x-scheme-handler/${scheme}`.quiet();
	await Bun.$`update-desktop-database ${resolve(homedir(), ".local/share/applications")}`.quiet();
	process.stdout.write(`registered ${scheme}:// via ${desktopPath}\n`);
}

async function run(action: "archive" | "delete", root: string, file: string) {
	if (!root || !file) {
		process.stderr.write(
			"usage: drafts-op.ts archive|delete --root <project> --file <rel>\n",
		);
		process.exitCode = 2;
		return;
	}
	const projectRoot = resolve(root);
	const result =
		action === "archive"
			? await archiveDraft(projectRoot, file)
			: await deleteDraft(projectRoot, file);
	if (!result.ok) {
		process.stderr.write(`${result.error}\n`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(`${action} ${result.file ?? file}\n`);
}

const first = args[0] ?? "";
if (first === "install") {
	await install();
} else if (first.startsWith(`${scheme}:`)) {
	const op = parseOp(first);
	if (!op) {
		process.stderr.write(`invalid ${scheme} url\n`);
		process.exitCode = 2;
	} else {
		await run(op.action, op.root, op.file);
	}
} else if (first === "archive" || first === "delete") {
	await run(first, valueFor("--root") ?? "", valueFor("--file") ?? "");
} else {
	process.stderr.write(
		`usage:\n  bun ${scriptPath} install\n  bun ${scriptPath} archive|delete --root <project> --file <rel>\n`,
	);
	process.exitCode = 2;
}
