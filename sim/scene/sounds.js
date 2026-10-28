// The bench's few sounds, made on the spot with Web Audio rather than shipped
// as files: a thunk when something lands in the bin and a short low buzz when
// the bin will not take it; a click as a part's pins go into a board, a tick
// as a wire's end goes in, a pop as a wire is pulled out, and the USB plug
// seating and coming out. Kept quiet: a long run of wiring should not be a din.
//
// The AudioContext is made on first use, which is always inside a pointer
// release or a click: browsers only let a page start sound from a user's gesture.

/** @type {AudioContext | null} */
let ctx = null;

function audio() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Something dropped into the bin: a soft body hitting a plastic floor. */
export function thunk() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.35, t + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  out.connect(a.destination);
  // The body of it: a pitch that falls fast, like a knock.
  const knock = a.createOscillator();
  knock.type = 'sine';
  knock.frequency.setValueAtTime(190, t);
  knock.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  knock.connect(out);
  knock.start(t);
  knock.stop(t + 0.24);
  // The rattle on top: a few milliseconds of filtered noise.
  const n = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 0.8;
  const level = a.createGain();
  level.gain.value = 0.25;
  noise.connect(band).connect(level).connect(a.destination);
  noise.start(t);
}

/** The bin refuses: two short low buzzes, the sound of "no". */
export function buzz() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  for (const at of [0, 0.13]) {
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(0.12, t + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.1);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const o = a.createOscillator();
    o.type = 'square';
    o.frequency.value = 110;
    o.connect(lp).connect(g).connect(a.destination);
    o.start(t + at);
    o.stop(t + at + 0.11);
  }
}

/**
 * A short burst of band-passed noise: the plastic-and-metal snap of a contact.
 * @param {number} freq  where the snap is pitched
 * @param {number} level
 * @param {number} ms
 */
function snap(freq, level, ms) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const n = Math.floor((a.sampleRate * ms) / 1000);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = level;
  src.connect(band).connect(g).connect(a.destination);
  src.start(t);
}

/** A part's pins go into the board. */
export function click() {
  snap(2400, 0.5, 28);
  snap(700, 0.25, 18);
}

/** A wire's end goes into a pin or a hole: lighter than a part. */
export function tick() {
  snap(3200, 0.3, 14);
}

/** A wire pulled out: a small rising pop. */
export function pop() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  g.connect(a.destination);
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(320, t);
  o.frequency.exponentialRampToValueAtTime(980, t + 0.07);
  o.connect(g);
  o.start(t);
  o.stop(t + 0.1);
}

/** The USB-C plug seats: deeper and firmer than a part's pins. */
export function usbIn() {
  snap(1500, 0.55, 34);
  snap(420, 0.35, 26);
}

/** The USB-C plug comes out: a lighter release. */
export function usbOut() {
  snap(1900, 0.3, 18);
}
