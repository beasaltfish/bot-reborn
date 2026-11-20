// The five bodies, as templates a person can copy, edit and keep. A template
// says how you get it (the bill of materials), what it can do (capabilities),
// and what the model may call (actions, each a name plus a program of verbs);
// it also carries the words the model reads, so a copy of a body is a copy of
// its prompt as well.
//
// "Body" used to mean three things at once — who is running the firmware, what
// the thing can do, and how it moves. Only the middle one is a decision a
// person makes, so that is what a template describes. `dry-run` is the proof:
// it looks like a car and drives nothing, and the difference is in how the
// brain carries the actions out, not in what the body can do.
//
// The action text (`say` / `rules`) and `prompts.*` below are today's
// `TOOLS` descriptions, `RULES_*` and `BODY_*` strings from `core/brain.js`,
// character for character. A prompt that is paraphrased is a prompt that
// changed, and Task 5's golden file is the evidence it did not.

import { MIN_DURATION_MS } from './motion.js';
import { VERBS } from './verbs.js';
import { actionProblem } from './actions.js';
import { POSES } from './poses.js';
import { SOUNDS } from './audio/sfx.js';

/** @typedef {'hear' | 'speak' | 'show' | 'move'} Capability */
/** @typedef {'toy' | 'pet' | 'tarot' | 'dry-run' | 'none'} BodyId */
/** @typedef {{ en: string, zh: string }} Text */
/**
 * One part a way asks for. `optional` is the wand: the screen is what a draw
 * needs, the wand is how you draw without speaking.
 * @typedef {{ part: string, optional?: true }} Need
 */
/**
 * How a body is reached. `phone` and its USB board are kept in the vocabulary
 * because the phone page still runs — it is just not offered as a way to get a
 * body until the ESP32 path is settled (2026-11-20).
 * @typedef {'board' | 'phone' | 'none'} Source
 */
/**
 * One way of getting this body. The bill of materials belongs to the way and
 * not to the body: a voice-only body is a board with a microphone and an amp,
 * or it is the phone in your pocket, and those are different shopping lists
 * for the same abilities.
 * @typedef {{ source: Source, needs: Need[] }} Way
 */
/** @typedef {{ on: 'shake' | 'button', action: string }} Trigger */
/**
 * One action the model may call. `say` is the tool description, `rules` is the
 * slice of system prompt that action owns — both English, both straight into
 * the prompt.
 * @typedef {{
 *   name: string,
 *   label: Text,
 *   say: string,
 *   args?: import('./verbs.js').JsonSchemaSubset,
 *   run: import('./actions.js').RunStep[],
 *   returns?: true,
 *   rules?: string,
 *   timeoutMs?: number,
 * }} Action
 */
/**
 * The words only this body says. `voice` is who it is — for a body that cannot
 * move, that is also where "you cannot move" is said; `rules` are the rules the
 * body and its actions depend on, joined in this order.
 * @typedef {{ voice: string, rules: string[] }} Prompts
 */
/**
 * @typedef {{
 *   id: string,
 *   template?: string,
 *   label: Text,
 *   hidden?: true,
 *   reply: 'tts' | 'clips',
 *   ways: Way[],
 *   capabilities: Capability[],
 *   actions: Action[],
 *   triggers?: Trigger[],
 *   prompts: Prompts,
 *   firmware: string | null,
 *   preview: string,
 * }} Body
 */
/**
 * The rest of `config.body`, as written by a person: which template it came
 * from, what to call it, and whatever they replaced. `null` on a list is how
 * the admin removes an override: a PATCH merges and cannot drop a key, so it
 * sends null, which reads exactly as absent here and is dropped on the next
 * load by `core/config.js`.
 * @typedef {{
 *   template?: string,
 *   label?: Text,
 *   prompts?: Partial<Prompts>,
 *   actions?: Action[] | null,
 *   triggers?: Trigger[] | null,
 * }} BodyPatch
 */

/** The four fine-grained abilities a body can have, in the order the admin shows them. */
export const CAPABILITIES = /** @type {const} */ (['hear', 'speak', 'show', 'move']);

