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
import { RemoteExecutor, IoExecutor } from './body/executor.js';
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
  // A body nobody is connected to has no screen either: its verbs are all only
  // written down (makeExecutor), so building an animator here would draw frames
  // for a body that never said it could show them.
  const reached = connected(body);
  // A pet has nothing to drive: its body is the screen, and the animator is
  // what moves. Started here so a connected body is already showing idle. The
  // pose action is what asks for the screen — a body called `pet` whose actions
  // were replaced with pose-free ones has nothing to animate.
  const animator = reached && verbs.has('pose') && deps.petFrames
    ? new Animator({ frames: deps.petFrames, show: (pick) => deps.screen?.(pick), log })
    : null;
  // A tarot reader's body is the screen too: the card back at rest, a shuffle
  // while it thinks. With no frames it has no animator and a blank screen.
  const tarotAnimator = reached && verbs.has('draw') && deps.tarotFrames
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
  // A result answers a `cmd` this robot sent, so it goes to the IO carrier
  // first and stops there: it is not a trigger, and nothing else may take it
  // for one. A shake is the wand, and only a body that draws answers it —
  // drawCard refuses while busy.
  conn.onMessage((msg) => {
    if (msg.type === 'result') { executor.onResult(msg); return; }
    if (msg.type === 'shake') robot.drawCard();
  });

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
      return drawsOnShake(body) && session.startTurn(() => brain.drawCard());
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
 * The choice is what the body declared, not what it is called, and the
 * carriers compose: a body may legally drive AND pose, and a body that only
 * halts still has to hear `stop`. Each method goes to the carrier that owns
 * its verb — motors over the link for `drive`/`cruise`/`stop`, the screen here
 * for `pose`/`draw` — and a body with no connected source at all is carried by
 * a log-only carrier for every verb.
 * @param {import('../core/bodies.js').Body} body
 * @param {import('./link.js').BodyConn} conn
 * @param {(line: string) => void} log
 * @param {{ pet: import('./pet/animator.js').Animator | null,
 *           tarot: import('./tarot/animator.js').TarotAnimator | null }} animators
 * @returns {CompositeExecutor}
 */
function makeExecutor(body, conn, log, animators) {
  const verbs = new Set(verbsOf(body.actions));
  if (!connected(body)) {
    // Nothing is listening, so nothing is drawn either: every verb — the
    // screen's included — is written down and no frame reaches `deps.screen`.
    return new CompositeExecutor(new DryRunExecutor(log), new LogOnlyScreen(log));
  }
  // `halt` needs the link as much as `drive` does: a body that can only stop
  // must still be told to. A body with neither has no motion to carry.
  const motors = verbs.has('drive') || verbs.has('halt')
    ? new RemoteExecutor((msg) => conn.send(msg))
    : new NoMotionExecutor();
  // With no frames there is no face to move, so the screen half is absent and
  // a pose or draw resolves without drawing anything — a body whose screen
  // cannot be drawn on has nothing to receive.
  const screen = verbs.has('pose') && animators.pet
    ? new PetExecutor(animators.pet)
    : verbs.has('draw') ? new TarotExecutor(animators.tarot) : null;
  // A plugin body's commands are the one thing it can be asked for that is not
  // a verb, so they get a carrier of their own — and only when there is
  // something to carry: a body whose command table is empty is never asked for
  // an op, and building the carrier would only be a promise nobody awaits.
  const io = body.commands?.length ? new IoExecutor(conn) : null;
  return new CompositeExecutor(motors, screen, io);
}

/**
 * One bounded move step, as the motors take it.
 * @typedef {{ drive: string, steer: string, duration_ms: number }} MotionStep
 */

/**
 * The executor the brain and the session talk to when the body has more than
 * one carrier. It keeps the shapes they already know — `connected` and
 * `generation` are the motors', because losing the link kills the motion first
 * — and sends each verb to the carrier that owns it: `move`/`cruise`/`stop` to
 * the motors, `pose`/`draw`/`reveal` to the screen. A carrier that is not there
 * resolves at once, the way `executor.pose?.()` did before.
 */
