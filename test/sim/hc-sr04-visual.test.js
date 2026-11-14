import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { buildPart, dispose } from '../../sim/scene/meshes.js';
import { PARTS } from '../../sim/parts.js';

test('HC-SR04 procedural visual retains physical pin anchors and both transducers', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ scale() {}, translate() {}, fillRect() {}, fillText() {}, createRadialGradient() { return { addColorStop() {} }; } });
  try {
    for (const onBoard of [false, true]) {
      const visual = buildPart(PARTS['hc-sr04'], { onBoard, burnt: false });
      assert.deepEqual([...visual.anchors.keys()], ['VCC', 'TRIG', 'ECHO', 'GND']);
      for (const pin of PARTS['hc-sr04'].pins) assert.equal(visual.anchors.get(pin.name)?.x, pin.x);
      assert.ok(visual.group.getObjectByName('sonar-transmitter'));
      assert.ok(visual.group.getObjectByName('sonar-receiver'));
      dispose(visual.group);
    }
  } finally { globalThis.document = previous; dom.window.close(); }
});
