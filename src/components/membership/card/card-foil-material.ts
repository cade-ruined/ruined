import * as THREE from "three";

export type CardFaceTextures = {
  color: THREE.Texture;
  roughness: THREE.Texture;
  bump: THREE.Texture;
  foilMask?: THREE.Texture | null;
};

/** Masked thin-film foil shares the exact printed face and its existing curvature. */
export function createCardFaceMaterial(textures: CardFaceTextures): THREE.MeshPhysicalMaterial {
  const foil = textures.foilMask ?? null;
  return new THREE.MeshPhysicalMaterial({
    map: textures.color,
    roughnessMap: textures.roughness,
    bumpMap: textures.bump,
    bumpScale: .0018,
    roughness: .83, ior: 1.46, alphaTest: .015,
    clearcoat: .24, clearcoatRoughness: .52,
    clearcoatRoughnessMap: textures.roughness,
    specularIntensity: .92, envMapIntensity: .86,
    sheen: .045, sheenRoughness: .9, sheenColor: new THREE.Color("#e6d5b4"),
    // Three samples metalness from B and iridescence strength from R. The
    // full-face grayscale leaf mask is zero on every surrounding paper pixel.
    // If a mask is unavailable, both effects remain completely disabled.
    metalness: foil ? .94 : 0,
    metalnessMap: foil,
    iridescence: foil ? .95 : 0,
    iridescenceMap: foil,
    iridescenceIOR: 1.5,
    // No thickness texture or clock: the installed physical shader derives the
    // reflected spectrum from viewing angle through this fixed thin coating.
    iridescenceThicknessRange: [280, 440],
  });
}
