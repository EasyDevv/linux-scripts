const lvl = process.env.APP_DEBUG_LEVEL;
export const debug = Bun.env.APP_DEBUG === "1";
/* APP_TRACE is documented but unused */
