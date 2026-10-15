// `npm start`: the brain on this computer, and its admin page in the browser.
// Characters are made on that page; a body on the same Wi-Fi connects to
// ws://<this machine>:<port>/body, and a phone opens the page this brain
// serves at http://<this machine>:<port>/phone/ (the admin page's QR code).

import { spawn } from 'node:child_process';
import { listCharacters, CHARACTERS_DIR } from './characters.js';
import { createBrainServer } from './brain-server.js';
import { lanAddresses } from './admin-api.js';
import { prepareAdmin, buildAdmin } from './admin-build.js';
import { renderEarcons, loadSfx } from './audio/render.js';
import {
  modelsPresent, loadSherpaNode, loadKeywords, createSpotter, createVoiceDetector,
} from './audio/sherpa-node.js';
import { BODY_PATH } from '../core/protocol.js';

const PORT = Number(process.env.PORT ?? 8787);

if (!modelsPresent()) {
  console.error('Models missing. Run: server/models/fetch.sh');
  process.exit(1);
}
prepareAdmin({ buildAdmin: () => { console.log('Building the admin page…'); buildAdmin(); } });
for (const p of listCharacters().problems) console.error(`skipped ${p}`);

const sherpa = loadSherpaNode();
const keywords = loadKeywords();
const server = createBrainServer({
  dir: CHARACTERS_DIR,
  makeEars: () => ({ kws: createSpotter(sherpa, keywords), vad: createVoiceDetector(sherpa) }),
  sfx: loadSfx(),
  earcons: renderEarcons(),
});
const port = await server.listen(PORT);

const admin = `http://localhost:${port}/`;
const lan = lanAddresses();
console.log(`admin page: ${admin}`);
for (const ip of lan) {
  console.log(`body URL: ws://${ip}:${port}${BODY_PATH}`);
  console.log(`phone page: http://${ip}:${port}/phone/`);
}
console.log('phone: Chrome must treat that address as secure — chrome://flags/#unsafely-treat-insecure-origin-as-secure');

if (process.env.BOT_REBORN_NO_OPEN !== '1') openBrowser(admin);

/** Best effort: a machine with no browser just doesn't get one. @param {string} url */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(cmd, /** @type {string[]} */ (args), { stdio: 'ignore', detached: true })
    .on('error', () => {}).unref();
}
