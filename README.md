# sector-renderer-gpu

A small browser/WebGL renderer for sector-authored, 2.5D retro-FPS-style worlds.

The package turns sector polygons into static floors, ceilings, and walls, then presents camera-facing sprites, arbitrary world quads, and screen overlays each frame. It is asset-loader agnostic and contains no assumptions about gameplay, input, physics, or simulation.

## Features

- Static sector geometry with textured or flat-colored walls, floors, and ceilings
- Height-aware portals between neighboring sectors
- Camera-facing sprites, caller-generated world quads, and screen overlays
- Caller-owned textures, including atlas regions for dynamic presentation that share one GPU upload
- World replacement, viewport resizing, diagnostics, and optional seam debugging
- Plain JavaScript API with public JSDoc; no TypeScript or runtime dependencies

## What this package is—and is not

This is the rendering layer of an engine. The caller owns the application loop and supplies a render-ready world plus every frame's camera and presentation objects. World distances have no prescribed real-world scale.

It intentionally does **not** provide a game loop, player controller, physics/collision, AI, gameplay entities, map editor or authoring DSL, asset loading, audio, or input handling. It is not a Node/headless renderer and does not support server-side rendering (SSR).

## Installation

```sh
npm install sector-renderer-gpu
```

## Quick Start: Hello Room

This complete browser module creates a canvas, generates its own checker texture, builds a rectangular room, and renders it. The vertices are counter-clockwise here for readability, although either winding is accepted.

```js
import { SectorRenderer } from 'sector-renderer-gpu';

const canvas = document.createElement('canvas');
document.body.append(canvas);

// CanvasImageSource generated locally: no image loader or external asset needed.
const checker = document.createElement('canvas');
checker.width = checker.height = 64;
const paint = checker.getContext('2d');
paint.fillStyle = '#263238';
paint.fillRect(0, 0, 64, 64);
paint.fillStyle = '#607d8b';
paint.fillRect(0, 0, 32, 32);
paint.fillRect(32, 32, 32, 32);

const textureRecord = {
  image: checker,
  uploadKey: 'checker-image',
  uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
  width: 64,
  height: 64,
  sourceSize: { w: 64, h: 64 }
};

const textureProvider = {
  getTextureKeys() {
    return ['checker'];
  },
  getTexture(key) {
    return key === 'checker' ? textureRecord : null;
  }
};

const vertices = [
  { x: -4, y: -3 },
  { x:  4, y: -3 },
  { x:  4, y:  3 },
  { x: -4, y:  3 }
];

const world = {
  sectors: [{
    id: 'room',
    vertices,
    walls: [
      { a: 0, b: 1, material: 'checker' },
      { a: 1, b: 2, material: 'checker' },
      { a: 2, b: 3, material: 'checker' },
      { a: 3, b: 0, material: 'checker' }
    ],
    floor: 0,
    ceil: 3,
    floorMaterial: 'checker',
    ceilingMaterial: 'checker',
    lightLevel: 1
  }],
  dynamicSectorIds: [],
  portalOpenings: []
};

const renderer = new SectorRenderer({
  world,
  canvas,
  width: 960,
  height: 540,
  pixelRatio: window.devicePixelRatio,
  textureProvider
});

// At yaw = 0 the camera looks toward +Y.
renderer.render({
  camera: { x: 0, y: -1, z: 1.6, yaw: 0 }
});

// Later, for example:
// renderer.resize(1280, 720, { pixelRatio: window.devicePixelRatio });
// renderer.replaceWorld(anotherWorld);
// renderer.destroy();
```

`camera` is required. `sprites`, `worldQuads`, and `overlays` may be omitted and default to empty arrays.

## Coordinate System

- **X and Y** form the horizontal world plane. **Z** is vertical; increasing Z means up.
- A camera's `x`, `y`, and `z` are its eye position in the same world units as sector geometry.
- `yaw` is in **radians**. `yaw = 0` faces **+Y**; `Math.PI / 2` faces **+X**. Increasing yaw turns from +Y toward +X (clockwise when the XY plane is viewed from above with +Y at the top).
- Camera pitch and roll are not supported. The view remains level with world Z as up.
- Units are intentionally scale-agnostic. Use one consistent scale for coordinates, heights, sprite dimensions, projection clipping distances, and UV scale.

