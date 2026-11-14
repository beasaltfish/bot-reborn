import * as THREE from 'three';

/** Frame a bounding sphere so all points fit at any camera orientation.
 * @param {(THREE.Vector3|null|undefined)[]} points
 * @param {number} aspect
 * @param {{ortho:boolean, fov:number, azimuth?:number}} pose
 * @param {{width:number, left?:number, right?:number}} [viewport]
 */
export function focusFrame(points, aspect, pose, viewport) {
  const valid = points.filter((/** @type {THREE.Vector3|null|undefined} */ p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (!valid.length) return null;
  const vectors = /** @type {THREE.Vector3[]} */ (valid);
  const target = new THREE.Box3().setFromPoints(vectors).getCenter(new THREE.Vector3());
  const radius = Math.max(...vectors.map(p => p.distanceTo(target))) * 1.15;
  const ratio = Math.max(0.01, aspect);
  const vertical = THREE.MathUtils.degToRad(pose.fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * ratio);
  const distance = radius / Math.sin(Math.min(vertical, horizontal));
  const baseHeight = pose.ortho ? Math.max(10, 2 * radius / Math.min(1, ratio)) : Math.max(10, 2 * distance * Math.tan(vertical));
  const width = Math.max(1, viewport?.width ?? 1);
  const left = Math.max(0, viewport?.left ?? 0);
  const right = Math.max(0, viewport?.right ?? 0);
  const visible = Math.max(1, width - left - right);
  const height = baseHeight * width / visible;
  const angle = pose.azimuth ?? 0;
  const cameraRight = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
  target.addScaledVector(cameraRight, -(left - right) * height * ratio / (2 * width));
  return { target, height };
}
