// `npm start`: the brain on this computer, and its admin page in the browser.
// Characters are made on that page; bodies on the same Wi-Fi connect to
// ws://<this machine>:<port>/body, and a phone goes through a tunnel.

import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { listCharacters, CHARACTERS_DIR } from './characters.js';
import { createBrainServer } from './brain-server.js';
import { prepareAdmin, buildAdmin } from './admin-build.js';
import { renderEarcons, loadSfx } from './audio/render.js';
import {
  modelsPresent, loadSherpaNode, loadKeywords, createSpotter, createVoiceDetector,
} from './audio/sherpa-node.js';
import { BODY_PATH } from '../web/protocol.js';

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
const lan = Object.values(networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i?.address);
console.log(`admin page: ${admin}`);
for (const ip of lan) console.log(`body URL: ws://${ip}:${port}${BODY_PATH}`);
console.log(`phone: cloudflared tunnel --url http://localhost:${port}`);

if (process.env.BOT_REBORN_NO_OPEN !== '1') openBrowser(admin);

/** Best effort: a machine with no browser just doesn't get one. @param {string} url */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(cmd, /** @type {string[]} */ (args), { stdio: 'ignore', detached: true })
    .on('error', () => {}).unref();
}
