// Entry point: wiring only (spec §10). The phone is a body now (server/body
// split spec §5): it hears, plays, drives and shows a face. Everything that
// decides — the wake word, the VAD, the three providers — is on the brain,
// which served this page and is at the other end of /body.

import { loadConfig, saveConfig, directionsTaught, tokenFromHash } from './config.js';
import { t } from '../core/strings.js';
import { BODY_PATH } from '../core/protocol.js';
import { toInt16 } from '../core/audio/pcm.js';
import { createUi } from './ui.js';
import { createSettings } from './settings.js';
import { createCalibration } from './calibrate.js';
import { fabRung } from './steps.js';
import { missingParts, PART_STEP } from './robot.js';
import { Ftdi, USB_FILTERS } from './ftdi.js';
import { Executor } from './executor.js';
import { AudioPipeline } from './audio/pipeline.js';
import { PcmPlayer } from './audio/player.js';
import { connectBody } from './body-link.js';
import { offerInstall } from './install.js';

const config = loadConfig();

// The admin page's code opens /phone/#token=…. Keep the token, then take it
// out of the address bar so it is not in the history or a bookmark.
const scanned = tokenFromHash(location.hash);
if (scanned) {
  config.token = scanned;
  saveConfig(config);
  history.replaceState(null, '', location.pathname);
}

// The brain sleeps only with its wake word on, so on this screen SLEEPING
// always means "waiting for its name".
const ui = createUi(config.lang, () => true);

const installButton = /** @type {HTMLElement} */ (document.getElementById('install'));
installButton.textContent = t(config.lang, 'install');
offerInstall(installButton);

/** @type {Record<string, import('../core/strings.js').StringKey>} */
const REJECT = {
  token: 'rejectToken', busy: 'rejectBusy', unconfigured: 'rejectUnconfigured',
  protocol: 'rejectProtocol', origin: 'rejectOrigin',
};

/** @type {AudioPipeline | null} */ let pipeline = null;
/** @type {Executor | null} */ let executor = null;
/** @type {ReturnType<typeof connectBody> | null} */ let link = null;
/** Between start() and stop(), including the boot in between. */
let live = false;
/** The screen went off with the microphone open, so it opens again with it. */
let resumeOnShow = false;

// One button: wake it, or stop it — routed on the tone painted on it when it
// was pressed, so what runs is what the user saw (see ui.onFab).
ui.onFab((tone) => {
  if (tone === 'stop') return void stop();
  if (tone === 'wait') return void startStep(fabRung(lastDone, false).step);
  void start();
});
ui.onMic(stop);

/**
 * What the one button offers when nothing is running, from the same rung the
 * robot's ring is drawn from (steps.js).
 * @param {boolean} [running]
 */
async function offerNextStep(running = false) {
  const done = {
    brain: Boolean(config.token),
    // Over plain http there is no navigator.usb at all (Review Focus 4).
    car: ((await navigator.usb?.getDevices()) ?? []).length > 0,
    steer: directionsTaught(config.calibration),
  };
  ui.needCar(!done.car);
  const missing = missingParts(config);
  ui.assembly(missing);
  const rung = fabRung(done, running);
  ui.nextPart(rung.step === 'listen' || rung.step === 'stop' ? null : rung.step);
  const doors = new Set(running ? [] : missing.map((part) => PART_STEP[part]));
  if (!running && !done.car) doors.add('car');
  ui.openParts(doors);
  ui.fabFace(rung.tone, rung.key);
  return done;
}

const calibration = createCalibration({
  lang: config.lang,
  openCar: (opts) => openCar(opts),
  onCalibrated: (patch) => {
    Object.assign(config.calibration, patch);
    saveConfig(config);
    lastDone = { ...lastDone, steer: directionsTaught(config.calibration) };
    ui.log('calibration: ' + JSON.stringify(patch));
  },
  onChange: () => void refresh(),
  log: ui.log,
});

createSettings({
  lang: config.lang,
  config,
  save: () => saveConfig(config),
  calibrate: (back) => calibration.open({ back }),
  onForgetBrain: () => {
    config.token = null;
    saveConfig(config);
  },
  onChange: () => void refresh(),
});

/**
 * Begin a gating step. Linking a brain happens on the computer — the admin
 * page's code — so its step can only say where to go.
 * @param {import('./steps.js').Step | 'listen' | 'stop'} step
 */
function startStep(step) {
  if (step === 'brain') return void ui.notice(t(config.lang, 'brainHow'));
  if (step === 'car') return void pair();
  if (step === 'steer') return void calibration.open();
}
ui.onPart(startStep);

let lastDone = { brain: false, car: false, steer: false };
async function refresh() { lastDone = await offerNextStep(); }
void refresh();

