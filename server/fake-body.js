// A body with no body: a WebSocket client that speaks the protocol, sends a
// WAV file as its microphone and writes down everything it is told.
//
// It is also the reference for the ESP32 (server/body split spec §8): the
// handshake, the pong, and above all the watchdog — halt on close at once,
// halt after WATCHDOG_MS of hearing nothing — are what firmware must copy.
//
//   node server/fake-body.js ws://localhost:8787/body some.wav

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { PROTOCOL, WATCHDOG_MS, RATE, encode, parse } from '../web/protocol.js';
import { toInt16 } from '../web/audio/pcm.js';
import { int16ToBytes, parseWav, resample } from './audio/pcm.js';

const FRAME = RATE / 10;

/**
 * @param {string} url
 * @param {{ caps?: Record<string, boolean>, watchdogMs?: number,
 *           onMessage?: (msg: any) => void }} [opts]
 */
export async function connectFakeBody(url, opts = {}) {
  const watchdogMs = opts.watchdogMs ?? WATCHDOG_MS;
  const ws = new WebSocket(url);
  /** @type {any[]} */ const messages = [];
  let audioBytes = 0;
  let lastHeard = Date.now();
  /** @type {{ at: number, why: 'watchdog' | 'closed' } | null} */ let halted = null;
  /** @param {'watchdog' | 'closed'} why */
  const halt = (why) => { motion = null; if (!halted) halted = { at: Date.now(), why }; };
  /**
   * The car, as far as a body without one can have it. A `move` REPLACES the
   * one in progress (protocol.js): the brain renews a cruise early with only
   * what is left, and a body that queued instead would overrun every renewal.
   * @type {{ drive: string, steer: string, until: number } | null}
   */
  let motion = null;

  // One listener, attached before hello: the brain sends its first state in
  // the same breath as welcome, and a second listener attached after
  // awaiting the welcome would miss it.
  /** @type {(msg: any) => void} */ let onFirst = () => {};
  const first = new Promise((resolve) => { onFirst = resolve; });
  let answered = false;
  ws.on('message', (data, isBinary) => {
    lastHeard = Date.now();
    if (isBinary) { audioBytes += /** @type {Buffer} */ (data).length; return; }
    const msg = parse(String(data), 'brain');
    if (!answered) { answered = true; onFirst(msg); return; }
    if (!msg) return;
    if (msg.type === 'ping') { ws.send(encode({ type: 'pong' })); return; }
    if (msg.type === 'move') motion = { drive: msg.drive, steer: msg.steer, until: Date.now() + msg.ms };
    if (msg.type === 'stop') motion = null;
    messages.push(msg);
    opts.onMessage?.(msg);
  });

  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(encode({ type: 'hello', protocol: PROTOCOL, caps: opts.caps ?? { motors: true, screen: false } }));

  const reply = await first;
  if (!reply || reply.type !== 'welcome') {
    ws.close();
    throw new Error(`not welcomed: ${JSON.stringify(reply)}`);
  }

  ws.on('close', () => halt('closed'));
  const dog = setInterval(() => { if (Date.now() - lastHeard > watchdogMs) halt('watchdog'); }, 50);
  ws.on('close', () => clearInterval(dog));

  return {
    messages,
    get audioBytes() { return audioBytes; },
    get halted() { return halted; },
    /** What the car is doing right now, or null when it is standing still. */
    get driving() {
      return motion && motion.until > Date.now() ? { drive: motion.drive, steer: motion.steer } : null;
    },
    /** @param {Int16Array} pcm @param {{ paceMs?: number }} [o] 0 = as fast as possible */
    async sendPcm(pcm, o = {}) {
      for (let i = 0; i < pcm.length; i += FRAME) {
        ws.send(int16ToBytes(pcm.subarray(i, i + FRAME)), { binary: true });
        if (o.paceMs) await new Promise((r) => setTimeout(r, o.paceMs));
        else await new Promise((r) => setImmediate(r));
      }
    },
    /** @param {(m: any) => boolean} pred @param {number} [ms] */
    async waitFor(pred, ms = 5000) {
      const end = Date.now() + ms;
      for (;;) {
        const hit = messages.find(pred);
        if (hit) return hit;
        if (Date.now() > end) throw new Error(`timed out; got ${JSON.stringify(messages)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    },
    close() { clearInterval(dog); ws.close(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [url, wavPath] = process.argv.slice(2);
  if (!url || !wavPath) {
    console.error('usage: node server/fake-body.js <ws-url> <file.wav>');
    process.exit(1);
  }
  const { rate, samples } = parseWav(new Uint8Array(readFileSync(wavPath)));
  const body = await connectFakeBody(url, { onMessage: (m) => console.log(JSON.stringify(m)) });
  await body.sendPcm(toInt16(resample(samples, rate, RATE)), { paceMs: 100 });
  await body.sendPcm(new Int16Array(RATE * 2), { paceMs: 100 });
  await new Promise((r) => setTimeout(r, 15000));
  console.log(`audio received: ${body.audioBytes} bytes; halted: ${JSON.stringify(body.halted)}`);
  body.close();
}