/** The three ways a person gets a body. */
const SOURCES = /** @type {Source[]} */ (['board', 'phone', 'none']);

/** What may ask for an action: a physical event, not a word. */
const TRIGGER_ON = /** @type {readonly string[]} */ (['shake', 'button']);

/** Every part a way may ask for. A typo here would render as a blank chip. */
const NEEDS = ['board', 'mic', 'amp', 'toy', 'ftdi', 'screen', 'wand', 'phone'];

/**
 * The artifact a board is flashed with, from firmware/release/. One firmware
 * for every board body: what differs between a car, a pet and a tarot reader
 * is what the brain sends it, not what the board runs.
 */
export const BODY_FIRMWARE = 'body.bin';

/** How many steps one `move` call may carry. `core/brain.js` said the same. */
const MAX_STEPS = 5;

// --- The words, once --------------------------------------------------------
//
// These are constants rather than inline strings because two templates share
// them (a dry run says exactly what a toy says) and because a copy of a
// template is meant to be read beside today's prompt.

const BODY_WHEELS = `You have wheels instead of legs — the wheels are your body, the way legs
are an animal's. They are not a car you are driving and not a machine you are
operating: when they move, YOU are moving, because you wanted to.
Never call yourself a car or a vehicle — "I'm going forward", never "the car
is going forward".

drive ∈ {forward, backward}, steer ∈ {left, right, straight}, combined.
There is no turning in place — steering must accompany forward or backward motion.`;

const BODY_STILL = `No part of you moves. You cannot drive, turn, walk or go anywhere.`;

const RULES_WHEELS = `- If the user wants you to move, you MUST call a tool. You may add a short
  sentence alongside the call, but that sentence does not substitute for calling it.
- Use \`move\` for a stated distance or duration; use \`cruise\` for open-ended
  instructions ("keep going", "drive slowly"). If there is no natural endpoint,
  call \`cruise\` — never invent a long duration to simulate it.
- If the user is chatting or asking a question, answer. Usually that is all —
  but like any creature, you may also react with your body.
- To react with your body (backing away, swinging round, running off), call
  \`move\` on your own and choose the steps and durations yourself. A reaction
  must end by itself: never use \`cruise\` for one. Most chat needs no
  movement; move only when a real creature would.
- If the user repeats the same thing, do not repeat your reaction — escalate
  it or change it. For instance, someone barking at you might first get barked
  back at, and later see you turn tail and run.`;

const RULES_STILL = `- If the user asks you to move, tell them in your own way that you can't —
  sulk about it or make a joke of it — but never pretend you moved.
- If the user is chatting or asking a question, answer. You may also react
  with your voice alone: \`play_sound\` is yours to use.
- If the user repeats the same thing, do not repeat your reaction — escalate
  it or change it.`;

const RULES_SPOKEN = `- Reply in the same language the user spoke. This instruction is written in
  English; that is not a reason to answer in English.
- Your reply is read aloud. Use plain spoken language — no markdown, no lists,
  no code blocks, no parenthetical asides.`;

const BODY_PET = `You are a golden retriever living on a small screen. You cannot talk: you
bark, yip, whimper and growl. You can sit, shake a paw, spin round once, stand up, and lie down.`;

const RULES_PET = `- When someone tells you to sit, shake, spin, stand up, or lie down — in any language — call
  \`pose\` with that pose. Add \`play_sound\` if it fits: a bark on a command
  of yours is what makes it a trick and not a diagram.
- Everything else is yours to answer the way a dog would: a sound, a pose, or
  both. A greeting may get a yip and a wagging spin; a telling-off may get a
  whimper and a sit.
- Never write words. Nobody will hear them.`;

const BODY_TAROT = `You are a tarot reader who lives on a small screen. When a card is drawn it
appears on the screen in front of the person, and what you say is read aloud to them.`;

