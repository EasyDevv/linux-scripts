#!/usr/bin/env node
/**
 * wxt-submit.mjs — Submit extension zips to Chrome, Firefox, and Edge stores.
 *
 * Reads name + version from ./package.json and store credentials from .env.submit,
 * then runs `wxt submit` with the correct zip paths.
 *
 * Usage:
 *   node ~/.local/bin/wxt/wxt-submit.mjs [options]
 *
 * Options:
 *   --dry-run              Check auth without uploading
 *   --chrome               Submit to Chrome Web Store only
 *   --firefox              Submit to Firefox Add-ons only
 *   --edge                 Submit to Edge Add-ons only
 *   --skip-zip-check       Skip zip file existence validation
 *   (any other flags are forwarded to wxt submit)
 */
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

function resolveWxtBin(cwd) {
  return path.join(cwd, 'node_modules/.bin/wxt-publish-extension');
}

const ANSI = {
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function colorize(text, color) {
  return useColor ? `${color}${text}${ANSI.reset}` : text;
}

function emitInfo(message) {
  process.stdout.write(`${colorize('==>', ANSI.cyan)} ${message}\n`);
}

function emitWarn(message) {
  process.stderr.write(`${colorize('warn', ANSI.yellow)} ${message}\n`);
}

function emitError(message) {
  process.stderr.write(`${colorize('error', ANSI.red)} ${message}\n`);
}

function isUndefined(value) {
  return !value || value === 'undefined' || value === 'null' || value === '';
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEnvFile(contents) {
  const vars = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const STORE_CONFIGS = [
  {
    name: 'chrome',
    selectorFlag: '--chrome',
    zipFlag: '--chrome-zip',
    zipSuffix: 'chrome.zip',
    requiredCredentials: ['CHROME_EXTENSION_ID', 'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN'],
    envToFlag: {
      CHROME_EXTENSION_ID: '--chrome-extension-id',
      CHROME_CLIENT_ID: '--chrome-client-id',
      CHROME_CLIENT_SECRET: '--chrome-client-secret',
      CHROME_REFRESH_TOKEN: '--chrome-refresh-token',
      CHROME_PUBLISH_TARGET: '--chrome-publish-target',
      CHROME_DEPLOY_PERCENTAGE: '--chrome-deploy-percentage',
      CHROME_SKIP_SUBMIT_REVIEW: '--chrome-skip-submit-review',
    },
    booleanFlags: new Set(['CHROME_SKIP_SUBMIT_REVIEW']),
  },
  {
    name: 'firefox',
    selectorFlag: '--firefox',
    zipFlag: '--firefox-zip',
    zipSuffix: 'firefox.zip',
    sourcesZipFlag: '--firefox-sources-zip',
    sourcesZipSuffix: 'sources.zip',
    requiredCredentials: ['FIREFOX_EXTENSION_ID', 'FIREFOX_JWT_ISSUER', 'FIREFOX_JWT_SECRET'],
    envToFlag: {
      FIREFOX_EXTENSION_ID: '--firefox-extension-id',
      FIREFOX_JWT_ISSUER: '--firefox-jwt-issuer',
      FIREFOX_JWT_SECRET: '--firefox-jwt-secret',
      FIREFOX_CHANNEL: '--firefox-channel',
    },
    booleanFlags: new Set(),
  },
  {
    name: 'edge',
    selectorFlag: '--edge',
    zipFlag: '--edge-zip',
    zipSuffix: 'chrome.zip',
    requiredCredentials: ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'],
    envToFlag: {
      EDGE_PRODUCT_ID: '--edge-product-id',
      EDGE_CLIENT_ID: '--edge-client-id',
      EDGE_API_KEY: '--edge-api-key',
      EDGE_SKIP_SUBMIT_REVIEW: '--edge-skip-submit-review',
    },
    booleanFlags: new Set(['EDGE_SKIP_SUBMIT_REVIEW']),
  },
];

const REDACTED_VALUE_FLAGS = new Set(
  STORE_CONFIGS.flatMap((store) =>
    Object.entries(store.envToFlag)
      .filter(([envKey]) => !store.booleanFlags.has(envKey))
      .map(([, cliFlag]) => cliFlag),
  ),
);

function sanitizeArgsForPreview(args) {
  const previewArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    previewArgs.push(arg);

    if (REDACTED_VALUE_FLAGS.has(arg) && index + 1 < args.length) {
      previewArgs.push('<redacted>');
      index += 1;
    }
  }

  return previewArgs;
}

function getMissingRequiredCredentials(store, envVars) {
  return store.requiredCredentials.filter((key) => isUndefined(envVars[key]));
}

async function main() {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  const storeSelectorFlags = new Map(
    STORE_CONFIGS.map((store) => [store.selectorFlag, store.name]),
  );
  const ownFlags = new Set([...storeSelectorFlags.keys(), '--skip-zip-check']);
  const skipZipCheck = args.includes('--skip-zip-check');
  const legacyFlag = args.find((arg) => arg.startsWith('--') && arg.endsWith('-only'));

  if (legacyFlag) {
    emitError(
      'Legacy `--*-only` store selectors are no longer supported. Use --chrome, --firefox, or --edge.',
    );
    process.exit(1);
  }

  const selectedStoreNames = [
    ...new Set(
      args
        .map((arg) => storeSelectorFlags.get(arg))
        .filter((storeName) => Boolean(storeName)),
    ),
  ];
  const passthroughArgs = args.filter((a) => !ownFlags.has(a));

  if (selectedStoreNames.length > 1) {
    emitError('Choose only one store selector: --chrome, --firefox, or --edge.');
    process.exit(1);
  }

  // Read package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (!(await fileExists(pkgPath))) {
    emitError('No package.json found in current directory.');
    process.exit(1);
  }
  const pkg = await readJson(pkgPath);
  const { name, version } = pkg;
  if (!name || !version) {
    emitError('package.json must have "name" and "version" fields.');
    process.exit(1);
  }

  // Read .env.submit
  const envPath = path.join(cwd, '.env.submit');
  let envVars = {};
  if (await fileExists(envPath)) {
    envVars = parseEnvFile(await readFile(envPath, 'utf8'));
    emitInfo(`Loaded credentials from .env.submit`);
  } else {
    emitWarn('No .env.submit found — using environment variables only.');
    for (const store of STORE_CONFIGS) {
      for (const key of Object.keys(store.envToFlag)) {
        if (process.env[key]) envVars[key] = process.env[key];
      }
    }
  }

  // Determine which stores to submit
  let stores = STORE_CONFIGS;
  if (selectedStoreNames.length === 1) {
    stores = STORE_CONFIGS.filter((store) => store.name === selectedStoreNames[0]);
  } else {
    stores = STORE_CONFIGS.filter((s) =>
      s.requiredCredentials.every((key) => !isUndefined(envVars[key])),
    );
  }

  if (stores.length === 0) {
    emitError('No stores configured. Check .env.submit credentials.');
    process.exit(1);
  }

  for (const store of stores) {
    const missingCredentials = getMissingRequiredCredentials(store, envVars);
    if (missingCredentials.length > 0) {
      emitError(
        `Missing required credentials for ${store.name}: ${missingCredentials.join(', ')}`,
      );
      process.exit(1);
    }
  }

  emitInfo(`Extension: ${name}@${version}`);
  emitInfo(`Stores: ${stores.map((s) => s.name).join(', ')}`);

  // Build publish-extension args
  const submitArgs = [];

  for (const store of stores) {
    // Zip path
    const zipName = `${name}-${version}-${store.zipSuffix}`;
    const zipPath = path.join(cwd, '.output', zipName);

    if (!skipZipCheck && !(await fileExists(zipPath))) {
      emitError(`Missing zip: ${zipPath}`);
      emitInfo('Run "bun run zip:version" first, or pass --skip-zip-check.');
      process.exit(1);
    }

    submitArgs.push(store.zipFlag, zipPath);

    // Sources zip (Firefox)
    if (store.sourcesZipFlag && store.sourcesZipSuffix) {
      const sourcesName = `${name}-${version}-${store.sourcesZipSuffix}`;
      const sourcesPath = path.join(cwd, '.output', sourcesName);
      if (await fileExists(sourcesPath)) {
        submitArgs.push(store.sourcesZipFlag, sourcesPath);
      }
    }

    // Credential flags
    for (const [envKey, cliFlag] of Object.entries(store.envToFlag)) {
      const value = envVars[envKey];
      if (isUndefined(value)) continue;

      if (store.booleanFlags.has(envKey)) {
        if (value === 'true') submitArgs.push(cliFlag);
        continue;
      }

      submitArgs.push(cliFlag, value);
    }
  }

  submitArgs.push(...passthroughArgs);

  const wxtBin = resolveWxtBin(cwd);
  const previewArgs = sanitizeArgsForPreview(submitArgs);
  const commandPreview = `wxt submit ${previewArgs.join(' ')}`;
  emitInfo(`Command: ${colorize(commandPreview, ANSI.dim)}`);

  // Run wxt submit
  const child = spawn(wxtBin, submitArgs, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    emitError(`Failed to start wxt: ${err.message}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    if (code === 0) {
      emitInfo(colorize('Submission complete!', ANSI.green));
    }
    process.exit(code ?? 1);
  });
}

main();
