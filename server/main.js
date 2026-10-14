// `npm start`: the brain on this computer. Bodies on the same Wi-Fi connect
// to ws://<this machine>:<port>/body; a phone needs HTTPS and goes through a
// tunnel (server/body split spec §1).

import { networkInterfaces } from 'node:os';
import { loadConfig, saveConfig, layerReady } from '../web/config.js';
import { fileStorage, DEFAULT_CONFIG_PATH } from './config-store.js';
import { createBrainServer } from './brain-server.js';
import { renderEarcons, loadSfx } from './audio/render.js';
import {
  modelsPresent, loadSherpaNode, loadKeywords, createSpotter, createVoiceDetector,
} from './audio/sherpa-node.js';
import { BODY_PATH } from '../web/protocol.js';

const PORT = Number(process.env.PORT ?? 8787);
const store = fileStorage(DEFAULT_CONFIG_PATH);
const config = loadConfig(store);
// Written back at once so a first run leaves a file with every field in it to
// fill in, rather than an error naming a file that does not exist.
saveConfig(config, store);

const missing = /** @type {const} */ (['stt', 'llm', 'tts']).filter((k) => !layerReady(config[k]));
if (missing.length) {
  console.error(`Fill in ${missing.join(', ')} in ${DEFAULT_CONFIG_PATH} (baseURL, apiKey, model; tts also voice).`);
  process.exit(1);
}
if (!modelsPresent()) {
  console.error('Models missing. Run: server/models/fetch.sh');
  process.exit(1);
}

const sherpa = loadSherpaNode();
const keywords = loadKeywords();
const server = createBrainServer({
  config,
  save: (cfg) => saveConfig(cfg, store),
  makeEars: () => ({ kws: createSpotter(sherpa, keywords), vad: createVoiceDetector(sherpa) }),
  sfx: loadSfx(),
  earcons: renderEarcons(),
});
const port = await server.listen(PORT);

const lan = Object.values(networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i?.address);
console.log(`brain listening on port ${port}`);
for (const ip of lan) console.log(`  body URL: ws://${ip}:${port}${BODY_PATH}`);
console.log(`  phone: cloudflared tunnel --url http://localhost:${port}`);
