import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBrainServer } from '../../server/brain-server.js';
import { renderEarcons } from '../../server/audio/render.js';
import { PROTOCOL } from '../../web/protocol.js';
import { readyConfig, fakeFetch, until } from './helpers.js';

test('a body connects, is welcomed, and is told its state', async () => {
  const server = createBrainServer({
    config: readyConfig(), fetch: fakeFetch(), sfx: new Map(), earcons: renderEarcons(),
    makeEars: () => ({
      kws: { accept: () => [] },
      vad: { accept() {}, detected: false, drain: () => [], clear() {} },
    }),
    log: () => {},
  });
  const port = await server.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/body`);
  /** @type {any[]} */ const msgs = [];
  ws.on('message', (d, bin) => { if (!bin) msgs.push(JSON.parse(String(d))); });
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, caps: { motors: true } }));
  await until(() => msgs.some((m) => m.type === 'state' && m.state === 'LISTENING'));
  assert.equal(msgs.find((m) => m.type === 'welcome')?.type, 'welcome');
  ws.close();
  await server.close();
});

test('plain HTTP gets a line saying where bodies connect', async () => {
  const server = createBrainServer({
    config: readyConfig(), sfx: new Map(), earcons: renderEarcons(), log: () => {},
    makeEars: () => { throw new Error('no body expected'); },
  });
  const port = await server.listen(0);
  const text = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(text, /\/body/);
  await server.close();
});