// Plain http without the Chrome flag: the browser hides the car and the
// microphone, and nothing below would say why.
if (!globalThis.isSecureContext) ui.notice(t(config.lang, 'insecure'));

// The cable is the control for the car's step: plugging and unplugging puts it
// back and takes it away by itself.
navigator.usb?.addEventListener('connect', () => void refresh());
navigator.usb?.addEventListener('disconnect', () => void refresh());

/**
 * Open the car, and nothing else. `raw` builds the executor with no
 * calibration applied, which is what calibrating it needs.
 * @param {{ raw?: boolean }} [opts]
 * @returns {Promise<{ ftdi: import('./ftdi.js').Ftdi, executor: Executor }>}
 */
async function openCar(opts = {}) {
  const [device] = (await navigator.usb?.getDevices()) ?? [];
  if (!device) throw new Error(t(config.lang, 'usbNotPaired'));
  const ftdi = await Ftdi.open(navigator.usb, {
    device,
    ...(config.calibration.bytesPerMs === null
      ? {} : { bytesPerMs: config.calibration.bytesPerMs }),
  });
  const car = new Executor(ftdi, { calibration: opts.raw ? {} : config.calibration });
  return { ftdi, executor: car };
}

async function pair() {
  try {
    await navigator.usb.requestDevice({ filters: [...USB_FILTERS] });
  } catch {
    ui.log('pairing cancelled');
  }
  await refresh();
}

async function start() {
  live = true;
  ui.running(true);
  ui.notice(t(config.lang, 'booting'));
  try {
    pipeline = await AudioPipeline.start({ onRate: (hz) => ui.log(`AudioContext ${hz} Hz`) });
    await running(pipeline.audioContext);
    const player = new PcmPlayer(pipeline.audioContext);
    const car = (await openCar()).executor;
    executor = car;
    car.onError = (err) => {
      ui.log('USB: ' + err.message);
      // The brain decides what to say about it (it brakes and says so); the
      // body only reports.
      link?.send({ type: 'motors', connected: false });
    };

    link = connectBody({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BODY_PATH}`,
      token: /** @type {string} */ (config.token),
      caps: { motors: true, screen: true },
      onWelcome: (name) => { ui.notice(''); ui.log(`▶︎ ${name}`); },
      onMessage: (msg) => {
        if (msg.type === 'move') car.hold(msg.drive, msg.steer, msg.ms);
        else if (msg.type === 'stop') void car.stop();
        else if (msg.type === 'hush') player.hush();
        else if (msg.type === 'state') ui.setState(msg.state);
      },
      onAudio: (bytes) => player.play(bytes),
      onLost: () => {
        // §2's watchdog: brake first, then say so. The link is already
        // looking for the brain again.
        void car.stop();
        player.hush();
        ui.setState('SLEEPING');
        ui.notice(t(config.lang, 'linkLost'));
      },
      onReject: (reason) => {
        stop();
        // A refused token is a dead one: forget it, so the button goes back
        // to asking for a brain instead of knocking with it again.
        if (reason === 'token') {
          config.token = null;
          saveConfig(config);
          void refresh();
        }
        ui.notice(t(config.lang, REJECT[reason] ?? 'rejectProtocol'));
      },
    });
    pipeline.subscribe('body', (frame) => link?.sendAudio(toInt16(frame)));
    await requestWakeLock();
  } catch (err) {
    const e = /** @type {Error} */ (err);
    const why = e.name === 'NotAllowedError' ? t(config.lang, 'micDenied') : e.message;
    ui.log('failed: ' + why);
    console.error(e);
    stop();
    ui.notice(why);
  }
}

function stop() {
  live = false;
  link?.close();
  link = null;
  void executor?.stop();
  executor = null;
  pipeline?.stop();
  pipeline = null;
  ui.running(false);
  void refresh();
}

/**
 * An AudioContext made without a fresh gesture can be born suspended; give
 * resume() a second, then fail loudly (see the same function's history).
 * @param {AudioContext} ctx
 */
async function running(ctx) {
  if (ctx.state === 'running') return;
  await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))]);
  if (/** @type {string} */ (ctx.state) !== 'running') {
    throw new Error(t(config.lang, 'needsTap'));
  }
}

/** §5.7: keep the screen on while it listens. */
async function requestWakeLock() {
  try { await navigator.wakeLock?.request('screen'); }
  catch (err) { ui.log('Wake Lock: ' + /** @type {Error} */ (err).message); }
}

// The screen is the robot's eyes: off, it is not listening and not driving;
// on again, it is (2026-09-27). Off closes the link too, so the brain sees the
// body leave rather than a microphone gone quiet.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!live) return;
    resumeOnShow = true;
    ui.log('screen off — stopping');
    stop();
    return;
  }
  if (!resumeOnShow) return;
  resumeOnShow = false;
  void start();
});
