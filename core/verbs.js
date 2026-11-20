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
 * The part of JSON Schema a verb's arguments may use. Deliberately small: the
 * checker in Task 2's `core/actions.js` stays a handful of explicit cases
 * rather than a schema engine.
 * @typedef {{
 *   type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean',
 *   properties?: Record<string, JsonSchemaSubset>,
 *   required?: string[],
 *   enum?: readonly (string | number)[],
 *   const?: string | number,
 *   anyOf?: JsonSchemaSubset[],
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
 * One bounded primitive. Flags here are properties of the verb itself; "must
 * be the last step of a program" is not one of them — that belongs to a
 * program, because the same `drive` is both `move` (in the middle) and
 * `cruise` (last, holding).
 * @typedef {{
 *   needs: import('./bodies.js').Capability,
 *   args: JsonSchemaSubset,
 *   bounded: string,
 *   cancelsRest?: true, // the turn becomes only this verb — earlier steps go too
 *   first?: true,       // runs before speech, so the face agrees with the words
 *   returns?: true,     // its result goes back to the model, which is asked again
 * }} Verb
 */

/** The same two lists `core/brain.js` validates against. The model's word for
 * a direction, not the wire frame. */
const DRIVE_VALUES = ['forward', 'backward'];
const STEER_VALUES = ['left', 'right', 'straight'];

/**
 * How long to drive. Two shapes, because the model has two intents: a number
 * of milliseconds, with no upper bound (a long drive is sliced into wire
 * frames by the carrier), or the word `hold`, which the brain keeps renewing
 * until something stops it. The 1 s the firmware enforces is a frame size, not
 * a limit on the request.
 */
/** @type {JsonSchemaSubset} */
const MS = {
  anyOf: [
    { type: 'integer', minimum: 1 },
    { const: 'hold' },
  ],
};

/** @type {Record<VerbName, Verb>} */
export const VERBS = {
  drive: {
    needs: 'move',
    args: {
      type: 'object',
      required: ['drive', 'steer', 'ms'],
      properties: {
        drive: { enum: DRIVE_VALUES },
        steer: { enum: STEER_VALUES },
        ms: MS,
      },
    },
    bounded: 'the firmware stops a motor it has not heard about for 1 s: a hold is renewed by the brain LEAD_MS ahead, and any duration longer than 1 s is sliced into 1 s wire frames by the carrier',
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
};

/**
 * The five names, in the order above. Closed: an action may not invent one.
 * Typed as the union, not plain strings, so reading `VERBS[name]` in a loop
 * over it does not need a cast.
 * @type {readonly VerbName[]}
 */
export const VERB_NAMES = /** @type {VerbName[]} */ (Object.keys(VERBS));

/**
 * What a body needs in order to run this verb, or `null` for a name that is not
 * a verb at all. This answers "what does it require", not "does the body have
 * it" — the body's own capability list answers that.
 * @param {string} name
 * @returns {import('./bodies.js').Capability[] | null}
 */
export function verbNeeds(name) {
  const verb = VERBS[/** @type {VerbName} */ (name)];
  return verb ? [verb.needs] : null;
}
