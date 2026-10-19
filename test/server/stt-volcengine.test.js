import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { gunzipSync, gzipSync } from 'node:zlib';

import { VolcengineStt } from '../../server/providers/stt-volcengine.js';

const CFG = { baseURL: 'https://openspeech.bytedance.com', apiKey: 'k-123', model: 'volc.seedasr.sauc.duration', prompt: 'woof' };
const PCM = new Int16Array(16000).fill(1000);

/** A last full response carrying `payload`, as the server frames it. @param {unknown} payload */
function lastResponse(payload) {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)));
  const fixed = Buffer.alloc(8);
  fixed.writeInt32BE(-6, 0);
  fixed.writeUInt32BE(body.length, 4);
  return Buffer.concat([Buffer.from([0x11, 0x93, 0x11, 0x00]), fixed, body]);
}

/** @param {number} code @param {string} message */
function errorFrame(code, message) {
  const body = Buffer.from(message);
  const fixed = Buffer.alloc(8);
  fixed.writeInt32BE(code, 0);
  fixed.writeUInt32BE(body.length, 4);
  return Buffer.concat([Buffer.from([0x11, 0xf0, 0x10, 0x00]), fixed, body]);
}

/**
 * A stand-in for `ws`: opens on the next tick, records what is sent, and calls
 * `onLast` once the last audio frame has gone out — where the real server
 * would answer.
 * @param {{ onLast?: (s: any) => void, open?: boolean }} [script]
 */
function fakeConnect(script = {}) {
  /** @type {any} */ let socket;
  const connect = /** @type {any} */ ((/** @type {string} */ url, /** @type {Record<string, string>} */ headers) => {
    socket = new EventEmitter();
    Object.assign(socket, { url, headers, sent: /** @type {Buffer[]} */ ([]), closed: false, terminated: false });
    socket.send = (/** @type {Buffer} */ b) => {
      socket.sent.push(b);
      if (b[1] === 0x23) script.onLast?.(socket);
    };
    socket.close = () => { socket.closed = true; };
    socket.terminate = () => { socket.terminated = true; };
    if (script.open !== false) setImmediate(() => socket.emit('open'));
    return socket;
  });
  return { connect, socket: () => socket };
}

const answer = (/** @type {unknown} */ payload) => ({ onLast: (/** @type {any} */ s) => s.emit('message', lastResponse(payload)) });

test('connects to bigmodel_nostream over wss with key, resource and request id', async () => {
  const fake = fakeConnect(answer({ result: { text: 'ok' } }));
  await new VolcengineStt(CFG, { connect: fake.connect }).transcribe(PCM, 16000);
  const s = fake.socket();
  assert.equal(s.url, 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream');
  assert.equal(s.headers['X-Api-Key'], 'k-123');
  assert.equal(s.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration');
  assert.ok(s.headers['X-Api-Request-Id']);
});

test('sends the full request first, then the PCM in 200 ms frames, the last one flagged', async () => {
  const fake = fakeConnect(answer({ result: { text: 'ok' } }));
  await new VolcengineStt(CFG, { connect: fake.connect }).transcribe(PCM, 16000);
  const [full, ...audio] = /** @type {Buffer[]} */ (fake.socket().sent);
  const req = JSON.parse(gunzipSync(full.subarray(12)).toString());
  assert.equal(full[1] >> 4, 0b0001);
  assert.deepEqual(req.audio, { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 });
  assert.equal(req.request.model_name, 'bigmodel');
  // Not sent: `context` is where a prompt would go, and nothing fills it yet.
  assert.ok(!JSON.stringify(req).includes('woof'));
  assert.deepEqual(audio.map((f) => f.readInt32BE(4)), [2, 3, 4, 5, -6]);
  assert.equal(audio.at(-1)?.[1], 0x23);
  const pcm = Buffer.concat(audio.map((f) => gunzipSync(f.subarray(12))));
  assert.deepEqual(pcm, Buffer.from(PCM.buffer));
});

test('returns the last package result text, trimmed', async () => {
  const fake = fakeConnect(answer({ result: { text: ' 往前走 ' } }));
  const stt = new VolcengineStt(CFG, { connect: fake.connect });
  assert.deepEqual(await stt.transcribeDetailed(PCM, 16000), { text: '往前走', noSpeech: null, logprob: null, parts: 0 });
  assert.ok(fake.socket().closed);
});

test('a last package with empty text is silence, not an error', async () => {
  const fake = fakeConnect(answer({ result: { text: '' } }));
  assert.equal(await new VolcengineStt(CFG, { connect: fake.connect }).transcribe(PCM, 16000), '');
});

test('an error frame rejects with code and message', async () => {
  const fake = fakeConnect({ onLast: (s) => s.emit('message', errorFrame(45000001, 'invalid audio')) });
  await assert.rejects(new VolcengineStt(CFG, { connect: fake.connect }).transcribe(PCM, 16000),
    /Volcengine STT 45000001: invalid audio/);
});

test('a refused upgrade rejects with the HTTP status, not a timeout', async () => {
  const fake = fakeConnect({ open: false });
  const p = new VolcengineStt(CFG, { connect: fake.connect, timeoutMs: 5000 }).transcribe(PCM, 16000);
  setImmediate(() => fake.socket().emit('unexpected-response', {}, { statusCode: 401, headers: { 'x-api-message': 'invalid key' } }));
  await assert.rejects(p, /401.*invalid key/);
});

test('closing before the last package rejects', async () => {
  // An empty string here would read as silence: the robot says "huh?" and
  // nothing is logged.
  const fake = fakeConnect({ onLast: (s) => s.emit('close', 1006, Buffer.alloc(0)) });
  await assert.rejects(new VolcengineStt(CFG, { connect: fake.connect }).transcribe(PCM, 16000),
    /closed before the result/);
});

test('timeout rejects and terminates the socket', async () => {
  const fake = fakeConnect();
  await assert.rejects(new VolcengineStt(CFG, { connect: fake.connect, timeoutMs: 20 }).transcribe(PCM, 16000));
  assert.ok(fake.socket().terminated);
});

test('abort closes the socket and rejects', async () => {
  const fake = fakeConnect();
  const ac = new AbortController();
  const p = new VolcengineStt(CFG, { connect: fake.connect, timeoutMs: 5000 }).transcribe(PCM, 16000, { signal: ac.signal });
  setImmediate(() => setImmediate(() => ac.abort()));
  await assert.rejects(p);
  const s = fake.socket();
  assert.ok(s.closed || s.terminated);
});

test('the retired flash model id is sent as 2.0 duration', async () => {
  const fake = fakeConnect(answer({ result: { text: 'ok' } }));
  await new VolcengineStt({ ...CFG, model: 'volc.bigasr.auc_turbo' }, { connect: fake.connect }).transcribe(PCM, 16000);
  assert.equal(fake.socket().headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration');
});

test('the concurrent model is sent as is', async () => {
  const fake = fakeConnect(answer({ result: { text: 'ok' } }));
  await new VolcengineStt({ ...CFG, model: 'volc.seedasr.sauc.concurrent' }, { connect: fake.connect }).transcribe(PCM, 16000);
  assert.equal(fake.socket().headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.concurrent');
});
