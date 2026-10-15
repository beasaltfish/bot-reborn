import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, faceFor, applyFace, missingParts, applyAssembly, hintVisible, PART_STEP }
  from '../phone/robot.js';
import { GATING } from '../phone/steps.js';
import { STRINGS } from '../core/strings.js';
import { defaultConfig } from '../phone/config.js';

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

test('every state owns a part no other state draws', () => {
  // SLEEPING used to own nothing: it was the other faces minus their parts,
  // which is why it read as an ordinary idle robot rather than a sleeping one.
  const only = (/** @type {(f: import('../phone/robot.js').Face) => boolean} */ has) =>
    STATES.filter((s) => has(faceFor(s)));
  assert.deepEqual(only((f) => f.doze), ['SLEEPING']);
  assert.deepEqual(only((f) => f.waves), ['CAPTURING']);
  assert.deepEqual(only((f) => f.mouth), ['SPEAKING']);
  assert.deepEqual(only((f) => f.antenna === 'orbit'), ['THINKING']);
});

test('applyFace writes the doze mark, not just the ones it started with', () => {
  // A field added to Face and forgotten here renders as whatever the previous
  // state left behind — the exact failure faceFor() throws to prevent.
  const root = /** @type {any} */ ({ dataset: {} });
  applyFace(root, 'SLEEPING');
  assert.equal(root.dataset.doze, 'true');
  applyFace(root, 'THINKING');
  assert.equal(root.dataset.doze, 'false');
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

const bodyCfg = (/** @type {Partial<import('../phone/config.js').BodyConfig>} */ over = {}) =>
  ({ ...defaultConfig(), ...over });
const taught = { steerSwapped: false, driveSwapped: false, bytesPerMs: null };

test('a phone straight out of the box is missing every part', () => {
  assert.deepEqual(missingParts(bodyCfg()), ['ears', 'mind', 'voice', 'wheels']);
});

test('a brain is the ears, the mind and the voice at once — one scan gives all three', () => {
  assert.deepEqual(missingParts(bodyCfg({ token: 'ab'.repeat(16) })), ['wheels']);
});

test('the wheels need both answers', () => {
  const linked = { token: 'ab'.repeat(16) };
  assert.deepEqual(missingParts(bodyCfg({ ...linked, calibration: taught })), []);
  assert.deepEqual(missingParts(bodyCfg({ ...linked, calibration: { ...taught, driveSwapped: null } })), ['wheels']);
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


// --- every ghost is a door -------------------------------------------------

test('every part the robot can draw as missing knows which sheet it opens', () => {
  // A ghost is the only advertisement a drawing has. One that is pressed and
  // does nothing is worse than not drawing it: the next ghost gets ignored
  // too. So a part added to missingParts() without a row here is a bug this
  // catches rather than something to be discovered by pressing it.
  const every = missingParts(bodyCfg());
  assert.equal(every.length, 4, 'bodyCfg() is meant to be missing every part');
  for (const part of every) {
    assert.ok(PART_STEP[part], `part "${part}" is drawn as missing but opens nothing`);
    assert.ok(GATING.includes(PART_STEP[part]),
      `part "${part}" opens "${PART_STEP[part]}", which is not a step`);
  }
});

test('the mouth opens the brain step, like the ears and the mind', () => {
  // One scan gives all three, so all three are one door.
  assert.equal(PART_STEP.voice, 'brain');
});


// --- the wake-word hint ----------------------------------------------------

test('the hint is only up while saying the name would do something', () => {
  // It is an instruction, and SLEEPING is the only state where carrying it out
  // has any effect (§5.3 keeps KWS subscribed there). From LISTENING onwards
  // it tells the user to do a thing they have already done.
  assert.equal(hintVisible(true, 'SLEEPING', true), true);
  for (const s of STATES.filter((s) => s !== 'SLEEPING')) {
    assert.equal(hintVisible(true, s, true), false, `${s} must not carry the hint`);
  }
});

test('a shut microphone carries no hint, asleep or not', () => {
  // SLEEPING covers both "the mic is shut" and "waiting to hear its name", and
  // only the second one can be acted on.
  for (const s of STATES) assert.equal(hintVisible(false, s, true), false);
});

test('the hint comes back when the session times out (§5.2)', () => {
  assert.equal(hintVisible(true, 'SPEAKING', true), false);
  assert.equal(hintVisible(true, 'SLEEPING', true), true);
});

test('with the wake word switched off there is no name to ask for', () => {
  // The robot starts awake and never sleeps, so the line would be an
  // instruction with nothing behind it (2026-09-27).
  for (const s of STATES) assert.equal(hintVisible(true, s, false), false);
});