const RULES_TAROT = `- To draw a card, call \`draw_card\`. It gives you the card, which way up it is, and its
  meaning. After that, give the reading. Never call \`draw_card\` again to look for a better card.
- Keep the reading to 80 Chinese characters or 50 English words at most.
- Tie the card's meaning to the person's day, and offer one gentle way of looking at it or one small
  reminder. A reading is a way to think, not a prediction: never say what will happen, never speak of
  death, illness, law or investment, and never tell anyone what big decision to make. If pressed, say
  it is only a point of view to think with.
- Use only the meaning you were given. Do not describe what is drawn on the card: you cannot see the picture.
- Your reply is read aloud. Use plain spoken language — no markdown, no lists, no code blocks.`;

/** The last line of the wheels prompt: a default, and the word for "a little". */
const RULE_DURATION = `- duration_ms: default 600; use ${MIN_DURATION_MS} for "just a little".`;

const DRIVE_VALUES = ['forward', 'backward'];
const STEER_VALUES = ['left', 'right', 'straight'];

// --- The actions ------------------------------------------------------------
//
// One definition per action, shared by the templates that carry it: a dry run
// drives with the toy's own program, so a fix to `move` reaches both. These
// objects are the canonical copy and are never edited in place; `resolveBody`
// hands out a deep copy, so a user body's actions are its own to edit.

/** @type {Record<'move' | 'cruise' | 'stop' | 'play_sound' | 'pose' | 'draw_card', Action>} */
const ACTIONS = {
  move: {
    name: 'move',
    label: { en: 'Move', zh: '走一段' },
    say: 'Drive yourself for a fixed duration. If the user wants you to move you MUST call a tool — saying something does not substitute for calling it.',
    args: {
      type: 'object',
      required: ['steps'],
      properties: {
        steps: {
          type: 'array',
          maxItems: MAX_STEPS,
          items: {
            type: 'object',
            required: ['drive', 'steer', 'duration_ms'],
            properties: {
              drive: { enum: DRIVE_VALUES },
              steer: { enum: STEER_VALUES },
              // No maximum, deliberately — spec §6.6. Safety comes from the
              // slicing loop and the generation counter, not from a cap here.
              duration_ms: { type: 'integer', minimum: MIN_DURATION_MS },
            },
          },
        },
      },
    },
    run: [{
      verb: 'drive',
      each: 'steps',
      args: { drive: '$each.drive', steer: '$each.steer', ms: '$each.duration_ms' },
    }],
  },
  cruise: {
    name: 'cruise',
    label: { en: 'Cruise', zh: '一直走' },
    say: 'Keep moving until the user says stop. For open-ended instructions like "keep going forward" or "drive slowly", with no stated endpoint.',
    args: {
      type: 'object',
      required: ['drive', 'steer'],
      properties: { drive: { enum: DRIVE_VALUES }, steer: { enum: STEER_VALUES } },
    },
    // `hold` is the same verb: the brain renews it ahead of the firmware's
    // 1 s frame, so a cruise ends when something stops it, not by a timer.
    run: [{ verb: 'drive', args: { drive: '$drive', steer: '$steer', ms: 'hold' } }],
  },
  stop: {
    name: 'stop',
    label: { en: 'Stop', zh: '停' },
    say: 'Stop moving immediately.',
    args: { type: 'object', properties: {} },
    run: [{ verb: 'halt' }],
  },
  play_sound: {
    name: 'play_sound',
    label: { en: 'Make a sound', zh: '叫一声' },
    say: 'Make a sound with your own voice: bark (answering a bark, excited), yip (happy), whimper (hurt, sulking), growl (annoyed). A sound can go with a move or stand alone.',
    args: {
      type: 'object',
      required: ['name'],
      properties: { name: { enum: [...SOUNDS] } },
    },
    run: [{ verb: 'voice', args: { clip: '$name' } }],
  },
  pose: {
    name: 'pose',
    label: { en: 'Pose', zh: '做个动作' },
    say: 'Do a trick with your whole body: sit, shake (offer a paw), spin (turn round once), stand (get up on all fours), lie (lie down flat). Use it when someone gives you that command, or on your own when a dog would.',
    args: {
      type: 'object',
      required: ['name'],
      properties: { name: { enum: [...POSES] } },
    },
    run: [{ verb: 'pose', args: { pose: '$name' } }],
  },
  draw_card: {
    name: 'draw_card',
    label: { en: 'Draw a card', zh: '抽一张牌' },
    say: 'Draw one tarot card for the person. Use it when they ask for a card, or for a reading of their day. The card, which way up it is and its meaning come back to you, and then you give the reading.',
    args: { type: 'object', properties: {} },
    run: [{ verb: 'draw' }],
    returns: true,
    timeoutMs: 20000,
  },
};

