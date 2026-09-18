import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import ts from "typescript";

async function load(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => { assert.equal(name, "three"); return THREE; }, loaded, loaded.exports);
  return loaded.exports;
}
const geometryModule = await load("src/components/membership/card/card-geometry.ts");
const framing = await load("src/components/membership/card/card-framing.ts");
const { CARD_CAMERA, CARD_REST_ROTATION: rest, cardBoundsCorners, cardFrameLimits, requiredCardCameraDistance, restingCardCameraDistance, nextCardCameraDistance, cardGroundHeight } = framing;
const geometry = geometryModule.createMemberCardGeometry("fit-the-real-worn-card");
const corners = cardBoundsCorners([geometry.stock, geometry.fibers]);
const allPositions = [geometry.stock, geometry.fibers].map(shape => shape.getAttribute("position"));
const viewports = [
  { name: "320px phone", width: 288, height: 390 },
  { name: "390px phone", width: 358, height: 476 },
  { name: "narrow owner panel", width: 260, height: 390 },
  { name: "tall narrow owner panel", width: 260, height: 700 },
  { name: "tablet portrait", width: 420, height: 620 },
  { name: "tablet landscape", width: 540, height: 700 },
  { name: "desktop", width: 780, height: 560 },
];
function transform({ x = 0, y = 0, z = .015, rx = rest.x, ry = rest.y, rz = rest.z } = {}) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
}
function cameraFor(viewport, distance) {
  const camera = new THREE.PerspectiveCamera(CARD_CAMERA.fov, viewport.width / viewport.height, CARD_CAMERA.near, CARD_CAMERA.far);
  camera.position.set(0, CARD_CAMERA.y, distance); camera.updateMatrixWorld(); return camera;
}
function projectionBounds(matrix, camera, actualVertices = true) {
  const combined = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(matrix);
  const point = new THREE.Vector3();
  const result = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const project = () => {
    point.applyMatrix4(combined);
    result.minX = Math.min(result.minX, point.x); result.maxX = Math.max(result.maxX, point.x);
    result.minY = Math.min(result.minY, point.y); result.maxY = Math.max(result.maxY, point.y);
    result.minZ = Math.min(result.minZ, point.z); result.maxZ = Math.max(result.maxZ, point.z);
  };
  if (actualVertices) for (const positions of allPositions) for (let i = 0; i < positions.count; i++) { point.fromBufferAttribute(positions, i); project(); }
  else for (const corner of corners) { point.copy(corner); project(); }
  return result;
}
function assertFits(bounds, viewport, label) {
  const limit = cardFrameLimits(viewport), epsilon = 1e-6;
  assert.ok(bounds.minX >= limit.left - epsilon && bounds.maxX <= limit.right + epsilon && bounds.minY >= limit.bottom - epsilon && bounds.maxY <= limit.top + epsilon,
    `${label}: actual stock and fibers exceed reserved canvas inset: ${JSON.stringify(bounds)}`);
  assert.ok(bounds.minZ > -1 && bounds.maxZ < 1, `${label}: near/far clipping`);
}

test("fixed camera reproduces narrow-panel and drag clipping; responsive rest remains comfortably large", () => {
  const viewport = viewports[3];
  const oldBounds = projectionBounds(transform(), cameraFor(viewport, 8.1));
  assert.ok(oldBounds.minX < -1 || oldBounds.maxX > 1, "the previous fixed distance crops the real card in a narrow tall canvas");
  const dragged = transform({ x: .34, y: -.32, z: .39, rx: rest.x + .62, ry: rest.y + .7, rz: rest.z - .16 });
  const oldDrag = projectionBounds(dragged, cameraFor(viewports[2], 8.1));
  assert.ok(oldDrag.minX < -1 || oldDrag.maxX > 1 || oldDrag.minY < -1 || oldDrag.maxY > 1, "the previous fixed distance also crops a held tilted corner");
  for (const stage of viewports) {
    const distance = restingCardCameraDistance(corners, stage);
    const bounds = projectionBounds(transform(), cameraFor(stage, distance));
    assertFits(bounds, stage, stage.name);
    const occupancy = Math.max((bounds.maxX - bounds.minX) / 2, (bounds.maxY - bounds.minY) / 2);
    assert.ok(occupancy > .74 && occupancy < .94, `${stage.name}: resting card should use the available shorter dimension well (${occupancy})`);
  }
});

