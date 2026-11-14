import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error jsdom has no bundled declarations
import { JSDOM } from 'jsdom';
import { buildPart, paintOled, dispose } from '../../sim/scene/meshes.js';
import { PARTS } from '../../sim/parts.js';
import { textFrame } from '../../sim/devices/ssd1306.js';

test('the animated device meshes expose named parts and drawable surfaces', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ scale() {}, translate() {}, fillRect() {}, fillText() {}, createRadialGradient() { return { addColorStop() {} }; } });
  try {
    const display = buildPart(PARTS.ssd1306, { onBoard: false, burnt: false });
    const screen = display.group.getObjectByName('oled-screen');
    assert.ok(screen);
    paintOled(screen, textFrame(['T 25.0 C']).frame);
    assert.equal(screen.userData.canvas.width, 128);
    assert.equal(screen.userData.canvas.height, 64);
    dispose(display.group);

    const servo = buildPart(PARTS.sg90, { onBoard: false, burnt: false });
    assert.ok(servo.group.getObjectByName('servo-horn'));
    dispose(servo.group);

    const motor = buildPart(PARTS['dc-motor-small'], { onBoard: false, burnt: false });
    assert.ok(motor.group.getObjectByName('motor-rotor'));
    dispose(motor.group);

    const strip = buildPart(PARTS['ws2812-strip'], { onBoard: false, burnt: false });
    for (let i = 0; i < 8; i++) assert.ok(strip.group.getObjectByName(`strip-led-${i}`));
    dispose(strip.group);

    const button = buildPart(PARTS['button-module'], { onBoard: false, burnt: false });
    assert.ok(button.group.getObjectByName('button-cap'));
    dispose(button.group);
  } finally { globalThis.document = previous; dom.window.close(); }
});
