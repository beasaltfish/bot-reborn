import { test } from 'node:test';
import assert from 'node:assert/strict';
// jsdom is a test dependency without bundled TypeScript declarations.
// @ts-expect-error no @types/jsdom dependency
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { emptyBench, trash, addWire, removeWire } from '../../sim/bench.js';
import { attachInteraction } from '../../sim/scene/interact.js';

test('clicking a pin selects it while keeping click-to-wire active', () => {
  const dom = new JSDOM('<!doctype html><canvas></canvas>');
  const previous = { document: globalThis.document, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    const canvas = /** @type {HTMLCanvasElement} */ (dom.window.document.querySelector('canvas'));
    canvas.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 0, top: 0, width: 200, height: 200 });
    canvas.setPointerCapture = () => {};
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    camera.position.set(0, 10, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const group = new THREE.Group();
    group.name = 'part:mic';
    group.userData.anchors = new Map([['GND', new THREE.Vector3(0, 0, 0)]]);
    scene.add(group);
    let bench = emptyBench();
    /** @type {import('../../sim/selection.js').Selection[]} */
    const changes = [];
    const world = /** @type {any} */ ({ canvas, scene, camera, pickables: [], requestRender() {}, binHover() {} });
    const hands = attachInteraction(world, () => bench, next => { bench = next; }, {
      say() {}, selectWire() {}, selectPart() {}, onSelect: value => changes.push(value),
    });
    for (const type of ['pointerdown', 'pointerup']) {
      const e = new dom.window.MouseEvent(type, { clientX: 100, clientY: 100, button: 0, bubbles: true });
      Object.defineProperties(e, { isPrimary: { value: true }, pointerId: { value: 1 } });
      canvas.dispatchEvent(e);
    }
    assert.deepEqual(hands.selection(), { kind: 'pin', point: 'mic:GND' });
    assert.deepEqual(changes, [{ kind: 'pin', point: 'mic:GND' }]);
    assert.match(dom.window.document.body.textContent ?? '', /Click a pin or a hole to end the wire/);
    const removed = trash(bench, 'mic');
    assert.ok(!('refused' in removed));
    bench = removed;
    hands.refreshSelection();
    assert.equal(hands.selection(), null);
  } finally {
    globalThis.document = previous.document;
    globalThis.addEventListener = previous.addEventListener;
    dom.window.close();
  }
});

test('clicking a part and wire selects them without replacing existing menus', () => {
  const dom = new JSDOM('<!doctype html><canvas></canvas>');
  const previous = { document: globalThis.document, addEventListener: globalThis.addEventListener };
  globalThis.document = dom.window.document;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  try {
    const canvas = /** @type {HTMLCanvasElement} */ (dom.window.document.querySelector('canvas'));
    canvas.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 0, top: 0, width: 200, height: 200 });
    canvas.setPointerCapture = () => {};
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    camera.position.set(0, 10, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const part = new THREE.Group();
    part.name = 'part:mic';
    part.userData = { kind: 'part', id: 'mic', anchors: new Map() };
    part.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial()));
    scene.add(part);
    scene.updateMatrixWorld(true);
    let bench = addWire(emptyBench(), 'esp:3V3', 'mic:VDD', 'red');
    /** @type {string[]} */
    const menus = [];
    const world = /** @type {any} */ ({ canvas, scene, camera, pickables: [part], requestRender() {}, binHover() {} });
    const hands = attachInteraction(world, () => bench, next => { bench = next; }, {
      say() {}, selectWire: id => menus.push(`wire:${id}`), selectPart: id => menus.push(`part:${id}`), onSelect() {},
    });
    const click = (/** @type {number} */ x, /** @type {number} */ y) => {
      for (const type of ['pointerdown', 'pointerup']) {
        const e = new dom.window.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
        Object.defineProperties(e, { isPrimary: { value: true }, pointerId: { value: 1 } });
        canvas.dispatchEvent(e);
      }
    };
    click(100, 100);
    assert.deepEqual(hands.selection(), { kind: 'part', id: 'mic' });
    assert.deepEqual(menus, ['part:mic']);
    const wire = new THREE.Group();
    wire.name = `wire:${bench.wires[0].id}`;
    wire.userData = { kind: 'wire', id: bench.wires[0].id };
    wire.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial()));
    scene.add(wire);
    scene.updateMatrixWorld(true);
    world.pickables = [wire];
    click(100, 100);
    assert.deepEqual(hands.selection(), { kind: 'wire', id: bench.wires[0].id });
    assert.deepEqual(menus, ['part:mic', `wire:${bench.wires[0].id}`]);
    click(190, 190);
    assert.equal(hands.selection(), null);
    click(100, 100);
    assert.equal(hands.selection()?.kind, 'wire');
    bench = removeWire(bench, bench.wires[0].id);
    hands.refreshSelection();
    assert.equal(hands.selection(), null);
  } finally {
    globalThis.document = previous.document;
    globalThis.addEventListener = previous.addEventListener;
    dom.window.close();
  }
});
