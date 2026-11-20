// The verbs: the five bounded things a body or the brain can actually be told
// to do. They sit under actions the way machine instructions sit under a
// program — an action is a name the model may call plus a short list of these,
// and the list can only ever be made of things the hardware already knows.
//
// This is the closed layer. Capabilities say what a body has (ears, wheels, a
// screen); verbs say what may be asked of it. A person adds actions, never
// verbs: a verb that no firmware or brain implements would be a promise made
// without anything behind it.
//
// Every verb carries `bounded` — the sentence that says what keeps it from
// running forever. It is here, next to the arguments, because a bound that
// lives only in a comment drifts away from the code that enforces it.

/**
 * Mirrors `core/bodies.js`'s Capability: what a body must have for this verb to
 * mean anything. Kept local until bodies.js grows the verbs in Task 3.
 * @typedef {'hear' | 'speak' | 'show' | 'move' | 'sense'} Capability
 */

/**
 * The part of JSON Schema an action's parameters and a verb's arguments may
 * use. Deliberately small: the validator stays a handful of explicit checks
 * rather than a schema engine.
 * @typedef {{
 *   type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean',
 *   properties?: Record<string, JsonSchemaSubset>,
 *   required?: string[],
 *   enum?: readonly (string | number)[],
 *   items?: JsonSchemaSubset,
 *   maxItems?: number,
 *   minimum?: number,
 *   maximum?: number,
 * }} JsonSchemaSubset
 */

/**
 * @typedef {'drive' | 'halt' | 'voice' | 'pose' | 'draw'} VerbName
 */

/**
 * One bounded primitive. Flags, not branches: the brain reads `cancelsRest`,
 * `first` and `last` off the record instead of keeping a list of names in
 * `#dispatch`.
 * @typedef {{
 *   needs: Capability,
 *   args: JsonSchemaSubset,
 *   bounded: string,
 *   hold?: true,        // a driver that keeps renewing it — the old `cruise`
 *   cancelsRest?: true, // everything queued after it is void
 *   first?: true,       // runs before speech, so the face agrees with the words
 *   last?: true,        // nothing may follow it in a program
 *   returns?: true,     // its result goes back to the model, which is asked again
 * }} Verb
 */

/** The same two lists `core/brain.js` validates against. The model's word for
 * a direction, not the wire frame. */
const DRIVE_VALUES = ['forward', 'backward'];
const STEER_VALUES = ['left', 'right', 'straight'];

/**
 * The wire frame a body is sent. `ms` is capped at 1 s because the firmware
 * stops a motor that has not been re-ordered within a second; anything longer
 * is the carrier's job to slice, not the model's to ask for.
 */
const MS_MIN = 1;
const MS_MAX = 1000;

/** @type {Record<VerbName, Verb>} */
export const VERBS = Object.freeze({
  drive: {
    needs: 'move',
    args: {
      type: 'object',
      required: ['drive', 'steer', 'ms'],
      properties: {
        drive: { enum: DRIVE_VALUES },
        steer: { enum: STEER_VALUES },
        ms: { type: 'integer', minimum: MS_MIN, maximum: MS_MAX },
      },
    },
    hold: true,
    last: true,
    bounded: 'the firmware stops a motor it has not heard about for 1 s; hold is renewed by the brain LEAD_MS ahead, and a duration longer than 1 s is sliced into wire frames by the carrier',
  },
  halt: {
    needs: 'move',
    args: { type: 'object', properties: {} },
    cancelsRest: true,
    bounded: 'it bumps the sync generation, so every renewal loop started before it is void at once',
  },
  voice: {
    needs: 'speak',
    args: {
      type: 'object',
      required: ['clip'],
      properties: { clip: { type: 'string' } },
    },
    bounded: 'only clips in the sound table can be played',
  },
  pose: {
    needs: 'show',
    args: {
      type: 'object',
      required: ['pose'],
      properties: { pose: { type: 'string' } },
    },
    first: true,
    bounded: 'the animator has no frames for a pose it does not know, so it does not move',
  },
  draw: {
    needs: 'show',
    args: { type: 'object', properties: {} },
    returns: true,
    bounded: 'the card turns over after 20 s without a reading (READING_TIMEOUT_MS)',
  },
});

/**
 * The five names, in the order above. Closed: an action may not invent one.
 * Typed as the union, not plain strings, so reading `VERBS[name]` in a loop
 * over it does not need a cast.
 * @type {readonly VerbName[]}
 */
export const VERB_NAMES = Object.freeze(/** @type {VerbName[]} */ (Object.keys(VERBS)));

/**
 * What a body needs to run this verb; empty for a name that is not a verb, so
 * an action using one is simply refused rather than half-run.
 * @param {string} name
 * @returns {Capability[]}
 */
export function verbNeeds(name) {
  const verb = VERBS[/** @type {VerbName} */ (name)];
  return verb ? [verb.needs] : [];
}
