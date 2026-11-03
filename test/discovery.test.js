import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishBrain, SERVICE_TYPE, BRAIN_HOST } from '../server/discovery.js';

/** A bonjour stand-in that records what it was asked, and touches no network. */
function fakeBonjour() {
  /** @type {{ publish: object[], unpublishAll: number, destroy: number }} */
  const calls = { publish: [], unpublishAll: 0, destroy: 0 };
  return {
    calls,
    /** @param {object} service */
    publish(service) { calls.publish.push(service); return {}; },
    /** @param {() => void} [cb] */
    unpublishAll(cb) { calls.unpublishAll++; cb?.(); },
    destroy() { calls.destroy++; },
  };
}

test('the brain publishes one _beasaltfish._tcp service on its port, as beasaltfish-brain.local', () => {
  const b = fakeBonjour();
  publishBrain({ port: 8787, name: 'My-Mac', bonjour: b });
  assert.equal(b.calls.publish.length, 1);
  assert.deepEqual(b.calls.publish[0], {
    name: 'My-Mac', type: 'beasaltfish', protocol: 'tcp', port: 8787, host: 'beasaltfish-brain.local',
  });
  assert.equal(SERVICE_TYPE, 'beasaltfish');
  assert.equal(BRAIN_HOST, 'beasaltfish-brain.local');
});

test('stop unpublishes and destroys once, and a second stop is harmless', () => {
  const b = fakeBonjour();
  const ad = publishBrain({ port: 8787, name: 'My-Mac', bonjour: b });
  ad.stop();
  ad.stop();
  assert.equal(b.calls.unpublishAll, 1);
  assert.equal(b.calls.destroy, 1);
});
