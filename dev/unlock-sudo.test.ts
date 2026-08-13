import { expect, test } from "bun:test";
import { applyTarget, targetCommand, type TargetRunner } from "./unlock-sudo";

test("quotes a complete remote command", () => {
	expect(targetCommand("cachyos", ["printf", "%s", "a'b c"])).toEqual([
		"ssh",
		"cachyos-home",
		`'printf' '%s' 'a'"'"'b c'`,
	]);
});

test("authenticates and installs in one sudo process", async () => {
	const calls: Array<{ args: string[]; stdin?: string }> = [];
	let installed = false;
	const run: TargetRunner = async (_target, args, options = {}) => {
		calls.push({ args, stdin: options.stdin });
		if (args.join(" ") === "sudo -n true") return installed ? 0 : 1;
		if (args.slice(0, 7).join(" ") === "sudo -S -k -p  sh -c") {
			expect(options.stdin).toBe("secret\n");
			expect(args[7]).toContain("visudo -cf /etc/sudoers");
			installed = true;
			return 0;
		}
		return 1;
	};

	await applyTarget("local", "local PC", async () => "secret", run);
	expect(calls).toHaveLength(3);
	expect(calls.some(({ args }) => args.includes("-v"))).toBe(false);
	expect(installed).toBe(true);
});

test("skips a target that already has passwordless sudo", async () => {
	const calls: string[][] = [];
	const run: TargetRunner = async (_target, args) => {
		calls.push(args);
		return args.join(" ") === "sudo -n true" ? 0 : 1;
	};
	let prompted = false;

	await applyTarget(
		"vm",
		"debian13-kde-podman",
		async () => {
			prompted = true;
			return "secret";
		},
		run,
	);

	expect(calls).toEqual([["sudo", "-n", "true"]]);
	expect(prompted).toBe(false);
});
