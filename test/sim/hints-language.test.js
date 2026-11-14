import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBench, addWire, place } from '../../sim/bench.js';
import { TARGET } from '../../sim/target.js';
import { holeXY } from '../../sim/parts.js';
import { powerOn } from '../../sim/power.js';
import { diagnose, nextHint } from '../../sim/diagnose.js';

/** @param {{a:string,b:string}[]} links */
function wired(links) {
  let b = { ...emptyBench(), usb: true };
  for (const link of links) b = addWire(b, link.a, link.b, 'red');
  return b;
}

test('Chinese swapped, adjacent-pin and missing hints retain the actual affected points', () => {
  const base = TARGET.filter(l => !['mic:SCK', 'mic:WS'].includes(l.a));
  const swapped = wired([...base, { a: 'mic:SCK', b: 'esp:GPIO13' }, { a: 'mic:WS', b: 'esp:GPIO12' }]);
  const swappedHint = diagnose(swapped, powerOn(swapped), 'zh').find(h => h.kind === 'swapped');
  assert.match(swappedHint?.text ?? '', /接反/);
  assert.deepEqual(new Set(swappedHint?.points), new Set(['mic:SCK', 'mic:WS', 'esp:GPIO12', 'esp:GPIO13']));
  const nearby = wired([...base, { a: 'mic:WS', b: 'esp:GPIO12' }]);
  assert.match(diagnose(nearby, powerOn(nearby), 'zh').find(h => h.kind === 'neighbour-pin')?.text ?? '', /旁边/);
  const missing = wired(TARGET.filter(l => l.a !== 'mic:SD'));
  assert.match(diagnose(missing, powerOn(missing), 'zh').find(h => h.kind === 'missing')?.text ?? '', /尚未连接/);
});

test('Chinese off-column and hanging hints describe the same physical problem', () => {
  let b = wired(TARGET.filter(l => l.a !== 'mic:SCK'));
  b = place(b, 'mic', { x: -14, z: -2 }, 0, true);
  b = addWire(b, 'bb1:b21', 'esp:GPIO12', 'red');
  const hint = diagnose(b, powerOn(b), 'zh').find(h => h.kind === 'off-by-one');
  assert.match(hint?.text ?? '', /21.*20/);
  const h = holeXY('h47');
  b = place(emptyBench(), 'mic', { x: h.x - 31, z: h.y - 9 }, 0, true);
  const hanging = diagnose(b, powerOn(b), 'zh').find(h => h.kind === 'hanging');
  assert.match(hanging?.text ?? '', /没有插入/);
});

test('Chinese next hint includes the translated safety explanation', () => {
  const hint = nextHint(emptyBench(), 'zh');
  assert.deepEqual(hint?.points, ['mic:VDD', 'esp:3V3']);
  assert.match(hint?.text ?? '', /连接/);
  assert.match(hint?.text ?? '', /不能接 5V/);
  assert.match(nextHint(emptyBench())?.text ?? '', /^Connect /);
});
