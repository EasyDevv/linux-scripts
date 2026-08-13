#!/usr/bin/env bun

import { mkdir, readlink, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { ROUTE_SCREENSHOT_CONFIG } from "./config.ts";
import {
  activateTabById,
  CDP,
  closeTabById,
  createTab,
  type Tab,
} from "../control-chrome/cdp.ts";
import {
  browserReachable,
  findAvailablePort,
  readPortLock,
} from "../control-chrome/browser-state.ts";
import {
  findRunningChromeForProfile,
  processMatchesLaunchInfo,
  readLaunchInfo,
  resolveProjectProfileDir,
} from "../control-chrome/chrome-instance.ts";
import { minimizeWindow } from "../control-chrome/minimize.ts";
import { readConfig as readExecutorConfig } from "../executor/config.ts";

const HELP = `route-capture - archive discovered SvelteKit routes with control-chrome

Usage:
  bun dev/route-capture/main.ts [project-root] [options]

Options:
  --url <url>          Running app URL (default: ${ROUTE_SCREENSHOT_CONFIG.baseUrl})
  --port <port>        Chrome DevTools port requested from control-chrome (default: ${ROUTE_SCREENSHOT_CONFIG.chrome.port})
  --concurrency <n>    Parallel browser tabs (default: ${ROUTE_SCREENSHOT_CONFIG.capture.concurrency})
  --settle-ms <ms>     Extra wait after navigation for client rendering (default: ${ROUTE_SCREENSHOT_CONFIG.capture.settleMs})
  --timeout-ms <ms>    Per-navigation timeout (default: ${ROUTE_SCREENSHOT_CONFIG.capture.timeoutMs})
  --max-routes <n>     Maximum static and crawled routes to capture (default: ${ROUTE_SCREENSHOT_CONFIG.capture.maxRoutes})
  --headless           Run Chrome headless (default)
  --minimized          Run Chrome minimized instead of headless
  --json               Print the capture manifest as JSON
  --help, -h           Show this help

Generated files:
  <project-root>/.capture/static/*.mhtml
  <project-root>/.capture/screenshots/*.png
  <project-root>/.capture/manifest.json
  <project-root>/.user-data/chrome-<project-name>/

Defaults, including screenshot viewport, are in dev/route-capture/config.ts.

When a login form is found, the script focuses that tab and waits for you to
complete login in Chrome before it continues.`;

export type DiscoveredRoute = {
  path: string;
  dynamic: boolean;
  sourcePath: string;
};

type Options = {
  projectRoot: string;
  baseUrl: string;
  baseUrlExplicit: boolean;
  requestedPort: number;
  concurrency: number;
  settleMs: number;
  timeoutMs: number;
  maxRoutes: number;
  headless: boolean;
  json: boolean;
  captureDir: string;
  screenshotDir: string;
  staticDir: string;
  profileDir: string;
};

type ControlChromeOpenResult = {
  port?: number;
  userDataDir?: string;
};

type ResolvedChromePort = {
  port: number;
  reuseExisting: boolean;
};

type PageState = {
  url: string;
  title: string;
  readyState: string;
  hasLoginForm: boolean;
};

type CaptureTask = {
  url: string;
  fileName: string;
  source: "filesystem" | "crawl";
};

type ExclusiveRunner = <T>(task: () => Promise<T>) => Promise<T>;

export type CaptureResult = {
  requestedUrl: string;
  finalUrl?: string;
  title?: string;
  screenshot?: string;
  staticFile?: string;
  source: CaptureTask["source"];
  discoveredLinks: string[];
  error?: string;
};

type CaptureManifest = {
  generatedAt: string;
  projectRoot: string;
  baseUrl: string;
  chromePort: number;
  profileDir: string;
  captureDir: string;
  screenshotDir: string;
  staticDir: string;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  hideScrollbars: boolean;
  fullPage: boolean;
  dynamicSourceRoutes: string[];
  routes: CaptureResult[];
};

function fail(message: string): never {
  throw new Error(message);
}

export function createExclusiveRunner(): ExclusiveRunner {
  let tail = Promise.resolve();

  return async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

function nextArg(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`Usage: ${option} <value>`);
  return value;
}

function parsePositiveInteger(raw: string, option: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    fail(`${option} must be a positive integer`);
  return value;
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`Invalid --url value: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:")
    fail(`--url must use http or https: ${raw}`);

  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function parseArgs(argv: string[]): Options {
  let projectRoot = process.cwd();
  let baseUrl = ROUTE_SCREENSHOT_CONFIG.baseUrl;
  let baseUrlExplicit = false;
  let requestedPort = ROUTE_SCREENSHOT_CONFIG.chrome.port;
  let concurrency = ROUTE_SCREENSHOT_CONFIG.capture.concurrency;
  let settleMs = ROUTE_SCREENSHOT_CONFIG.capture.settleMs;
  let timeoutMs = ROUTE_SCREENSHOT_CONFIG.capture.timeoutMs;
  let maxRoutes = ROUTE_SCREENSHOT_CONFIG.capture.maxRoutes;
  let headless = true;
  let json = false;
  let hasProjectRoot = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--url":
        baseUrl = nextArg(argv, index, arg);
        baseUrlExplicit = true;
        index++;
        break;
      case "--port":
        requestedPort = parsePositiveInteger(nextArg(argv, index, arg), arg);
        index++;
        break;
      case "--concurrency":
        concurrency = parsePositiveInteger(nextArg(argv, index, arg), arg);
        index++;
        break;
      case "--settle-ms":
        settleMs = parsePositiveInteger(nextArg(argv, index, arg), arg);
        index++;
        break;
      case "--timeout-ms":
        timeoutMs = parsePositiveInteger(nextArg(argv, index, arg), arg);
        index++;
        break;
      case "--max-routes":
        maxRoutes = parsePositiveInteger(nextArg(argv, index, arg), arg);
        index++;
        break;
      case "--headless":
        headless = true;
        break;
      case "--minimized":
        headless = false;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
        if (hasProjectRoot) fail(`Unexpected argument: ${arg}`);
        projectRoot = arg;
        hasProjectRoot = true;
    }
  }

  projectRoot = resolve(projectRoot);
  return {
    projectRoot,
    baseUrl: normalizeBaseUrl(baseUrl),
    baseUrlExplicit,
    requestedPort,
    concurrency,
    settleMs,
    timeoutMs,
    maxRoutes,
    headless,
    json,
    captureDir: join(projectRoot, ".capture"),
    screenshotDir: join(projectRoot, ".capture", "screenshots"),
    staticDir: join(projectRoot, ".capture", "static"),
    profileDir: resolveProjectProfileDir(projectRoot),
  };
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function routeSegment(segment: string): string {
  if (!segment.includes("[")) return segment;

  const rawName = segment
    .replace(/\[/g, "")
    .replace(/\]/g, "")
    .replace(/^\.\.\./, "")
    .split("=")[0];
  return `:${rawName || "param"}`;
}

export function routeFromSvelteKitSourcePath(
  sourcePath: string,
): DiscoveredRoute | null {
  const normalized = toPosixPath(sourcePath);
  const match = normalized.match(/(?:^|\/)src\/routes\/(.+)$/);
  if (!match) return null;

  const routeFile = match[1];
  if (!/(?:^|\/)\+page\.(?:svelte|ts|js)$/.test(routeFile)) return null;

  const segments = routeFile
    .split("/")
    .slice(0, -1)
    .filter((segment) => !isRouteGroup(segment));
  const dynamic = segments.some((segment) => segment.includes("["));
  const path = segments.length
    ? `/${segments.map(routeSegment).join("/")}`
    : "/";

  return { path, dynamic, sourcePath: normalized };
}

export async function discoverSvelteKitRoutes(
  projectRoot: string,
): Promise<DiscoveredRoute[]> {
  const routeFiles = new Set<string>();
  const patterns = [
    "src/routes/**/+page.*",
    "apps/*/src/routes/**/+page.*",
    "packages/*/src/routes/**/+page.*",
  ];

  for (const pattern of patterns) {
    for await (const sourcePath of new Bun.Glob(pattern).scan({
      cwd: projectRoot,
      onlyFiles: true,
    })) {
      routeFiles.add(toPosixPath(sourcePath));
    }
  }

  const routes = new Map<string, DiscoveredRoute>();
  for (const sourcePath of routeFiles) {
    const route = routeFromSvelteKitSourcePath(sourcePath);
    if (!route) continue;

    const key = `${route.dynamic}:${route.path}`;
    const existing = routes.get(key);
    if (!existing || route.sourcePath.endsWith("+page.svelte")) {
      routes.set(key, route);
    }
  }

  return [...routes.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function ignoreLineMatches(line: string, path: string): boolean {
  const normalized = line.trim().replace(/^\//, "").replace(/\/$/, "");
  const target = path.replace(/^\//, "").replace(/\/$/, "");
  return normalized === target || target.startsWith(`${normalized}/`);
}

export async function ensureGeneratedPathsIgnored(
  projectRoot: string,
): Promise<boolean> {
  const gitignorePath = join(projectRoot, ".gitignore");
  const gitignore = Bun.file(gitignorePath);
  const current = (await gitignore.exists()) ? await gitignore.text() : "";
  const lines = current.split(/\r?\n/);
  const required = ["/.capture/", "/.user-data/"];
  const additions = required.filter(
    (path) => !lines.some((line) => ignoreLineMatches(line, path)),
  );

  if (!additions.length) return false;

  const separator = current && !current.endsWith("\n") ? "\n" : "";
  const hasHeader = lines.some(
    (line) => line.trim() === "# Generated route captures.",
  );
  const header = hasHeader ? "" : "# Generated route captures.\n";
  await Bun.write(
    gitignorePath,
    `${current}${separator}${header}${additions.join("\n")}\n`,
  );
  return true;
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function pageUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/$/, "");
  base.pathname = `${basePath}${path === "/" ? "/" : path}`.replace(
    /\/+/g,
    "/",
  );
  base.search = "";
  base.hash = "";
  return canonicalUrl(base.href);
}

function shortHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function screenshotFileName(urlValue: string): string {
  const url = new URL(urlValue);
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .map(
      (segment) =>
        segment.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
        "route",
    );
  const baseName = segments.length ? segments.join("--") : "index";
  const querySuffix = url.search ? `--${shortHash(url.search)}` : "";
  return `${baseName}${querySuffix}.png`;
}

export function extractInternalLinks(
  hrefs: string[],
  currentUrl: string,
  baseUrl: string,
): string[] {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/$/, "") || "/";
  const links = new Set<string>();

  for (const href of hrefs) {
    if (!href || /^(?:javascript|mailto|tel|data):/i.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, currentUrl);
    } catch {
      continue;
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== base.origin ||
      (basePath !== "/" &&
        url.pathname !== basePath &&
        !url.pathname.startsWith(`${basePath}/`)) ||
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/")
    )
      continue;

    links.add(canonicalUrl(url.href));
  }

  return [...links].sort();
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function respondsWithHtml(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(1000),
    });
    await response.body?.cancel();
    return response.headers.get("content-type")?.includes("text/html") ?? false;
  } catch {
    return false;
  }
}

async function waitForHtml(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await respondsWithHtml(url)) return true;
    await Bun.sleep(250);
  } while (Date.now() < deadline);
  return false;
}

async function detectProjectBaseUrl(options: Options): Promise<string> {
  if (options.baseUrlExplicit || (await respondsWithHtml(options.baseUrl)))
    return options.baseUrl;

  try {
    const executorConfig = await readExecutorConfig(false);
    if (executorConfig) {
      for (const [name, instance] of executorConfig.instances) {
        if (
          !executorConfig.isEnabled(name) ||
          resolve(instance.dir) !== options.projectRoot
        )
          continue;

        const port = Number(executorConfig.getPort(name));
        if (!Number.isInteger(port)) continue;
        const url = normalizeBaseUrl(`http://localhost:${port}`);
        if (await waitForHtml(url, 10_000)) return url;
      }
    }
  } catch {}

  const process = Bun.spawn(["ss", "-ltnpH"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    readStream(process.stdout),
  ]);
  if (exitCode !== 0) return options.baseUrl;

  const candidates = new Set<number>();
  for (const line of stdout.split("\n")) {
    if (!/users:\(\(\"(?:node|bun|deno|MainThread)\"/.test(line)) continue;
    const port = Number(line.match(/(?:127\.0\.0\.1|\[::1\]):(\d+)/)?.[1]);
    const pid = Number(line.match(/pid=(\d+)/)?.[1]);
    if (!Number.isInteger(port) || !Number.isInteger(pid)) continue;

    try {
      const processCwd = resolve(await readlink(`/proc/${pid}/cwd`));
      const pathFromProject = relative(options.projectRoot, processCwd);
      if (
        pathFromProject === "" ||
        (!pathFromProject.startsWith("..") && !pathFromProject.startsWith("/"))
      )
        candidates.add(port);
    } catch {}
  }

  for (const port of [...candidates].sort((a, b) => a - b)) {
    const url = normalizeBaseUrl(`http://localhost:${port}`);
    if (await respondsWithHtml(url)) return url;
  }
  return options.baseUrl;
}

async function resolveChromePort(
  options: Options,
): Promise<ResolvedChromePort> {
  const runningProfile = await findRunningChromeForProfile(options.profileDir);
  if (runningProfile && (await browserReachable(runningProfile.port)))
    return { port: runningProfile.port, reuseExisting: true };

  const previousLaunch = await readLaunchInfo(options.profileDir);
  if (
    previousLaunch?.pid &&
    previousLaunch.userDataDir === options.profileDir &&
    (await processMatchesLaunchInfo(previousLaunch)) === true &&
    (await browserReachable(previousLaunch.port))
  )
    return { port: previousLaunch.port, reuseExisting: true };

  for (
    let port = options.requestedPort;
    port < options.requestedPort + 100;
    port++
  ) {
    const lock = await readPortLock(port);
    if (
      lock?.userDataDir === options.profileDir &&
      lock.browserPid &&
      (await processMatchesLaunchInfo({
        pid: lock.browserPid,
        port,
        userDataDir: lock.userDataDir,
      })) === true &&
      (await browserReachable(port))
    )
      return { port, reuseExisting: true };
  }

  if (await browserReachable(options.requestedPort))
    return {
      port: await findAvailablePort(options.requestedPort + 1),
      reuseExisting: false,
    };

  return { port: options.requestedPort, reuseExisting: false };
}

async function openProjectChrome(options: Options): Promise<number> {
  const controlChrome = Bun.which("control-chrome");
  const resolved = await resolveChromePort(options);
  if (resolved.reuseExisting) {
    const minimized = await minimizeWindow(resolved.port, {
      timeoutMs: 2_000,
      silent: true,
    });
    if (minimized) options.headless = false;
    console.error(`✓ Reusing project Chrome on port ${resolved.port}`);
    return resolved.port;
  }
  console.error(
    `→ Opening ${options.headless ? "headless" : "minimized"} project Chrome on port ${resolved.port}...`,
  );
  const openArgs = [
    "open",
    "--port",
    String(resolved.port),
    "--url",
    options.baseUrl,
    "--browser-arg",
    `--window-size=${ROUTE_SCREENSHOT_CONFIG.chrome.viewport.width},${ROUTE_SCREENSHOT_CONFIG.chrome.viewport.height}`,
    "--json",
  ];
  openArgs.push(options.headless ? "--headless" : "--minimize");

  const command = controlChrome
    ? [controlChrome, ...openArgs]
    : [
        "bun",
        join(import.meta.dir, "..", "control-chrome", "main.ts"),
        ...openArgs,
      ];
  const process = Bun.spawn({
    cmd: command,
    cwd: options.projectRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    readStream(process.stdout),
    readStream(process.stderr),
  ]);

  if (exitCode !== 0)
    fail(`control-chrome open failed: ${stderr.trim() || stdout.trim()}`);

  let result: ControlChromeOpenResult;
  try {
    result = JSON.parse(stdout) as ControlChromeOpenResult;
  } catch {
    fail(`control-chrome returned invalid JSON: ${stdout.trim()}`);
  }

  if (!result.port || !Number.isInteger(result.port))
    fail("control-chrome did not return a DevTools port");
  if (result.userDataDir !== options.profileDir)
    fail(
      `control-chrome selected ${result.userDataDir ?? "an unknown profile"} instead of ${options.profileDir}`,
    );
  return result.port;
}

async function closeProjectChrome(
  options: Options,
  port: number,
): Promise<void> {
  const controlChrome = Bun.which("control-chrome");
  const command = controlChrome
    ? [controlChrome, "close", "--port", String(port), "--json"]
    : [
        "bun",
        join(import.meta.dir, "..", "control-chrome", "main.ts"),
        "close",
        "--port",
        String(port),
        "--json",
      ];
  const process = Bun.spawn({
    cmd: command,
    cwd: options.projectRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    readStream(process.stdout),
    readStream(process.stderr),
  ]);
  if (exitCode !== 0)
    fail(`control-chrome close failed: ${stderr.trim() || stdout.trim()}`);
  console.error(`✓ Closed project Chrome on port ${port}`);
}

async function evaluateValue(cdp: CDP, expression: string): Promise<unknown> {
  const result = await cdp.send<{
    result?: { value?: unknown; description?: string };
    exceptionDetails?: { text?: string };
  }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails)
    fail(
      `Page evaluation failed: ${result.exceptionDetails.text ?? "unknown error"}`,
    );
  return result.result?.value;
}

async function inspectPage(cdp: CDP): Promise<PageState> {
  const value = await evaluateValue(
    cdp,
    `JSON.stringify({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      hasLoginForm: (() => {
        const password = document.querySelector('input[autocomplete="current-password"], input[type="password"]');
        const form = password?.closest('form');
        if (!password || !form) return false;
        const marker = location.pathname + " " + document.title + " " + (form.textContent ?? "");
        return password.getAttribute('autocomplete') === 'current-password' || /log[ -]?in|sign[ -]?in|authenticate|로그인/i.test(marker);
      })()
    })`,
  );
  if (typeof value !== "string") fail("Unable to inspect the current page");
  return JSON.parse(value) as PageState;
}

async function waitForDocumentReady(
  cdp: CDP,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyState = await evaluateValue(cdp, "document.readyState");
    if (readyState === "complete") return;
    await Bun.sleep(100);
  }
  fail(`Timed out after ${timeoutMs}ms waiting for page load`);
}

