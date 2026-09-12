/**
 * Per-material fog uniforms.
 *
 * `THREE.UniformsUtils.merge()` deep-clones *every* three object it finds,
 * including textures — which would silently detach a `DataTexture` we keep
 * writing to from the uniform the shader actually samples. These custom
 * shaders therefore build their fog block by hand (same shape as
 * `UniformsLib.fog`) and spread it into their own uniform object.
 */
import * as THREE from 'three';

export function fogUniforms() {
  return {
    fogDensity: { value: 0.00025 },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
    fogColor: { value: new THREE.Color(0xffffff) },
  };
}
