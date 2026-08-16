/**
 * Renderer-owned public contracts. Coordinates are world units and angles are radians.
 * @typedef {string|number} RendererId
 * @typedef {Object} RendererVertex
 * @property {number} x Horizontal X coordinate.
 * @property {number} y Horizontal Y coordinate.
 * @typedef {Object} RendererWall
 * @property {number} a Index of the wall's first vertex.
 * @property {number} b Index of the wall's second vertex.
 * @property {string|null} [material] TextureProvider key; null/omitted uses flat color.
 * @property {number} [color=0xffffff] RGB fallback tint encoded as 0xRRGGBB.
 * @property {RendererId|null} [portalTo] Exact ID of the sector behind this wall.
 * @property {number} [uvScale] Positive world units per horizontal texture repeat.
 * @typedef {Object} RendererSector
 * @property {RendererId} id Unique ID (also unique after String(id)).
 * @property {RendererVertex[]} vertices Ordered vertices of a simple polygon.
 * @property {RendererWall[]} walls Boundary wall spans referencing vertices.
 * @property {number} floor Floor Z coordinate.
 * @property {number} ceil Ceiling Z coordinate.
 * @property {string|null} [floorMaterial] TextureProvider key.
 * @property {string|null} [ceilingMaterial] TextureProvider key.
 * @property {number} [floorColor] RGB fallback color encoded as 0xRRGGBB.
 * @property {number} [ceilColor] RGB fallback color encoded as 0xRRGGBB.
 * @property {number} [lightLevel=1] Values in 0..1 are direct brightness scalars; values above 1 use a 0..255 scale. The result is clamped to 0..1, and non-finite values default to 1.
 * @property {RendererId|null} [parentSectorId] Advanced nested-sector surface relationship.
 * @typedef {Object} WallRef
 * @property {RendererId} sectorId Exact sector ID.
 * @property {number} wallIndex Zero-based index into that sector's walls.
 * @typedef {Object} PortalOpening
 * @property {WallRef} wallRef Portal wall to decorate/constrain.
 * @property {number} [bottomZ] Opening lower bound.
 * @property {number} [topZ] Opening upper bound.
 * @property {string|null} [trimMaterial] TextureProvider key for side trim.
 * @typedef {Object} SectorRenderWorld
 * @property {RendererSector[]} sectors
 * @property {RendererId[]} [dynamicSectorIds=[]]
 * @property {PortalOpening[]} [portalOpenings=[]]
 * @typedef {{x:number,y:number,z:number,yaw:number}} RendererCamera
 * @typedef {{textureKey:string,x:number,y:number,z:number,width?:number,height?:number,size?:number,anchor?:'center'|'floor',opacity?:number,order?:number,flipX?:boolean,flipV?:boolean}} RendererSprite
 * @typedef {Object} RendererWorldQuad
 * @property {[number[],number[],number[],number[]]} corners Four world-space corners in top-left, top-right, bottom-right, bottom-left order.
 * @property {string} textureKey TextureProvider key.
 * @property {number} [opacity=1] Opacity scalar.
 * @property {number} [lightLevel=1] Values in 0..1 are direct brightness scalars; values above 1 use a 0..255 scale. The result is clamped to 0..1, and non-finite values default to 1.
 * @property {[number[],number[],number[],number[]]} [uvs] Four normalized uploaded-image texture coordinates.
 * @property {boolean} [flipX=false] Reverse horizontal texture sampling.
 * @property {boolean} [flipV=false] Reverse vertical texture sampling.
 * @typedef {{textureKey:string,anchorX:number,anchorY:number,offsetX?:number,offsetY?:number,width:number,height:number,pivotX?:number,pivotY?:number,rotation?:number,opacity?:number,order?:number}} RendererOverlay
 * @typedef {{camera:RendererCamera,sprites?:RendererSprite[],worldQuads?:RendererWorldQuad[],overlays?:RendererOverlay[]}} RendererFrame
 * @typedef {{fovY?:number,near?:number,far?:number}} RendererProjection
 * @typedef {{enabled?:boolean,targetSeamKey?:string,targetWallRef?:WallRef}} RendererSeamDebugOptions
 * @typedef {{seam?:RendererSeamDebugOptions}} RendererDebugOptions
 * @typedef {import('./textureProvider.js').TextureProvider} TextureProvider
 * @typedef {{world:SectorRenderWorld,canvas?:HTMLCanvasElement,container?:HTMLElement,width?:number,height?:number,pixelRatio?:number,projection?:RendererProjection,textureProvider:TextureProvider,debug?:RendererDebugOptions}} SectorRendererOptions
 */

