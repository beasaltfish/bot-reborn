import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { focusFrame } from '../../sim/scene/focus-frame.js';

test('focus frames every point with margin in orthographic and perspective views', () => {
  const points = [new THREE.Vector3(-32, 1, 4), new THREE.Vector3(21, 9, -27), new THREE.Vector3(9, 2, 19)];
  for (const ortho of [true, false]) for (const aspect of [0.5, 1, 2]) for (const polar of [0.0001, 0.7, 1.1]) {
    const fov = 38, azimuth = -0.4;
    const frame = focusFrame(points, aspect, { ortho, fov });
    assert.ok(frame);
    const camera = ortho
      ? new THREE.OrthographicCamera(-frame.height * aspect / 2, frame.height * aspect / 2, frame.height / 2, -frame.height / 2, 0.1, 2000)
      : new THREE.PerspectiveCamera(fov, aspect, 0.1, 2000);
    const distance = ortho ? 400 : frame.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    camera.position.copy(frame.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, polar, azimuth)));
    camera.lookAt(frame.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const point of points) {
      const p = point.clone().project(camera);
      assert.ok(Math.abs(p.x) <= 0.91 && Math.abs(p.y) <= 0.91, `${ortho} ${aspect} ${polar}: ${p.x},${p.y}`);
    }
  }
});

test('focus keeps points clear of an open left sidebar', () => {
  const points = [new THREE.Vector3(-25, 2, 15), new THREE.Vector3(30, 2, 16)];
  for (const ortho of [true, false]) {
    const aspect = 1.6, fov = 38, polar = 0.6, azimuth = -0.2;
    const frame = focusFrame(points, aspect, { ortho, fov, azimuth }, { width: 1280, left: 360 });
    assert.ok(frame);
    const camera = ortho
      ? new THREE.OrthographicCamera(-frame.height * aspect / 2, frame.height * aspect / 2, frame.height / 2, -frame.height / 2, 0.1, 2000)
      : new THREE.PerspectiveCamera(fov, aspect, 0.1, 2000);
    const distance = ortho ? 400 : frame.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    camera.position.copy(frame.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, polar, azimuth)));
    camera.lookAt(frame.target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    for (const p of points.map(point => point.clone().project(camera))) assert.ok(p.x > -1 + 2 * 360 / 1280 && p.x < 1, `${ortho}: ${p.x}`);
  }
});

test('focus ignores missing points and does not move for an empty set', () => {
  const pose = { ortho: true, polar: 0.5, azimuth: 0, fov: 38 };
  assert.equal(focusFrame([], 1, pose), null);
  assert.equal(focusFrame([null, undefined], 1, pose), null);
  const result = focusFrame([null, new THREE.Vector3(3, 2, -4)], 1, pose);
  assert.ok(result);
  assert.deepEqual(result.target.toArray(), [3, 2, -4]);
  assert.ok(result.height >= 10);
});
