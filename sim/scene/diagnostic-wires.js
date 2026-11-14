// Independent silhouettes for wires on a diagnosed net. Never replace the
// jumper's material: its stored colour stays visible inside the outline.
import * as THREE from 'three';
import { nets } from '../netlist.js';

/** @param {THREE.Scene} scene */
export function createDiagnosticWires(scene) {
  /** @type {THREE.Mesh[]} */
  let outlines = [];
  function clear() {
    for (const outline of outlines) {
      outline.removeFromParent();
      outline.geometry.dispose();
      if (!Array.isArray(outline.material)) outline.material.dispose();
    }
    outlines = [];
  }
  /** @param {import('../bench.js').Bench} bench @param {string[]} points */
  function show(bench, points) {
    clear();
    if (!points.length) return;
    const graph = nets(bench);
    const roots = new Set(points.map(point => graph.netOf(point)));
    for (const wire of bench.wires) {
      if (!roots.has(graph.netOf(wire.a))) continue;
      const group = scene.getObjectByName(`wire:${wire.id}`);
      if (!group) continue;
      /** @type {THREE.Mesh[]} */
      const meshes = [];
      group.traverse(o => { if (o instanceof THREE.Mesh && !o.userData.diagnosticOutline) meshes.push(o); });
      for (const mesh of meshes) {
        const geometry = mesh.geometry.clone();
        const pos = geometry.getAttribute('position');
        const normal = geometry.getAttribute('normal');
        if (!pos || !normal) { geometry.dispose(); continue; }
        if (geometry.type === 'BoxGeometry') {
          // A box has face normals: normal-only expansion leaves each front
          // face at its old width, making its silhouette disappear head-on.
          geometry.computeBoundingBox();
          const centre = geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            pos.setXYZ(i, x + Math.sign(x - centre.x) * 0.16, y + Math.sign(y - centre.y) * 0.16, z + Math.sign(z - centre.z) * 0.16);
          }
        } else {
          for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + normal.getX(i) * 0.16, pos.getY(i) + normal.getY(i) * 0.16, pos.getZ(i) + normal.getZ(i) * 0.16);
        }
        pos.needsUpdate = true;
        const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xff492e, side: THREE.BackSide }));
        outline.name = 'diagnostic-wire-outline';
        outline.userData.diagnosticOutline = true;
        mesh.add(outline);
        outlines.push(outline);
      }
    }
  }
  return { show, clear };
}