const fail = (message) => { throw new TypeError(`[SectorRenderer] ${message}`); };
const normalizedId = (id) => String(id);
const isRendererId = (id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
const assertRendererId = (id, label) => {
  if (!isRendererId(id)) fail(`${label} must be a string or finite number.`);
};
const assertMaterialKey = (value, label) => {
  if (value != null && (typeof value !== 'string' || value.length === 0)) fail(`${label} must be a non-empty string or null.`);
};

/**
 * Validates the public world shape and cross-references, then returns the same object.
 * This intentionally does not prove polygon topology or geometric correctness.
 * @param {SectorRenderWorld} world
 * @returns {SectorRenderWorld}
 * @throws {TypeError} When a checked API-shape or reference invariant is invalid.
 */
export function assertRendererWorld(world) {
  if (!world || typeof world !== 'object') fail('Renderer world must be an object.');
  if (!Array.isArray(world.sectors)) fail('Renderer world sectors must be an array.');
  const sectorById = new Map();
  const normalizedSectorIds = new Set();
  world.sectors.forEach((sector, index) => {
    if (!sector || typeof sector !== 'object') fail(`Sector at index ${index} must be an object.`);
    assertRendererId(sector.id, `Sector at index ${index} id`);
    if (!Array.isArray(sector.vertices)) fail(`Sector "${sector.id}" vertices must be an array.`);
    if (sector.vertices.length < 3) fail(`Sector "${sector.id}" must contain at least 3 vertices.`);
    if (!Array.isArray(sector.walls)) fail(`Sector "${sector.id}" walls must be an array.`);
    const key = normalizedId(sector.id);
    if (normalizedSectorIds.has(key)) fail(`Sector id "${key}" is duplicate or collides after string conversion.`);
    normalizedSectorIds.add(key);
    sectorById.set(sector.id, sector);
    sector.vertices.forEach((vertex, vertexIndex) => {
      if (!vertex || typeof vertex !== 'object' || Array.isArray(vertex)) fail(`Sector "${key}" vertex ${vertexIndex} must be an object.`);
      if (!Number.isFinite(vertex.x)) fail(`Sector "${key}" vertex ${vertexIndex} x must be finite.`);
      if (!Number.isFinite(vertex.y)) fail(`Sector "${key}" vertex ${vertexIndex} y must be finite.`);
    });
    if (!Number.isFinite(sector.floor)) fail(`Sector "${key}" floor must be finite.`);
    if (!Number.isFinite(sector.ceil)) fail(`Sector "${key}" ceil must be finite.`);
    if (sector.ceil <= sector.floor) fail(`Sector "${key}" ceil must be greater than floor.`);
    assertMaterialKey(sector.floorMaterial, `Sector "${key}" floorMaterial`);
    assertMaterialKey(sector.ceilingMaterial, `Sector "${key}" ceilingMaterial`);
    sector.walls.forEach((wall, wallIndex) => {
      for (const endpoint of ['a', 'b']) {
        const vertexIndex = wall?.[endpoint];
        if (!Number.isInteger(vertexIndex)) fail(`Sector "${key}" wall ${wallIndex} ${endpoint} must be an integer vertex index.`);
        if (vertexIndex < 0 || vertexIndex >= sector.vertices.length) {
          fail(`Sector "${key}" wall ${wallIndex} references vertex ${vertexIndex}, but only ${sector.vertices.length} vertices exist.`);
        }
      }
      if (wall.a === wall.b) fail(`Sector "${key}" wall ${wallIndex} must reference two different vertices.`);
      assertMaterialKey(wall.material, `Sector "${key}" wall ${wallIndex} material`);
    });
  });
  world.sectors.forEach((sector) => {
    const sectorKey = normalizedId(sector.id);
    if (sector.parentSectorId != null) {
      assertRendererId(sector.parentSectorId, `Sector "${sectorKey}" parentSectorId`);
      if (!sectorById.has(sector.parentSectorId)) {
        fail(`Sector "${sectorKey}" parentSectorId references unknown sector "${normalizedId(sector.parentSectorId)}".`);
      }
    }
    sector.walls.forEach((wall, wallIndex) => {
      if (wall.portalTo == null) return;
      assertRendererId(wall.portalTo, `Sector "${sectorKey}" wall ${wallIndex} portalTo`);
      if (!sectorById.has(wall.portalTo)) {
        fail(`Sector "${sectorKey}" wall ${wallIndex} portalTo references unknown sector "${normalizedId(wall.portalTo)}".`);
      }
    });
  });
  if (world.dynamicSectorIds != null && !Array.isArray(world.dynamicSectorIds)) fail('dynamicSectorIds must be an array.');
  const dynamic = new Set();
  for (const id of world.dynamicSectorIds ?? []) {
    if (id == null) fail('dynamicSectorIds may not contain null IDs.');
    if (!sectorById.has(id)) fail(`Unknown dynamic sector id "${String(id)}".`);
    if (dynamic.has(id)) fail(`Duplicate dynamic sector id "${String(id)}".`);
    dynamic.add(id);
  }
  if (world.portalOpenings != null && !Array.isArray(world.portalOpenings)) fail('portalOpenings must be an array.');
  const refs = new Set();
  (world.portalOpenings ?? []).forEach((opening, index) => {
    const ref = opening?.wallRef;
    if (!ref || ref.sectorId == null || !Number.isInteger(ref.wallIndex) || ref.wallIndex < 0) fail(`Portal opening at index ${index} has an invalid wallRef.`);
    const sector = sectorById.get(ref.sectorId);
    if (!sector) fail(`Portal opening at index ${index} references unknown sector "${ref.sectorId}".`);
    if (ref.wallIndex >= sector.walls.length) fail(`Portal opening at index ${index} wall index ${ref.wallIndex} is out of range.`);
    const key = `${normalizedId(ref.sectorId)}:${ref.wallIndex}`;
    if (refs.has(key)) fail(`Duplicate portal opening wallRef "${key}".`);
    refs.add(key);
    assertMaterialKey(opening.trimMaterial, `Portal opening at index ${index} trimMaterial`);
  });
  return world;
}

/**
 * Validates the shallow per-frame public boundary and returns the same object.
 * @param {RendererFrame} frame
 * @returns {RendererFrame}
 * @throws {TypeError} When the camera or optional collection shapes are invalid.
 */
export function assertRendererFrame(frame) {
  if (!frame || typeof frame !== 'object') fail('Renderer frame must be an object.');
  if (!frame.camera || typeof frame.camera !== 'object') fail('Renderer frame requires a camera.');
  for (const key of ['x', 'y', 'z', 'yaw']) if (!Number.isFinite(frame.camera[key])) fail(`Camera ${key} must be a finite number.`);
  for (const key of ['sprites', 'worldQuads', 'overlays']) if (frame[key] != null && !Array.isArray(frame[key])) fail(`${key} must be an array.`);
  return frame;
}
