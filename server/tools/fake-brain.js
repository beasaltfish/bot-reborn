// A brain with no mind, for benching a body (the ESP32 first): the handshake,
// heartbeat and watchdog are server/link.js's own, and audio goes down through
// server/body/mouth.js, 300 ms ahead as the real brain sends it. Everything
// else is typed:
//
//   node server/tools/fake-brain.js [--port 8787] [--token <hex>] [--reject busy]
//
//   move <forward|backward> <left|right|straight> <ms>   stop   hush
//   state <NAME>   tone [ms]   say <file.wav>   rec <file.wav> <seconds>   status
//
// Without --token any token is welcome. While the body sends audio, a line a
// second says how much arrived and how loud it was.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createLink } from '../link.js';
import { Mouth } from '../body/mouth.js';
import { RATE, BODY_PATH, encode, parse } from '../../core/protocol.js';
import { toInt16 } from '../../core/audio/pcm.js';
import { rms, dbOf } from '../../core/audio/level.js';
import { encodeWav } from '../../core/providers/stt-openai-compat.js';
import { bytesToFloat32, parseWav, resample } from '../audio/pcm.js';

/**
 * @param {{ port?: number, token?: string, reject?: string, log?: (line: string) => void }} opts
 *   No `token`: any token is welcome. `reject`: every hello gets this reason.
 */
export async function startFakeBrain(opts = {}) {
  const log = opts.log ?? console.log;
  const http = createServer((_req, res) => { res.writeHead(404); res.end(); });

  /** @type {import('../link.js').BodyConn | null} */ let conn = null;
  /** @type {Mouth | null} */ let mouth = null;
  let bytesUp = 0;
  /** @type {Uint8Array[]} */ let second = [];
  /** @type {{ path: string, until: number, parts: Uint8Array[] } | null} */ let rec = null;

  const link = createLink({
    server: http,
    log,
    admit: (token) => {
      if (opts.reject) return opts.reject;
      if (opts.token && token !== opts.token) return 'token';
      return { id: 'fake', name: 'fake brain' };
    },
    onBody: (c) => {
      conn = c;
      bytesUp = 0;
      mouth = new Mouth({ sendAudio: (b) => c.sendAudio(b), send: (m) => c.send(m) });
      c.onAudio((bytes) => {
        bytesUp += bytes.length;
        second.push(bytes);
        if (rec) {
          rec.parts.push(bytes);
          if (Date.now() >= rec.until) finishRec();
        }
      });
      c.onClose(() => { conn = null; mouth = null; });
      c.send({ type: 'state', state: 'LISTENING' });
    },
  });

  const meter = setInterval(() => {
    if (second.length === 0) return;
    const bytes = Buffer.concat(second);
    second = [];
    log(`uplink ${bytes.length} B/s, ${Math.round(dbOf(rms(bytesToFloat32(bytes))))} dBFS`);
  }, 1000);

  function finishRec() {
    if (!rec) return;
    const bytes = Buffer.concat(rec.parts);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
    writeFileSync(rec.path, Buffer.from(encodeWav(pcm, RATE)));
    log(`recorded ${(pcm.length / RATE).toFixed(1)} s to ${rec.path}`);
    rec = null;
  }

  /** @param {Int16Array} pcm */
  const play = (pcm) => { /** @type {Mouth} */ (mouth).play(pcm); return `sent ${Math.round(pcm.length / (RATE / 1000))} ms`; };

  /** @param {string} line @returns {Promise<string>} */
  async function run(line) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (cmd === 'status') return conn ? `connected, ${bytesUp} bytes up` : 'not connected';
    if (!['move', 'stop', 'hush', 'state', 'tone', 'say', 'rec'].includes(cmd)) {
      return 'error: unknown command (move, stop, hush, state, tone, say, rec, status)';
    }
    if (!conn || !mouth) return 'error: no body connected';
    switch (cmd) {
      case 'move': {
        const msg = { type: 'move', drive: args[0], steer: args[1], ms: Number(args[2]) };
        // The protocol's own check, not a second copy of its rules.
        if (args.length !== 3 || !parse(encode(msg), 'brain')) {
          return 'error: move <forward|backward> <left|right|straight> <1–1000 ms>';
        }
        conn.send(msg);
        return `sent ${line.trim()}`;
      }
      case 'stop': conn.send({ type: 'stop' }); return 'sent stop';
      case 'hush': mouth.hush(); return 'sent hush';
      case 'state':
        if (!args[0]) return 'error: state <NAME>';
        conn.send({ type: 'state', state: args[0] });
        return `sent state ${args[0]}`;
      case 'tone': {
        const ms = args[0] ? Number(args[0]) : 1000;
        if (!(ms > 0)) return 'error: tone [ms]';
        const n = Math.round((RATE * ms) / 1000);
        return play(toInt16(new Float32Array(n).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE))));
      }
      case 'say': {
        if (!args[0]) return 'error: say <file.wav>';
        const { rate, samples } = parseWav(new Uint8Array(readFileSync(args[0])));
        return play(toInt16(resample(samples, rate, RATE)));
      }
      case 'rec': {
        const seconds = Number(args[1]);
        if (!args[0] || !(seconds > 0)) return 'error: rec <file.wav> <seconds>';
        rec = { path: args[0], until: Date.now() + seconds * 1000, parts: [] };
        return `recording ${seconds} s to ${args[0]}`;
      }
    }
    return 'error: unreachable';
  }

  const port = await new Promise((resolve) => http.listen(opts.port ?? 8787, () => {
    resolve(/** @type {import('node:net').AddressInfo} */ (http.address()).port);
  }));

  return {
    /** @type {number} */ port,
    run,
    close() { clearInterval(meter); finishRec(); link.close(); http.close(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  /** @param {string} flag */
  const arg = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
  const brain = await startFakeBrain({ port: Number(arg('--port') ?? 8787), token: arg('--token'), reject: arg('--reject') });
  console.log(`fake brain on ws://<this machine>:${brain.port}${BODY_PATH}`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => { if (line.trim()) console.log(await brain.run(line)); });
  rl.on('close', () => brain.close());
}
