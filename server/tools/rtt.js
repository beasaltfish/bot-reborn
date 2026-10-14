// How far away is the brain? Spec §8's first measurement: the round trip
// over the quick tunnel, and how long "all stop" takes from the end of the
// words to a `stop` arriving at the body (§2's known cost).
//
//   node server/tools/rtt.js ws://localhost:8787/body
//   node server/tools/rtt.js wss://<name>.trycloudflare.com/body --wav my-all-stop.wav

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { PROTOCOL, RATE, encode, parse } from '../../web/protocol.js';
import { toInt16 } from '../../web/audio/pcm.js';
import { int16ToBytes, parseWav, resample } from '../audio/pcm.js';

const args = process.argv.slice(2);
const url = args[0];
const count = Number(args[args.indexOf('--count') + 1] || 50);
const wavAt = args.indexOf('--wav');
if (!url) { console.error('usage: rtt.js <ws-url> [--count N] [--wav file.wav]'); process.exit(1); }

const ws = new WebSocket(url);
await new Promise((r) => ws.once('open', r));
// motors: false, so nothing this tool says can drive a car.
ws.send(encode({ type: 'hello', protocol: PROTOCOL, caps: { motors: false } }));
// An inbox, not a list of waiters: the brain sends welcome and its first
// states in one burst, and a waiter attached after the previous await
// resolved would miss them.
/** @type {any[]} */ const inbox = [];
let wake = () => {};
ws.on('message', (d, bin) => {
  if (bin) return;
  const msg = parse(String(d), 'brain');
  if (!msg) return;
  if (msg.type === 'ping') return ws.send(encode({ type: 'pong' }));
  inbox.push(msg);
  wake();
});
/** @param {string} type */
async function next(type) {
  for (;;) {
    const i = inbox.findIndex((m) => m.type === type);
    if (i !== -1) return inbox.splice(i, 1)[0];
    await new Promise((resolve) => { wake = () => resolve(undefined); });
  }
}
await next('welcome');
// The brain loads its ears right after welcoming, which blocks it for up to a
// second; the first state message says it is done. Timing before that
// measures the model load, not the link.
await next('state');

const silence = int16ToBytes(new Int16Array(RATE / 10));
/** @type {number[]} */ const rtts = [];
for (let i = 0; i < count; i++) {
  ws.send(silence, { binary: true });               // a realistic load beside the ping
  const t0 = performance.now();
  ws.send(encode({ type: 'ping' }));
  await next('pong');
  rtts.push(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 100));
}
rtts.sort((a, b) => a - b);
const pct = (/** @type {number} */ p) => rtts[Math.min(rtts.length - 1, Math.floor(p * rtts.length))].toFixed(0);
console.log(`round trip over ${count}: p50 ${pct(0.5)} ms, p95 ${pct(0.95)} ms, max ${pct(1)} ms`);

if (wavAt !== -1) {
  const { rate, samples } = parseWav(new Uint8Array(readFileSync(args[wavAt + 1])));
  const pcm = toInt16(resample(samples, rate, RATE));
  const stop = next('stop');
  let lastSent = 0;
  for (let i = 0; i < pcm.length; i += RATE / 10) {
    ws.send(int16ToBytes(pcm.subarray(i, i + RATE / 10)), { binary: true });
    lastSent = performance.now();
    await new Promise((r) => setTimeout(r, 100));
  }
  const timeout = new Promise((r) => setTimeout(() => r(null), 3000));
  for (let i = 0; i < 30; i++) ws.send(silence, { binary: true });
  const got = await Promise.race([stop, timeout]);
  console.log(got
    ? `stop arrived ${(performance.now() - lastSent).toFixed(0)} ms after the last frame of the recording`
    : 'no stop within 3 s — the stop word was not heard');
}
ws.close();
