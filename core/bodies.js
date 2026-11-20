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
/** @typedef {'car' | 'pet' | 'tarot' | 'dry-run' | 'none'} BodyId */
/**
 * What a body is made of, as keys rather than sentences: the admin says them
 * in the reader's language, and a part number is the one thing that does not
 * translate.
 * @typedef {'board' | 'motor' | 'battery' | 'screen' | 'wand' | 'phone'} Need
 */
/** @typedef {'board' | 'phone' | 'none'} Source */

/** The five fine-grained abilities a body can have, in the order the admin shows them. */
export const CAPABILITIES = /** @type {const} */ (['hear', 'speak', 'show', 'move', 'sense']);

/**
 * The three ways a person gets a body.
 * @type {readonly Source[]}
 */
export const SOURCES = ['board', 'phone', 'none'];

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
 *   needs: Need[],
 *   sources: Source[],
 *   firmware: string | null,
 *   capabilities: Capability[],
 *   actions: ActionKind[],
 *   preview: string,
 * }} Body
 */

// Order is the admin's: the bodies most people have, then the bench-only two.
// `actions` is exactly what the brain may call, and nothing here adds a
// capability the body did not have before this table existed.
/** @type {readonly Body[]} */
export const BODIES = [
  {
    id: 'car',
    label: 'Car',
    labelZh: '小车',
    needs: ['board', 'motor', 'battery'],
    sources: ['board', 'phone'],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak', 'show', 'move'],
    actions: ['move', 'cruise', 'stop', 'sound'],
    preview: 'car',
  },
  {
    id: 'pet',
    label: 'Pet on a screen',
    labelZh: '屏幕宠物',
    needs: ['board', 'screen'],
    sources: ['board'],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak', 'show'],
    actions: ['pose', 'sound'],
    preview: 'pet',
  },
  {
    id: 'tarot',
    label: 'Tarot reader',
    labelZh: '塔罗牌',
    needs: ['board', 'screen', 'wand'],
    sources: ['board'],
    firmware: BODY_FIRMWARE,
    capabilities: ['hear', 'speak', 'show', 'sense'],
    actions: ['draw'],
    preview: 'tarot',
  },
  {
    id: 'dry-run',
    label: 'Dry run',
    labelZh: '演练',
    needs: [],
    sources: ['none'],
    firmware: null,
    capabilities: ['hear', 'speak', 'show', 'move'],
    actions: ['move', 'cruise', 'stop', 'sound'],
    preview: 'car',
  },
  {
    id: 'none',
    label: 'No moving parts',
    labelZh: '无身体',
    needs: ['phone'],
    sources: ['phone'],
    firmware: null,
    capabilities: ['hear', 'speak'],
    actions: ['sound'],
    preview: 'voice',
  },
];

/** In the admin's order, so the first one is also the fallback. */
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
  if (!Array.isArray(row.sources) || row.sources.length === 0) return `${row.id}: no source`;
  for (const s of row.sources) {
    if (!SOURCES.includes(s)) return `${row.id}: unknown source ${s}`;
  }
  const board = row.sources.includes('board');
  if (board && !row.firmware) return `${row.id}: a board body needs firmware`;
  if (!board && row.firmware !== null) return `${row.id}: only a board body has firmware`;
  if (!row.preview) return `${row.id}: no preview`;
  return null;
}
