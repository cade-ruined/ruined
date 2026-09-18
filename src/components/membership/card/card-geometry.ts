import * as THREE from "three";

/** 63 × 88 mm card, in a world where one unit is 25 mm. */
export const CARD_PHYSICAL = { width: 2.52, height: 3.52, thickness: .032, radius: .108 } as const;

function seedValue(seed: string): number {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
}
function randomFrom(seed: string) {
  let value = Math.floor(seedValue(seed) * 4294967295);
  return () => { value |= 0; value = value + 0x6d2b79f5 | 0; let next = Math.imul(value ^ value >>> 15, 1 | value); next ^= next + Math.imul(next ^ next >>> 7, 61 | next); return ((next ^ next >>> 14) >>> 0) / 4294967296; };
}

/** A permanent shallow saddle and handled corner, not a rigid flat image. */
export function cardStockHeight(x: number, y: number, seed: string): number {
  const nx = x / (CARD_PHYSICAL.width / 2), ny = y / (CARD_PHYSICAL.height / 2);
  const variation = seedValue(seed);
  const bow = (.018 + variation * .011) * (nx * nx - .35);
  const twist = (.017 + variation * .01) * nx * ny;
  const curl = .018 * ny * ny * ny;
  const corner = .032 * Math.exp(-((nx - .94) ** 2 / .06 + (ny - .92) ** 2 / .09));
  return bow + twist + curl + corner;
}
function pointOnStock(x: number, y: number, offset: number, seed: string): THREE.Vector3 {
  const e = .001;
  const dx = (cardStockHeight(x + e, y, seed) - cardStockHeight(x - e, y, seed)) / (2 * e);
  const dy = (cardStockHeight(x, y + e, seed) - cardStockHeight(x, y - e, seed)) / (2 * e);
  const normal = new THREE.Vector3(-dx, -dy, 1).normalize();
  return new THREE.Vector3(x, y, cardStockHeight(x, y, seed)).addScaledVector(normal, offset);
}
function roundedRows() {
  const { height, radius } = CARD_PHYSICAL;
  const values: number[] = [];
  const half = height / 2;
  for (let i = 0; i < 12; i++) values.push(-half + radius - radius * Math.cos(i / 12 * Math.PI / 2));
  for (let i = 0; i <= 52; i++) values.push(-half + radius + (height - radius * 2) * i / 52);
  for (let i = 1; i <= 12; i++) values.push(half - radius + radius * Math.sin(i / 12 * Math.PI / 2));
  return values;
}
function halfWidthAt(y: number): number {
  const { width, height, radius } = CARD_PHYSICAL;
  const cornerDistance = Math.max(0, Math.abs(y) - (height / 2 - radius));
  return width / 2 - radius + Math.sqrt(Math.max(0, radius * radius - cornerDistance * cornerDistance));
}

export type MemberCardGeometry = { stock: THREE.BufferGeometry; fibers: THREE.BufferGeometry };

