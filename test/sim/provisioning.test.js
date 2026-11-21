import test from 'node:test';
import assert from 'node:assert/strict';

import { planById } from '../../sim/plan.js';
import { provisionPlan, isRemote, screenMismatch, planScreen, provisionSteps, createProvisioning, manualPairing, paintManualPairing, bootManualPairing, showBootloader, offerTokenRepair } from '../../sim/provision.js';
import { emptyBoard } from '../../sim/bench.js';

const settings = (over = {}) => ({ ...emptyBoard().settings, ...over });
const TOKEN = 'b'.repeat(32);

/** A serial panel that records the lines it was made to type. */
function fakePanel() {
  const typed = /** @type {string[]} */ ([]);
  return { typed, type(/** @type {string} */ line) { typed.push(line); } };
}

test('a plan that talks to a character needs a token; a device plan does not', () => {
  assert.deepEqual(provisionPlan(planById('audio'), settings()).missing, ['token']);
  assert.deepEqual(provisionPlan(planById('bme280-readings'), settings()).missing, []);
});

test('a configured token but empty screen still provisions the screen', () => {
  const plan = planById('screen');
  assert.ok(plan);
  assert.equal(planScreen(plan), 'ili9341-ips');
  assert.deepEqual(provisionPlan(plan, settings({ token: 'a'.repeat(32) })).missing, ['screen']);
});

test('a screen with another model is a mismatch, not a silent reuse', () => {
  const plan = planById('screen');
  assert.ok(plan);
  assert.equal(screenMismatch(plan, settings({ screen: 'st7789-240x320' })), true);
  assert.equal(screenMismatch(plan, settings({ screen: 'ili9341-ips' })), false);
});

test('an explicit remote brain is recognised', () => {
  assert.equal(isRemote('', 'http://localhost:8787'), false);
  assert.equal(isRemote('ws://localhost:8787/body', 'http://localhost:8787'), false);
  assert.equal(isRemote('ws://other:8787/body', 'http://localhost:8787'), true);
});

test('an empty token is typed as a token command; a set token is not', () => {
  const audio = planById('audio');
  const empty = provisionSteps(audio, settings(), { token: TOKEN });
  assert.deepEqual(empty.commands, [`token ${TOKEN}`]);
  const set = provisionSteps(audio, settings({ token: TOKEN }), { token: TOKEN });
  assert.deepEqual(set.commands, []);
});

test('a device plan never types a token', () => {
  const device = planById('bme280-readings');
  assert.ok(device);
  assert.equal(device.connection, null);
  assert.deepEqual(provisionSteps(device, settings(), { token: TOKEN }).commands, []);
});

test('a configured token but empty screen still types the screen', () => {
  const plan = planById('screen');
  assert.deepEqual(provisionSteps(plan, settings({ token: TOKEN }), { token: TOKEN }).commands, ['screen ili9341-ips']);
});

test('a screen configured with another model is only replaced when asked', () => {
  const plan = planById('screen');
  const board = settings({ token: TOKEN, screen: 'st7789-240x320' });
  assert.deepEqual(provisionSteps(plan, board, { token: TOKEN, replaceScreen: false }).commands, []);
  assert.deepEqual(provisionSteps(plan, board, { token: TOKEN, replaceScreen: true }).commands, ['screen ili9341-ips']);
});

test('provisioning types the commands, reboots once and waits for welcome', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const panel = fakePanel();
  let reboots = 0;
  const results = /** @type {string[]} */ ([]);
  const p = createProvisioning({
    commands: [`token ${TOKEN}`, 'screen ili9341-ips'],
    panel,
    reboot() { reboots += 1; },
    onDone(/** @type {string} */ result) { results.push(result); },
  });
  p.start();
  assert.deepEqual(panel.typed, [`token ${TOKEN}`, 'screen ili9341-ips']);
  assert.equal(reboots, 1);
  p.welcomed();
  assert.deepEqual(results, ['welcomed']);
  t.mock.timers.tick(20000);
  assert.deepEqual(results, ['welcomed']);
});

test('an unreachable brain hands control back after 15 s and keeps retrying', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const results = /** @type {string[]} */ ([]);
  const p = createProvisioning({
    commands: [`token ${TOKEN}`], panel: fakePanel(), reboot() {},
    onDone(/** @type {string} */ result) { results.push(result); },
  });
  p.start();
  t.mock.timers.tick(14999);
  assert.deepEqual(results, []);
  t.mock.timers.tick(1);
  assert.deepEqual(results, ['still-retrying']);
  // The firmware's own retry is not cancelled: only the waiting ended.
  p.welcomed();
  assert.deepEqual(results, ['still-retrying']);
});

