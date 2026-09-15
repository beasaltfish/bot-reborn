// Entry point: wiring only (spec §10). Every decision here is made somewhere
// else; if a branch shows up in this file it belongs in session.js.

import { loadConfig } from './config.js';
import { t } from './strings.js';
import { createUi } from './ui.js';
import { Ftdi } from './ftdi.js';
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

/** @type {AudioPipeline | null} */ let pipeline = null;
/** @type {{ stop(): void } | null} */ let keepAlive = null;
/** @type {Session | null} */ let session = null;

ui.onStart(start);
ui.onStop(stop);
// Layer 2 of §4.1. The order inside onEmergencyStop() is the part that matters
// (car first, state machine second); this line only has to reach it.
ui.onEmergencyStop(() => session?.onEmergencyStop());

async function start() {
  ui.running(true);
  ui.notice('');
  try {
    // Before any await: autoplay needs the user gesture, and one await spends it.
    const ka = createKeepAlive({ onLog: ui.log });
    keepAlive = ka;
    const armed = ka.armFromGesture();

    ui.log(t(config.lang, 'booting'));
    const sherpa = await loadSherpa((s) => s && ui.log(s));

    // §5.5 / docs/hardware.md: an unknown token does not fail quietly — it
    // calls SHERPA_ONNX_EXIT(-1) and aborts the whole wasm module, and the page
    // has to be reloaded. Check before createKws() ever sees the lines.
    const keywords = (await Promise.all(
      ['keywords/name.txt', 'keywords/stop.txt']
        .map((p) => fetch(p).then((r) => r.text())),
    )).join('\n');
    const bad = unknownTokens(keywords, sherpa.tokens);
    if (bad.length) throw new Error(t(config.lang, 'keywordsInvalid') + bad.join(' '));

    pipeline = await AudioPipeline.start({
      onRate: (hz) => ui.log(`AudioContext ${hz} Hz`),
    });
    const earcon = createEarcon(pipeline.audioContext);

    const stt = new OpenAiCompatStt(config.stt);
    const llm = new OpenAiCompatLlm(config.llm);
    const tts = new WebAudioTts(config.tts, { audioContext: pipeline.audioContext });

    // getDevices(), not requestDevice(): the picker needs a user gesture and
    // several awaits ago this one was spent. The grant is persistent (§9.2), so
    // pairing happens once, in the onboarding flow, and never here.
    const [device] = await navigator.usb.getDevices();
    if (!device) throw new Error(t(config.lang, 'usbNotPaired'));
    const ftdi = await Ftdi.open(navigator.usb, { device });
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
    }));
    session.start();

    await armed;
    await requestWakeLock();
    watchForMissedFrames();
    ui.log('▶︎ hey steven');
  } catch (err) {
    const e = /** @type {Error} */ (err);
    ui.log('❌ ' + (e.name === 'NotAllowedError' ? t(config.lang, 'micDenied') : e.message));
    stop();
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
