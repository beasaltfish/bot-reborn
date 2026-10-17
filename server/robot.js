// One robot per connected body: the session and the brain from core/, wired
// to a body over the link instead of to a microphone, a speaker and a USB
// cable. Everything here is wiring, the way app.js is on the phone.

import { Session } from '../core/audio/session.js';
import { Brain } from '../core/brain.js';
import { Ladder } from '../core/ladder.js';
import { Reflex } from '../core/reflex.js';
import { layerReady } from '../core/config.js';
import { OpenAiCompatStt } from '../core/providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from '../core/providers/llm-openai-compat.js';
import { RemotePipeline } from './body/pipeline.js';
import { RemoteExecutor } from './body/executor.js';
import { DryRunExecutor, NoMotionExecutor } from './body/still.js';
import { Mouth } from './body/mouth.js';
import { PcmTts } from './providers/tts-pcm.js';

/**
 * How much longer the session keeps its ears shut after one of the robot's
 * own sounds. The body plays a sound some network delay after we send it, and
 * its echo comes back up the same way. Provisional: replace with the round
 * trip measured in Task 12.
 */
export const ECHO_SLACK_MS = 300;

/**
 * @param {import('./link.js').BodyConn} conn
 * @param {{
 *   config: ReturnType<typeof import('../core/config.js').loadConfig>,
 *   save?: (cfg: any) => void,
 *   fetch?: typeof fetch,
 *   ears: { kws: { accept(frame: Float32Array): string[] },
 *           vad: { accept(frame: Float32Array): void, readonly detected: boolean,
 *                  drain(): Float32Array[], clear(): void } },
 *   sfx: Map<import('../core/audio/sfx.js').SoundName, Int16Array>,
 *   earcons: Record<import('../core/audio/earcon.js').EarconName, Int16Array>,
 *   log?: (line: string) => void,
 *   slackMs?: number,
 * }} deps
 */
export function startRobot(conn, deps) {
  const { config, ears, sfx, earcons } = deps;
  const save = deps.save ?? (() => {});
  const log = deps.log ?? console.log;
  const net = deps.fetch ? { fetch: deps.fetch } : {};

  const pipeline = new RemotePipeline();
  const executor = makeExecutor(config.body.motion, conn, log);
  const mouth = new Mouth({
    sendAudio: (bytes) => conn.sendAudio(bytes),
    send: (msg) => conn.send(msg),
    slackMs: deps.slackMs ?? ECHO_SLACK_MS,
  });
  const tts = new PcmTts(config.tts, { mouth, ...net });
  /** @type {(part: import('../core/strings.js').FaultPart, err: Error) => void} */
  const onFault = (part, err) => log(`[${part}] ${err.message}`);

  const session = new Session({
    pipeline,
    kws: ears.kws,
    vad: ears.vad,
    stt: new OpenAiCompatStt(config.stt, net),
    tts,
    executor,
    earcon: (name) => mouth.play(earcons[name]).ms,
    sfx: (name) => {
      const pcm = sfx.get(name);
      return pcm ? mouth.play(pcm).ms : 0;
    },
    config,
    onState: (state) => conn.send({ type: 'state', state }),
    onFault,
  });
  session.attach(new Brain({
    llm: new OpenAiCompatLlm(config.llm, net),
    executor,
    tts: session.speakingTts,
    earcon: session.earcon,
    sound: session.sound,
    reflex: layerReady(config.reflex) ? new Reflex(config.reflex, net) : null,
    ladder: new Ladder(),
    config,
    onReplyLangChange: () => save(config),
    onFault,
    trace: log,
  }));

  conn.onAudio((bytes) => pipeline.feed(bytes));

  // Session only reports changes, and SLEEPING is where it starts.
  conn.send({ type: 'state', state: session.state });
  session.start();

  let stopped = false;
  return {
    session,
    stop() {
      if (stopped) return;
      stopped = true;
      executor.connected = false;
      session.onEmergencyStop();
      pipeline.clear();
    },
  };
}

/**
 * Body motion spec §3. The body is never told which: a dry-run is a car that
 * never receives an order, and a still one is a car with nothing to receive.
 * @param {import('../core/config.js').Motion} motion
 * @param {import('./link.js').BodyConn} conn
 * @param {(line: string) => void} log
 */
function makeExecutor(motion, conn, log) {
  if (motion === 'dry-run') return new DryRunExecutor(log);
  if (motion === 'none') return new NoMotionExecutor();
  return new RemoteExecutor((msg) => conn.send(msg));
}
