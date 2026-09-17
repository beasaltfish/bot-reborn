// Providers: ⑨ and ⑪. The two calibrations that are about the cloud layers
// rather than about the microphone.
//
// ⑨ counts, over twenty real turns, how many replies are pure restatement. It
// needs the model's own sentence and its dispatched actions visible, which is
// what the decorators below are for — the same shape setup.js uses for the
// typed driver, with speech on the front instead of a text box.
//
// ⑪ plays one code-switched line through whichever TTS you paste in. It is the
// only waiting item that can overturn a CHOICE rather than a constant: §8.3's
// default TTS. Nothing is saved; config.js stays the only writer of storage.

import { Session } from '../audio/session.js';
import { Brain } from '../brain.js';
import { createSpotter } from '../audio/kws.js';
import { createVoiceDetector } from '../audio/vad.js';
import { createEarcon } from '../audio/earcon.js';
import { OpenAiCompatStt } from '../providers/stt-openai-compat.js';
import { OpenAiCompatLlm } from '../providers/llm-openai-compat.js';
import { WebAudioTts } from '../providers/tts-webaudio.js';
import { setStat, setDisabled } from './readout.js';

const NAME = 'providers';
const MIXED_LINE = '「往前走」的英文是 go forward';

const $ = (/** @type {string} */ id) =>
  /** @type {HTMLElement} */ (document.getElementById(id));
const val = (/** @type {string} */ id) =>
  /** @type {HTMLInputElement} */ ($(id)).value.trim();

export function createProviders() {
  /** @type {import('./main.js').BenchContext | null} */ let ctx = null;
  /** @type {Session | null} */ let session = null;
  let turnLog = '';

  /** @param {string} text */
  function logTurn(text) {
    turnLog += `[${new Date().toISOString().slice(11, 19)}] ${text}\n`;
    $('pvTurnLog').textContent = turnLog;
    $('pvTurnLog').scrollTop = $('pvTurnLog').scrollHeight;
  }

  /**
   * ⑨ needs the actions, not just a completion sound. Brain learns nothing
   * about the DOM from this: it still sees an executor.
   * @param {any} exec
   */
  function logged(exec) {
    return {
      get connected() { return exec.connected; },
      /** @param {Array<{ drive: string, steer: string, duration_ms: number }>} steps */
      move(steps) {
        logTurn(`→ move ${steps.map((s) => `${s.drive}+${s.steer} ${s.duration_ms}ms`).join(' → ')}`);
        return exec.move(steps);
      },
      /** @param {string} drive @param {string} steer */
      cruise(drive, steer) {
        logTurn(`→ cruise ${drive}+${steer}`);
        return exec.cruise(drive, steer);
      },
      stop() { logTurn('→ stop'); return exec.stop(); },
    };
  }

  /** ⑨ needs the sentence itself — that is the thing being judged.
   *  @param {any} tts */
  function loggedTts(tts) {
    return {
      /** @param {string} text @param {{ signal?: AbortSignal }} [opts] */
      speak(text, opts) { logTurn(`♫ 「${text}」`); return tts.speak(text, opts); },
      cancel() { tts.cancel(); },
    };
  }

  function runLoop() {
    if (!ctx || session) return;
    const executor = ctx.knobs.executor;
    if (!executor) { logTurn('!! connect the FT232H above first'); return; }
    if (!ctx.config.llm.baseURL) { logTurn('!! no LLM configured — see setup.html'); return; }
    if (!ctx.exclusion.claim(NAME)) {
      logTurn(`!! another panel (${ctx.exclusion.owner}) is running`);
      return;
    }

    const stt = new OpenAiCompatStt(ctx.config.stt);
    const llm = new OpenAiCompatLlm(ctx.config.llm);
    const tts = new WebAudioTts(ctx.config.tts, { audioContext: ctx.pipeline.audioContext });

    // One wrapper, shared. Session only calls stop() on it and Brain calls all
    // three, but two wrappers around one executor would put the same action in
    // the log twice depending on who dispatched it.
    const loggedExec = logged(executor);

    const s = new Session({
      pipeline: ctx.pipeline,
      kws: createSpotter(ctx.sherpa, ctx.keywords),
      vad: createVoiceDetector(ctx.sherpa),
      stt: {
        /** @param {Int16Array} pcm @param {number} rate @param {{ signal?: AbortSignal }} [o] */
        async transcribeDetailed(pcm, rate, o) {
          const heard = await stt.transcribeDetailed(pcm, rate, o);
          // The confidence is on the line because session.js now vetoes on it:
          // a turn that ends in `huh` with a perfectly readable transcript in
          // the log is otherwise indistinguishable from the STT failing.
          const lp = heard.logprob === null ? '' : ` [lp ${heard.logprob.toFixed(2)}]`;
          logTurn(`> ${heard.text}${lp}`);
          return heard;
        },
      },
      tts,
      executor: loggedExec,
      earcon: createEarcon(ctx.pipeline.audioContext),
      config: ctx.config,
      onState: (st) => setStat('pvState', st),
    });
    // Brain gets the session's wrappers, never the raw provider — that is what
    // makes SPEAKING bracket exactly the playback (web/app.js:88).
    s.attach(new Brain({
      llm,
      executor: loggedExec,
      tts: loggedTts(s.speakingTts),
      earcon: s.earcon,
      config: ctx.config,
      onReplyLangChange: () => logTurn(`(reply language is now ${ctx?.config.replyLang})`),
    }));
    s.start();
    session = s;
    setDisabled('pvRun', true);
    setDisabled('pvStop', false);
    logTurn('▶︎ say "hey steven", then talk. Twenty turns.');
  }

  function stopLoop() {
    if (!ctx || !session) return;
    session.onEmergencyStop();
    session = null;
    ctx.exclusion.release(NAME);
    setDisabled('pvRun', false);
    setDisabled('pvStop', true);
    logTurn('■ stopped');
  }

  async function speakMixed() {
    if (!ctx) return;
    setStat('pvSpeakResult', 'speaking…');
    const tts = new WebAudioTts({
      baseURL: val('pvTtsBase'), apiKey: val('pvTtsKey'),
      model: val('pvTtsModel'), voice: val('pvTtsVoice'),
    }, { audioContext: ctx.pipeline.audioContext });
    try {
      const t0 = performance.now();
      await tts.speak(MIXED_LINE);
      setStat('pvSpeakResult',
        `played in ${Math.round(performance.now() - t0)} ms — `
        + 'both languages have to be intelligible, and that is an ear judgement');
    } catch (err) {
      setStat('pvSpeakResult', '❌ ' + /** @type {Error} */ (err).message);
    }
  }

  return {
    name: NAME,

    /** @param {import('./main.js').BenchContext} c */
    start(c) {
      ctx = c;
      setDisabled('pvRun', false);
      // Prefilled from the stored config so the first listen needs no typing;
      // edited here it goes nowhere near storage.
      /** @type {HTMLInputElement} */ ($('pvTtsBase')).value = c.config.tts.baseURL;
      /** @type {HTMLInputElement} */ ($('pvTtsKey')).value = c.config.tts.apiKey;
      /** @type {HTMLInputElement} */ ($('pvTtsModel')).value = c.config.tts.model;
      /** @type {HTMLInputElement} */ ($('pvTtsVoice')).value = c.config.tts.voice;
      $('pvRun').addEventListener('click', runLoop);
      $('pvStop').addEventListener('click', stopLoop);
      $('pvSpeak').addEventListener('click', () => void speakMixed());
    },

    stop() { stopLoop(); ctx = null; },
  };
}
