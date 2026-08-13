#!/usr/bin/env bun

import { getMainRoot } from "./git";
import { cmdNew, cmdList, cmdApply, cmdMerge, cmdStatus, cmdRm } from "./cmds";
import { cmdDiff } from "./diff";

// ── Flags ──

export interface Flags {
	positional: string[];
	symlinks: string[];
	copies: string[];
	branch?: string;
	dryRun: boolean;
	force: boolean;
	noPrompt: boolean;
	patch: boolean;
	json: boolean;
	squash: boolean;
	rstSrc: boolean;
	rmSrc: boolean;
	keepBranch: boolean;
}

const BOOL_FLAGS = new Set([
	"dry-run",
	"force",
	"no-prompt",
	"patch",
	"json",
	"squash",
	"rst-src",
	"rm-src",
	"keep-branch",
]);
const VAL_FLAGS = new Set(["symlink", "copy", "branch"]);

type FlagScope = "new" | "apply" | "merge" | "diff" | "ls" | "status" | "rm";

const FLAG_SCOPES: Record<string, FlagScope[]> = {
	symlink: ["new", "apply"],
	copy: ["new", "apply"],
	branch: ["new"],
	"no-prompt": ["new", "rm"],
	force: ["new", "apply", "merge", "rm"],
	"dry-run": ["new", "apply", "merge", "rm"],
	patch: ["diff"],
	json: ["diff", "ls", "status"],
	"keep-branch": ["rm"],
	squash: ["merge"],
	"rst-src": ["merge"],
	"rm-src": ["merge"],
};

function validateFlags(flags: Flags, sub: string): void {
	for (const [flag, scopes] of Object.entries(FLAG_SCOPES)) {
		const camel = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
		if ((flags as any)[camel] && !scopes.includes(sub as FlagScope)) {
			throw new Error(
				`--${flag} is only valid with: ${scopes.join(", ")} (used: ${sub})`,
			);
		}
	}
}