The +Y-at-zero yaw convention may differ from engines that use +X as forward; adapters must convert their camera heading explicitly.

## World Model

A `SectorRenderWorld` is:

```js
{
  sectors: RendererSector[],          // required
  dynamicSectorIds: (string|number)[],// optional; default []
  portalOpenings: PortalOpening[]     // optional; default []
}
```

### `RendererSector`

| Field | Requirement | Meaning/default |
| --- | --- | --- |
| `id` | Required, string or number | Exact identity used by references. IDs must be unique and must not collide after string conversion. |
| `vertices` | Required array | Ordered `RendererVertex` polygon coordinates. |
| `walls` | Required array | Wall spans referencing entries in `vertices`. |
| `floor` | Required | Finite floor Z. |
| `ceil` | Required | Finite ceiling Z greater than `floor`. |
| `floorMaterial` | Optional string/null | Floor texture key; absent/null uses flat color. |
| `ceilingMaterial` | Optional string/null | Ceiling texture key; absent/null uses flat color. |
| `floorColor` | Optional number | `0xRRGGBB` flat-color fallback. Otherwise derived from wall colors (or gray). |
| `ceilColor` | Optional number | `0xRRGGBB` flat-color fallback. Otherwise derived from wall colors (or gray). |
| `lightLevel` | Optional number | Defaults to `1`. Values `0..1` are direct; values above 1 are interpreted on a `0..255` scale; the result is clamped to `0..1`. |
| `parentSectorId` | Optional exact sector ID | Advanced nested-sector hint. A child omits its ceiling; a child floor matching its parent's floor is also omitted. The relationship is not a general scene graph. |

### `RendererVertex`

```js
{ x: number, y: number }
```

Both values are horizontal world coordinates. Z comes from the containing sector's `floor` and `ceil`.

### `RendererWall`

```js
{
  a: number,                 // required vertex index
  b: number,                 // required vertex index
  material?: string | null,
  color?: number,
  portalTo?: string | number | null,
  uvScale?: number
}
```