/** One closed indexed stock surface: front, readable reverse, and seven edge laminations. */
export function createMemberCardGeometry(seed = "ruined-card"): MemberCardGeometry {
  const { width, height, thickness } = CARD_PHYSICAL;
  const columns = 40, rows = roundedRows(), stride = columns + 1;
  const points: Array<[number, number]> = [];
  for (const y of rows) {
    const extent = halfWidthAt(y);
    for (let i = 0; i <= columns; i++) points.push([extent * (i / columns * 2 - 1), y]);
  }
  const perimeter: number[] = [];
  for (let i = 0; i <= columns; i++) perimeter.push(i);
  for (let j = 1; j < rows.length; j++) perimeter.push(j * stride + columns);
  for (let i = columns - 1; i >= 0; i--) perimeter.push((rows.length - 1) * stride + i);
  for (let j = rows.length - 2; j > 0; j--) perimeter.push(j * stride);
  const phase = seedValue(seed) * 47;
  function wear(x: number, y: number) {
    const detail = .0006 + .00065 * Math.sin(83 * x + phase) * Math.sin(109 * y - phase);
    const rub = .0011 * Math.max(0, Math.sin(x * 19 + y * 31 + phase)) ** 8;
    return detail + rub;
  }
  function contour(index: number, outer: boolean) {
    const [x, y] = points[index];
    const inset = outer ? 0 : .0028;
    // Taper boundary abrasion through adjacent rows, so the dense corner grid
    // cannot fold over itself when a worn edge moves farther than one row spacing.
    const edgeDistance = Math.max(0, Math.min(halfWidthAt(y) - Math.abs(x), height / 2 - Math.abs(y)));
    const abrasion = wear(x, y) * Math.exp(-edgeDistance / .028);
    return [x * (1 - (inset + abrasion) / (width / 2)), y * (1 - (inset + abrasion) / (height / 2))] as const;
  }
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const add = (point: THREE.Vector3, u: number, v: number, color?: THREE.Color) => {
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z); uvs.push(u, v);
    colors.push(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1); return index;
  };
  const frontIndices: number[] = [], backIndices: number[] = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < points.length; i++) {
      const [x, y] = contour(i, false);
      const [flatX, flatY] = points[i];
      const u = flatX / width + .5, v = flatY / height + .5;
      add(pointOnStock(x, y, side === 0 ? thickness / 2 : -thickness / 2, seed), side === 0 ? u : 1 - u, v);
    }
    const start = side * points.length;
    const output = side === 0 ? frontIndices : backIndices;
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < columns; i++) {
      const a = start + j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      if (side === 0) output.push(a, b, d, a, d, c);
      else output.push(a, d, b, a, c, d);
    }
  }
  indices.push(...frontIndices, ...backIndices);
  const edgeStart = positions.length / 3;
  const offsets = [.5, .36, .17, 0, -.17, -.36, -.5];
  const layerColors = ["#e2d6b9", "#cdbb99", "#b5a381", "#e1d1ac", "#b2a082", "#c5b38f", "#d6c8a6"];
  for (let layer = 0; layer < offsets.length; layer++) {
    for (let i = 0; i < perimeter.length; i++) {
      const index = perimeter[i];
      const [x, y] = contour(index, layer !== 0 && layer !== offsets.length - 1);
      const color = new THREE.Color(layerColors[layer]);
      const mottling = .88 + .12 * Math.sin(i * .63 + phase) * Math.sin(i * .27 - phase);
      color.multiplyScalar(mottling);
      add(pointOnStock(x, y, thickness * offsets[layer], seed), i / perimeter.length, layer / (offsets.length - 1), color);
    }
  }
  const edgeIndexStart = indices.length;
  for (let layer = 0; layer < offsets.length - 1; layer++) for (let i = 0; i < perimeter.length; i++) {
    const next = (i + 1) % perimeter.length;
    const a = edgeStart + layer * perimeter.length + i, b = edgeStart + layer * perimeter.length + next;
    const c = a + perimeter.length, d = b + perimeter.length;
    indices.push(a, c, b, b, c, d);
  }
  const stock = new THREE.BufferGeometry();
  stock.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  stock.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  stock.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  stock.setIndex(indices);
  stock.addGroup(0, frontIndices.length, 0); stock.addGroup(frontIndices.length, backIndices.length, 1);
  stock.addGroup(edgeIndexStart, indices.length - edgeIndexStart, 2);
  stock.computeVertexNormals(); stock.computeBoundingBox(); stock.computeBoundingSphere();

  // Isolated tiny paper fibers sit on the cut edge; no uniform saw-tooth border.
  const fiberPositions: number[] = [], fiberColors: number[] = [];
  const rnd = randomFrom(`${seed}:fibers`);
  for (let i = 0; i < 96; i++) {
    const edge = Math.floor(rnd() * perimeter.length);
    const index = perimeter[edge]; const [x, y] = contour(index, true);
    const offset = (rnd() - .5) * thickness * .8;
    const root = pointOnStock(x, y, offset, seed);
    const nextIndex = perimeter[(edge + 1) % perimeter.length]; const nextPoint = contour(nextIndex, true);
    const tangent = new THREE.Vector3(nextPoint[0] - x, nextPoint[1] - y, 0).normalize();
    const outward = new THREE.Vector3(tangent.y, -tangent.x, 0);
    const length = .002 + rnd() ** 2 * .007, breadth = .0005 + rnd() * .0012;
    const a = root.clone().addScaledVector(tangent, -breadth / 2);
    const b = root.clone().addScaledVector(tangent, breadth / 2);
    const tip = root.clone().addScaledVector(outward, length).addScaledVector(tangent, (rnd() - .5) * .007);
    tip.z += (rnd() - .5) * .002;
    fiberPositions.push(...a.toArray(), ...b.toArray(), ...tip.toArray());
    const color = new THREE.Color().setRGB(.57 + rnd() * .2, .5 + rnd() * .18, .36 + rnd() * .14);
    for (let vertex = 0; vertex < 3; vertex++) fiberColors.push(color.r, color.g, color.b);
  }
  const fibers = new THREE.BufferGeometry();
  fibers.setAttribute("position", new THREE.Float32BufferAttribute(fiberPositions, 3));
  fibers.setAttribute("color", new THREE.Float32BufferAttribute(fiberColors, 3)); fibers.computeVertexNormals();
  return { stock, fibers };
}