async function waitForVisiblePageContent(
  cdp: CDP,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasContent = await evaluateValue(
      cdp,
      `(() => {
        const body = document.body;
        if (!body) return false;
        if (body.innerText.trim().length > 0) return true;
        return Array.from(body.querySelectorAll('img, svg, canvas, video')).some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      })()`,
    );
    if (hasContent === true) return;
    await Bun.sleep(100);
  }
}

async function navigateAndInspect(
  cdp: CDP,
  url: string,
  options: Options,
): Promise<PageState> {
  const navigation = await cdp.send<{ errorText?: string }>("Page.navigate", {
    url,
  });
  if (navigation.errorText) fail(navigation.errorText);
  await waitForDocumentReady(cdp, options.timeoutMs);
  await waitForVisiblePageContent(cdp, options.timeoutMs);
  await Bun.sleep(options.settleMs);
  return inspectPage(cdp);
}

async function collectHrefs(cdp: CDP): Promise<string[]> {
  const document = await cdp.send<{ root?: { nodeId?: number } }>(
    "DOM.getDocument",
    { depth: 1 },
  );
  const rootNodeId = document.root?.nodeId;
  if (!rootNodeId) return [];

  const selected = await cdp.send<{ nodeIds?: number[] }>(
    "DOM.querySelectorAll",
    {
      nodeId: rootNodeId,
      selector: "a[href]",
    },
  );
  const hrefs: string[] = [];
  for (const nodeId of selected.nodeIds ?? []) {
    const attributes = await cdp.send<{ attributes?: string[] }>(
      "DOM.getAttributes",
      { nodeId },
    );
    const values = attributes.attributes ?? [];
    for (let index = 0; index < values.length; index += 2) {
      if (values[index]?.toLowerCase() === "href" && values[index + 1]) {
        hrefs.push(values[index + 1]);
      }
    }
  }

  return hrefs;
}

