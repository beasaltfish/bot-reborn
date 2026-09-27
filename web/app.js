// Entry point: wiring only (spec §10). Every decision here is made somewhere
// else; if a branch shows up in this file it belongs in session.js.

import { loadConfig, saveConfig, layerReady, directionsTaught, resetSticky } from './config.js';
import { t, FAULT_LABEL } from './strings.js';
import { createUi } from './ui.js';
import { createSettings } from './settings.js';
import { createCalibration } from './calibrate.js';
import { createSetupSheet } from './setup-sheet.js';
import { fabRung } from './steps.js';
import { missingParts, PART_STEP } from './robot.js';
import { Ftdi , USB_FILTERS } from './ftdi.js';
import { Executor } from './executor.js';
import { Brain } from './brain.js';
import { OpenAiCompatStt } from './providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from './providers/llm-openai-compat.js';
import { WebAudioTts } from './providers/tts-webaudio.js';
import { AudioPipeline } from './audio/pipeline.js';
import { loadSherpa } from './audio/sherpa.js';
import { createSpotter } from './audio/kws.js';
import { createVoiceDetector } from './audio/vad.js';
import { createEarcon } from './audio/earcon.js';
import { unknownTokens } from './audio/keyword-lines.js';
import { Session } from './audio/session.js';

const config = loadConfig();
const ui = createUi(config.lang, () => config.wakeWord);

// Start pulling the model down the moment the page opens. Nothing about
// downloading needs a user gesture — only getUserMedia and the AudioContext do
// — so making the first press wait for 19 MB was a choice, and the wrong one.
// loadSherpa is a one-shot, so start() joins this attempt rather than making
// another.
const warming = loadSherpa((s) => s && step(s));
warming.catch(() => {});

/** @type {AudioPipeline | null} */ let pipeline = null;
/** @type {Session | null} */ let session = null;
/** Between start() and stop(), including the boot in between — `session` is
 *  only set near the end of it, and a screen going off during the boot still
 *  has to be told the microphone is on its way. */
let live = false;
/** The screen went off with the microphone open, so it opens again with it. */
let resumeOnShow = false;

// One button with two meanings in stage 1: wake it, then stop it. It routes on
// the tone painted on the button at the moment it was pressed, so what runs is
// what the user saw — a separate flag could disagree with the face, and the
// moment it did, a button reading STOP would start the car.
//
// Layer 2 of §4.1 lives in the 'stop' branch. The order inside
// onEmergencyStop() is the part that matters (car first, state machine
// second); this line only has to reach it.
ui.onFab((tone) => {
  if (tone === 'stop') return void session?.onEmergencyStop();
  // Amber is whichever gating step is unfinished, so the rung decides, not the
  // colour. Reading it back off steps.js keeps this in step with the list.
  if (tone === 'wait') {
    // The same routing the robot's own bands use, from the same rung: the
    // button names a step, and pressing it does that step. Nothing in this
    // path goes through a list.
    return void startStep(fabRung(lastDone, false).step);
  }
  void start();
});
ui.onMic(stop);
// The wake word's other job, done by hand: a tap on the robot while it is
// thinking or talking shuts it up. session.js decides whether there is
// anything to interrupt; before start() there is no session and this is a
// tap on a picture.
ui.onRobot(() => session?.interrupt());

/**
 * What the one button offers when nothing is running.
 *
 * The rung comes from steps.js, which the settings list renders too, so the
 * two cannot disagree about what is next (spec §6).
 *
 * getDevices() answers from the persistent grant, so this survives reloads and
 * costs nothing. Asking it up front is the whole point: the product used to
 * download 19 MB, open the microphone, and only then discover the car had
 * never been paired — reporting it as a failure of the thing the user had just
 * asked for.
 *
 * @param {boolean} [running]
 */
