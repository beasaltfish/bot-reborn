import test from 'node:test';
import assert from 'node:assert/strict';

import { consoleCommand } from '../../sim/firmware/console.js';
import { emptyBoard } from '../../sim/bench.js';
import { BODY } from '../../sim/firmware/body.js';
import { SCREENS } from '../../core/screens.js';

const state = (settings = {}) => ({ settings: { ...emptyBoard().settings, ...settings }, firmware: BODY });

test('token saves, echoes the prefix, and asks for reboot', () => {
  const r = consoleCommand(state(), 'token 0123456789abcdef0123456789abcdef');
  assert.equal(r.settings.token, '0123456789abcdef0123456789abcdef');
  assert.ok(r.lines.some((line) => line.startsWith('token 0123…')));
  assert.ok(r.lines.includes('type reboot to use it'));
});

test('show prints board.* lines ending with board.end', () => {
  const r = consoleCommand(state({ token: 'f'.repeat(32), screen: 'ili9341-ips' }), 'show');
  assert.deepEqual(r.lines, [
    'board.ssid=bench', 'board.pass=', `board.token=${'f'.repeat(32)}`, 'board.url=', 'board.screen=ili9341-ips', 'board.end',
  ]);
});

test('cal drive toggles and survives a reboot', () => {
  const once = consoleCommand(state(), 'cal drive');
  assert.equal(once.settings.calib.driveSwapped, true);
  const shown = consoleCommand({ ...once, firmware: BODY }, 'cal');
  assert.ok(shown.lines.includes('drive swapped: yes, steer swapped: no'));
  const twice = consoleCommand({ ...once, firmware: BODY }, 'cal drive');
  assert.equal(twice.settings.calib.driveSwapped, false);
});

test('screen lists models, sets a known one, and turns off', () => {
  const list = consoleCommand(state(), 'screen');
  assert.ok(list.lines.some((line) => line.includes(SCREENS[0].id)));
  const set = consoleCommand(state(), `screen ${SCREENS[0].id}`);
  assert.equal(set.settings.screen, SCREENS[0].id);
  const off = consoleCommand({ ...set, firmware: BODY }, 'screen off');
  assert.equal(off.settings.screen, '');
});

test('sketch firmware has no console commands', () => {
  const r = consoleCommand({ settings: emptyBoard().settings, firmware: { ...BODY, id: 'sketch-x' } }, 'show');
  assert.deepEqual(r.lines, ['no console on this firmware']);
});

test('bad commands report error: …', () => {
  assert.equal(consoleCommand(state(), 'nope').lines[0], 'error: unknown command');
  assert.equal(consoleCommand(state(), 'token abc').lines[0], 'error: token needs 32 hex characters');
});