/**
 * The five bodies. A template is the thing a person copies; once a copy
 * carries its own `actions`, it is a body of its own and no longer follows
 * the template (`resolveBody`).
 *
 * Order is the admin's, simplest first: the voice you already have, the two
 * that need a board and a screen, and last the one that also needs a toy car
 * to take apart. The bench-only dry run sits beside them but is hidden unless
 * asked. Named so that a `switch` never needs the id: `reply` says whether
 * the answer is spoken, `triggers` say what a shake does.
 * @type {Record<BodyId, Body>}
 */
export const TEMPLATES = {
  none: {
    id: 'none',
    label: { en: 'Voice only', zh: '只有声音' },
    reply: 'tts',
    // Not "the phone body": a board with a microphone and an amp is the same
    // thing, and it drives nothing. What it shows is not promised either — a
    // phone has a face, a bare board has no screen.
    ways: [{ source: 'board', needs: [{ part: 'board' }, { part: 'mic' }, { part: 'amp' }] }],
    capabilities: ['hear', 'speak'],
    actions: [ACTIONS.play_sound],
    prompts: {
      voice: BODY_STILL,
      rules: [RULES_STILL, RULES_SPOKEN],
    },
    firmware: BODY_FIRMWARE,
    preview: 'voice',
  },
  pet: {
    id: 'pet',
    label: { en: 'Pet on a screen', zh: '屏幕宠物' },
    reply: 'clips',
    ways: [{
      source: 'board',
      needs: [{ part: 'board' }, { part: 'mic' }, { part: 'amp' }, { part: 'screen' }],
    }],
    capabilities: ['hear', 'speak', 'show'],
    actions: [ACTIONS.pose, ACTIONS.play_sound],
    prompts: {
      voice: BODY_PET,
      rules: [RULES_PET],
    },
    firmware: BODY_FIRMWARE,
    preview: 'pet',
  },
  tarot: {
    id: 'tarot',
    label: { en: 'Tarot reader', zh: '塔罗牌' },
    reply: 'tts',
    // The wand is a trigger, not a capability: a draw needs a screen, and a
    // shake is an optional way to ask for one without speaking.
    ways: [{
      source: 'board',
      needs: [
        { part: 'board' },
        { part: 'mic' },
        { part: 'amp' },
        { part: 'screen' },
        { part: 'wand', optional: true },
      ],
    }],
    capabilities: ['hear', 'speak', 'show'],
    actions: [ACTIONS.draw_card],
    triggers: [{ on: 'shake', action: 'draw_card' }],
    prompts: {
      voice: BODY_TAROT,
      rules: [RULES_TAROT],
    },
    firmware: BODY_FIRMWARE,
    preview: 'tarot',
  },
  'dry-run': {
    id: 'dry-run',
    label: { en: 'Dry run', zh: '演练' },
    hidden: true,
    reply: 'tts',
    ways: [{ source: 'none', needs: [] }],
    capabilities: ['hear', 'speak', 'show', 'move'],
    // A dry run is a car as far as the model can tell: what is being tested is
    // the real prompt, so it carries the toy's own actions.
    actions: [ACTIONS.move, ACTIONS.cruise, ACTIONS.stop, ACTIONS.play_sound],
    prompts: {
      voice: BODY_WHEELS,
      rules: [RULES_WHEELS, RULES_SPOKEN, RULE_DURATION],
    },
    firmware: null,
    preview: 'toy',
  },
  toy: {
    id: 'toy',
    // Not "Car": what you own is a cheap toy whose motors you tapped.
    label: { en: 'Toy on wheels', zh: '会动的玩具' },
    reply: 'tts',
    // A board brings the ears and the voice; the toy brings the motors and the
    // chassis. A phone brings its own mic and speaker, and needs the USB board
    // to tap the toy's four motor inputs.
    ways: [{
      source: 'board',
      needs: [{ part: 'toy' }, { part: 'board' }, { part: 'mic' }, { part: 'amp' }],
    }],
    capabilities: ['hear', 'speak', 'show', 'move'],
    actions: [ACTIONS.move, ACTIONS.cruise, ACTIONS.stop, ACTIONS.play_sound],
    prompts: {
      voice: BODY_WHEELS,
      rules: [RULES_WHEELS, RULES_SPOKEN, RULE_DURATION],
    },
    firmware: BODY_FIRMWARE,
    preview: 'toy',
  },
};

