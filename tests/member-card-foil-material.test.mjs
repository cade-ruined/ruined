import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import ts from "typescript";

const source = await readFile(new URL("../src/components/membership/card/card-foil-material.ts", import.meta.url), "utf8");
const loaded = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function("require", "module", "exports", compiled)(name => { assert.equal(name, "three"); return THREE; }, loaded, loaded.exports);
const { createCardFaceMaterial } = loaded.exports;
function maps() {
  const color = new THREE.Texture(), roughness = new THREE.Texture(), bump = new THREE.Texture();
  color.colorSpace = THREE.SRGBColorSpace;
  return { color, roughness, bump };
}

test("the installed physical shader uses the agreed RGB mask channels and the real viewing angle", () => {
  assert.match(THREE.ShaderChunk.lights_physical_fragment, /material\.iridescence\s*\*=\s*texture2D\( iridescenceMap, vIridescenceMapUv \)\.r/);
  assert.match(THREE.ShaderChunk.metalnessmap_fragment, /metalnessFactor\s*\*=\s*texelMetalness\.b/);
  assert.match(THREE.ShaderChunk.lights_physical_fragment, /texture2D\( iridescenceThicknessMap, vIridescenceThicknessMapUv \)\.g/);
  assert.match(THREE.ShaderChunk.lights_fragment_begin, /dot\( normal, geometryViewDir \)/);
  assert.match(THREE.ShaderChunk.lights_fragment_begin, /evalIridescence\( 1\.0, material\.iridescenceIOR, dotNVi,/);
});

test("foil occupies only the exact mask coverage; surrounding ink remains ordinary paper", () => {
  const base = maps();
  // Outside, quarter-covered SVG boundary, opaque leaf: RGB stores coverage,
  // unlike transparent white whose red/blue would falsely enable the effect.
  const pixels = new Uint8Array([0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255]);
  const mask = new THREE.DataTexture(pixels, 3, 1, THREE.RGBAFormat);
  mask.colorSpace = THREE.NoColorSpace; mask.flipY = true;
  const face = createCardFaceMaterial({ ...base, foilMask: mask });
  try {
    assert.equal(face.isMeshPhysicalMaterial, true);
    assert.equal(face.iridescenceMap, mask); assert.equal(face.metalnessMap, mask);
    assert.equal(face.map, base.color); assert.equal(face.roughnessMap, base.roughness); assert.equal(face.bumpMap, base.bump);
    assert.equal(face.iridescenceMap.colorSpace, THREE.NoColorSpace);
    assert.equal(face.iridescenceMap.channel, 0); assert.deepEqual(face.iridescenceMap.repeat.toArray(), [1, 1]);
    assert.equal(face.iridescenceMap.flipY, true, "material assignment must not invert the face's existing UV registration");
    assert.equal(face.metalness * pixels[2] / 255, 0); assert.equal(face.iridescence * pixels[0] / 255, 0);
    assert.ok(face.metalness * pixels[6] / 255 > 0 && face.metalness * pixels[6] / 255 < face.metalness);
    assert.equal(face.metalness * pixels[10] / 255, .94); assert.equal(face.iridescence * pixels[8] / 255, .95);
    assert.equal(face.iridescenceThicknessMap, null); assert.deepEqual(face.iridescenceThicknessRange, [280, 440]);
    assert.equal(face.emissive.getHex(), 0, "foil reflects light rather than glowing");
    assert.equal(face.transparent, false); assert.equal(face.alphaTest, .015);
  } finally { face.dispose(); mask.dispose(); Object.values(base).forEach(texture => texture.dispose()); }
});

test("missing masks disable all foil effects and both faces retain the approved paper material", () => {
  const frontTextures = maps(), backTextures = maps();
  const front = createCardFaceMaterial(frontTextures), back = createCardFaceMaterial(backTextures);
  try {
    for (const face of [front, back]) {
      assert.equal(face.metalness, 0); assert.equal(face.iridescence, 0);
      assert.equal(face.metalnessMap, null); assert.equal(face.iridescenceMap, null);
      assert.equal(face.roughness, .83); assert.equal(face.bumpScale, .0018);
      assert.equal(face.clearcoat, .24); assert.equal(face.specularIntensity, .92); assert.equal(face.envMapIntensity, .86);
    }
  } finally { front.dispose(); back.dispose(); [...Object.values(frontTextures), ...Object.values(backTextures)].forEach(texture => texture.dispose()); }
});
