import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { connectFakeBody } from '../../server/fake-body.js';
import { tempCharacters, fakeFetch, until } from './helpers.js';

const W = { 'X-Bot-Reborn': '1', 'Content-Type': 'application/json' };

/** @param {{ dev?: boolean }} [opts] */
async function rig({ dev = false } = {}) {
  const chars = tempCharacters();
  const fetch = fakeFetch({ reply: 'Your card says begin.' });
  const server = createBrainServer({
    dir: chars.dir, fetch, sfx: new Map(), earcons: renderEarcons(), log: () => {}, dev,
    makeEars: () => ({ kws: { accept: () => [] }, vad: { accept() {}, detected: false, drain: () => [], clear() {} } }),
  });
  const port = await server.listen(0);
  /** @param {unknown} body */
  const draw = async (body) => {
    const r = await globalThis.fetch(`http://127.0.0.1:${port}/api/dev/draw`, { method: 'POST', headers: W, body: JSON.stringify(body) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: r.status, body: parsed };
  };
  return { chars, fetch, server, port, draw };
}

test('without the dev flag there is no draw route', async () => {
  const r = await rig();
  const c = r.chars.add('tara', (cfg) => { cfg.body.motion = 'tarot'; });
  assert.equal((await r.draw({ id: c.id })).status, 404);
  await r.server.close();
});

test('with the dev flag: an unknown or offline character starts nothing; a connected tarot reader reads a card', async () => {
  const r = await rig({ dev: true });
  const c = r.chars.add('tara', (cfg) => { cfg.body.motion = 'tarot'; });
  assert.deepEqual(await r.draw({ id: 'nobody' }), { status: 200, body: { started: false } });
  assert.deepEqual(await r.draw({ id: c.id }), { status: 200, body: { started: false } }, 'offline');
  const body = await connectFakeBody(`ws://127.0.0.1:${r.port}/body`, { token: c.token });
  await until(() => body.messages.some((m) => m.type === 'state'));
  assert.deepEqual(await r.draw({ id: c.id }), { status: 200, body: { started: true } });
  await until(() => r.fetch.calls.some((x) => x.url.endsWith('/chat/completions')));
  await until(() => body.audioBytes > 0);
  body.close();
  await r.server.close();
});

test('a bad request body is a 400, not a crash', async () => {
  const r = await rig({ dev: true });
  assert.equal((await r.draw({ nope: 1 })).status, 400);
  await r.server.close();
});
