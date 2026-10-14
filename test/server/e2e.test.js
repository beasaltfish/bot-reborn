import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBrainServer } from '../../server/brain-server.js';
import { connectFakeBody } from '../../server/fake-body.js';
import { renderEarcons, loadSfx } from '../../server/audio/render.js';
import { parseWav } from '../../server/audio/pcm.js';
import { toInt16 } from '../../web/audio/pcm.js';
import {
  modelsPresent, loadSherpaNode, loadKeywords, createSpotter, createVoiceDetector,
} from '../../server/audio/sherpa-node.js';
import { fakeFetch, tempCharacters } from './helpers.js';

const skip = modelsPresent() ? false : 'models missing — run server/models/fetch.sh';

test('a recorded sentence drives the robot end to end', { skip, timeout: 20000 }, async () => {
  const sherpa = loadSherpaNode();
  const keywords = loadKeywords();
  const chars = tempCharacters();
  const me = chars.add('me');
  const server = createBrainServer({
    dir: chars.dir, fetch: fakeFetch(), sfx: loadSfx(), earcons: renderEarcons(),
    makeEars: () => ({ kws: createSpotter(sherpa, keywords), vad: createVoiceDetector(sherpa) }),
    log: () => {},
  });
  const port = await server.listen(0);
  const body = await connectFakeBody(`ws://127.0.0.1:${port}/body`, { token: me.token });
  await body.waitFor((m) => m.type === 'state' && m.state === 'LISTENING');

  const { samples } = parseWav(new Uint8Array(
    readFileSync(new URL('../../web/fixtures/check-en.wav', import.meta.url))));
  // A real body streams in real time, and the session shuts its ears for the
  // wake earcon plus ECHO_SLACK_MS: wait that out, then pace like a body.
  await new Promise((r) => setTimeout(r, 500));
  await body.sendPcm(toInt16(samples), { paceMs: 100 });
  await body.sendPcm(new Int16Array(32000), { paceMs: 100 });  // 2 s of silence closes the segment

  const move = await body.waitFor((m) => m.type === 'move', 10000);
  assert.deepEqual(move, { type: 'move', drive: 'forward', steer: 'straight', ms: 600 });
  await body.waitFor((m) => m.type === 'state' && m.state === 'SPEAKING', 10000);
  await body.waitFor((m) => m.type === 'state' && m.state === 'LISTENING'
    && body.messages.some((x) => x.state === 'SPEAKING'), 10000);
  assert.ok(body.audioBytes > 0);
  assert.equal(body.halted, null);
  body.close();
  await server.close();
});
