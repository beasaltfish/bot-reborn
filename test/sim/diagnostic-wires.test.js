import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { emptyBench, addWire, setWireColor } from '../../sim/bench.js';
import { createDiagnosticWires } from '../../sim/scene/diagnostic-wires.js';

test('diagnosis outlines wires on the affected net without changing their materials or unrelated wires', () => {
  let bench = addWire(emptyBench(), 'esp:3V3', 'mic:VDD', 'red');
  bench = addWire(bench, 'mic:VDD', 'amp:Vin', 'yellow');
  bench = addWire(bench, 'esp:GND', 'mic:GND', 'black');
  const scene = new THREE.Scene();
  const groups = bench.wires.map(w => {
    const group = new THREE.Group();
    group.name = `wire:${w.id}`;
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: w.color })));
    scene.add(group);
    return group;
  });
  const first = /** @type {THREE.Mesh} */ (groups[0].children[0]);
  const originalMaterial = first.material;
  const highlight = createDiagnosticWires(scene);
  highlight.show(bench, ['esp:3V3']);
  const outline = /** @type {THREE.Mesh} */ (groups[0].getObjectByName('diagnostic-wire-outline'));
  assert.ok(outline);
  outline.geometry.computeBoundingBox();
  const positions = outline.geometry.getAttribute('position');
  // Front-facing box vertices must expand sideways too, otherwise a straight-on
  // view has no visible silhouette even though the bounds grow on side faces.
  assert.ok(positions.getX(0) > 0.5);
  assert.ok(positions.getY(0) > 0.5);
  assert.ok(groups[1].getObjectByName('diagnostic-wire-outline'));
  assert.equal(groups[2].getObjectByName('diagnostic-wire-outline'), undefined);
  assert.equal(first.material, originalMaterial);
  bench = setWireColor(bench, bench.wires[0].id, 'blue');
  highlight.show(bench, ['esp:3V3']);
  assert.equal(groups[0].getObjectsByProperty('name', 'diagnostic-wire-outline').length, 1);
  assert.equal(first.material, originalMaterial);
  highlight.clear();
  assert.equal(groups[0].getObjectByName('diagnostic-wire-outline'), undefined);
  assert.equal(groups[1].getObjectByName('diagnostic-wire-outline'), undefined);
});