async function offerNextStep(running = false) {
  const done = {
    // Every field, not just the address: a layer with no key in it used to
    // count as done, and the first thing it did was fail.
    keys: layerReady(config.stt) && layerReady(config.llm),
    car: (await navigator.usb.getDevices()).length > 0,
    // Measured, not its value: a car that turned out NOT to be reversed has
    // been calibrated just as much as one that was. Both answers, because the
    // step is one sheet that asks two questions.
    steer: directionsTaught(config.calibration),
  };
  ui.needCar(!done.car);
  // What is still missing, drawn on the robot rather than listed anywhere: a
  // part it has not been given yet is a part that is not there yet.
  const missing = missingParts(config);
  ui.assembly(missing);
  const rung = fabRung(done, running);
  // The ring on the robot and the word on the button come from the same rung,
  // so they can never point at two different steps.
  ui.nextPart(rung.step === 'listen' || rung.step === 'stop' ? null : rung.step);
  // The doors are drawn from what the robot is SHOWING, not from the rung: a
  // ghost is the only advertisement a drawing has, so every ghost opens. That
  // is one part wider than the checklist — the mouth, because a voice is
  // optional and no step will ever ring over it — and the plug, which is a
  // missing car rather than a missing part and so is added here.
  //
  // While the car is running none of them is a door: the one button is the
  // brake, and the robot is not a place to start an errand from.
  const doors = new Set(running ? [] : missing.map((part) => PART_STEP[part]));
  if (!running && !done.car) doors.add('car');
  ui.openParts(doors);
  ui.fabFace(rung.tone, rung.key);
  return done;
}
void offerNextStep();

/**
 * One AudioContext for the setup sheet's checks.
 *
 * Lazy: built on the first check, which is always inside a user gesture, so it
 * starts running rather than suspended. Shared, because Chrome hard-caps a
 * document at six and the sheet's TTS check is the kind of thing somebody
 * presses repeatedly while swapping providers.
 */
/** @type {AudioContext | null} */
let checkCtx = null;

const setupSheet = createSetupSheet({
  lang: config.lang,
  config,
  save: () => saveConfig(config),
  onChange: () => void refresh(),
  audioContext: () => (checkCtx ??= new AudioContext()),
  log: ui.log,
});

const calibration = createCalibration({
  lang: config.lang,
  openCar: (opts) => openCar(opts),
  onCalibrated: (patch) => {
    // Assigned into the same object, one answer at a time: the sheet settles
    // ①b before it asks ①, and a car unplugged between the two questions must
    // keep the answer it already gave.
    Object.assign(config.calibration, patch);
    saveConfig(config);
    lastDone = { ...lastDone, steer: directionsTaught(config.calibration) };
    step('calibration: ' + JSON.stringify(patch));
  },
  onChange: () => void refresh(),
  log: ui.log,
});

const settings = createSettings({
  lang: config.lang,
  config,
  save: () => saveConfig(config),
  openKeys: (back) => setupSheet.open({ back }),
  calibrate: (back) => calibration.open({ back }),
  onResetSticky: () => {
    // Assigned back into the same object every other module is holding: they
    // were handed `config` itself, and swapping in a fresh one would leave the
    // brain and the session reading the values this button just cleared.
    Object.assign(config, resetSticky(config));
    saveConfig(config);
  },
  onChange: () => void refresh(),
});

/**
 * Begin a gating step. The robot's bands and the amber button both land here,
 * so a tap on the wheels and a press of a button reading "Teach me which way"
 * can never turn out to mean two different things.
 *
 * Only ever reached for the step that is NEXT: the fab offers that one, and
 * ui.js leaves that one band live and marks the other two inert. A finished
 * step is not a door — see nextPart().
 *
 * @param {import('./steps.js').Step | 'listen' | 'stop'} step
 */
function startStep(step) {
  if (step === 'car') return void pair();
  if (step === 'steer') return void calibration.open();
  if (step === 'keys') return void setupSheet.open();
}

// The robot is the checklist: the band the ring is on is pressed, and the step
// it stands for happens. The other two bands are inert, so this listener sits
// on all three and can still only ever hear one.
ui.onPart(startStep);

/** The settings list reads this synchronously while it renders, and
 *  getDevices() is a promise — so the answer is kept rather than re-asked. */
let lastDone = { keys: false, car: false, steer: false };
async function refresh() { lastDone = await offerNextStep(); }
void refresh();

// The cable IS the control for this step. getDevices() only answers with
// devices that are currently plugged in, so pulling the cable puts the car's
// step back by itself and plugging it in again takes it away — no picker, no
// button, because the permission outlives the unplug. Without these two lines
// that is all true but invisible: nothing would ask again until some other
// event happened to call refresh(), and the robot would sit there showing a
// body it no longer has.
//
// This is also why the body is not a door once the step is done. Re-opening
// the picker was the only way to change cars; it is not, and it was startling.
navigator.usb.addEventListener('connect', () => void refresh());
navigator.usb.addEventListener('disconnect', () => void refresh());