test('skipping types nothing; cancelling stops only the wait', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const panel = fakePanel();
  let reboots = 0;
  const results = /** @type {string[]} */ ([]);
  const options = { commands: [`token ${TOKEN}`], panel, reboot() { reboots += 1; }, onDone(/** @type {string} */ r) { results.push(r); } };
  const skipped = createProvisioning(options);
  skipped.skip();
  assert.deepEqual(panel.typed, []);
  assert.equal(reboots, 0);
  const cancelled = createProvisioning(options);
  cancelled.start();
  cancelled.cancel();
  assert.deepEqual(results, ['skipped', 'cancelled']);
  t.mock.timers.tick(20000);
  assert.deepEqual(results, ['skipped', 'cancelled']);
});

import { tokenCandidates } from '../../sim/provision.js';

test('pairing candidates are ready and offline, never filtered by capability', () => {
  const list = [
    { id: 'a', name: 'Asten', ready: true, online: false, motion: 'tarot' },
    { id: 'b', name: 'Rex', ready: false, online: false, motion: 'car' },
    { id: 'c', name: 'Busy', ready: true, online: true, motion: 'pet' },
  ];
  assert.deepEqual(tokenCandidates(list).map((c) => c.id), ['a']);
});

test('a body with no token and no demo still gets a character list', () => {
  const list = [{ id: 'a', name: 'Asten', ready: true, online: false }];
  assert.deepEqual(manualPairing({ firmware: 'body', settings: {}, remote: false, characters: list }), { show: true, list });
});

test('a paired body, a remote brain, or another firmware gets nothing', () => {
  const list = [{ id: 'a', name: 'Asten', ready: true, online: false }];
  assert.equal(manualPairing({ firmware: 'body', settings: { token: 't' }, remote: false, characters: list }).show, false);
  assert.equal(manualPairing({ firmware: 'body', settings: {}, remote: true, characters: list }).show, false);
  assert.equal(manualPairing({ firmware: 'sketch-sonar', settings: {}, remote: false, characters: list }).show, false);
});

/** A serial panel whose picker state the tests can read back. */
function fakePicker() {
  /** @type {{ visible: boolean, helper: boolean, list: { id: string, name: string }[],
   *   show(visible: boolean): void, setCharacterHelper(enabled: boolean): void,
   *   setCharacters(list: { id: string, name: string }[]): void }} */
  const panel = {
    visible: false,
    helper: false,
    list: [],
    show(visible) { panel.visible = visible; },
    setCharacterHelper(enabled) { panel.helper = enabled; },
    setCharacters(list) { panel.list = list; },
  };
  return panel;
}

test('a populated local picker is withdrawn when the brain turns remote', () => {
  const characters = [{ id: 'a', name: 'Asten', ready: true, online: false }];
  const panel = fakePicker();
  assert.equal(paintManualPairing({ firmware: 'body', settings: {}, remote: false, characters, panel }), 'shown');
  assert.deepEqual(panel.list.map((c) => c.id), ['a']);
  assert.equal(panel.helper, true);

  assert.equal(paintManualPairing({ firmware: 'body', settings: {}, remote: true, characters, panel }), 'ineligible');
  assert.deepEqual(panel.list, []);
  assert.equal(panel.helper, false);
});

test('a populated local picker is withdrawn before the ROM bootloader panel shows', () => {
  const characters = [{ id: 'a', name: 'Asten', ready: true, online: false }];
  const panel = fakePicker();
  assert.equal(paintManualPairing({ firmware: 'body', settings: {}, remote: false, characters, panel }), 'shown');
  assert.deepEqual(panel.list.map((c) => c.id), ['a']);
  assert.equal(panel.helper, true);

  /** @type {string[]} */ const calls = [];
  /** @type {boolean} */ let helper = panel.helper;
  /** @type {{ id: string, name: string }[]} */ let list = panel.list;
  /** @type {{ show(visible: boolean): void, setCharacterHelper(enabled: boolean): void,
   *   setCharacters(list: { id: string, name: string }[]): void }} */
  const recording = {
    show(visible) { calls.push(`show:${visible}:${helper}:${list.length}`); },
    setCharacterHelper(enabled) { helper = enabled; calls.push(`helper:${enabled}`); },
    setCharacters(next) { list = next; calls.push(`characters:${next.length}`); },
  };
  showBootloader(recording);

  // At the moment show(true) runs the helper is hidden and the list is empty.
  assert.deepEqual(calls, ['helper:false', 'characters:0', 'show:true:false:0']);
});

