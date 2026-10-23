import { expect, test } from "bun:test";

import {
	displayLaunchEnv,
	hasDisplay,
	missingDisplayEnv,
	NO_DISPLAY_MESSAGE,
} from "./display-env.ts";

const SHOWN = `HOME=/home/example
DISPLAY=:0
QT_WAYLAND_RECONNECT=1
WAYLAND_DISPLAY=wayland-1
XAUTHORITY=/run/user/1000/xauth_abc
EMPTY_DISPLAY=
`;

test("takes the display variables the process lacks", () => {
	expect(missingDisplayEnv(SHOWN, () => false)).toEqual({
		DISPLAY: ":0",
		WAYLAND_DISPLAY: "wayland-1",
		XAUTHORITY: "/run/user/1000/xauth_abc",
	});
});

test("keeps only the keys the process lacks", () => {
	const have = new Set(["DISPLAY"]);
	expect(missingDisplayEnv(SHOWN, (key) => have.has(key))).toEqual({
		WAYLAND_DISPLAY: "wayland-1",
		XAUTHORITY: "/run/user/1000/xauth_abc",
	});
});

test("ignores other variables, empty values, and lines without =", () => {
	const shown = `DISPLAY=:1
WAYLAND_DISPLAY=
XAUTHORITY=
noise
DISPLAY_EXTRA=:2
`;
	expect(missingDisplayEnv(shown, () => false)).toEqual({ DISPLAY: ":1" });
	expect(missingDisplayEnv("", () => false)).toEqual({});
});

test("splits on the first = only", () => {
	expect(missingDisplayEnv("XAUTHORITY=/tmp/x=a=b\n", () => false)).toEqual({
		XAUTHORITY: "/tmp/x=a=b",
	});
});

test("a display is DISPLAY or WAYLAND_DISPLAY, not XAUTHORITY", () => {
	expect(hasDisplay({ WAYLAND_DISPLAY: "wayland-1" })).toBe(true);
	expect(hasDisplay({ DISPLAY: ":0" })).toBe(true);
	expect(hasDisplay({ XAUTHORITY: "/run/user/1000/xauth_abc" })).toBe(false);
	expect(hasDisplay({})).toBe(false);
});

test("an inherited display needs no lookup", async () => {
	expect(await displayLaunchEnv({ WAYLAND_DISPLAY: "wayland-1" })).toEqual({
		env: {},
		display: true,
	});
});

test("without a display the message names both ways out", () => {
	expect(NO_DISPLAY_MESSAGE).toContain("--headless");
	expect(NO_DISPLAY_MESSAGE).toContain("WAYLAND_DISPLAY/DISPLAY unset");
});
