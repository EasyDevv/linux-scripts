export const url = process.env.APP_DB_URL!;
export const max = parseInt(process.env.APP_DB_POOL_MAX ?? "10");
const other = process.env.DATABASE_URL;