/**
 * Pairing, from its own gesture.
 *
 * requestDevice() needs a user gesture and start() spends its own on several
 * awaits long before it gets here, which is why this is a rung of its own
 * rather than something start() could do when it notices. Cancelling the
 * picker throws, and a person changing their mind is not a failure to report.
 */
/**
 * Open the car, and nothing else.
 *
 * Calibration has to move the car before the model or the microphone exist, so
 * this cannot stay buried inside start(). getDevices() answers from the
 * persistent grant; if it is empty, whoever called this has a bug, because the
 * button does not offer anything that needs the car until it is paired.
 *
 * @param {{ raw?: boolean }} [opts] `raw` builds the executor with no
 *   calibration applied, which is what calibrating it needs — measuring
 *   through the setting under measurement only confirms what was set.
 * @returns {Promise<{ ftdi: import('./ftdi.js').Ftdi, executor: Executor }>}
 */
async function openCar(opts = {}) {
  const [device] = await navigator.usb.getDevices();
  if (!device) throw new Error(t(config.lang, 'usbNotPaired'));
  // ② if it has been measured on this car; ftdi.js's 1.2 if it has not.
  const ftdi = await Ftdi.open(navigator.usb, {
    device,
    ...(config.calibration.bytesPerMs === null
      ? {} : { bytesPerMs: config.calibration.bytesPerMs }),
  });
  // Item one. Without it a car wired the other way drives mirror-image and
  // nothing anywhere says so — it simply goes left when it was told right.
  const executor = new Executor(ftdi, {
    calibration: opts.raw ? {} : config.calibration,
  });
  return { ftdi, executor };
}

async function pair() {
  try {
    await navigator.usb.requestDevice({ filters: [...USB_FILTERS] });
  } catch {
    step('pairing cancelled');
  }
  await refresh();
}

/**
 * Boot progress is diagnostics, not copy.
 *
 * It went to the notice line for one round and that was wrong: 「✓
 * sherpa-onnx-wasm-kws-main.js」 is not something to say to a child. The
 * screen gets one sentence while starting; the trace goes where a developer
 * can reach it and nowhere else.
 *
 * @param {string} msg
 */
function step(msg) {
  ui.log(msg);
  console.info('[boot]', msg);
}