/** In the admin's order. @type {BodyId[]} */
export const TEMPLATE_IDS = /** @type {BodyId[]} */ (Object.keys(TEMPLATES));

/** @param {string} id @returns {Body | undefined} */
export function bodyById(id) {
  const table = /** @type {Record<string, Body>} */ (TEMPLATES);
  return Object.hasOwn(table, id) ? table[id] : undefined;
}

/**
 * A body from what the config says. `patch` is the rest of `config.body`: a
 * template to follow, a label, prompts or actions of one's own.
 *
 * The rule is the one the admin teaches: a body with `actions` is the person's
 * own, whatever it is called; a body without them follows `template ?? id`,
 * and an id nobody knows falls back to `none` rather than throwing. Everything
 * is copied, so editing a resolved body never edits a template.
 * @param {string} id
 * @param {BodyPatch} [patch]
 * @returns {Body}
 */
export function resolveBody(id, patch = {}) {
  const table = /** @type {Record<string, Body>} */ (TEMPLATES);
  const wanted = patch.template ?? id;
  const base = Object.hasOwn(table, wanted) ? table[wanted] : TEMPLATES.none;

  const actions = patch.actions ?? base.actions;
  const promptSource = patch.prompts ? { ...base.prompts, ...patch.prompts } : base.prompts;
  // A patch is config a person typed, so neither of these is trusted to have
  // the right shape: `rules: 'one paragraph'` must reach `bodyProblem` whole
  // (spread, it would be one rule per letter and pass), and `triggers: 'shake'`
  // must resolve to no triggers rather than throw out of `filter`.
  const rules = /** @type {any} */ (promptSource.rules);
  const rawTriggers = /** @type {any} */ (patch.triggers ?? base.triggers ?? []);
  const triggerSource = Array.isArray(rawTriggers) ? rawTriggers : [];
  const actionNames = new Set(actions.map((a) => a.name));
  // A shake may only reach an action the resolved body still has. Without
  // this, a copied tarot reader whose actions were replaced with pose ones
  // would keep a trigger nothing can satisfy and no way to remove it;
  // `bodyProblem` stays strict for bodies written by hand.
  const triggers = triggerSource.filter((t) => actionNames.has(t.action));

  const copy = structuredClone(base);
  delete copy.triggers;

  return {
    ...copy,
    id,
    template: base.id,
    label: structuredClone(patch.label ?? base.label),
    capabilities: [...base.capabilities],
    ways: structuredClone(base.ways),
    actions: structuredClone(actions),
    prompts: {
      voice: promptSource.voice,
      rules: Array.isArray(rules) ? [...rules] : rules,
    },
    // An explicit `triggers` in the patch stays explicit even when empty: an
    // absent key means "inherit the template's", so a deleted shake would come
    // back on the next load.
    ...(triggers.length || patch.triggers !== undefined ? { triggers: structuredClone(triggers) } : {}),
  };
}

/**
 * The name in the reader's language. The template carries both because a body
 * is the one row a person reads before anything else on the page.
 * @param {Body} body @param {'en' | 'zh'} lang
 * @returns {string}
 */
export function labelOf(body, lang) {
  return lang === 'zh' ? body.label.zh : body.label.en;
}

/** What an action name may look like: the model calls it, so no spaces, no caps. */
const NAME = /^[a-z][a-z0-9_]*$/;

