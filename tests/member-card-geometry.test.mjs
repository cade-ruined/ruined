import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import ts from "typescript";

const source = await readFile(new URL("../src/components/membership/card/card-geometry.ts", import.meta.url), "utf8");
const loaded = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("require", "module", "exports", compiled)(name => { assert.equal(name, "three"); return THREE; }, loaded, loaded.exports);
const { createMemberCardGeometry, CARD_PHYSICAL } = loaded.exports;

function point(attribute, index) { return new THREE.Vector3().fromBufferAttribute(attribute, index); }
function weldedTopology(geometry) {
  const positions = geometry.getAttribute("position"), indices = geometry.getIndex();
  const coordinates = new Map(), weld = [];
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(value => Math.round(value * 1e6)).join(":");
    if (!coordinates.has(key)) coordinates.set(key, coordinates.size);
    weld.push(coordinates.get(key));
  }
  const edges = new Map(), adjacency = new Map(); let degenerate = 0, volume = 0;
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    const [a, b, c] = vertices.map(index => point(positions, index));
    const cross = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (cross.length() < 1e-10) degenerate++;
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    for (let j = 0; j < 3; j++) {
      const u = weld[vertices[j]], v = weld[vertices[(j + 1) % 3]], key = [u, v].sort((x, y) => x - y).join(":");
      edges.set(key, (edges.get(key) ?? 0) + 1);
      if (!adjacency.has(u)) adjacency.set(u, new Set());
      if (!adjacency.has(v)) adjacency.set(v, new Set());
      adjacency.get(u).add(v); adjacency.get(v).add(u);
    }
  }
  const visited = new Set(); let components = 0;
  for (const vertex of adjacency.keys()) {
    if (visited.has(vertex)) continue;
    components++; const pending = [vertex];
    while (pending.length) { const next = pending.pop(); if (visited.has(next)) continue; visited.add(next); for (const adjacent of adjacency.get(next)) pending.push(adjacent); }
  }
  return { edges, components, degenerate, volume };
}

test("worn cardstock is one closed curved solid with finite faces and realistic dimensions", () => {
  const { stock, fibers } = createMemberCardGeometry("physical-member-card");
  try {
    for (const geometry of [stock, fibers]) for (const attribute of Object.values(geometry.attributes)) {
      assert.ok([...attribute.array].every(Number.isFinite), "all generated positions, colors, normals and UVs are finite");
    }
    assert.equal(stock.groups.length, 3);
    assert.ok(stock.getIndex().count / 3 < 18000, "the physical card stays within a modest scene budget");
    const topology = weldedTopology(stock);
    assert.equal(topology.degenerate, 0); assert.equal(topology.components, 1);
    assert.ok([...topology.edges.values()].every(count => count === 2), "front, back and bevel share every geometric boundary exactly twice");
    const nominalVolume = CARD_PHYSICAL.width * CARD_PHYSICAL.height * CARD_PHYSICAL.thickness;
    assert.ok(topology.volume > nominalVolume * .97 && topology.volume < nominalVolume * 1.01, `outward solid volume agrees with the stock dimensions: ${topology.volume}`);
    const size = stock.boundingBox.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - CARD_PHYSICAL.width) < .02); assert.ok(Math.abs(size.y - CARD_PHYSICAL.height) < .02);
    assert.ok(size.z > .06 && size.z < .18, `visible but restrained bow/corner curl ${size.z}`);
    assert.equal(fibers.getAttribute("position").count, 96 * 3);
  } finally { stock.dispose(); fibers.dispose(); }
});

test("the printed front and reverse stay readable on the same bent stock without mirror transforms", () => {
  const { stock, fibers } = createMemberCardGeometry("uv-registration");
  try {
    const positions = stock.getAttribute("position"), uv = stock.getAttribute("uv"), indices = stock.getIndex();
    const frontVertices = new Set(), backVertices = new Set();
    for (const [groupIndex, group] of stock.groups.slice(0, 2).entries()) {
      const visited = groupIndex === 0 ? frontVertices : backVertices;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
        for (const vertex of [a, b, c]) visited.add(vertex);
        const signedUV = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
        assert.ok(signedUV > 0, "both visible faces preserve artwork handedness");
        const normal = point(positions, b).sub(point(positions, a)).cross(point(positions, c).sub(point(positions, a)));
        assert.ok(groupIndex === 0 ? normal.z > 0 : normal.z < 0, "front/back winding faces outward");
      }
    }
    assert.equal(frontVertices.size, backVertices.size);
    const front = [...frontVertices].sort((a, b) => a - b), back = [...backVertices].sort((a, b) => a - b);
    for (let i = 0; i < front.length; i++) {
      assert.ok(Math.abs(point(positions, front[i]).distanceTo(point(positions, back[i])) - CARD_PHYSICAL.thickness) < 1e-6, "paired faces maintain actual cardstock thickness around the curve");
      assert.ok(Math.abs(uv.getX(front[i]) + uv.getX(back[i]) - 1) < 1e-6);
      assert.equal(uv.getY(front[i]), uv.getY(back[i]));
    }
  } finally { stock.dispose(); fibers.dispose(); }
});

test("member wear is deterministic and survives repeat visits without regenerating a different object", () => {
  const first = createMemberCardGeometry("one-member"), same = createMemberCardGeometry("one-member"), other = createMemberCardGeometry("another-member");
  try {
    assert.deepEqual(first.stock.getAttribute("position").array, same.stock.getAttribute("position").array);
    assert.deepEqual(first.fibers.getAttribute("position").array, same.fibers.getAttribute("position").array);
    assert.notDeepEqual(first.stock.getAttribute("position").array, other.stock.getAttribute("position").array);
    assert.notDeepEqual(first.stock.getAttribute("color").array, other.stock.getAttribute("color").array);
  } finally { for (const card of [first, same, other]) { card.stock.dispose(); card.fibers.dispose(); } }
});
