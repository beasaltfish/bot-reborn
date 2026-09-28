// What the robot does when it is barked at, by how many times in a row.
// Reflex spec §4.
//
// A table, not a model: the answer to "barked at twice in five seconds" should
// be the same every time and testable, and it costs no call. The rungs are
// ordinary actions, so they go through the same #dispatch as the LLM's.
//
// The durations are placeholders until they are tuned on the car (spec §9
// step 3). Tuning changes this table and nothing else. The car cannot turn in
// place, so "turning tail" is backing away while steering, then driving off.

/** Spec §4: this long without a bark and it starts over. */
export const WINDOW_MS = 20000;

/** @type {import('./brain.js').Action[][]} */
export const LADDER = [
  [{ kind: 'sound', name: 'bark' }],
  [
    { kind: 'sound', name: 'bark' },
    { kind: 'move', steps: [
      { drive: 'backward', steer: 'left', duration_ms: 600 },
      { drive: 'forward', steer: 'straight', duration_ms: 800 },
    ] },
  ],
  [
    { kind: 'sound', name: 'whimper' },
    { kind: 'move', steps: [{ drive: 'backward', steer: 'straight', duration_ms: 400 }] },
  ],
];

export class Ladder {
  #now; #count = 0; #last = -Infinity;

  /** @param {() => number} [now] */
  constructor(now = () => Date.now()) { this.#now = now; }

  /** @returns {import('./brain.js').Action[]} */
  next() {
    const t = this.#now();
    if (t - this.#last > WINDOW_MS) this.#count = 0;
    this.#last = t;
    const rung = LADDER[Math.min(this.#count, LADDER.length - 1)];
    this.#count++;
    return structuredClone(rung);
  }

  reset() { this.#count = 0; this.#last = -Infinity; }
}
