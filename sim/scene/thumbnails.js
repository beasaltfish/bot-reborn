// Small offscreen renders of the same procedural models the bench uses, so the
// catalogue shows the part a person will actually place. One renderer, one
// cache; when WebGL is unavailable the catalogue simply shows no image.
import * as THREE from 'three';
import { PARTS } from '../parts.js';
import { buildPart, buildBreadboard, dispose } from './meshes.js';

/** @param {number} [size] */
export function createPartThumbnails(size = 96) {
  /** @type {Map<string, string|null>} */ const cache = new Map();
  /** @type {THREE.WebGLRenderer|null} */ let renderer = null;
  /** @type {THREE.Scene|null} */ let scene = null;
  let broken = false;
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
  function ensure() {
    if (renderer && scene) return true;
    if (broken) return false;
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2') && !probe.getContext('webgl')) { broken = true; return false; }
      const canvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(size, size, false);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3028, 2.4));
      const light = new THREE.DirectionalLight(0xffffff, 2);
      light.position.set(-3, 5, 4);
      scene.add(light);
      return true;
    } catch {
      broken = true;
      renderer = null;
      scene = null;
      return false;
    }
  }
  /** @param {string} id @returns {string|null} */
  return function thumbnail(id) {
    if (cache.has(id)) return cache.get(id) ?? null;
    if (id !== 'breadboard' && !Object.hasOwn(PARTS, id)) { cache.set(id, null); return null; }
    if (!ensure() || !renderer || !scene) { cache.set(id, null); return null; }
    /** @type {THREE.Group|null} */ let group = null;
    try {
      group = id === 'breadboard' ? buildBreadboard() : buildPart(PARTS[id], { onBoard: false, burnt: false }).group;
      scene.add(group);
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const extent = box.getSize(new THREE.Vector3());
      const radius = Math.max(extent.x, extent.y, extent.z, 1);
      camera.position.set(center.x + radius * 1.15, center.y + radius * 0.9, center.z + radius * 1.15);
      camera.near = Math.max(0.01, radius / 200);
      camera.far = radius * 20;
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.setSize(size, size, false);
      renderer.render(scene, camera);
      const url = /** @type {HTMLCanvasElement} */ (renderer.domElement).toDataURL('image/png');
      cache.set(id, url);
      return url;
    } catch {
      cache.set(id, null);
      return null;
    } finally {
      if (group) { scene.remove(group); dispose(group); }
    }
  };
}