- `a` and `b` index `sector.vertices`; they define the authored direction of the span.
- `material` is an opaque `TextureProvider` key. Null/absent material renders with `color` (`0xffffff` by default).
- `color` is an RGB integer `0xRRGGBB` and remains the fallback tint if no usable texture exists.
- `portalTo` is the **exact** ID of the sector on the other side. See [Portals](#portals).
- A positive finite `uvScale` means horizontal world units per texture repeat. Missing, zero, negative, or non-finite values fall back to `1`. Vertical wall UVs use world Z directly at one repeat per world unit.

### Polygon and wall conventions

Floors and ceilings are triangulated from `vertices`; both clockwise and counter-clockwise simple polygons are supported. Do not repeat the first vertex at the end. Concave simple polygons are supported. Sector polygons must be non-degenerate simple polygons. If a structurally valid polygon cannot be triangulated, scene construction throws an error identifying the affected sector.

Walls are explicit spans rather than being synthesized from polygon edges. For a closed room, provide one wall for every polygon boundary edge, normally in the same cyclic order as the vertices. The shallow public validator checks finite vertex coordinates, finite ordered heights, and wall vertex references. It does not verify boundary coverage, winding, polygon simplicity, or other topology; comprehensive geometric/topological correctness remains the caller's responsibility.

## Portals

A normal portal is a wall whose `portalTo` references the neighboring sector. Adjacent sectors normally author geometrically coincident, overlapping shared-wall spans in opposite directions and reference one another reciprocally:

```js
const world = {
  sectors: [
    {
      id: 'west', floor: 0, ceil: 3,
      vertices: [
        { x: -4, y: -2 }, { x: 0, y: -2 },
        { x: 0, y: 2 }, { x: -4, y: 2 }
      ],
      walls: [
        { a: 0, b: 1, material: 'wall' },
        { a: 1, b: 2, material: 'wall', portalTo: 'east' },
        { a: 2, b: 3, material: 'wall' },
        { a: 3, b: 0, material: 'wall' }
      ]
    },
    {
      id: 'east', floor: 0, ceil: 3,
      vertices: [
        { x: 0, y: -2 }, { x: 4, y: -2 },
        { x: 4, y: 2 }, { x: 0, y: 2 }
      ],
      walls: [
        { a: 0, b: 1, material: 'wall' },
        { a: 1, b: 2, material: 'wall' },
        { a: 2, b: 3, material: 'wall' },
        { a: 3, b: 0, material: 'wall', portalTo: 'west' }
      ]
    }
  ]
};
```

One matching side declaring `portalTo` is sufficient for the current seam resolver, so one-way metadata can render an opening. Nevertheless, reciprocal, coincident, oppositely oriented walls are the recommended authoring contract: it is unambiguous, supplies materials from both sides, and describes a genuinely traversable shared boundary. `portalTo` affects rendering only; traversal and collision are external.

The visible opening is normally the vertical overlap of both sectors: `max(floor)` through `min(ceil)`. Any non-overlap is rendered as upper/lower wall bands.

### `PortalOpening` presentation metadata

`portalOpenings` optionally constrains or decorates a normal portal without changing sector connectivity:

```js
{
  wallRef: { sectorId: 'west', wallIndex: 1 },
  bottomZ: 0.5,
  topZ: 2.5,
  trimMaterial: 'portal-trim'
}
```

`WallRef.sectorId` uses exact ID identity and `wallIndex` is zero-based. At most one opening may reference a wall. Finite bounds with `topZ > bottomZ` are intersected with both sectors' height overlap. If either bound is missing/non-finite or `topZ <= bottomZ`, both custom bounds are ignored and normal sector overlap is used. A non-null `trimMaterial` must be a non-empty string; it adds narrow textured side strips around a valid opening. This is generic portal presentation metadata, not a gameplay or moving-boundary API.

## Dynamic Sectors

`dynamicSectorIds` contains exact sector IDs whose floor and owned wall geometry must not be baked into the static mesh because the caller intends to submit moving or replacement presentation through `worldQuads`. Their ceilings follow the normal sector/parent rules. Example uses include an animated platform, a deforming room component, or a surface generated by an external simulation.

ID identity is strict: numeric `1` and string `"1"` are not interchangeable in `dynamicSectorIds`, `portalTo`, or wall references. In addition, sector definitions cannot contain both IDs because IDs must also be unique after `String(id)` conversion; this prevents ambiguous diagnostic/seam keys.

## Materials

All public material keys are non-empty **strings** and are opaque to the renderer:

- `wall.material`
- `sector.floorMaterial`
- `sector.ceilingMaterial`
- `portalOpening.trimMaterial`

The caller's `TextureProvider` resolves keys. A null/absent static surface material selects its flat-color fallback. Static geometry also uses that fallback when its material key is not present in the **successfully created** texture registry. This is different from a declared startup texture failing: construction fails rather than silently substituting a color. Dynamic sprites/quads/overlays with a key that is not usable in the registry are skipped. Numeric material keys are rejected at the world boundary so every material obeys the provider's string-key contract.

Static wall, floor, and ceiling UVs are baked in world/repeating coordinates and are not remapped through a record's `uvRect` at draw time. Consequently, use **full-image texture records for repeating static world materials**. Atlas sub-region records work with the default UV generation used by sprites, world quads, and overlays, but are not currently a safe general material contract for static world surfaces.

Under the current WebGL1 upload policy, power-of-two image dimensions use `REPEAT` wrapping, mipmaps, and anisotropy where supported. Non-power-of-two images use `CLAMP_TO_EDGE` and no mipmaps. If a static material needs to tile beyond `0..1`, use a power-of-two uploaded image.

## TextureProvider

A provider exposes all texture keys available when the renderer is constructed and returns a ready browser image record for each key:

```js
const textureProvider = {
  getTextureKeys() { return ['stone']; },
  getTexture(key) {
    if (key !== 'stone') return null;
    return {
      image: stoneImage,
      uploadKey: 'stone-image',
      uvRect: { u0: 0, v0: 0, u1: 1, v1: 1 },
      width: 128,
      height: 128,
      sourceSize: { w: 128, h: 128 }
    };
  }
};
```

`getTextureKeys()` must return a duplicate-free array of non-empty strings. Records are read/uploaded during construction; this is not an asynchronous loading interface. Load images before constructing the renderer.

Every startup key returned by `getTextureKeys()` is a declaration that `getTexture(key)` will return a valid, uploadable `RendererTextureRecord`. Renderer construction fails if a declared key returns `null`, returns an invalid record or UV/dimension values, conflicts by associating one `uploadKey` with different image objects, or fails during GPU upload. Registry construction deletes textures it already created before propagating the error. `getTexture(key)` may return `null` only for keys that were not declared as startup keys; such keys never enter the registry.

### `RendererTextureRecord`

| Field | Requirement | Meaning |
| --- | --- | --- |
| `image` | Required | A non-null WebGL `texImage2D` browser source, normally `HTMLImageElement`, `HTMLCanvasElement`, `ImageBitmap`, `ImageData`, `HTMLVideoElement`, or `OffscreenCanvas` where supported by the browser/WebGL implementation. |
| `uploadKey` | Required non-empty string | Stable identity of the underlying GPU upload. Multiple logical keys can share one upload. The same `uploadKey` plus the same image object is allowed; the same key with a different image object is rejected. |
| `uvRect` | Required | Normalized atlas bounds in `0..1`: `{u0,v0,u1,v1}` with non-reversed ranges. Full texture: `{ u0: 0, v0: 0, u1: 1, v1: 1 }`. |
| `width`, `height` | Required positive numbers | Logical dimensions of this key/region, not necessarily the uploaded image's pixel dimensions. They are sprite sizing fallbacks. |
| `sourceSize` | Optional `{w,h}` or null | Positive untrimmed logical dimensions. Sprite auto-sizing prefers these, allowing a trimmed atlas sprite to retain its original layout size. |

Two atlas keys used by dynamic presentation can share an upload:

```js
const records = {
  iconA: { image: atlas, uploadKey: 'ui-atlas', uvRect: { u0: 0, v0: 0, u1: .5, v1: 1 }, width: 32, height: 64 },
  iconB: { image: atlas, uploadKey: 'ui-atlas', uvRect: { u0: .5, v0: 0, u1: 1, v1: 1 }, width: 32, height: 64 }
};
const provider = {
  getTextureKeys: () => Object.keys(records),
  getTexture: (key) => records[key] ?? null
};
```

Sharing by `uploadKey` is generic, but `uvRect` sub-regions are applied by default only to sprites, world quads, and overlays. Repeating static materials should currently use a full-image record (`0..1` UV rectangle), preferably backed by a power-of-two image.

## Rendering Frames

```js
renderer.render({ camera, sprites, worldQuads, overlays });
```

### `RendererCamera`

```js
{ x: 0, y: -2, z: 1.6, yaw: 0 }
```

All four finite numbers are required. Position is the eye in world coordinates. Yaw follows the [coordinate convention](#coordinate-system); there is currently no pitch.

### `RendererSprite`

```js
{
  textureKey: 'character', // required
  x: 1, y: 2, z: 0,       // required; z is floor when anchor='floor'
  width: 1, height: 2,     // optional
  size: 1,                 // optional shared fallback
  anchor: 'floor',         // 'center' (default) or 'floor'
  opacity: 1,
  order: 0,
  flipX: false,
  flipV: false
}
```

Sprites are vertical billboards: they rotate around world Z to face the camera and stay upright; they do not pitch toward it. `'center'` places the quad center at `z`; `'floor'` places its bottom at `z`. Values other than these two are not supported (the current renderer treats them like `'center'`, but callers must not rely on that fallback).

Each dimension resolves independently in this order: explicit `width`/`height`, then `size`, then texture `sourceSize.w`/`.h`, then texture logical `width`/`height`, then `1`. Thus setting only `width` still allows height to come from later fallbacks. Sprites draw far-to-near. `order` (default `0`, ascending) breaks equal-distance ties; it is not a global Z index. `opacity` defaults to `1`; `flipX` and `flipV` reverse texture sampling horizontally and vertically.

### `RendererWorldQuad`

```js
{
  textureKey: 'energy',
  corners: [
    [0, 2, 3], // top-left
    [2, 2, 3], // top-right
    [2, 2, 0], // bottom-right
    [0, 2, 0]  // bottom-left
  ],
  opacity: 1,
  flipX: false,
  flipV: false
}
```

`textureKey` and exactly four `[x, y, z]` corners are required. Corner order is **top-left, top-right, bottom-right, bottom-left** as viewed from the intended front. Default UVs map the texture record's atlas rectangle to that order. `flipX` reverses its left/right coordinates, `flipV` reverses its top/bottom coordinates, and enabling both reverses both axes. Optional `uvs` supplies four `[u,v]` pairs in the same order; these are direct normalized uploaded-image coordinates, so custom UVs take responsibility for atlas placement and supersede both flip flags. Quads render in submission order with depth testing and are useful for moving geometry, animated/transient planes, and externally generated surfaces.

### `RendererOverlay`

```js
{
  textureKey: 'reticle',
  anchorX: 0.5,
  anchorY: 0.5,
  offsetX: 0,
  offsetY: 0,
  width: 32,
  height: 32,
  pivotX: 0.5,
  pivotY: 0.5,
  rotation: 0,
  opacity: 1,
  order: 0
}
```

`textureKey`, normalized `anchorX`/`anchorY`, and dimensions are required. Anchor origin `(0,0)` is the drawing buffer's top-left and `(1,1)` its bottom-right. Offsets and `width`/`height` are drawing-buffer pixels (therefore affected by `pixelRatio`, not logical CSS pixels). Pivots are normalized within the overlay: `(0,0)` top-left, `(0.5,0.5)` center (default), `(1,1)` bottom-right. Rotation is radians around the pivot; positive values appear clockwise on screen because screen Y grows downward. Overlays draw after the world with depth testing disabled, sorted by ascending `order` (default `0`).

## Projection

```js
import { DEFAULT_PROJECTION } from 'sector-renderer-gpu';
// { fovY: Math.PI / 3, near: 0.1, far: 160 }
```

Pass partial overrides as `projection: { fovY, near, far }`. `fovY` is vertical radians and must be finite, greater than `0`, and less than `Math.PI`. `near` must be finite and `> 0`; `far` must be finite and `> near`. Projection does not add camera pitch.

## Renderer Construction and Lifecycle

Recommended construction uses a caller-owned canvas, as in Quick Start:

```js
const renderer = new SectorRenderer({
  world, canvas, width: 960, height: 540,
  pixelRatio: window.devicePixelRatio,
  projection: { far: 300 },
  textureProvider,
  debug: { seam: { enabled: false } }
});
```

Constructor options:

| Option | Requirement | Behavior |
| --- | --- | --- |
| `world` | Required | Valid `SectorRenderWorld`; static geometry is built immediately. |
| `canvas` / `container` | Exactly one | A supplied canvas remains caller-owned. With a container, the renderer creates/appends a canvas and removes it on failed construction or `destroy()`. |
| `width`, `height` | Optional, default `1280`, `720` | Positive logical CSS viewport dimensions. |
| `pixelRatio` | Optional, default `1` | Positive finite backing-store multiplier; invalid values fall back to `1`. The renderer does not automatically read device DPR. |
| `projection` | Optional | Partial perspective override. |
| `textureProvider` | Required | Synchronous provider described above. |
| `debug` | Optional | Advanced seam diagnostics configuration. |

Normal lifecycle:

```text
construct → render many frames → resize as needed
          → optionally replaceWorld → render more → destroy
```

- `render(frame)` validates the required finite camera and that optional collections are arrays, then draws one frame.
- `resize(width, height, { pixelRatio = 1 } = {})` updates CSS size, backing-store size, viewport, and aspect. Pass DPR again when retaining a non-1 value.
- `replaceWorld(world)` rebuilds and uploads static geometry while preserving the WebGL context, canvas, shader, and texture registry. Replacement is transactional at a useful resource level: a build/upload failure leaves the previous world/mesh installed.
- `getStats()` returns the latest diagnostics snapshot.
- `destroy()` frees WebGL resources and removes only a renderer-created canvas. It is safe to call repeatedly. Do not render/resize/replace after destruction.

## Diagnostics

`getStats()` returns `{ backend: 'gpu', gpu: { ... } }`. The GPU object reports useful counts (sectors, authored walls, primitives, triangles, materials, textures, vertices, indices, and draw calls), timings (`buildMs`, `uploadInitMs`, `renderMs`), and optional `seamDebug`. It is a diagnostics/performance payload, not mutable renderer state. Its detailed shape may evolve during the **0.x** release series; avoid persisting it as application data.

## Advanced Debugging

Seam debugging inspects how shared walls/portals were resolved:

```js
const debug = {
  seam: {
    enabled: true,
    targetSeamKey: 'known-internal-seam-key'
    // or targetWallRef: { sectorId: 'west', wallIndex: 1 }
  }
};
```

`enabled` activates collection. `targetWallRef` is usually the practical selector; `targetSeamKey` directly selects a diagnostic seam key and takes precedence. Results appear at `renderer.getStats().gpu.seamDebug`, including participants and resolution/deduplication information. Seam keys and the detailed debug payload are diagnostic and may evolve during 0.x.

## Public API Reference

### Primary API

- `SectorRenderer` — construct and operate a renderer.
- `DEFAULT_PROJECTION` — frozen default projection values.

### Utility API

These validators are retained for adapters, tooling, integration tests, and callers that want early boundary errors:

- `assertRendererWorld(world)` checks the shallow world shape, basic sector geometry (finite coordinates, valid heights, and wall vertex references), unique/exact references, portal-opening references, and string material keys. It returns the same object or throws `TypeError`. It does **not** comprehensively validate polygon topology.
- `assertRendererFrame(frame)` checks the camera and optional collection containers. It returns the same object or throws `TypeError`; individual sprite/quad/overlay fields remain caller responsibilities.
- `assertTextureProvider(provider)` checks the two required methods. It returns the provider or throws `TypeError`.
- `assertRendererTextureRecord(record, key?)` checks upload identity, UV bounds, and logical/source dimensions. It returns the record or throws `TypeError`.

`buildGpuScene` and `buildStaticMeshFromGpuScene` are deliberately **not public in 0.1.0**. Their intermediate formats are implementation details and have no stable external contract.

No package subpaths are public exports.

## Current Limitations

**Unsupported runtime capabilities:**

- Browser DOM plus WebGL are required; no Node, headless, SSR, or software rendering
- No camera pitch or roll
- Static meshes use WebGL 1 `Uint16` indices and fail before exceeding the 65,536-vertex/index-addressing capacity
- Polygon topology is not comprehensively validated; non-triangulatable sectors fail with an error
- Textures are captured/uploaded at construction; there is no asynchronous/hot-loading API

**Intentionally external to this renderer:** asset loading, game loop, controls, collision/physics, AI, gameplay, audio, map editing, and a map-authoring DSL.

## Browser Support / Environment

Use a modern browser with DOM canvas APIs, ES modules, and WebGL. Construction throws when WebGL context creation fails. Exact browser/version support has not yet been formalized.

## Assets and Licensing

The package includes no maps, art, textures, audio, or other game assets. Consumers supply and license every image exposed through their `TextureProvider`. The package source is available under the MIT License; this does not license consumer-supplied assets.

## Development Status

The package follows a `0.x` contract: the documented public API is suitable for use, while compatibility may evolve between minor releases before `1.0.0`.
