const port = Number(process.env.APP_PORT ?? 3000);
// process.env.APP_LEGACY_MODE was removed in v2
export const host = process.env["APP_HOST"] || "0.0.0.0";
