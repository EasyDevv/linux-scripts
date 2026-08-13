import { expect, test } from "bun:test";
import { loadConfig } from "./config";

test("uses an explicit VM name for its disk path", () => {
	const config = loadConfig("debian13-test");
	expect(config.name).toBe("debian13-test");
	expect(config.diskPath).toEndWith("/.vm-images/debian13-test.qcow2");
});

test("uses the dedicated VM management SSH key", () => {
	const config = loadConfig();
	expect(config.publicKeyPath).toEndWith("/.ssh/vm_ed25519.pub");
	expect(config.guestSharedDir).toBe("/home/easydev/shared");
});
