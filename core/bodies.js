// One table for what a body is: the hardware it needs, how you get it, and
// what it can do. The admin draws its cards from it, the brain reads what the
// model may call from it, and the simulator asks it what a demo can show.
//
// "Body" used to mean three things at once — who is running the firmware, what
// the thing can do, and how it moves. Only the middle one is a decision a
// person makes, so only the middle one is here. `dry-run` is the proof: it
// looks like a car and drives nothing, and the difference is in how the brain
// carries the actions out, not in what the body can do.

/** @typedef {'hear' | 'speak' | 'show' | 'move' | 'sense'} Capability */
/** @typedef {'move' | 'cruise' | 'stop' | 'sound' | 'pose' | 'draw'} ActionKind */
/** @typedef {'toy' | 'pet' | 'tarot' | 'dry-run' | 'none'} BodyId */
/**
 * What a body is made of, as keys rather than sentences: the admin says them
 * in the reader's language, and a part number is the one thing that does not
 * translate.
 * @typedef {'board' | 'mic' | 'amp' | 'toy' | 'ftdi' | 'screen' | 'wand' | 'phone'} Need
 */
/**
 * How a body is reached. `phone` and its USB board are kept in the vocabulary
 * because the phone page still runs — it is just not offered in the admin
 * until the ESP32 path is settled (2026-11-20).
 * @typedef {'board' | 'phone' | 'none'} Source */
/**
 * One way of getting this body. The bill of materials belongs to the way and
 * not to the body: a voice-only body is a board with a microphone and an amp,
 * or it is the phone in your pocket, and those are different shopping lists
 * for the same abilities.
 * @typedef {{ source: Source, needs: Need[] }} Way
 */

/** The five fine-grained abilities a body can have, in the order the admin shows them. */
export const CAPABILITIES = /** @type {const} */ (['hear', 'speak', 'show', 'move', 'sense']);

/**
 * The three ways a person gets a body.
 * @type {readonly Source[]}
 */
export const SOURCES = ['board', 'phone', 'none'];

/** Every part a way may ask for. A typo here would render as a blank chip. */
export const NEEDS = ['board', 'mic', 'amp', 'toy', 'ftdi', 'screen', 'wand', 'phone'];

/**
 * What an action needs before it means anything. An action is offered to the
 * model only by a body that can carry it out, so a body that claims `pose`
 * without `show` would be promising a face it does not have.
 * @type {Record<ActionKind, Capability>}
 */
export const ACTION_NEEDS = {
  move: 'move',
  cruise: 'move',
  stop: 'move',
  pose: 'show',
  draw: 'sense',
  sound: 'speak',
};

/**
 * The artifact a board is flashed with, from firmware/release/. One firmware
 * for every board body: what differs between a car, a pet and a tarot reader
 * is what the brain sends it, not what the board runs.
 */
export const BODY_FIRMWARE = 'body.bin';

/**
 * @typedef {{
 *   id: BodyId,
 *   label: string,
 *   labelZh: string,
 *   ways: Way[],
 *   firmware: string | null,
 *   capabilities: Capability[],
 *   actions: ActionKind[],
 *   preview: string,
 * }} Body
 */