export function parseFlags(args: string[]): Flags {
	const f: Flags = {
		positional: [],
		symlinks: [],
		copies: [],
		dryRun: false,
		force: false,
		noPrompt: false,
		patch: false,
		json: false,
		squash: false,
		rstSrc: false,
		rmSrc: false,
		keepBranch: false,
	};
	let i = 0;
	while (i < args.length) {
		const a = args[i];
		if (BOOL_FLAGS.has(a.slice(2))) {
			(f as any)[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
				true;
			i++;
		} else if (VAL_FLAGS.has(a.slice(2))) {
			const k = a.slice(2);
			i++;
			if (i >= args.length) {
				console.error(`Missing value for ${a}`);
				throw new Error("invalid arguments");
			}
			if (k === "symlink") f.symlinks.push(args[i]);
			else if (k === "copy") f.copies.push(args[i]);
			else f.branch = args[i];
			i++;
		} else if (
			a.startsWith("--symlink=") ||
			a.startsWith("--copy=") ||
			a.startsWith("--branch=")
		) {
			const eq = a.indexOf("=");
			const k = a.slice(2, eq);
			const v = a.slice(eq + 1);
			if (k === "symlink") f.symlinks.push(v);
			else if (k === "copy") f.copies.push(v);
			else f.branch = v;
			i++;
		} else if (a.startsWith("-")) {
			console.error(`Unknown flag: ${a}`);
			throw new Error("invalid arguments");
		} else {
			f.positional.push(a);
			i++;
		}
	}
	return f;
}

// ── Help data ──

const SUBCOMMAND_HELP: Record<
	string,
	{ description: string; usage: string; examples: string[]; seeAlso: string[] }
> = {
	new: {
		description: "Create a new worktree",
		usage: "atree new [slot]",
		examples: [
			"atree new",
			"atree new 1",
			"atree new 1 --symlink .env",
			"atree new --branch feature/x 1",
		],
		seeAlso: ["apply", "diff"],
	},
	ls: {
		description: "List worktree slots",
		usage: "atree ls",
		examples: ["atree ls", "atree ls --json"],
		seeAlso: ["status"],
	},
	apply: {
		description: "Reapply config to worktree(s)",
		usage: "atree apply [slot]",
		examples: ["atree apply", "atree apply 1 --force"],
		seeAlso: ["new"],
	},
	diff: {
		description: "Show changes across worktrees",
		usage: "atree diff [slot]",
		examples: [
			"atree diff",
			"atree diff 1",
			"atree diff --patch",
			"atree diff --json",
		],
		seeAlso: ["merge", "rm"],
	},
	merge: {
		description: "Merge a worktree branch into main",
		usage: "atree merge <slot>",
		examples: [
			"atree merge 1",
			"atree merge 1 --squash",
			"atree merge 1 --rm-src",
			"atree merge 1 --rst-src",
		],
		seeAlso: ["diff", "rm"],
	},
	rm: {
		description: "Remove worktree + branch (with confirm)",
		usage: "atree rm <slot>",
		examples: [
			"atree rm 1",
			"atree rm 1 --force",
			"atree rm 1 --keep-branch",
			"atree rm 1 --dry-run",
		],
		seeAlso: ["diff"],
	},
	status: {
		description: "Show active sessions/locks and slot overview",
		usage: "atree status",
		examples: ["atree status", "atree status --json"],
		seeAlso: ["ls"],
	},
	root: {
		description: "Print main repository root",
		usage: "atree root",
		examples: [],
		seeAlso: [],
	},
	sh: {
		description: "Print shell integration code",
		usage: "atree sh",
		examples: [],
		seeAlso: [],
	},
};

const FLAG_DESC: Record<string, string> = {
	symlink: "Path to share via symlink (repeatable)",
	copy: "Path to copy (repeatable)",
	branch: "Branch name (default atree/<slot>)",
	force: "Skip safety checks",
	"dry-run": "Preview only",
	"no-prompt": "Skip confirmations",
	"keep-branch": "Keep branch when removing",
	patch: "Show full diff",
	json: "Machine-readable output",
	squash: "Squash merge",
	"rst-src": "Reset source to main after merge",
	"rm-src": "Remove source worktree after merge",
};

// ── Help functions ──

function showGeneralHelp(): void {
	const maxName = Math.max(
		...Object.keys(SUBCOMMAND_HELP).map((s) => `${s}`.length),
	);
	const lines: string[] = [
		`atree - Git worktree manager\n`,
		`Usage:\n  atree <command> [options]\n`,
		"Commands:",
	];
	for (const [sub, info] of Object.entries(SUBCOMMAND_HELP)) {
		lines.push(`  ${sub.padEnd(maxName)}  ${info.description}`);
	}
	lines.push(``, "Run 'atree help <command>' for command-specific help.");
	console.log(lines.join("\n"));
}

function showSubcommandHelp(sub: string): void {
	const info = SUBCOMMAND_HELP[sub];
	const lines: string[] = [
		`atree ${sub} - ${info.description}\n`,
		`Usage:\n  ${info.usage}\n`,
	];

	const relevantFlags = Object.entries(FLAG_SCOPES)
		.filter(([_, scopes]) => scopes.includes(sub as FlagScope))
		.map(([flag]) => flag);

	if (relevantFlags.length > 0) {
		lines.push("Options:");
		const labelWidth = Math.max(...relevantFlags.map((f) => f.length)) + 2;
		for (const flag of relevantFlags) {
			const desc = FLAG_DESC[flag] || "";
			lines.push(`  --${flag.padEnd(labelWidth - 2)} ${desc}`);
		}
		lines.push("");
	}

	if (info.examples.length > 0) {
		lines.push("Examples:");
		for (const ex of info.examples) lines.push(`  ${ex}`);
		lines.push("");
	}

	if (info.seeAlso.length > 0) {
		lines.push(`See also: ${info.seeAlso.join(", ")}`);
	}

	console.log(lines.join("\n"));
}

function detectHelp(args: string[]): { sub: string | null; isHelp: boolean } {
	if (args.length === 0) return { sub: null, isHelp: false };

	const hasHelpFlag = args.includes("--help") || args.includes("-h");

	// --help / -h as first arg → general
	if (args[0] === "--help" || args[0] === "-h") {
		return { sub: null, isHelp: true };
	}

	// "help" [sub]
	if (args[0] === "help") {
		return { sub: args[1] || null, isHelp: true };
	}

	// <sub> --help / <sub> -h
	if (hasHelpFlag && !args[0].startsWith("-")) {
		return { sub: args[0], isHelp: true };
	}

	return { sub: null, isHelp: false };
}

function showShellInit(): void {
	console.log(`# atree shell integration — add to ~/.bashrc or ~/.zshrc:
atree() {
  if [ "\$1" = "root" ]; then
    local target
    target="\$(command atree root)"
    if [ -n "\$target" ]; then
      cd "\$target" || return 1
    fi
  else
    command atree "\$@"
  fi
}`);
}

// ── Entry ──

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	const help = detectHelp(args);
	if (help.isHelp) {
		if (help.sub && help.sub in SUBCOMMAND_HELP) {
			showSubcommandHelp(help.sub);
		} else if (help.sub) {
			console.error(`Unknown command: ${help.sub}`);
			console.error("Run 'atree --help' for the list of commands.");
			throw new Error("invalid arguments");
		} else {
			showGeneralHelp();
		}
		return;
	}

	const flags = parseFlags(args);
	const sub = flags.positional[0] || "new";
	validateFlags(flags, sub);

	if (sub === "root") {
		try {
			console.log(await getMainRoot());
		} catch (e: any) {
			console.error(`Error: ${e.message}`);
			throw new Error("invalid arguments");
		}
		return;
	}
	if (sub === "sh") {
		showShellInit();
		return;
	}

	let root: string;
	try {
		root = await getMainRoot();
	} catch (e: any) {
		console.error(`Error: ${e.message}`);
		throw new Error("invalid arguments");
	}

	switch (sub) {
		case "new":
			await cmdNew(root, flags);
			break;
		case "ls":
			await cmdList(root, flags);
			break;
		case "apply":
			await cmdApply(root, flags);
			break;
		case "diff":
			await cmdDiff(root, flags);
			break;
		case "merge":
			await cmdMerge(root, flags);
			break;
		case "status":
			await cmdStatus(root, flags);
			break;
		case "rm":
			await cmdRm(root, flags);
			break;
		default:
			console.error(`Unknown subcommand: ${sub}`);
			throw new Error("invalid arguments");
	}
}

main().catch((e: any) => {
	if (e?.code) process.exit(e.code);
	if (e?.message) console.error(`Error: ${e.message}`);
	process.exit(1);
});