async function saveScreenshot(cdp: CDP, outputPath: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const screenshot = await cdp.send<{ data?: string }>(
        "Page.captureScreenshot",
        {
          format: "png",
          captureBeyondViewport: ROUTE_SCREENSHOT_CONFIG.capture.fullPage,
          fromSurface: true,
        },
      );
      if (!screenshot.data) fail("Chrome returned an empty screenshot");
      await Bun.write(outputPath, Buffer.from(screenshot.data, "base64"));
      return;
    } catch (error) {
      if (
        attempt > 0 ||
        !(error instanceof Error) ||
        !error.message.startsWith(
          "CDP command timed out: Page.captureScreenshot",
        )
      )
        throw error;
      await Bun.sleep(250);
    }
  }
}

async function saveStaticPage(cdp: CDP, outputPath: string): Promise<void> {
  const snapshot = await cdp.send<{ data?: string }>("Page.captureSnapshot", {
    format: "mhtml",
  });
  if (!snapshot.data) fail("Chrome returned an empty static page snapshot");
  await Bun.write(outputPath, snapshot.data);
}

async function configureViewport(cdp: CDP): Promise<void> {
  const { width, height, deviceScaleFactor } =
    ROUTE_SCREENSHOT_CONFIG.chrome.viewport;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp.send("Emulation.setScrollbarsHidden", {
    hidden: ROUTE_SCREENSHOT_CONFIG.chrome.hideScrollbars,
  });
}

