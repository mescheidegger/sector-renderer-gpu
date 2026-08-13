/**
 * Module: Public barrel for the GPU renderer package.
 *
 * Deliberate public package surface.
 */
export { SectorRenderer } from './SectorRenderer.js';
export { assertRendererWorld, assertRendererFrame } from './contracts.js';
export { assertTextureProvider, assertRendererTextureRecord } from './textureProvider.js';
export { DEFAULT_PROJECTION } from './webgl/resolveProjection.js';
