import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { publishBrain, keepPublished, SERVICE_TYPE, BRAIN_HOST } from '../server/discovery.js';

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

test('keepPublished announces again when the computer\'s addresses change, and not otherwise', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    /** @type {ReturnType<typeof fakeBonjour>[]} */
    const made = [];
    let addrs = ['192.168.3.82'];
    const ad = keepPublished({
      port: 8787, name: 'My-Mac', intervalMs: 1000,
      addresses: () => addrs,
      makeBonjour: () => { const b = fakeBonjour(); made.push(b); return b; },
    });
    assert.equal(made.length, 1);
    mock.timers.tick(3000);
    assert.equal(made.length, 1, 'same addresses: nothing new');
    addrs = ['192.168.3.84'];
    mock.timers.tick(1000);
    assert.equal(made.length, 2, 'new address: announced again');
    assert.equal(made[0].calls.unpublishAll, 1, 'the old announcement is withdrawn');
    assert.equal(made[1].calls.publish.length, 1);
    ad.stop();
    assert.equal(made[1].calls.unpublishAll, 1);
    mock.timers.tick(5000);
    assert.equal(made.length, 2, 'stopped: no more checks');
  } finally {
    mock.timers.reset();
  }
});
