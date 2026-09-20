import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, faceFor, applyFace, missingParts, applyAssembly, hintVisible } from '../web/robot.js';
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

// --- the parts it has not been given yet ----------------------------------

/** @param {any} over @returns {any} */
const cfg = (over = {}) => ({
  stt: { baseURL: '', apiKey: '', model: '' },
  llm: { baseURL: '', apiKey: '', model: '' },
  tts: { baseURL: '', apiKey: '', model: '', voice: '' },
  calibration: { steerSwapped: null, bytesPerMs: null },
  ...over,
});

const full = { baseURL: 'https://x.test/v1', apiKey: 'k', model: 'm' };

test('a config straight out of the box is missing every part', () => {
  assert.deepEqual(missingParts(cfg()), ['ears', 'mind', 'voice', 'wheels']);
});

test('each layer accounts for exactly one part', () => {
  assert.ok(!missingParts(cfg({ stt: full })).includes('ears'));
  assert.ok(missingParts(cfg({ stt: full })).includes('mind'));
  assert.ok(!missingParts(cfg({ llm: full })).includes('mind'));
  assert.ok(!missingParts(cfg({ tts: { ...full, voice: 'v' } })).includes('voice'));
});

test('an address with no key behind it is not a part it has been given', () => {
  // This is the case the old check passed: baseURL set, nothing else, and the
  // robot looked complete right up until its first sentence failed.
  assert.ok(missingParts(cfg({ llm: { baseURL: 'https://x.test', apiKey: '', model: '' } }))
    .includes('mind'));
});

test('TTS is not complete without its voice (spec §8.2 gives it a fourth field)', () => {
  assert.ok(missingParts(cfg({ tts: { ...full, voice: '' } })).includes('voice'));
});

test('a car that measured as NOT reversed has still been taught', () => {
  // `false` is a measurement. Only `null` means nobody has asked the question,
  // and treating the two alike would leave the wheels pale forever on half the
  // cars in the world.
  assert.ok(!missingParts(cfg({ calibration: { steerSwapped: false, bytesPerMs: null } }))
    .includes('wheels'));
  assert.ok(missingParts(cfg({ calibration: { steerSwapped: true, bytesPerMs: null } }))
    .length === 3);
});

test('applyAssembly writes a token list the stylesheet can match one part at a time', () => {
  // The CSS asks [data-missing~="ears"]. A joined string like "earsmind" would
  // match nothing and fail without an error anywhere.
  const fake = { dataset: /** @type {Record<string, string>} */ ({}) };
  applyAssembly(/** @type {any} */ (fake), ['ears', 'wheels']);
  assert.deepEqual(fake.dataset.missing.split(' '), ['ears', 'wheels']);
});

test('nothing missing clears the attribute rather than leaving the last value', () => {
  const fake = { dataset: /** @type {Record<string, string>} */ ({ missing: 'ears mind' }) };
  applyAssembly(/** @type {any} */ (fake), []);
  assert.equal(fake.dataset.missing, '');
});


// --- the wake-word hint ----------------------------------------------------

test('the hint is only up while saying the name would do something', () => {
  // It is an instruction, and SLEEPING is the only state where carrying it out
  // has any effect (§5.3 keeps KWS subscribed there). From LISTENING onwards
  // it tells the user to do a thing they have already done.
  assert.equal(hintVisible(true, 'SLEEPING'), true);
  for (const s of STATES.filter((s) => s !== 'SLEEPING')) {
    assert.equal(hintVisible(true, s), false, `${s} must not carry the hint`);
  }
});

test('a shut microphone carries no hint, asleep or not', () => {
  // SLEEPING covers both "the mic is shut" and "waiting to hear its name", and
  // only the second one can be acted on.
  for (const s of STATES) assert.equal(hintVisible(false, s), false);
});

test('the hint comes back when the session times out (§5.2)', () => {
  assert.equal(hintVisible(true, 'SPEAKING'), false);
  assert.equal(hintVisible(true, 'SLEEPING'), true);
});
