// `npm run setup`: the checks that turn a fresh clone into a brain that starts.
// One command, because the first failure a new user meets should be a sentence
// that says what to do — not a stack trace from somewhere inside the audio
// stack. Pure checks, so the rules are testable without a network or a port.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelsPresent } from './audio/sherpa-node.js';
import { build, needsBuild } from './build.js';

/** The version `npm test` was last run on. */
export const TESTED_NODE = '24.13.1';
/**
 * What the locked Vite release actually accepts, copied from its package.json:
 * `^20.19.0 || >=22.12.0`. A coarser "20 or newer" check passes a Node that
 * cannot run the build, so the check is by version and not by major.
 */
export const MIN_NODE = '20.19.0';
export const MIN_NODE_22 = '22.12.0';

/** The VAD's digest, the same one `server/models/fetch.sh` verifies. */
const VAD_SHA256 = '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6';
const MODEL_FILES = [
  'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
  'decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
  'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
  'tokens.txt',
  'silero_vad.onnx',
];

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const MODELS_DIR = 'server/models/';
const KWS_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2';
const VAD_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';

/**
 * @typedef {{ id: 'node'|'models'|'port'|'build', ok: boolean, detail: string, fix?: string }} Check
 */

/** @param {string} version @returns {number[]} */
const parts = (version) => String(version).replace(/^v/, '').split('.').map((n) => Number(n) || 0);

/** @param {string} version @param {string} floor @returns {boolean} */
const atLeast = (version, floor) => {
  const [a, b, c] = parts(version);
  const [x, y, z] = parts(floor);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};

/** @param {string} version @returns {boolean} */
export function nodeSupported(version) {
  const major = parts(version)[0];
  if (major === 20) return atLeast(version, MIN_NODE) && major < 22;
  if (major === 21) return false;
  return atLeast(version, MIN_NODE_22);
}

/**
 * Presence is not enough: `fetch.sh` writes the VAD file before it checks the
 * hash, so a truncated download can sit there looking ready. The digest is the
 * same one the script checks — keep the two in step.
 *
 * Returns why the models cannot be trusted, so the message can say "corrupt"
 * rather than "missing" when the files are there and wrong.
 * @param {string} [dir]
 * @returns {'missing' | 'corrupt' | null}
 */
export function modelsProblem(dir = 'server/models') {
  const base = isAbsolute(dir) ? dir : join(ROOT, dir);
  const present = MODEL_FILES.filter((name) => existsSync(join(base, name)));
  if (present.length !== MODEL_FILES.length) return 'missing';
  const vad = readFileSync(join(base, 'silero_vad.onnx'));
  return createHash('sha256').update(vad).digest('hex') === VAD_SHA256 ? null : 'corrupt';
}

/** @param {string} [dir] @returns {boolean} */
export function modelsIntact(dir = 'server/models') {
  return modelsProblem(dir) === null;
}

/**
 * @param {{
 *   nodeVersion?: string,
 *   models?: boolean,
 *   portFree?: () => Promise<boolean>,
 *   needsBuild?: boolean,
 *   build?: () => void,
 *   platform?: string,
 *   modelsProblem?: 'missing' | 'corrupt' | null,
 * }} [deps]
 * @returns {Promise<Check[]>}
 */
export async function runChecks(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const version = deps.nodeVersion ?? process.versions.node;
  const models = deps.models ?? modelsIntact();
  const portFree = deps.portFree ?? (() => probePort(PORT));
  const wantsBuild = deps.needsBuild ?? needsBuild();
  const doBuild = deps.build ?? build;

  /** @type {Check[]} */
  const checks = [];
  const supported = nodeSupported(version);
  checks.push({
    id: 'node',
    ok: supported,
    detail: `Node ${version}`,
    ...(supported ? {} : {
      fix: `Install Node ${MIN_NODE}+ (or ${MIN_NODE_22}+): https://nodejs.org. This project was tested on ${TESTED_NODE}.`,
    }),
  });

  const problem = deps.modelsProblem ?? (models ? null : modelsProblem());
  checks.push({
    id: 'models',
    ok: models,
    detail: models ? 'wake-word and VAD models present'
      : problem === 'corrupt'
        ? `the model files in ${MODELS_DIR} look corrupt (a truncated or failed download)`
        : `models missing from ${MODELS_DIR}`,
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

/**
 * Fetch the two models once, so the next start does not stop on them. A failed
 * download is a failure: `fetch.sh` leaves a partial file behind, and treating
 * that as ready is how a user gets a brain that will not start after a
 * "successful" setup.
 * @param {{ present?: () => boolean, run?: () => number | null, platform?: string }} [deps]
 * @returns {Promise<boolean>}
 */
export async function ensureModels(deps = {}) {
  const present = deps.present ?? modelsIntact;
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? (() => spawnSync('sh', ['server/models/fetch.sh'], { stdio: 'inherit', cwd: ROOT }).status);
  if (present()) return true;
  // The script needs a POSIX shell; Windows gets the two files named by the check instead.
  if (platform === 'win32') return false;
  console.log('Fetching the wake-word and VAD models (once)…');
  const status = run();
  if (status !== 0) {
    console.log('The fetch script failed; its output is above.');
    return false;
  }
  return present();
}

export async function main() {
  // The version check comes before the 6 MB download: a Node that cannot build
  // should not cost the user a download first.
  const [node] = await runChecks({ models: true, portFree: async () => true, needsBuild: false });
  if (!node.ok) {
    console.log(`fail  ${node.id}: ${node.detail}`);
    if (node.fix) console.log(`      ${node.fix}`);
    process.exitCode = 1;
    return;
  }
  await ensureModels();
  const checks = await runChecks({});
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

