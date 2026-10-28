// The four animations, as keyframes over drawDog's parameters (pet screen
// spec §7). Every trick ends on the idle's first frame: the animator hands the
// screen back to idle after one play, and a dog that teleported from sitting
// to lying would read as a glitch rather than as an animation.

const REST = { breathe: 0, blink: 0, tail: 0, sit: 0, paw: 0, turn: 0 };

/** Ease in and out, so a pose change starts and stops like a body, not a slider. */
const ease = (/** @type {number} */ t) => (1 - Math.cos(Math.PI * t)) / 2;

/** frame i of n, from 0 to 1 */
const at = (/** @type {number} */ i, /** @type {number} */ n) => (n <= 1 ? 0 : i / (n - 1));

/** Idle: lying down, breathing, a slow wag, and one blink in every loop. */
function idleFrame(/** @type {number} */ i, /** @type {number} */ n) {
  const t = at(i, n);
  const breath = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
  // One blink near the end of the loop, opened again before it repeats.
  const blink = t > 0.62 && t < 0.72 ? Math.sin(((t - 0.62) / 0.1) * Math.PI) : 0;
  return {
    ...REST,
    breathe: Math.round(breath * 100) / 100,
    blink: Math.round(blink * 100) / 100,
    tail: Math.round(Math.sin(t * Math.PI * 2) * 10),
  };
}

const IDLE_N = 24;

/**
 * A trick: `hold` builds the body of the animation (0..1 through the trick),
 * then the last two frames settle back onto REST — the idle's first frame —
 * so the hand-back is a movement, not a cut.
 * @param {number} n @param {(t: number) => object} hold
 */
function trickFrames(n, hold) {
  const out = [];
  for (let i = 0; i < n - 2; i++) out.push(hold(i / (n - 3)));
  out.push({ ...REST, tail: -8 });
  out.push({ ...REST });
  return out;
}

export const ANIMS = {
  idle: {
    fps: 8,
    loop: true,
    frames: Array.from({ length: IDLE_N }, (_, i) => idleFrame(i, IDLE_N)),
  },

  // Up from lying to sitting, two wags, then back down.
  sit: {
    fps: 10,
    loop: false,
    frames: trickFrames(16, (t) => ({
      ...REST,
      sit: Math.round(ease(Math.min(1, t / 0.35)) * (t < 0.8 ? 1 : 1 - ease((t - 0.8) / 0.2)) * 100) / 100,
      tail: Math.round(Math.sin(t * Math.PI * 4) * 16),
      breathe: Math.round((0.5 - 0.5 * Math.cos(t * Math.PI * 2)) * 100) / 100,
    })),
  },

  // Sitting, the right paw comes up, shakes twice, goes down.
  shake: {
    fps: 10,
    loop: false,
    frames: trickFrames(16, (t) => {
      const up = Math.min(1, t / 0.2) * (t > 0.78 ? 1 - ease((t - 0.78) / 0.22) : 1);
      return {
        ...REST,
        sit: Math.round(ease(Math.min(1, t / 0.15)) * 100) / 100,
        paw: Math.round(Math.max(0, Math.min(1, up)) * 100) / 100,
        tail: Math.round(Math.sin(t * Math.PI * 6) * 14),
      };
    }),
  },

  // One full turn, standing, tail out.
  spin: {
    fps: 10,
    loop: false,
    frames: trickFrames(18, (t) => ({
      ...REST,
      sit: t < 0.12 ? Math.round((t / 0.12) * 30) / 100 : t > 0.9 ? Math.round(((1 - t) / 0.1) * 30) / 100 : 0.3,
      turn: Math.round(t * 100) / 100,
      tail: Math.round(Math.sin(t * Math.PI * 8) * 20),
    })),
  },
};