test('an empty list hides the picker rather than showing only a placeholder', () => {
  const panel = fakePicker();
  assert.equal(paintManualPairing({ firmware: 'body', settings: {}, remote: false, characters: [], panel }), 'empty');
  assert.equal(panel.helper, false);
  assert.deepEqual(panel.list, []);
});

test('the pairing lookup can be retried after the user sets a character up', async () => {
  const panel = fakePicker();
  let characters = /** @type {{ id: string, name: string, ready?: boolean, online?: boolean }[]} */ ([]);
  const boot = () => bootManualPairing({
    characters: async () => characters,
    isCurrent: () => true,
    board: () => ({ firmware: 'body', settings: { token: '', url: '' } }),
    origin: 'http://localhost:8787',
    panel,
  });
  assert.equal(await boot(), 'empty');
  assert.equal(panel.helper, false);
  assert.deepEqual(panel.list, []);

  // Back from the admin page with a character that is ready to pair.
  characters = [{ id: 'a', name: 'Asten', ready: true, online: false }];
  assert.equal(await boot(), 'shown');
  assert.equal(panel.helper, true);
  assert.deepEqual(panel.list, [{ id: 'a', name: 'Asten' }]);
});

test('a list that could not be read is not reported as an empty brain', async () => {
  const panel = fakePicker();
  const status = await bootManualPairing({
    characters: async () => { throw new Error('offline'); },
    isCurrent: () => true,
    board: () => ({ firmware: 'body', settings: { token: '', url: '' } }),
    origin: 'http://localhost:8787',
    panel,
  });
  assert.equal(status, 'unreadable');
  assert.equal(panel.visible, false);
  assert.equal(panel.helper, false);
});

test('a stale token still gets the list, so its replacement can be picked', () => {
  const characters = [
    { id: 'a', name: 'Asten', ready: true, online: false },
    { id: 'b', name: 'Busy', ready: true, online: true },
  ];
  const panel = fakePicker();
  // Boot stays quiet: a token is set, so manualPairing does not offer the list.
  assert.equal(manualPairing({ firmware: 'body', settings: { token: 'stale' }, remote: false, characters }).show, false);
  assert.equal(offerTokenRepair(panel, characters), 1);
  assert.deepEqual(panel.list.map((c) => c.id), ['a']);
  assert.equal(panel.helper, true);
});

test('a stale token with nothing to pick leaves the helper hidden', () => {
  const panel = fakePicker();
  assert.equal(offerTokenRepair(panel, [{ id: 'b', name: 'Busy', ready: true, online: true }]), 0);
  assert.deepEqual(panel.list, []);
  assert.equal(panel.helper, false);
});

test('a deferred answer is discarded when the brain turned remote during the fetch', async () => {
  const panel = fakePicker();
  /** @type {((list: { id: string, name: string, ready?: boolean, online?: boolean }[]) => void) | undefined} */
  let answer;
  let url = '';
  const boot = bootManualPairing({
    characters: () => new Promise((resolve) => { answer = resolve; }),
    isCurrent: () => true,
    board: () => ({ firmware: 'body', settings: { token: '', url } }),
    origin: 'http://localhost:8787',
    panel,
  });
  url = 'ws://other:8787/body';
  answer?.([{ id: 'a', name: 'Asten', ready: true, online: false }]);
  assert.equal(await boot, 'ineligible');
  assert.deepEqual(panel.list, []);
  assert.equal(panel.helper, false);
});

test('a late answer from a boot the user left never reaches the picker', async () => {
  const panel = fakePicker();
  /** @type {((list: { id: string, name: string, ready?: boolean, online?: boolean }[]) => void) | undefined} */
  let answer;
  let current = true;
  const boot = bootManualPairing({
    characters: () => new Promise((resolve) => { answer = resolve; }),
    isCurrent: () => current,
    board: () => ({ firmware: 'body', settings: { token: '', url: '' } }),
    origin: 'http://localhost:8787',
    panel,
  });
  current = false;
  answer?.([{ id: 'a', name: 'Asten', ready: true, online: false }]);
  assert.equal(await boot, 'stale');
  assert.deepEqual(panel.list, []);
  assert.equal(panel.helper, false);
  assert.equal(panel.visible, false);
});
