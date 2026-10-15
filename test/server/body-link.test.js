import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { connectBody } from '../../phone/body-link.js';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
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

test('the phone\'s link carries a whole turn: welcome, audio up, a move and speech down', async () => {
  const chars = tempCharacters();
  const a = chars.add('Rex');
  const server = createBrainServer({
    dir: chars.dir, fetch: fakeFetch(), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => onceEars(), log: () => {}, slackMs: 0,
  });
  const port = await server.listen(0);
  /** @type {any[]} */ const got = [];
  let audio = 0;
  const link = connectBody({
    url: `ws://127.0.0.1:${port}/body`, token: a.token, caps: { motors: true, screen: true },
    WebSocket: /** @type {any} */ (WebSocket),
    onWelcome: (name) => got.push({ type: 'welcome', name }),
    onMessage: (m) => got.push(m),
    onAudio: (b) => { audio += b.byteLength; },
    onLost: () => got.push({ type: 'lost' }),
    onReject: (reason) => got.push({ type: 'reject', reason }),
  });
  await until(() => link.welcomed);
  assert.deepEqual(got[0], { type: 'welcome', name: 'Rex' });
  const feeder = setInterval(() => link.sendAudio(new Int16Array(1600)), 20);
  await until(() => got.some((m) => m.type === 'move'), 5000);
  await until(() => audio > 0, 5000);
  clearInterval(feeder);
  link.close();
  await server.close();
});

test('a wrong token is refused once, and the phone does not knock again', async () => {
  const chars = tempCharacters();
  const server = createBrainServer({
    dir: chars.dir, sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => onceEars(),
  });
  const port = await server.listen(0);
  /** @type {string[]} */ const why = [];
  const link = connectBody({
    url: `ws://127.0.0.1:${port}/body`, token: '0'.repeat(32), caps: { motors: true },
    WebSocket: /** @type {any} */ (WebSocket),
    onWelcome() {}, onMessage() {}, onAudio() {}, onLost() {},
    onReject: (reason) => why.push(reason),
    retryMs: [20],
  });
  await until(() => why.length > 0);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(why, ['token']);
  link.close();
  await server.close();
});