class CompositeExecutor {
  #motors;
  /** @type {{
   *   connected: boolean,
   *   pose?(name: import('../core/poses.js').Pose): Promise<void>,
   *   draw?(card: import('../core/tarot.js').Draw): Promise<void>,
   *   reveal?(): Promise<void>,
   * } | null} */
  #screen;
  /** @type {import('./body/executor.js').IoExecutor | null} */
  #io;

  /**
   * @param {{
   *   connected: boolean,
   *   readonly generation: number,
   *   move(steps: MotionStep[]): Promise<void>,
   *   cruise(drive: string, steer: string): Promise<void>,
   *   stop(): Promise<void>,
   * }} motors
   * @param {{
   *   connected: boolean,
   *   pose?(name: import('../core/poses.js').Pose): Promise<void>,
   *   draw?(card: import('../core/tarot.js').Draw): Promise<void>,
   *   reveal?(): Promise<void>,
   * } | null} screen
   * @param {import('./body/executor.js').IoExecutor | null} [io]
   */
  constructor(motors, screen, io = null) {
    this.#motors = motors;
    this.#screen = screen;
    this.#io = io;
  }

  get connected() { return this.#motors.connected; }

  /** Losing the link takes both halves: the screen stops being fed with them. */
  set connected(value) {
    this.#motors.connected = value;
    if (this.#screen) this.#screen.connected = value;
    if (this.#io) this.#io.connected = value;
  }

  get generation() { return this.#motors.generation; }

  /** @param {MotionStep[]} steps */
  move(steps) { return this.#motors.move(steps); }

  /** @param {string} drive @param {string} steer */
  cruise(drive, steer) { return this.#motors.cruise(drive, steer); }

  /** A halt abandons any IO in flight as well as the motion. */
  stop() {
    this.#io?.abort();
    return this.#motors.stop();
  }

  /**
   * One IO op. No carrier means the body declared no commands — asking anyway
   * is a refusal, not a silent success: the brain traces the failure.
   * @param {import('../core/io-program.js').Op} op
   * @returns {Promise<unknown>}
   */
  io(op) {
    return this.#io ? this.#io.io(op) : Promise.reject(new Error('unavailable'));
  }

  /**
   * The body's answer to a `cmd`.
   * @param {{ id?: unknown, ok?: unknown, value?: unknown, error?: unknown }} msg
   */
  onResult(msg) { this.#io?.onResult(msg); }

  /** @param {import('../core/poses.js').Pose} name */
  pose(name) { return this.#screen?.pose?.(name) ?? Promise.resolve(); }

  /** @param {import('../core/tarot.js').Draw} card */
  draw(card) { return this.#screen?.draw?.(card) ?? Promise.resolve(); }

  reveal() { return this.#screen?.reveal?.() ?? Promise.resolve(); }
}

/**
 * The screen half of a body that is not connected at all. A pose is written
 * down the way a move is, and no frame is drawn: "only logs" has to cover the
 * screen verbs too, or a dry run would quietly paint a screen it cannot reach.
 */
class LogOnlyScreen {
  /** The Brain's `stop()` on a body that has gone away sets this; nothing here reads it. */
  connected = true;
  /** @type {(line: string) => void} */
  #log;

  /** @param {(line: string) => void} log */
  constructor(log) { this.#log = log; }

  /** @param {import('../core/poses.js').Pose} name */
  pose(name) {
    this.#log(`dry-run: pose ${name}`);
    return Promise.resolve();
  }

  draw() {
    this.#log('dry-run: draw');
    return Promise.resolve();
  }

  reveal() {
    this.#log('dry-run: reveal');
    return Promise.resolve();
  }
}

/**
 * Whether a shake reaches a returning draw on this body (tarot mode spec §5).
 * The brain asks the same question inside `drawCard`; asking it here as well is
 * what keeps a shake that draws nothing from taking a turn — a body whose
 * trigger was emptied would otherwise enter THINKING and only then be refused.
 * @param {import('../core/bodies.js').Body} body
 */
function drawsOnShake(body) {
  const shake = (body.triggers ?? []).find((trigger) => trigger.on === 'shake');
  const action = shake ? body.actions.find((candidate) => candidate.name === shake.action) : undefined;
  return action?.returns === true;
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
