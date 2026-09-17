import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, faceFor, applyFace } from '../web/robot.js';
import { STRINGS } from '../web/strings.js';

test('the five states are session.js\'s five, in its own order', () => {
  assert.deepEqual(
    [...STATES],
    ['SLEEPING', 'LISTENING', 'CAPTURING', 'THINKING', 'SPEAKING'],
  );
});

test('every state has a face — none falls through to a default', () => {
  // A missing state would render as whatever the previous one left behind, and
  // the robot would silently lie about what the session is doing.
  for (const s of STATES) assert.ok(faceFor(s), `${s} has no face`);
});

test('every face names a string key that actually exists in both languages', () => {
  for (const s of STATES) {
    const { labelKey } = faceFor(s);
    assert.ok(labelKey in STRINGS.en, `en is missing ${labelKey}`);
    assert.ok(labelKey in STRINGS.zh, `zh is missing ${labelKey}`);
  }
});

test('no two faces look the same', () => {
  // The spec's load-bearing pair is LISTENING vs CAPTURING — "you may speak"
  // against "I hear you". If they render identically the child cannot tell
  // when to talk, and nothing else in the product says it.
  //
  // labelKey is excluded on purpose: it is what a screen reader hears, not
  // something drawn, so two faces that differ ONLY by it are still two
  // identical pictures. Including it made this assertion pass a mutation that
  // collapsed CAPTURING into LISTENING — a green test for the exact collision
  // it was written to catch.
  const seen = new Map();
  for (const s of STATES) {
    const { labelKey, ...drawn } = faceFor(s);
    const key = JSON.stringify(drawn);
    assert.ok(!seen.has(key), `${s} is drawn identically to ${seen.get(key)}`);
    seen.set(key, s);
  }
});

test('LISTENING and CAPTURING differ by the sound waves and nothing else', () => {
  // Stated as its own test because it is the one distinction a reader is most
  // likely to "simplify" away later.
  const l = faceFor('LISTENING');
  const c = faceFor('CAPTURING');
  assert.equal(l.waves, false);
  assert.equal(c.waves, true);
  assert.deepEqual({ ...l, waves: null, labelKey: null }, { ...c, waves: null, labelKey: null });
});

test('only SLEEPING is dim, and only THINKING is amber', () => {
  // §11: green = ready, amber = your turn / busy, red belongs to the emergency
  // stop alone. The robot never shows red.
  const tints = Object.fromEntries(STATES.map((s) => [s, faceFor(s).tint]));
  assert.deepEqual(tints, {
    SLEEPING: 'dim', LISTENING: 'go', CAPTURING: 'go', THINKING: 'wait', SPEAKING: 'go',
  });
  assert.ok(!Object.values(tints).includes('stop'), 'the robot must never wear red');
});

test('applyFace writes every field onto the element as a data attribute', () => {
  const fake = { dataset: /** @type {Record<string, string>} */ ({}) };
  const face = applyFace(/** @type {any} */ (fake), 'CAPTURING');
  assert.equal(fake.dataset.face, 'CAPTURING');
  assert.equal(fake.dataset.eyes, face.eyes);
  assert.equal(fake.dataset.antenna, face.antenna);
  assert.equal(fake.dataset.waves, 'true');
  assert.equal(fake.dataset.mouth, 'false');
  assert.equal(fake.dataset.motion, face.motion);
  assert.equal(fake.dataset.tint, face.tint);
});

test('applyFace on an unknown state throws rather than leaving the last face up', () => {
  // Leaving the previous face is the dangerous failure: the robot would look
  // awake while the session had moved on.
  const fake = { dataset: {} };
  assert.throws(() => applyFace(/** @type {any} */ (fake), /** @type {any} */ ('NAPPING')));
});
