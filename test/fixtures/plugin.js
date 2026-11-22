// The smallest honest plugin: one command that drives a servo, and the body the
// loader builds around it. Shared by the loader and body tests so both are
// talking about the same manifest.

import { BODY_FIRMWARE, TEMPLATES } from '../../core/bodies.js';

/** @type {import('../../core/io-program.js').Command} */
export const pointCommand = {
  name: 'point',
  args: {
    type: 'object',
    required: ['angle'],
    properties: { angle: { type: 'integer', minimum: 0, maximum: 180 } },
  },
  timeoutMs: 500,
  run: [{ op: 'pwm', args: { pin: 'sig', value: '$angle', map: { from: [0, 180], to: [500, 2400] } } }],
};

/** The declaration `pointCommand` names: one output pin, nothing else. */
export const pointResources = [
  { kind: 'gpio', name: 'sig', gpio: 5, direction: 'output', safe: 0 },
];

/**
 * The other half of the vocabulary: a command that reads a button and returns
 * the level. Its `timeoutMs` is short on purpose — a read the body never
 * answers must not hold a turn for the carrier's fallback.
 * @type {import('../../core/io-program.js').Command}
 */
export const isPressedCommand = {
  name: 'is_pressed',
  args: { type: 'object', properties: {} },
  timeoutMs: 50,
  returns: true,
  run: [{ op: 'pin.read', args: { pin: 'button' } }],
};

/** The button `isPressedCommand` reads. */
export const readResources = [
  ...pointResources,
  { kind: 'gpio', name: 'button', gpio: 4, direction: 'input' },
];

/**
 * The action that hands a read back to the model.
 * @type {import('../../core/bodies.js').Action}
 */
export const PRESSED_ACTION = {
  name: 'pressed',
  label: { en: 'Is it pressed', zh: '按下了吗' },
  say: 'Read whether the button is pressed right now. It returns 1 or 0.',
  args: { type: 'object', properties: {} },
  run: [{ command: 'is_pressed' }],
  returns: true,
};

/**
 * The body a plugin manifest becomes, without touching disk. Mirrors the
 * loader on purpose: a plugin body is the voice-only body with its own id,
 * label, resources and commands.
 * @param {{
 *   id: string,
 *   commands?: import('../../core/io-program.js').Command[],
 *   resources?: import('../../core/io-program.js').Resource[],
 * }} spec
 * @returns {import('../../core/bodies.js').Body}
 */
export function pluginBody({ id, commands = [], resources = pointResources }) {
  return {
    id,
    label: { en: id, zh: id },
    reply: 'tts',
    ways: [{ source: 'board', needs: [{ part: 'board' }, { part: 'mic' }, { part: 'amp' }] }],
    capabilities: ['hear', 'speak'],
    actions: [],
    fixedTools: ['set_reply_language'],
    commands,
    resources: structuredClone(resources),
    prompts: structuredClone(TEMPLATES.none.prompts),
    firmware: BODY_FIRMWARE,
    preview: 'voice',
  };
}

/**
 * One manifest, as a body.json would carry it.
 * @param {string} id
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function manifest(id, overrides = {}) {
  return {
    id,
    label: { en: id, zh: id },
    parts: ['esp32'],
    resources: structuredClone(pointResources),
    commands: [structuredClone(pointCommand)],
    ...overrides,
  };
}
