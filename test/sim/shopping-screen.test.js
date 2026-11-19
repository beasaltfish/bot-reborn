import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench } from '../../sim/bench.js';
import { shoppingList } from '../../sim/shopping.js';
import { SCREENS } from '../../core/screens.js';
import { FIRMWARE_DRIVERS } from '../../core/screens.js';

test('every screen model carries buying information', () => {
  for (const screen of SCREENS) {
    assert.ok(screen.buy, screen.id);
    assert.ok(screen.buy.keywords.en && screen.buy.keywords.zh, screen.id);
    assert.ok(screen.buy.alternatives.length >= 1, screen.id);
  }
});

test('a screen the firmware cannot drive is listed with a warning', () => {
  const bench = emptyBench();
  const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
    { id: 'scr', part: 'screen-st7735-160', at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false, properties: {} },
  ]);
  const { lines, warnings } = shoppingList({ ...bench, placed });
  const line = lines.find((l) => l.key === 'screen-st7735-160');
  assert.equal(line?.warning, 'screen-unsupported-controller');
  assert.ok(warnings.includes('screen-unsupported-controller'));
  assert.ok(FIRMWARE_DRIVERS.has('ili9341'));
  assert.ok(!FIRMWARE_DRIVERS.has('st7735'));
});

test('the default panel is priced and marked unverified, not unsupported', () => {
  const bench = emptyBench();
  const placed = /** @type {import('../../sim/bench.js').Placed[]} */ ([
    { id: 'scr', part: 'screen-ili9341-ips', at: { x: 0, z: 0 }, rot: 0, seated: false, burnt: false, properties: {} },
  ]);
  const { lines } = shoppingList({ ...bench, placed });
  const line = lines.find((l) => l.key === 'screen-ili9341-ips');
  assert.ok(line);
  assert.equal(line.quantity, 1);
  assert.equal(line.warning, 'screen-unverified');
  assert.match(line.purchase.keywords.en, /ILI9341/);
});

test('the default panel names the 5 V supply its own regulator needs', () => {
  const panel = SCREENS.find((s) => s.id === 'ili9341-ips');
  assert.ok(panel?.buy);
  const spec = panel.buy.mustMatch.map((m) => m.en).join(' ');
  assert.match(spec, /5\s?V/i);
  assert.match(spec, /regulator|LDO/i);
});
