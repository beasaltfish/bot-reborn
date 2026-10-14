import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { PROTOCOL } from '../../web/protocol.js';
import { fakeFetch, until, tempCharacters } from './helpers.js';

/** Ears that hear one loud second after `frames` frames, once. */
function onceEars(frames = 5) {
  let n = 0;
  return {
    kws: { accept: () => [] },
    vad: {
      accept() { n++; }, detected: false, clear() {},
      drain: () => (n === frames ? [new Float32Array(16000).map((_, i) => 0.3 * Math.sin(i / 5))] : []),
    },
  };
}

/** @param {number} port @param {string} token */
async function body(port, token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/body`);
  /** @type {any[]} */ const msgs = [];
  ws.on('message', (d, bin) => {
    if (bin) return;
    const m = JSON.parse(String(d));
    if (m.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    msgs.push(m);
  });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, token, caps: { motors: true } }));
  await until(() => msgs.length > 0);
  return { ws, msgs };
}

test('a body with its character\'s token is welcomed by name and told its state', async () => {
  const chars = tempCharacters();
  const a = chars.add('a');
  const server = createBrainServer({
    dir: chars.dir, fetch: fakeFetch(), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => onceEars(), log: () => {},
  });
  const port = await server.listen(0);
  const b = await body(port, a.token);
  assert.deepEqual(b.msgs[0], { type: 'welcome', name: 'a' });
  await until(() => b.msgs.some((m) => m.type === 'state' && m.state === 'LISTENING'));
  b.ws.close();
  await server.close();
});

test('a wrong token and an unfinished character are told why', async () => {
  const chars = tempCharacters();
  const half = chars.add('half', (cfg) => { cfg.tts.apiKey = ''; });
  const server = createBrainServer({
    dir: chars.dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no robot expected'); },
  });
  const port = await server.listen(0);
  const wrong = await body(port, '0'.repeat(32));
  assert.deepEqual(wrong.msgs[0], { type: 'reject', reason: 'token' });
  const unfinished = await body(port, half.token);
  assert.deepEqual(unfinished.msgs[0], { type: 'reject', reason: 'unconfigured' });
  wrong.ws.close(); unfinished.ws.close();
  await server.close();
});

test('two characters talk at once, each with its own voice and key', async () => {
  const chars = tempCharacters();
  const a = chars.add('a', (cfg) => { cfg.tts.voice = 'alloy'; cfg.llm.apiKey = 'key-a'; });
  const b = chars.add('b', (cfg) => { cfg.tts.voice = 'nova'; cfg.llm.apiKey = 'key-b'; });
  const fetch = fakeFetch();
  /** @type {string[]} */ const auth = [];
  const spy = /** @type {typeof fetch} */ (async (url, init) => {
    if (String(url).endsWith('/chat/completions')) auth.push(String(/** @type {any} */ (init?.headers)?.Authorization));
    return fetch(url, init);
  });
  const server = createBrainServer({
    dir: chars.dir, fetch: spy, sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => onceEars(), log: () => {}, slackMs: 0,
  });
  const port = await server.listen(0);
  const ba = await body(port, a.token);
  const bb = await body(port, b.token);
  for (const x of [ba, bb]) await until(() => x.msgs.some((m) => m.state === 'LISTENING'));
  await new Promise((r) => setTimeout(r, 150));      // the wake earcon's gate
  const frame = new Uint8Array(3200);
  await until(() => {
    ba.ws.send(frame); bb.ws.send(frame);
    return fetch.calls.filter((c) => c.url.endsWith('/audio/speech')).length === 2;
  }, 5000);
  const voices = fetch.calls.filter((c) => c.url.endsWith('/audio/speech')).map((c) => c.body.voice).sort();
  assert.deepEqual(voices, ['alloy', 'nova']);
  assert.deepEqual(auth.sort(), ['Bearer key-a', 'Bearer key-b']);
  ba.ws.close(); bb.ws.close();
  await server.close();
});
