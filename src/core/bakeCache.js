// GPU bakes (leaf / needle atlases, impostor atlases) kept as RGBA8 texels in the IndexedDB cache
// (core/cache.js). Besides the bake time, this keeps their big one-off shaders out of later loads:
// with them the browser's shader cache overflowed and every load recompiled all the pipelines
// (the precompile of main.js hit its 12 s limit), see tools/pipeprobe.mjs.
import * as THREE from 'three/webgpu';

// square RGBA8 render target, mipmapped, raw data (no colour space)
export function bakeTarget( size, name, { depthBuffer = false, anisotropy = 1 } = {} ) {
	const rt = new THREE.RenderTarget( size, size, {
		type: THREE.UnsignedByteType, depthBuffer, generateMipmaps: true,
		minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
	} );
	rt.texture.name = name;
	rt.texture.colorSpace = THREE.NoColorSpace;
	rt.texture.anisotropy = anisotropy;
	return rt;
}

// the same texture from cached texels (render targets and data textures share the row order)
export function textureFromData( data, size, name, { anisotropy = 1 } = {} ) {
	const t = new THREE.DataTexture( data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType );
	t.name = name;
	t.colorSpace = THREE.NoColorSpace;
	t.generateMipmaps = true;
	t.minFilter = THREE.LinearMipmapLinearFilter;
	t.magFilter = THREE.LinearFilter;
	t.anisotropy = anisotropy;
	t.needsUpdate = true;
	return t;
}

export async function readTarget( renderer, rt ) {
	const px = await renderer.readRenderTargetPixelsAsync( rt, 0, 0, rt.width, rt.height );
	return new Uint8Array( px.buffer, px.byteOffset, rt.width * rt.height * 4 ).slice();
}
