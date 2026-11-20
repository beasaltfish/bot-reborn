// One robot per connected body: the session and the brain from core/, wired
// to a body over the link instead of to a microphone, a speaker and a USB
// cable. Everything here is wiring, the way app.js is on the phone.

import { Session } from '../core/audio/session.js';
import { Brain } from '../core/brain.js';
import { faultOf } from '../core/fault.js';
import { Reflex } from '../core/reflex.js';
import { reflexReady } from '../core/config.js';
import { resolveBody } from '../core/bodies.js';
import { verbsOf } from '../core/actions.js';
import { OpenAiCompatLlm } from '../core/providers/llm-openai-compat.js';
import { RemotePipeline } from './body/pipeline.js';
import { RemoteExecutor } from './body/executor.js';
import { DryRunExecutor, NoMotionExecutor } from './body/still.js';
import { PetExecutor } from './body/pet.js';
import { Animator } from './pet/animator.js';
import { TarotAnimator } from './tarot/animator.js';
import { TarotExecutor } from './body/tarot.js';
import { Mouth } from './body/mouth.js';
import { PcmTts } from './providers/tts-pcm.js';
import { makeStt, makeTtsSource } from './providers/pick.js';

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
 *   petFrames?: import('./pet/frames.js').PetFrames,
 *   tarotFrames?: import('./tarot/frames.js').TarotFrames,
 *   screen?: (pick: import('./pet/frames.js').FramePick) => void,
 *   onSpoke?: () => void,
 * }} deps
 *   `onSpoke` runs once, the first time the robot actually answers out loud:
 *   TTS for a talking body, a bark for a pet — not a beep, an empty clip, or
 *   a body that already left.
 */
export function startRobot(conn, deps) {
  const { config, ears, sfx, earcons } = deps;
  const save = deps.save ?? (() => {});
  const log = deps.log ?? console.log;
  const net = deps.fetch ? { fetch: deps.fetch } : {};

  const pipeline = new RemotePipeline();
  // The body as declared, not as named: what it can do, how it is reached and
  // whether its answer is spoken all come from here (core/bodies.js).
  const body = resolveBody(config.body?.id ?? 'toy', config.body);
  const verbs = new Set(verbsOf(body.actions));
  // A pet has nothing to drive: its body is the screen, and the animator is
  // what moves. Started here so a connected body is already showing idle. The
  // pose action is what asks for the screen — a body called `pet` whose actions
  // were replaced with pose-free ones has nothing to animate.
  const animator = verbs.has('pose') && deps.petFrames
    ? new Animator({ frames: deps.petFrames, show: (pick) => deps.screen?.(pick), log })
    : null;
  // A tarot reader's body is the screen too: the card back at rest, a shuffle
  // while it thinks. With no frames it has no animator and a blank screen.
  const tarotAnimator = verbs.has('draw') && deps.tarotFrames
    ? new TarotAnimator({
      frames: deps.tarotFrames, show: (pick) => deps.screen?.(pick), log, lang: () => tarotLang(config),
    })
    : null;
  const executor = makeExecutor(body, conn, log, { pet: animator, tarot: tarotAnimator });
  animator?.start();
  tarotAnimator?.start();
  let announcedReply = false;
  const mouth = new Mouth({
    sendAudio: (bytes, source) => {
      conn.sendAudio(bytes);
      // Only a frame that was queued as the reply, is not empty, and reached
      // a body that is still there counts. A wake beep or a sound effect is
      // labelled as itself at playback, so it can never pass for the reply.
      if (announcedReply || source !== 'reply' || !bytes?.length || !conn.open) return;
      announcedReply = true;
      deps.onSpoke?.();
    },
    send: (msg) => conn.send(msg),
    slackMs: deps.slackMs ?? ECHO_SLACK_MS,
  });
  // A pet's bark is its reply; for a talking body TTS is, unless the call
  // site tagged it diagnostic (an apology). Both are labelled at the mouth,
  // where the audio actually goes out: what decides is the body's `reply`,
  // whether its answer is clips or a spoken voice.
  const replySound = body.reply === 'clips' ? 'reply' : 'sound';
  const tts = new PcmTts(makeTtsSource(config.tts, net), { mouth });
  /** @type {(part: import('../core/strings.js').FaultPart, err: Error) => void} */
  const onFault = (part, err) => {
    log(`[${part}] ${err.message}`);
    // 'turn' is the catch-all for a throw nobody expected; there is no layer
    // to name, so the body is told nothing.
    if (part !== 'turn') conn.send(faultOf(part, err));
  };

  const session = new Session({
    pipeline,
    kws: ears.kws,
    vad: ears.vad,
    stt: makeStt(config.stt, net),
    tts,
    executor,
    earcon: (name) => mouth.play(earcons[name], 'earcon').ms,
    sfx: (name) => {
      const pcm = sfx.get(name);
      return pcm ? mouth.play(pcm, replySound).ms : 0;
    },
    config,
    onState: (state) => conn.send({ type: 'state', state }),
    onFault,
  });
  const brain = new Brain({
    llm: new OpenAiCompatLlm(config.llm, net),
    executor,
    tts: session.speakingTts,
    earcon: session.earcon,
    sound: session.sound,
    reflex: reflexReady(config.reflex) ? new Reflex(config.reflex, net) : null,
    config,
    onReplyLangChange: () => save(config),
    onFault,
    trace: log,
  });
  session.attach(brain);

  conn.onAudio((bytes) => pipeline.feed(bytes));
  // The wand was shaken: only a body that draws answers, and drawCard refuses
  // while busy.
  conn.onMessage((msg) => { if (msg.type === 'shake') robot.drawCard(); });

  // Session only reports changes, and SLEEPING is where it starts.
  conn.send({ type: 'state', state: session.state });
  session.start();

  let stopped = false;
  const robot = {
    session,
    /**
     * Draw a card without anyone speaking: the wand was shaken (tarot mode spec
     * §5). Only a body with a draw action does; false when it cannot, or is
     * busy.
     * @returns {boolean}
     */
    drawCard() {
      return verbs.has('draw') && session.startTurn(() => brain.drawCard());
    },
    stop() {
      if (stopped) return;
      stopped = true;
      executor.connected = false;
      session.onEmergencyStop();
      // The screen keeps whatever it is showing; it just stops being fed.
      animator?.stop();
      tarotAnimator?.stop();
      pipeline.clear();
    },
  };
  return robot;
}