// Order is the admin's, simplest first: the phone you already own, the two
// that need a board and a screen, and last the one that also needs a toy car to
// take apart. The bench-only dry run sits beside them but is hidden unless asked.
// `actions` is exactly what the brain may call, and nothing here adds a
// capability the body did not have before this table existed.
/** @type {readonly Body[]} */
export const BODIES = [
  {
    id: 'none',
    label: 'Voice only',
    labelZh: '只有声音',
    // Not "the phone body": a board with a microphone and an amp is the same
    // thing, and it drives nothing. What it shows is not promised either — a
    // phone has a face, a bare board has no screen.
    ways: [{ source: 'board', needs: ['board', 'mic', 'amp'] }],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak'],
    actions: ['sound'],
    preview: 'voice',
  },
  {
    id: 'pet',
    label: 'Pet on a screen',
    labelZh: '屏幕宠物',
    ways: [{ source: 'board', needs: ['board', 'mic', 'amp', 'screen'] }],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak', 'show'],
    actions: ['pose', 'sound'],
    preview: 'pet',
  },
  {
    id: 'tarot',
    label: 'Tarot reader',
    labelZh: '塔罗牌',
    ways: [{ source: 'board', needs: ['board', 'mic', 'amp', 'screen', 'wand'] }],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak', 'show', 'sense'],
    actions: ['draw'],
    preview: 'tarot',
  },
  {
    id: 'dry-run',
    label: 'Dry run',
    labelZh: '演练',
    ways: [{ source: 'none', needs: [] }],
    firmware: null,
    capabilities: ['hear', 'speak', 'show', 'move'],
    actions: ['move', 'cruise', 'stop', 'sound'],
    preview: 'toy',
  },
  {
    id: 'toy',
    // Not "Car": what you own is a cheap toy whose motors you tapped.
    label: 'Toy on wheels',
    labelZh: '会动的玩具',
    // A board brings the ears and the voice; the toy brings the motors and the
    // chassis. A phone brings its own mic and speaker, and needs the USB board
    // to tap the toy's four motor inputs.
    ways: [{ source: 'board', needs: ['toy', 'board', 'mic', 'amp'] }],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak', 'show', 'move'],
    actions: ['move', 'cruise', 'stop', 'sound'],
    preview: 'toy',
  },

];

/** In the admin's order. The fallback for an unknown id is `toy` and is stated
 * where it is used (core/config.js), not inferred from this order. */
export const BODY_IDS = /** @type {BodyId[]} */ (BODIES.map((b) => b.id));

/**
 * Body id → the action kinds the brain may carry out. Derived, because the
 * brain used to keep its own copy of this, and a second copy is how a card
 * comes to promise something the brain then refuses to do.
 * @type {Record<BodyId, readonly string[]>}
 */
export const CAN_DO = /** @type {any} */ (Object.fromEntries(BODIES.map((b) => [b.id, b.actions])));

/** @param {string} id @returns {Body | undefined} */
export function bodyById(id) {
  return BODIES.find((b) => b.id === id);
}

/**
 * The name in the reader's language. The table carries both because a body is
 * the one row in it a person reads before anything else on the page.
 * @param {Body} body @param {'en' | 'zh'} lang
 * @returns {string}
 */
export function labelOf(body, lang) {
  return lang === 'zh' ? body.labelZh : body.label;
}

/**
 * What is wrong with a row, or null. Run by the tests and by anyone adding a
 * body: the failure to avoid is a card that promises a face the firmware
 * never shows, and a string in a table is exactly where that slips through.
 *
 * Takes any row, not a `Body`: it is handed the one somebody just wrote,
 * before its shape can be trusted.
 * @param {any} body
 * @returns {string | null}
 */
export function bodyProblem(body) {
  /** @type {Body} */ const row = body;
  for (const a of row.actions) {
    if (!(a in ACTION_NEEDS)) return `${row.id}: unknown action ${a}`;
    if (!row.capabilities.includes(ACTION_NEEDS[a])) return `${row.id}: ${a} needs ${ACTION_NEEDS[a]}`;
  }
  if (!Array.isArray(row.ways) || row.ways.length === 0) return `${row.id}: no way to get it`;
  for (const w of row.ways) {
    if (!SOURCES.includes(w.source)) return `${row.id}: unknown source ${w.source}`;
    for (const n of w.needs) if (!NEEDS.includes(n)) return `${row.id}: unknown part ${n}`;
  }
  const board = row.ways.some((w) => w.source === 'board');
  if (board && !row.firmware) return `${row.id}: a board body needs firmware`;
  if (!board && row.firmware !== null) return `${row.id}: only a board body has firmware`;
  if (!row.preview) return `${row.id}: no preview`;
  return null;
}
