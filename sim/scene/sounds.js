// The bench's few sounds, made on the spot with Web Audio rather than shipped
// as files: a thunk when something lands in the bin, and a short low buzz
// when the bin will not take it.
//
// The AudioContext is made on first use, which is always inside a pointer
// release: browsers only let a page start sound from a user's gesture.

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