/**
 * Which verb carrier this body gets (body motion spec §3). The body is never
 * told which: a dry run is a car that never receives an order, and a still one
 * is a car with nothing to receive.
 *
 * The choice is what the body declared, not what it is called. A body with no
 * connected source has nothing to send to, so its orders are only written down.
 * A connected body is carried by whatever its verbs need that the link cannot
 * do by itself: motors go over the link (`drive` first — a body that can drive
 * must never have its orders swallowed), a screen is drawn here (`pose`, then
 * `draw`), and a body with only a voice needs nothing to move, which is the
 * still one at the end.
 * @param {import('../core/bodies.js').Body} body
 * @param {import('./link.js').BodyConn} conn
 * @param {(line: string) => void} log
 * @param {{ pet: import('./pet/animator.js').Animator | null,
 *           tarot: import('./tarot/animator.js').TarotAnimator | null }} animators
 */
function makeExecutor(body, conn, log, animators) {
  if (!connected(body)) return new DryRunExecutor(log);
  const verbs = new Set(verbsOf(body.actions));
  if (verbs.has('drive')) return new RemoteExecutor((msg) => conn.send(msg));
  // With no frames there is no face to move, so the fall-through below carries
  // it: a body whose screen cannot be drawn on has nothing to receive.
  if (verbs.has('pose') && animators.pet) return new PetExecutor(animators.pet);
  // A tarot reader never gets car commands: with no animator its draws do nothing.
  if (verbs.has('draw')) return new TarotExecutor(animators.tarot);
  return new NoMotionExecutor();
}

/**
 * Whether the body is reached over the link: a board, or the phone's USB board
 * (the hidden path kept in the vocabulary, `core/bodies.js`).
 * @param {import('../core/bodies.js').Body} body
 */
function connected(body) {
  return body.ways.some((way) => way.source === 'board' || way.source === 'phone');
}

/**
 * What language the card's name is written in: the one the character replies
 * in, else its interface language, else English (tarot mode spec §8).
 * @param {{ replyLang?: 'zh' | 'en' | null, lang?: 'zh' | 'en' }} config
 * @returns {'zh' | 'en'}
 */
export function tarotLang(config) {
  return config.replyLang ?? config.lang ?? 'en';
}
