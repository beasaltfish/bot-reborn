// `npm start`: the brain on this computer. Each body is a character, set up
// with `npm run add-character -- <name>`. Bodies on the same Wi-Fi connect to
// ws://<this machine>:<port>/body; a phone needs HTTPS and goes through a
// tunnel (server/body split spec §1).

import { networkInterfaces } from 'node:os';
import { listCharacters, ready, CHARACTERS_DIR } from './characters.js';
import { createBrainServer } from './brain-server.js';
import { renderEarcons, loadSfx } from './audio/render.js';
import {
  modelsPresent, loadSherpaNode, loadKeywords, createSpotter, createVoiceDetector,
} from './audio/sherpa-node.js';
import { BODY_PATH } from '../web/protocol.js';

const PORT = Number(process.env.PORT ?? 8787);

const { characters, problems } = listCharacters();
for (const p of problems) console.error(`skipped ${p}`);
if (characters.length === 0) {
  console.error(`No characters in ${CHARACTERS_DIR}. Create one: npm run add-character -- <name>`);
  process.exit(1);
}
for (const c of characters) {
  console.log(`  ${c.name}: ${ready(c.config) ? 'ready' : `fill in stt, llm, tts in ${c.path}`}`);
}
if (!modelsPresent()) {
  console.error('Models missing. Run: server/models/fetch.sh');
  process.exit(1);
}

const sherpa = loadSherpaNode();
const keywords = loadKeywords();
const server = createBrainServer({
  characters: () => {
    const now = listCharacters();
    for (const p of now.problems) console.error(`skipped ${p}`);
    return now.characters;
  },
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