async function start() {
  live = true;
  ui.running(true);
  step('start');
  // One sentence, held until the whole chain is up. The detail is in the
  // console; what the screen owes the user is "something is happening".
  ui.notice(t(config.lang, 'booting'));
  try {
    const sherpa = await warming;
    step('✓ model');

    // §5.5 / docs/hardware.md: an unknown token does not fail quietly — it
    // calls SHERPA_ONNX_EXIT(-1) and aborts the whole wasm module, and the page
    // has to be reloaded. Check before createKws() ever sees the lines.
    const keywords = (await Promise.all(
      ['keywords/name.txt', 'keywords/stop.txt']
        .map((p) => fetch(p).then((r) => r.text())),
    )).join('\n');
    const bad = unknownTokens(keywords, sherpa.tokens);
    if (bad.length) throw new Error(t(config.lang, 'keywordsInvalid') + bad.join(' '));

    step('… microphone');
    pipeline = await AudioPipeline.start({
      onRate: (hz) => ui.log(`AudioContext ${hz} Hz`),
    });
    step('✓ microphone');
    await running(pipeline.audioContext);
    const earcon = createEarcon(pipeline.audioContext);

    const stt = new OpenAiCompatStt(config.stt);
    const llm = new OpenAiCompatLlm(config.llm);
    const tts = new WebAudioTts(config.tts, { audioContext: pipeline.audioContext });

    // getDevices(), not requestDevice(): the picker needs a user gesture and
    // several awaits ago this one was spent. The grant is persistent (§9.2), so
    // pairing happens once, in the onboarding flow, and never here.
    step('… car');
    const { ftdi, executor } = await openCar();
    step('✓ car');
    executor.onError = (err) => {
      ui.log('USB: ' + err.message);
      session?.onEmergencyStop();
      tts.speak(t(config.lang, 'deviceDisconnected')).catch(() => {});
    };

    // One turn can fault twice: the instrument fails, and then the line that
    // would report it cannot be spoken either. The first is the cause and the
    // second is a consequence of it — overwriting the notice with the
    // consequence sends the user to fix the wrong instrument. Every fault
    // reaches the log; the notice keeps the first one of the turn.
    let reported = false;
    /** @type {(part: import('./strings.js').FaultPart, err: Error) => void} */
    const onFault = (part, err) => {
      ui.log(`${part}: ${err.message}`);
      console.error(`[${part}]`, err);
      if (reported) return;
      reported = true;
      ui.notice(t(config.lang, FAULT_LABEL[part]) + err.message);
    };

    session = new Session({
      pipeline,
      kws: createSpotter(sherpa, keywords),
      vad: createVoiceDetector(sherpa),
      stt,
      tts,
      executor,
      earcon,
      config,
      // THINKING is the start of an attempt, which is the honest moment to
      // clear the last one's verdict: the notice then means "the turn you
      // just took failed", and it goes away by trying again rather than by a
      // timer nobody can see.
      onState: (s) => {
        if (s === 'THINKING') { reported = false; ui.notice(''); }
        ui.setState(s);
      },
      onFault,
    });
    // Brain gets the session's wrappers, never the raw provider: speakingTts is
    // what makes SPEAKING bracket exactly the playback, and session.earcon is
    // what puts brain's beeps behind §5.6's gate.
    session.attach(new Brain({
      llm,
      executor,
      tts: session.speakingTts,
      earcon: session.earcon,
      config,
      // §11.1: set by voice, invisible afterwards. If it is not written down
      // here it is not sticky at all, and the settings page (part 3) would have
      // nothing to show or reset.
      onReplyLangChange: () => saveConfig(config),
      onFault,
    }));
    session.start();

    step('… wake lock');
    await requestWakeLock();
    ui.notice('');
    ui.log('▶︎ ' + (config.wakeWord ? 'hey steven' : 'listening'));
  } catch (err) {
    const e = /** @type {Error} */ (err);
    const why = e.name === 'NotAllowedError' ? t(config.lang, 'micDenied') : e.message;
    step('failed: ' + why);
    console.error(e);
    stop();
    // After stop(), which does not touch the notice: a failed start used to
    // report itself only into a log this page hides, so pressing the one
    // button looked like pressing nothing. A person then presses it again —
    // and until loadSherpa became a one-shot, the second press wedged the
    // engine permanently.
    ui.notice(why, /** @type {any} */ (e).go);
  }
}

function stop() {
  live = false;
  session?.onEmergencyStop();
  pipeline?.stop();
  session = null;
  pipeline = null;
  ui.running(false);
  void refresh();
}

/**
 * An AudioContext made without a user gesture does not fail, it is born
 * suspended and hears nothing — a robot with its eyes open and its ears shut.
 * That only happens on the way back from a screen-off, and only if the browser
 * has stopped counting the page's earlier gesture. resume() then neither
 * resolves nor rejects, so it gets a second, and after that the failure is
 * made loud: start() reports it and the Listen button comes back.
 *
 * @param {AudioContext} ctx
 */
async function running(ctx) {
  if (ctx.state === 'running') return;
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))]);
  if (/** @type {string} */ (ctx.state) !== 'running') {
    throw new Error(t(config.lang, 'needsTap'));
  }
}

/** §5.7: the lock keeps the screen from timing out while the robot listens.
 *  It is released whenever the page leaves the front, and start() asks again
 *  on the way back. */
async function requestWakeLock() {
  try { await navigator.wakeLock?.request('screen'); }
  catch (err) { ui.log('Wake Lock: ' + /** @type {Error} */ (err).message); }
}

/**
 * The screen is the robot's eyes: off, it is not listening; on again, it is.
 *
 * This replaced the keep-alive tone (2026-09-27). Android takes the microphone
 * away about a minute after the screen goes off, and the tone kept it by
 * borrowing a media session — behaviour, not a contract, and a different
 * Android could take it away silently. Now the page lets go of everything
 * itself, on the one event that says when, and a robot the user cannot see
 * cannot be driving a car they cannot see either: stop() brakes first.
 *
 * Coming back reopens the microphone without a tap. The page has already had
 * its gesture, and Chrome counts that for the AudioContext; if some browser
 * does not, running() makes start() fail and the Listen button is back.
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!live) return;
    resumeOnShow = true;
    step('screen off — stopping');
    stop();
    return;
  }
  if (!resumeOnShow) return;
  resumeOnShow = false;
  void start();
});
