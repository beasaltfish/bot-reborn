import test from 'node:test';
import assert from 'node:assert/strict';
import { VERBS, VERB_NAMES, verbNeeds } from '../core/verbs.js';

/**
 * Reads the two-branch `ms` schema the way Task 2's checker will: integer at or
 * above the minimum, or the one literal word. Local and tiny on purpose — this
 * pins what the schema *means*, not just how it is spelled.
 * @param {unknown} value
 */
function msAccepted(value) {
  const schema = VERBS.drive.args.properties?.ms;
  assert.ok(schema?.anyOf, 'drive.ms is a union, not a single type');
  return schema.anyOf.some((branch) => {
    if (branch.const !== undefined) return value === branch.const;
    if (branch.type === 'integer') {
      return Number.isInteger(value) && /** @type {number} */ (value) >= (branch.minimum ?? 0);
    }
    return false;
  });
}

test('the five verbs are the five things the code can already do', () => {
  assert.deepEqual([...VERB_NAMES].sort(), ['draw', 'drive', 'halt', 'pose', 'voice']);
  assert.equal(VERBS.drive.needs, 'move');
  assert.equal(VERBS.halt.cancelsRest, true);
  assert.equal(VERBS.pose.first, true);
  assert.equal(VERBS.draw.returns, true);
});

test('each verb asks for the capability that carries it out', () => {
  assert.equal(VERBS.drive.needs, 'move');
  assert.equal(VERBS.halt.needs, 'move');
  assert.equal(VERBS.voice.needs, 'speak');
  assert.equal(VERBS.pose.needs, 'show');
  // A card is drawn, framed and turned over in the brain; the screen is what it
  // appears on. Needing `sense` here was reading "has a wand" as "can read".
  assert.equal(VERBS.draw.needs, 'show');
});

test('ms is a number of any length, or the word hold — nothing else', () => {
  assert.equal(msAccepted(60000), true); // no upper bound: the carrier slices it
  assert.equal(msAccepted(1), true);
  assert.equal(msAccepted('hold'), true);
  assert.equal(msAccepted(0), false);
  assert.equal(msAccepted('held'), false);
});

test('halt and draw take no arguments; voice and pose take their name', () => {
  assert.deepEqual(VERBS.halt.args, { type: 'object', properties: {} });
  assert.deepEqual(VERBS.draw.args, { type: 'object', properties: {} });
  assert.deepEqual(VERBS.voice.args.required, ['clip']);
  assert.deepEqual(VERBS.pose.args.required, ['pose']);
});

test('verbNeeds answers what a verb requires, and null for a non-verb', () => {
  assert.deepEqual(verbNeeds('drive'), ['move']);
  assert.deepEqual(verbNeeds('draw'), ['show']);
  assert.equal(verbNeeds('cruise'), null);
});

test('every verb says where it is bounded', () => {
  for (const name of VERB_NAMES) assert.ok(VERBS[name].bounded, name);
});
