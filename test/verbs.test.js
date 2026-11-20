import test from 'node:test';
import assert from 'node:assert/strict';
import { VERBS, VERB_NAMES } from '../core/verbs.js';

test('the five verbs are the five things the code can already do', () => {
  assert.deepEqual([...VERB_NAMES].sort(), ['draw', 'drive', 'halt', 'pose', 'voice']);
  assert.equal(VERBS.drive.needs, 'move');
  assert.equal(VERBS.halt.cancelsRest, true);
  assert.equal(VERBS.pose.first, true);
  assert.equal(VERBS.drive.args.properties?.ms?.maximum, 1000); // the wire frame, not the model's word
  assert.equal(VERBS.draw.returns, true);
});

test('every verb says where it is bounded', () => {
  for (const name of VERB_NAMES) assert.ok(VERBS[name].bounded, name);
});