test("actual warped stock and every fiber stay inside the canvas through drag extrema and both faces", () => {
  const states = [];
  for (const rx of [rest.x - .62 - .012, rest.x, rest.x + .62 + .012]) {
    for (const yaw of [-Math.PI * 1.15, -Math.PI, -Math.PI / 2, -.5, 0, .5, Math.PI / 2, Math.PI, Math.PI * 1.15]) {
      for (const rz of [rest.z - .166, rest.z + .166]) {
        for (const [x, y] of [[-.34, -.334], [-.34, .334], [.34, -.334], [.34, .334]]) {
          states.push(transform({ x, y, z: .39, rx, ry: rest.y + yaw, rz }));
          states.push(transform({ x, y, z: .015, rx, ry: rest.y + Math.PI + yaw, rz }));
        }
      }
    }
  }
  for (const viewport of viewports) {
    const baseline = restingCardCameraDistance(corners, viewport);
    states.forEach((matrix, index) => {
      const required = requiredCardCameraDistance(corners, matrix, viewport);
      const distance = nextCardCameraDistance(8.1, required, baseline, 1 / 60);
      assertFits(projectionBounds(matrix, cameraFor(viewport, distance)), viewport, `${viewport.name}, drag ${index}`);
    });
  }
});

test("every rendered interpolation frame fits during lift, a full flip, release and a narrower resize", () => {
  let viewport = viewports[6], distance = 8.1;
  let state = { x: 0, y: 0, z: .015, rx: rest.x, ry: rest.y, rz: rest.z };
  for (let frame = 0; frame < 260; frame++) {
    if (frame === 75) viewport = viewports[3];
    if (frame === 170) viewport = viewports[1];
    const held = frame < 140;
    const target = held
      ? { x: .34, y: -.32, z: .39, rx: rest.x + .62, ry: rest.y + Math.PI * 1.15, rz: rest.z + .16 }
      : { x: 0, y: 0, z: .015, rx: rest.x, ry: rest.y + Math.PI, rz: rest.z };
    const factor = 1 - Math.exp(-1 / 60 * (held ? 18 : 9));
    state = Object.fromEntries(Object.keys(state).map(key => [key, THREE.MathUtils.lerp(state[key], target[key], factor)]));
    const matrix = transform(state), required = requiredCardCameraDistance(corners, matrix, viewport);
    distance = nextCardCameraDistance(distance, required, restingCardCameraDistance(corners, viewport), 1 / 60, frame > 0);
    assertFits(projectionBounds(matrix, cameraFor(viewport, distance)), viewport, `interpolated frame ${frame}`);
  }
  for (let frame = 0; frame <= 70; frame++) {
    const matrix = transform({ ry: rest.y - Math.PI * 2 * (1 - frame / 70) });
    const required = requiredCardCameraDistance(corners, matrix, viewports[2]);
    const distance = Math.max(required, restingCardCameraDistance(corners, viewports[2]));
    assertFits(projectionBounds(matrix, cameraFor(viewports[2], distance)), viewports[2], `intro ${frame}`);
  }
});

test("decorative ground sits below every orientation in the full translation envelope", () => {
  const floor = cardGroundHeight(corners);
  const radius = Math.max(...corners.map(corner => corner.length()));
  assert.ok(floor < -radius - .334 - .139);
  const oldFloor = -2.07;
  let lowest = Infinity;
  for (let i = 0; i <= 120; i++) {
    const matrix = transform({ y: -.334, rx: rest.x + .62 * Math.sin(i), ry: i / 120 * Math.PI * 2, rz: rest.z - .166 });
    for (const corner of corners) lowest = Math.min(lowest, corner.clone().applyMatrix4(matrix).y);
  }
  assert.ok(lowest < oldFloor, "old shadow plane intersected the dragged-card envelope");
  assert.ok(lowest > floor + .139);
});

test.after(() => { geometry.stock.dispose(); geometry.fibers.dispose(); });