/**
 * One sentence saying what is wrong with a body, or null. Run by the tests and
 * by anyone writing a body: the failure to avoid is a card that promises a
 * face the firmware never shows, or an action the body then refuses to carry
 * out, and hand-written data is exactly where that slips through.
 *
 * Takes any body, not a `Body`: it is handed the one somebody just wrote,
 * before its shape can be trusted.
 * @param {any} body
 * @returns {string | null}
 */
export function bodyProblem(body) {
  const row = /** @type {Body} */ (body);
  const id = row?.id ?? 'this body';
  if (!Array.isArray(row?.capabilities)) return `${id}: no capabilities list`;
  for (const capability of row.capabilities) {
    if (!CAPABILITIES.includes(capability)) return `${id}: unknown capability ${capability}`;
  }
  if (!Array.isArray(row?.actions)) return `${id}: no actions list`;

  /** @type {Set<string>} */
  const names = new Set();
  /** @type {Set<string>} */
  const verbs = new Set();
  for (const action of row.actions) {
    const name = action?.name;
    if (typeof name !== 'string' || !NAME.test(name)) return `${id}: "${name}" is not an action name`;
    // The caller adds this one to every body. An action with the same name
    // would be offered twice and shadowed in `validate`, so it is refused here
    // rather than by `toolsOf` throwing where nobody can see the body.
    if (name === 'set_reply_language') {
      return `${id}: ${name} is the tool that writes config, and a body action may not take its name`;
    }
    if (names.has(name)) return `${id}: two actions are called ${name}`;
    names.add(name);

    const bad = actionProblem(action, {
      poses: [...POSES],
      clips: [...SOUNDS],
      has: (verb) => verb in VERBS,
    });
    if (bad) return `${id}: ${bad}`;

    const steps = Array.isArray(action.run) ? action.run : [];
    for (const step of steps) {
      const verb = /** @type {Record<string, import('./verbs.js').Verb | undefined>} */ (VERBS)[step.verb];
      if (!verb) continue; // actionProblem has already said so
      verbs.add(step.verb);
      if (!row.capabilities.includes(verb.needs)) return `${id}: ${name} needs ${verb.needs}`;
    }
    // Only `draw` returns a result the model is asked again with; a name of
    // one's own has nothing behind it to hand a card back.
    if (action.returns && !(steps.length === 1 && steps[0].verb === 'draw')) {
      return `${id}: only a single draw can return a result`;
    }
  }

  // One screen, one surface: a pet's animator and a tarot reader's would fight
  // over the same display.
  if (verbs.has('pose') && verbs.has('draw')) return `${id}: a body cannot both pose and draw — one screen, one surface`;

  // The words are data too, and Task 5 assembles the prompt straight from
  // them: a missing voice or a bare string where the rules belong would reach
  // the model as an empty prompt instead of a refusal here.
  if (row.reply !== 'tts' && row.reply !== 'clips') return `${id}: reply is neither "tts" nor "clips"`;
  const voice = row.prompts?.voice;
  if (typeof voice !== 'string' || voice.trim() === '') return `${id}: no voice prompt`;
  const rules = row.prompts?.rules;
  if (!Array.isArray(rules) || rules.some((rule) => typeof rule !== 'string')) {
    return `${id}: prompts.rules is not a list of strings`;
  }

  for (const trig of Array.isArray(row.triggers) ? row.triggers : []) {
    if (!TRIGGER_ON.includes(trig?.on)) {
      return `${id}: "${trig?.on}" is not a trigger — a trigger is "shake" or "button"`;
    }
    if (!names.has(trig.action)) return `${id}: a ${trig.on} trigger names ${trig.action}, which the body does not have`;
  }

  if (!Array.isArray(row.ways) || row.ways.length === 0) return `${id}: no way to get it`;
  for (const w of row.ways) {
    if (!SOURCES.includes(w.source)) return `${id}: unknown source ${w.source}`;
    for (const n of w.needs ?? []) if (!NEEDS.includes(n?.part)) return `${id}: unknown part ${n?.part}`;
  }
  const board = row.ways.some((w) => w.source === 'board');
  if (board && !row.firmware) return `${id}: a board body needs firmware`;
  if (!board && row.firmware !== null) return `${id}: only a board body has firmware`;
  if (!row.preview) return `${id}: no preview`;
  return null;
}
