// npm run add-character -- <name>
// A new character: a token for its body and a config file to fill in.

import { createCharacter } from '../characters.js';
import { BODY_PATH } from '../../core/protocol.js';

const name = process.argv.slice(2).join(' ').trim();
try {
  const c = createCharacter(name);
  console.log(`Created ${c.name}.`);
  console.log(`  Fill in stt, llm and tts (baseURL, apiKey, model; tts also voice): ${c.path}`);
  console.log(`  Token for its body: ${c.token}`);
  console.log(`  The body says hello with it on ws://<this computer>:8787${BODY_PATH}`);
} catch (err) {
  console.error(/** @type {Error} */ (err).message);
  process.exit(1);
}
