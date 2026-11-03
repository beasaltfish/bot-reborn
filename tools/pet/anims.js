// The dog's animations, as keyframes over drawDog's parameters (pet screen
// spec §7, postures spec). The dog is always in one of three postures — lying,
// sitting, standing — and each has a looping rest. Moving between postures is a
// transition (one play), and a trick (shake, spin) is done from the posture it
// belongs to and ends on that posture's rest, so nothing ever jumps:
//
//   rest-lie  rest-sit  rest-stand            loops
//   lie-sit  sit-lie  lie-stand  stand-lie  sit-stand  stand-sit     once each
//   shake (from sitting)  spin (from standing)                       once each
//
// Every one of them starts and ends on the first frame of a rest, and
// POSTURE says what those first frames are.

/** How much of each posture the dog is in: what is left over is lying. */
const SHAPE = {
  lie: { sit: 0, stand: 0 },
  sit: { sit: 1, stand: 0 },
  stand: { sit: 0, stand: 1 },
};

const REST = { breathe: 0, blink: 0, tail: 0, sit: 0, stand: 0, paw: 0, bob: 0, turn: 0 };

/** Ease in and out, so a change starts and stops like a body, not a slider. */
const ease = (/** @type {number} */ t) => (1 - Math.cos(Math.PI * t)) / 2;
const round2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** frame i of n, from 0 to 1 */
const at = (/** @type {number} */ i, /** @type {number} */ n) => (n <= 1 ? 0 : i / (n - 1));

/**
 * A rest: breathing, a slow wag, and one blink in every loop, in a posture.
 * Frame 0 is the posture's own parameters with nothing moving.
 * @param {'lie'|'sit'|'stand'} posture @param {number} n
 */
function restFrames(posture, n) {
  return Array.from({ length: n }, (_, i) => {
    const t = at(i, n);
    const breath = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    // One blink near the end of the loop, opened again before it repeats.
    const blink = t > 0.62 && t < 0.72 ? Math.sin(((t - 0.62) / 0.1) * Math.PI) : 0;
    return {
      ...REST, ...SHAPE[posture],
      breathe: round2(breath),
      blink: round2(blink),
      tail: Math.round(Math.sin(t * Math.PI * 2) * (posture === 'lie' ? 8 : 12)),
    };
  });
}

/** The first frame of each rest: where every other animation starts and ends. */
export const POSTURE = {
  lie: restFrames('lie', 24)[0],
  sit: restFrames('sit', 16)[0],
  stand: restFrames('stand', 16)[0],
};

/**
 * One posture to another, eased, with the tail swinging once on the way. Starts
 * on the source's rest frame and ends on the target's.
 * @param {'lie'|'sit'|'stand'} from @param {'lie'|'sit'|'stand'} to
 */
function transition(from, to) {
  const n = 8;
  return Array.from({ length: n }, (_, i) => {
    const t = at(i, n);
    const u = ease(t);
    return {
      ...REST,
      sit: round2(SHAPE[from].sit + (SHAPE[to].sit - SHAPE[from].sit) * u),
      stand: round2(SHAPE[from].stand + (SHAPE[to].stand - SHAPE[from].stand) * u),
      tail: Math.round(Math.sin(t * Math.PI * 2) * 10) || 0,   // `|| 0`: sin(2π) rounds to -0, which is not 0 to deepEqual
    };
  });
}

/**
 * A trick: `hold` builds the body of it (0..1 through the trick), then the last
 * two frames settle onto the posture's rest frame, so the hand-back is a
 * movement, not a cut. `hold(0)` must be that rest frame.
 * @param {'lie'|'sit'|'stand'} posture @param {number} n @param {(t: number, base: object) => object} hold
 */
function trickFrames(posture, n, hold) {
  const base = { ...POSTURE[posture] };
  const out = [];
  for (let i = 0; i < n - 2; i++) out.push(hold(i / (n - 3), base));
  out.push({ ...base, tail: -8 });
  out.push({ ...base });
  return out;
}

export const ANIMS = {
  'rest-lie': { fps: 8, loop: true, frames: restFrames('lie', 24) },
  'rest-sit': { fps: 8, loop: true, frames: restFrames('sit', 16) },
  'rest-stand': { fps: 8, loop: true, frames: restFrames('stand', 16) },

  'lie-sit': { fps: 10, loop: false, frames: transition('lie', 'sit') },
  'sit-lie': { fps: 10, loop: false, frames: transition('sit', 'lie') },
  'lie-stand': { fps: 10, loop: false, frames: transition('lie', 'stand') },
  'stand-lie': { fps: 10, loop: false, frames: transition('stand', 'lie') },
  'sit-stand': { fps: 10, loop: false, frames: transition('sit', 'stand') },
  'stand-sit': { fps: 10, loop: false, frames: transition('stand', 'sit') },

  // Sitting, the right paw is held out in front, shaken up and down three
  // times, and goes back down.
  shake: {
    fps: 10,
    loop: false,
    frames: trickFrames('sit', 16, (t, base) => {
      const out = Math.min(1, t / 0.2) * (t > 0.78 ? 1 - ease((t - 0.78) / 0.22) : 1);
      // The shake itself is only while the paw is out.
      const shaking = t > 0.22 && t < 0.76 ? Math.sin(((t - 0.22) / 0.54) * Math.PI * 6) : 0;
      return {
        ...base,
        paw: round2(Math.max(0, Math.min(1, out))),
        bob: round2(shaking),
        tail: Math.round(Math.sin(t * Math.PI * 6) * 14),
      };
    }),
  },

  // Standing, one full turn, tail out.
  spin: {
    fps: 10,
    loop: false,
    frames: trickFrames('stand', 18, (t, base) => ({
      ...base,
      turn: round2(t),
      tail: Math.round(Math.sin(t * Math.PI * 8) * 20),
    })),
  },
};
