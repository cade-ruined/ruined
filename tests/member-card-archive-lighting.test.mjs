import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import ts from "typescript";

async function load(name) {
  const source = await readFile(new URL(`../src/components/membership/card/${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => { assert.equal(name, "three"); return THREE; }, loaded, loaded.exports);
  return loaded.exports;
}
const { getArchiveLightLayout, archiveDustIllumination } = await load("archive-lighting");
const { archiveLampPosition, archiveFloorFootprint, createArchiveTableCalibration, projectArchiveShadow } = await load("archive-card-lighting");
const { createMemberCardGeometry } = await load("card-geometry");
const { CARD_CAMERA, CARD_REST_ROTATION: rest, cardBoundsCorners, cardGroundHeight, restingCardCameraDistance, requiredCardCameraDistance } = await load("card-framing");
const geometry = createMemberCardGeometry("archive-registration-check");
const corners = cardBoundsCorners([geometry.stock, geometry.fibers]), floorY = cardGroundHeight(corners);
const screens = [
  { width: 320, height: 568, rect: { left: 16, top: 86, width: 288, height: 365 } },
  { width: 390, height: 844, rect: { left: 16, top: 130, width: 358, height: 476 } },
  { width: 768, height: 1024, rect: { left: 30, top: 140, width: 708, height: 660 } },
  { width: 1024, height: 768, rect: { left: 122, top: 106, width: 780, height: 446 } },
  { width: 1440, height: 900, rect: { left: 330, top: 125, width: 780, height: 578 } },
];
function matrix({ x = 0, y = 0, z = .015, rx = rest.x, ry = rest.y, rz = rest.z } = {}) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
}
function setup(screen) {
  const layout = getArchiveLightLayout(screen.width, screen.height);
  const camera = new THREE.PerspectiveCamera(CARD_CAMERA.fov, screen.rect.width / screen.rect.height, CARD_CAMERA.near, CARD_CAMERA.far);
  const restingDistance = restingCardCameraDistance(corners, screen.rect);
  camera.position.set(0, CARD_CAMERA.y, restingDistance); camera.updateMatrixWorld();
  const lamp = archiveLampPosition(layout, screen.rect, camera, -floorY + .8);
  assert.ok(lamp);
  const calibration = createArchiveTableCalibration(corners, matrix(), lamp, screen.rect, layout, floorY);
  assert.ok(calibration);
  return { layout, camera, lamp, calibration, restingDistance };
}
function bounds(points) {
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}

test("photo landmarks use the exact source breakpoint and centered cover crop", () => {
  const wide = getArchiveLightLayout(1672, 941), tall = getArchiveLightLayout(941, 1672);
  assert.deepEqual(wide.pendant, { x: 606, y: 120 });
  assert.deepEqual(wide.table, { backY: 682, frontY: 874, pool: { x: 640, y: 754 } });
  assert.deepEqual(tall.pendant, { x: 235, y: 255 });
  assert.deepEqual(tall.table, { backY: 1225, frontY: 1515, pool: { x: 365, y: 1360 } });
  assert.equal(getArchiveLightLayout(800, 1000).portrait, true);
  assert.equal(getArchiveLightLayout(801, 1000).portrait, false);
  const scrollbarCrop = getArchiveLightLayout(795, 1000, false);
  assert.equal(scrollbarCrop.portrait, false, "the actual 810px media viewport selects landscape despite a 15px scrollbar");
  assert.ok(Math.abs(scrollbarCrop.pendant.x - ((795 - 1672 * 1000 / 941) / 2 + 606 * 1000 / 941)) < 1e-9);
  const phone = getArchiveLightLayout(390, 844), scale = 844 / 1672;
  assert.ok(Math.abs(phone.pendant.x - ((390 - 941 * scale) / 2 + 235 * scale)) < 1e-9);
  const wideCrop = getArchiveLightLayout(1920, 900), wideScale = 1920 / 1672;
  assert.ok(Math.abs(wideCrop.table.backY - ((900 - 941 * wideScale) / 2 + 682 * wideScale)) < 1e-9);
  assert.ok(Number.isFinite(getArchiveLightLayout(NaN, Infinity).table.frontY));
});

test("the registered overhead lamp projects back onto the photo through responsive fitted cameras and scrolling", () => {
  for (const screen of screens) for (const scroll of [0, 32, -80]) {
    const { layout, camera, restingDistance } = setup(screen);
    const rect = { ...screen.rect, top: screen.rect.top - scroll };
    for (const distance of [restingDistance, restingDistance + .6, restingDistance + 2]) {
      camera.position.z = distance; camera.updateMatrixWorld();
      const lamp = archiveLampPosition(layout, rect, camera, -floorY + .8);
      assert.ok(lamp);
      const projected = lamp.clone().project(camera);
      const px = rect.left + (projected.x + 1) * rect.width / 2, py = rect.top + (1 - projected.y) * rect.height / 2;
      assert.ok(Math.abs(px - layout.pendant.x) < 1e-7 && Math.abs(py - layout.pendant.y) < 1e-7);
      assert.ok(lamp.y > Math.max(...corners.map(p => p.length())) + .334 + .7, "lamp clears all drag orientations");
    }
  }
  const screen = screens[4], { layout, camera } = setup(screen);
  assert.equal(archiveLampPosition(layout, { ...screen.rect, top: -700 }, camera, 3.5), null, "an offscreen source below the optical horizon must not flip or explode");
});

test("dragged corners cast forward, collinear rays onto a table below all geometry", () => {
  for (const screen of screens) {
    const { layout, camera, restingDistance } = setup(screen);
    for (const yaw of [-Math.PI * 1.15, -Math.PI / 2, 0, Math.PI / 2, Math.PI, Math.PI * 2]) {
      for (const tilt of [-.62, 0, .62]) for (const translation of [-1, 1]) {
        const transform = matrix({ x: .34 * translation, y: .334 * translation, z: .39, rx: rest.x + tilt, ry: rest.y + yaw, rz: rest.z + .166 * translation });
        camera.position.z = Math.max(restingDistance, requiredCardCameraDistance(corners, transform, screen.rect)); camera.updateMatrixWorld();
        const lamp = archiveLampPosition(layout, screen.rect, camera, -floorY + .8);
        const footprint = archiveFloorFootprint(corners, transform, lamp, floorY);
        assert.equal(footprint.length, corners.length);
        footprint.forEach((shadow, i) => {
          const cardPoint = corners[i].clone().applyMatrix4(transform), incoming = cardPoint.clone().sub(lamp), outgoing = shadow.clone().sub(cardPoint);
          assert.ok(incoming.clone().cross(outgoing).length() < 1e-7);
          assert.ok(incoming.dot(outgoing) > 0);
          assert.equal(shadow.y, floorY);
          assert.ok(cardPoint.y > shadow.y + .13);
        });
      }
    }
  }
});

test("fixed tabletop calibration gives soft, finite shadows through extrema, edge-on flips and camera refitting", () => {
  for (const screen of screens) {
    const { layout, camera, lamp, calibration, restingDistance } = setup(screen);
    const baseline = projectArchiveShadow(corners, matrix(), lamp, calibration, layout), restBounds = bounds(baseline.points);
    assert.ok(restBounds.top > layout.table.backY && restBounds.bottom < layout.table.frontY);
    assert.ok(restBounds.right - restBounds.left < screen.width * .5);
    for (let i = 0; i <= 160; i++) {
      const transform = matrix({ x: .34 * Math.sin(i), y: .334 * Math.cos(i), z: .39, rx: rest.x + .62 * Math.sin(i * .61), ry: rest.y + i / 160 * Math.PI * 4, rz: rest.z + .166 * Math.cos(i * .7) });
      camera.position.z = Math.max(restingDistance, requiredCardCameraDistance(corners, transform, screen.rect)); camera.updateMatrixWorld();
      const movingLamp = archiveLampPosition(layout, screen.rect, camera, -floorY + .8);
      const shadow = projectArchiveShadow(corners, transform, movingLamp, calibration, layout);
      assert.ok(shadow, `${screen.width}px frame ${i}`);
      assert.ok(shadow.points.length >= 3 && shadow.points.length <= 8);
      assert.ok(shadow.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
      assert.equal(shadow.clipTop, layout.table.backY); assert.equal(shadow.clipBottom, layout.table.frontY);
      assert.ok(shadow.opacity > 0 && shadow.opacity <= .14 && shadow.blur >= 8 && shadow.blur < 28);
    }
    const left = bounds(projectArchiveShadow(corners, matrix({ x: -.34 }), lamp, calibration, layout).points);
    const right = bounds(projectArchiveShadow(corners, matrix({ x: .34 }), lamp, calibration, layout).points);
    assert.ok(right.left > left.left + 2, "a fixed calibration preserves drag movement instead of pinning/recentering the shadow");
  }
});

test("dust shares the lamp and pool while room fill keeps it visible outside the cone", () => {
  for (const screen of screens) {
    const layout = getArchiveLightLayout(screen.width, screen.height);
    const middle = { x: (layout.pendant.x + layout.table.pool.x) / 2, y: (layout.pendant.y + layout.table.pool.y) / 2 };
    const lit = archiveDustIllumination(middle.x, middle.y, layout);
    assert.ok(lit > .75);
    const unlit = [
      archiveDustIllumination(middle.x + screen.width, middle.y, layout),
      archiveDustIllumination(layout.pendant.x, layout.pendant.y - screen.height * .2, layout),
      archiveDustIllumination(layout.table.pool.x, layout.table.frontY + screen.height * .2, layout),
    ];
    for (const fill of unlit) {
      assert.ok(fill >= .12 && fill < .25, "room fill stays visible without flattening the beam");
      assert.ok(lit > fill * 4, "the registered pendant remains the stronger source");
    }
  }
});

test.after(() => { geometry.stock.dispose(); geometry.fibers.dispose(); });
