// Entry point: wiring only (spec §10). Every decision here is made somewhere
// else; if a branch shows up in this file it belongs in session.js.

import { loadConfig, saveConfig } from './config.js';
import { t } from './strings.js';
import { createUi } from './ui.js';
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
import { createKeepAlive, isBehind } from './audio/keepalive.js';
import { unknownTokens } from './audio/keyword-lines.js';
import { Session } from './audio/session.js';

const config = loadConfig();
const ui = createUi(config.lang);

// Start pulling the model down the moment the page opens. Nothing about
// downloading needs a user gesture — only getUserMedia and the AudioContext do
// — so making the first press wait for 19 MB was a choice, and the wrong one.
// loadSherpa is a one-shot, so start() joins this attempt rather than making
// another.
const warming = loadSherpa((s) => s && step(s));
warming.catch(() => {});

/** @type {AudioPipeline | null} */ let pipeline = null;
/** @type {{ stop(): void } | null} */ let keepAlive = null;
/** @type {Session | null} */ let session = null;

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
  if (tone === 'wait') return void pair();
  void start();
});
ui.onSleep(stop);

/**
 * What the one button offers when nothing is running.
 *
 * getDevices() answers from the persistent grant, so this survives reloads and
 * costs nothing. Asking it up front is the whole point: the product used to
 * download 19 MB, open the microphone, and only then discover the car had
 * never been paired — reporting it as a failure of the thing the user had just
 * asked for.
 */
async function offerNextStep() {
  const paired = (await navigator.usb.getDevices()).length > 0;
  ui.needCar(!paired);
  ui.fabFace(paired ? 'go' : 'wait', paired ? 'fabStart' : 'fabPair');
}
void offerNextStep();

/**
 * Pairing, from its own gesture.
 *
 * requestDevice() needs a user gesture and start() spends its own on several
 * awaits long before it gets here, which is why this is a rung of its own
 * rather than something start() could do when it notices. Cancelling the
 * picker throws, and a person changing their mind is not a failure to report.
 */
async function pair() {
  try {
    await navigator.usb.requestDevice({ filters: [...USB_FILTERS] });
  } catch {
    step('pairing cancelled');
  }
  await offerNextStep();
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
  ui.running(true);
  step('start');
  // One sentence, held until the whole chain is up. The detail is in the
  // console; what the screen owes the user is "something is happening".
  ui.notice(t(config.lang, 'booting'));
  try {
    // Before any await: autoplay needs the user gesture, and one await spends it.
    const ka = createKeepAlive({ onLog: ui.log });
    keepAlive = ka;
    const armed = ka.armFromGesture();

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
    const earcon = createEarcon(pipeline.audioContext);

    const stt = new OpenAiCompatStt(config.stt);
    const llm = new OpenAiCompatLlm(config.llm);
    const tts = new WebAudioTts(config.tts, { audioContext: pipeline.audioContext });

    // getDevices(), not requestDevice(): the picker needs a user gesture and
    // several awaits ago this one was spent. The grant is persistent (§9.2), so
    // pairing happens once, in the onboarding flow, and never here.
    step('… car');
    const [device] = await navigator.usb.getDevices();
    // Not thrown as a bare message: this is the one failure that names
    // something the user has to go and do, so it travels with somewhere to go.
    // §5's 「连上车」 rung folds this into the button itself in stage 2.
    if (!device) throw Object.assign(new Error(t(config.lang, 'usbNotPaired')), {
      go: { href: 'setup.html', label: t(config.lang, 'pairNow') },
    });
    const ftdi = await Ftdi.open(navigator.usb, { device });
    step('✓ car');
    const executor = new Executor(ftdi, {
      onError: (err) => {
        ui.log('USB: ' + err.message);
        session?.onEmergencyStop();
        tts.speak(t(config.lang, 'deviceDisconnected')).catch(() => {});
      },
    });

    session = new Session({
      pipeline,
      kws: createSpotter(sherpa, keywords),
      vad: createVoiceDetector(sherpa),
      stt,
      tts,
      executor,
      earcon,
      config,
      onState: (s) => ui.setState(s),
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
    }));
    session.start();

    await armed;
    step('… wake lock');
    await requestWakeLock();
    watchForMissedFrames();
    ui.notice('');
    ui.log('▶︎ hey steven');
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
  session?.onEmergencyStop();
  keepAlive?.stop();
  pipeline?.stop();
  session = null;
  pipeline = null;
  keepAlive = null;
  ui.running(false);
  void offerNextStep();
}

/** §5.7: the lock only covers "screen on, page in front". It cannot keep the
 *  page alive in the background — no Web API can — which is what §5.8 is for. */
async function requestWakeLock() {
  try { await navigator.wakeLock?.request('screen'); }
  catch (err) { ui.log('Wake Lock: ' + /** @type {Error} */ (err).message); }
}

/** §5.8's passive detection. It can only report once the page is in front
 *  again — nobody can be told anything while the phone is asleep — and that is
 *  exactly the moment the user is looking at the screen. No earcon: they were
 *  not in the room. */
function watchForMissedFrames() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !pipeline) return;
    const elapsed = Date.now() - pipeline.startedAt;
    if (isBehind(pipeline.fedFrames, elapsed)) ui.notice(t(config.lang, 'screenOffMissed'));
  });
}
