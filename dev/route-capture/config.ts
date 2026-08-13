/**
 * Route screenshot defaults. CLI options override these values for one run.
 */
export const ROUTE_SCREENSHOT_CONFIG = {
	baseUrl: "http://localhost:5173",
	chrome: {
		port: 9222,
		viewport: {
			width: 1440,
			height: 1440,
			deviceScaleFactor: 1,
		},
		hideScrollbars: true,
	},
	capture: {
		concurrency: 4,
		settleMs: 1_500,
		timeoutMs: 20_000,
		maxRoutes: 100,
		fullPage: false,
	},
};
