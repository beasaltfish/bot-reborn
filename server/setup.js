// `npm run setup`: the checks that turn a fresh clone into a brain that starts.
// One command, because the first failure a new user meets should be a sentence
// that says what to do — not a stack trace from somewhere inside the audio
// stack. Pure checks, so the rules are testable without a network or a port.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelsPresent } from './audio/sherpa-node.js';
import { build, needsBuild } from './build.js';

/** The version `npm test` was last run on. Node 20 is the floor, not the target. */
export const TESTED_NODE = '24.13.1';
/** The floor package.json declares. */
export const MIN_MAJOR = 20;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const MODELS_DIR = 'server/models/';
const KWS_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2';
const VAD_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';

/**
 * @typedef {{ id: 'node'|'models'|'port'|'build', ok: boolean, detail: string, fix?: string }} Check
 */

/** @param {string} version @returns {number} */
const majorOf = (version) => Number(String(version).replace(/^v/, '').split('.')[0]) || 0;

/**
 * @param {{
 *   nodeVersion?: string,
 *   models?: boolean,
 *   portFree?: () => Promise<boolean>,
 *   needsBuild?: boolean,
 *   build?: () => void,
 *   platform?: string,
 * }} [deps]
 * @returns {Promise<Check[]>}
 */
export async function runChecks(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const version = deps.nodeVersion ?? process.versions.node;
  const models = deps.models ?? modelsPresent();
  const portFree = deps.portFree ?? (() => probePort(PORT));
  const wantsBuild = deps.needsBuild ?? needsBuild();
  const doBuild = deps.build ?? build;

  /** @type {Check[]} */
  const checks = [];
  const major = majorOf(version);
  checks.push({
    id: 'node',
    ok: major >= MIN_MAJOR,
    detail: `Node ${version}`,
    ...(major >= MIN_MAJOR ? {} : {
      fix: `Install Node ${MIN_MAJOR} or newer (https://nodejs.org). This project was tested on ${TESTED_NODE}.`,
    }),
  });

  checks.push({
    id: 'models',
    ok: models,
    detail: models ? 'wake-word and VAD models present' : `models missing from ${MODELS_DIR}`,
    ...(models ? {} : {
      // The script needs a POSIX shell; Windows gets the two files named instead.
      fix: platform === 'win32'
        ? `Download ${KWS_URL} (unpack it) and ${VAD_URL} into ${MODELS_DIR}.`
        : 'Run: sh server/models/fetch.sh',
    }),
  });

  const free = await portFree();
  checks.push({
    id: 'port',
    ok: free,
    detail: free ? `port ${PORT} is free` : `port ${PORT} is already in use`,
    ...(free ? {} : { fix: `Stop whatever holds port ${PORT}, or start with PORT=<another> npm start` }),
  });

  if (wantsBuild) {
    try {
      doBuild();
      checks.push({ id: 'build', ok: true, detail: 'pages built' });
    } catch (err) {
      checks.push({ id: 'build', ok: false, detail: 'pages could not be built', fix: /** @type {Error} */ (err).message });
    }
  } else {
    checks.push({ id: 'build', ok: true, detail: 'pages are up to date' });
  }
  return checks;
}

/** @param {number} port @returns {Promise<boolean>} */
function probePort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    // Bind the way the brain does (no host: dual-stack), or a busy port looks free.
    server.listen(port);
  });
}

/** Fetch the two models once, so the next start does not stop on them. */
async function ensureModels() {
  if (modelsPresent() || process.platform === 'win32') return;
  console.log('Fetching the wake-word and VAD models (once)…');
  const run = spawnSync('sh', ['server/models/fetch.sh'], { stdio: 'inherit', cwd: ROOT });
  if (run.status !== 0) console.log('The fetch script failed; its output is above.');
}

export async function main() {
  await ensureModels();
  const checks = await runChecks();
  for (const check of checks) {
    console.log(`${check.ok ? 'ok  ' : 'fail'}  ${check.id}: ${check.detail}`);
    if (!check.ok && check.fix) console.log(`      ${check.fix}`);
  }
  if (checks.some((c) => !c.ok)) {
    console.log('\nFix the lines marked fail, then run npm run setup again.');
    process.exitCode = 1;
    return;
  }
  console.log('\nnext: npm start');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

