import test from 'node:test';
import assert from 'node:assert/strict';
import { keepAliveOptions, createExclusion } from '../web/audio-bench/knobs.js';

test('off means no tone at all, not a tone with always:false', () => {
  // The trap this pins: `hidden` ALSO has always:false, and it is the product
  // behaviour. Returning {always:false} for `off` would make ⑫ compare the
  // shipped arm against itself and report success no matter what.
  assert.equal(keepAliveOptions('off'), null);
});

test('hidden is the shipped behaviour: gated on document.hidden', () => {
  assert.deepEqual(keepAliveOptions('hidden'), { always: false });
});

test('always is ⑫ control arm: ungated', () => {
  assert.deepEqual(keepAliveOptions('always'), { always: true });
});

test('an unknown mode is off rather than a crash', () => {
  assert.equal(keepAliveOptions(/** @type {any} */ ('nonsense')), null);
});

test('the first panel to claim gets it', () => {
  const ex = createExclusion();
  assert.equal(ex.claim('residency'), true);
  assert.equal(ex.owner, 'residency');
});

test('a second panel is refused while the first holds it', () => {
  const ex = createExclusion();
  ex.claim('residency');
  assert.equal(ex.claim('acoustics'), false);
  assert.equal(ex.owner, 'residency');
});

test('the holder can claim again — re-entry is not a conflict', () => {
  const ex = createExclusion();
  ex.claim('residency');
  assert.equal(ex.claim('residency'), true);
});

test('release frees it for the next panel', () => {
  const ex = createExclusion();
  ex.claim('residency');
  ex.release('residency');
  assert.equal(ex.owner, null);
  assert.equal(ex.claim('acoustics'), true);
});

test('a panel that does not hold it cannot release it', () => {
  // Otherwise a panel's own cleanup, running late, hands the microphone away
  // from whoever started in the meantime.
  const ex = createExclusion();
  ex.claim('residency');
  ex.release('acoustics');
  assert.equal(ex.owner, 'residency');
});
