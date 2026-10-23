/** Every feature the daemon serves; the server mounts each at its `path`. */

import { dispatchFeature } from "./dispatch.ts";
import { findSkill } from "./find-skill.ts";
import { findTool } from "./find-tool.ts";
import { guardFeature } from "./guard.ts";
import { loop } from "./loop.ts";
import { modelRoute } from "./model-route.ts";
import type { FeatureDef } from "./types.ts";

export const FEATURES: readonly FeatureDef[] = [modelRoute, findSkill, findTool, loop, guardFeature, dispatchFeature];

export function feature(name: string): FeatureDef | undefined {
	return FEATURES.find((f) => f.name === name);
}