async function waitForEnter(): Promise<void> {
  if (!process.stdin.isTTY)
    fail(
      "Authentication is required, but standard input is not interactive. Run from a terminal after authenticating the project Chrome profile.",
    );

  await new Promise<void>((resolvePromise, reject) => {
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
      process.stdin.pause();
    };
    const onData = () => {
      cleanup();
      resolvePromise();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    process.stdin.once("data", onData);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

function createLoginGate(options: Options, port: number) {
  let pending: Promise<void> | undefined;

  return async (tab: Tab, url: string): Promise<void> => {
    if (!pending) {
      pending = (async () => {
        if (options.headless)
          fail(
            `Authentication is required at ${url}. Re-run without --headless to log in, then reuse the persistent project profile.`,
          );
        await activateTabById(port, tab.id);
        console.log(`\nAuthentication is required at ${url}.`);
        console.log(
          "Complete login in the focused Chrome tab, then press Enter here.",
        );
        await waitForEnter();
        await Bun.sleep(options.settleMs);
      })().finally(() => {
        pending = undefined;
      });
    }
    return pending;
  };
}

async function captureLoadedPage(
  cdp: CDP,
  task: CaptureTask,
  state: PageState,
  options: Options,
  captureExclusive: ExclusiveRunner,
): Promise<CaptureResult> {
  const screenshot = join("screenshots", task.fileName);
  const staticFile = join("static", task.fileName.replace(/\.png$/, ".mhtml"));
  const hrefs = await collectHrefs(cdp);
  await captureExclusive(async () => {
    await saveStaticPage(cdp, join(options.captureDir, staticFile));
    await saveScreenshot(cdp, join(options.captureDir, screenshot));
  });
  return {
    requestedUrl: task.url,
    finalUrl: canonicalUrl(state.url),
    title: state.title,
    screenshot,
    staticFile,
    source: task.source,
    discoveredLinks: extractInternalLinks(hrefs, state.url, options.baseUrl),
  };
}

async function captureInTab(
  cdp: CDP,
  tab: Tab,
  task: CaptureTask,
  options: Options,
  requestLogin: ReturnType<typeof createLoginGate>,
  captureExclusive: ExclusiveRunner,
): Promise<CaptureResult> {
  for (let loginAttempt = 0; loginAttempt < 2; loginAttempt++) {
    const state = await navigateAndInspect(cdp, task.url, options);
    if (!state.hasLoginForm)
      return captureLoadedPage(cdp, task, state, options, captureExclusive);

    await requestLogin(tab, state.url);
  }

  fail(`Page still requires login after human confirmation: ${task.url}`);
}

async function captureInNewTab(
  port: number,
  task: CaptureTask,
  options: Options,
  requestLogin: ReturnType<typeof createLoginGate>,
  captureExclusive: ExclusiveRunner,
): Promise<CaptureResult> {
  let tab: Tab | null = null;
  let cdp: CDP | undefined;
  try {
    tab = await createTab(port, "about:blank");
    if (!tab?.webSocketDebuggerUrl)
      fail(`Unable to create a Chrome tab for ${task.url}`);

    cdp = await CDP.connect(tab.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await configureViewport(cdp);
    return await captureInTab(
      cdp,
      tab,
      task,
      options,
      requestLogin,
      captureExclusive,
    );
  } catch (error) {
    return {
      requestedUrl: task.url,
      source: task.source,
      discoveredLinks: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    cdp?.close();
    if (tab) await closeTabById(port, tab.id);
  }
}

async function mapConcurrent<T, Result>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function taskFor(
  url: string,
  source: CaptureTask["source"],
  usedFileNames: Set<string>,
): CaptureTask {
  const baseName = screenshotFileName(url);
  let fileName = baseName;
  if (usedFileNames.has(fileName)) {
    const extensionIndex = baseName.lastIndexOf(".");
    fileName = `${baseName.slice(0, extensionIndex)}--${shortHash(url)}${baseName.slice(extensionIndex)}`;
  }
  usedFileNames.add(fileName);
  return { url, fileName, source };
}

async function run(options: Options): Promise<CaptureManifest> {
  await ensureGeneratedPathsIgnored(options.projectRoot);
  await Promise.all([
    rm(options.screenshotDir, { recursive: true, force: true }),
    rm(options.staticDir, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(options.screenshotDir, { recursive: true }),
    mkdir(options.staticDir, { recursive: true }),
  ]);
  const configuredBaseUrl = options.baseUrl;
  options.baseUrl = await detectProjectBaseUrl(options);
  if (options.baseUrl !== configuredBaseUrl)
    console.error(`✓ Detected project web server at ${options.baseUrl}`);

  console.error(`→ Discovering routes in ${options.projectRoot}...`);
  const sourceRoutes = await discoverSvelteKitRoutes(options.projectRoot);
  if (!sourceRoutes.length)
    fail(
      `No SvelteKit +page files found below ${options.projectRoot}. Expected src/routes or apps/*/src/routes.`,
    );
  console.error(`✓ Found ${sourceRoutes.length} source routes`);

  const port = await openProjectChrome(options);
  try {
    const requestLogin = createLoginGate(options, port);
    const captureExclusive = createExclusiveRunner();
    const usedFileNames = new Set<string>();
    const queuedUrls = new Set<string>();
    const tasks: CaptureTask[] = [];
    const enqueue = (url: string, source: CaptureTask["source"]): boolean => {
      const canonical = canonicalUrl(url);
      if (queuedUrls.has(canonical) || queuedUrls.size >= options.maxRoutes)
        return false;
      queuedUrls.add(canonical);
      tasks.push(taskFor(canonical, source, usedFileNames));
      return true;
    };

    const rootUrl = pageUrl(options.baseUrl, "/");
    enqueue(rootUrl, "filesystem");
    const bootstrapTask = tasks.shift();
    if (!bootstrapTask) fail("Unable to create a root capture task");
    console.error(`→ Capturing ${bootstrapTask.url}`);
    const bootstrapResult = await captureInNewTab(
      port,
      bootstrapTask,
      options,
      requestLogin,
      captureExclusive,
    );
    console.error(
      bootstrapResult.screenshot
        ? `✓ Captured ${bootstrapResult.screenshot}`
        : `✗ ${bootstrapTask.url}: ${bootstrapResult.error ?? "capture failed"}`,
    );
    const results = [bootstrapResult];

    for (const route of sourceRoutes) {
      if (!route.dynamic && route.path !== "/")
        enqueue(pageUrl(options.baseUrl, route.path), "filesystem");
    }

    while (tasks.length) {
      const batch = tasks.splice(0);
      const captured = await mapConcurrent(
        batch,
        options.concurrency,
        async (task) => {
          console.error(`→ Capturing ${task.url}`);
          const result = await captureInNewTab(
            port,
            task,
            options,
            requestLogin,
            captureExclusive,
          );
          console.error(
            result.screenshot
              ? `✓ Captured ${result.screenshot}`
              : `✗ ${task.url}: ${result.error ?? "capture failed"}`,
          );
          return result;
        },
      );
      results.push(...captured);

      for (const result of captured) {
        for (const link of result.discoveredLinks) enqueue(link, "crawl");
      }
    }

    const manifest: CaptureManifest = {
      generatedAt: new Date().toISOString(),
      projectRoot: options.projectRoot,
      baseUrl: options.baseUrl,
      chromePort: port,
      profileDir: options.profileDir,
      captureDir: options.captureDir,
      screenshotDir: options.screenshotDir,
      staticDir: options.staticDir,
      viewport: { ...ROUTE_SCREENSHOT_CONFIG.chrome.viewport },
      hideScrollbars: ROUTE_SCREENSHOT_CONFIG.chrome.hideScrollbars,
      fullPage: ROUTE_SCREENSHOT_CONFIG.capture.fullPage,
      dynamicSourceRoutes: sourceRoutes
        .filter((route) => route.dynamic)
        .map((route) => route.path),
      routes: results,
    };
    await Bun.write(
      join(options.captureDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return manifest;
  } finally {
    await closeProjectChrome(options, port);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await run(options);
  const successful = manifest.routes.filter(
    (route) => route.screenshot && route.staticFile,
  ).length;
  const failed = manifest.routes.filter((route) => route.error);

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(
      `Captured ${successful}/${manifest.routes.length} routes in ${relative(options.projectRoot, options.captureDir) || ".capture"}.`,
    );
    console.log(`Manifest: ${join(options.captureDir, "manifest.json")}`);
    for (const route of failed) {
      console.error(`✗ ${route.requestedUrl}: ${route.error}`);
    }
  }

  if (failed.length) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
