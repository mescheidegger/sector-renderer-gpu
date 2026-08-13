/**
 * @typedef {Object} RendererTextureRecord
 * @property {CanvasImageSource} image Image source uploaded to WebGL.
 * @property {string} uploadKey Stable identity of the underlying GPU upload.
 * @property {{u0: number, v0: number, u1: number, v1: number}} uvRect Normalized sampling rectangle.
 * @property {number} width Logical texture width.
 * @property {number} height Logical texture height.
 * @property {{w: number, h: number}|null} [sourceSize] Optional untrimmed logical size used by sprite presentation.
 *
 * @typedef {Object} TextureProvider
 * @property {() => string[]} getTextureKeys Returns every texture key available to the renderer.
 * @property {(key: string) => RendererTextureRecord|null} getTexture Returns ready-to-render texture data, or null when absent.
 */

const REQUIRED_TEXTURE_PROVIDER_METHODS = Object.freeze([
  'getTextureKeys',
  'getTexture'
]);

/**
 * Validates the minimal texture-facing contract required by the renderer.
 * @param {TextureProvider} textureProvider
 * @returns {TextureProvider}
 */
export function assertTextureProvider(textureProvider) {
  if (!textureProvider || typeof textureProvider !== 'object') {
    throw new TypeError('[SectorRenderer] A textureProvider is required.');
  }

  const missingMethods = REQUIRED_TEXTURE_PROVIDER_METHODS.filter(
    (methodName) => typeof textureProvider[methodName] !== 'function'
  );

  if (missingMethods.length > 0) {
    throw new TypeError(
      `[SectorRenderer] Invalid textureProvider; missing methods: ${missingMethods.join(', ')}`
    );
  }

  return textureProvider;
}

/** Validates keys returned by a TextureProvider. @param {*} keys @returns {string[]} @throws {TypeError} */
export function assertTextureKeys(keys) {
  if (!Array.isArray(keys)) throw new TypeError('[SectorRenderer] textureProvider.getTextureKeys() must return an array.');
  const seen = new Set();
  keys.forEach((key, index) => {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError(`[SectorRenderer] Texture key at index ${index} must be a non-empty string.`);
    if (seen.has(key)) throw new TypeError(`[SectorRenderer] Duplicate texture key "${key}" at index ${index}.`);
    seen.add(key);
  });
  return keys;
}

/**
 * Validates a renderer-native texture record and returns the same object.
 * @param {RendererTextureRecord} record
 * @param {string|null} [key]
 * @returns {RendererTextureRecord}
 * @throws {TypeError} When a required field, dimension, or normalized UV bound is invalid.
 */
export function assertRendererTextureRecord(record, key = null) {
  const label = key == null ? '' : ` for key "${key}"`;
  if (!record || typeof record !== 'object') throw new TypeError(`[SectorRenderer] Missing texture record${label}.`);
  if (record.image == null) throw new TypeError(`[SectorRenderer] Texture image${label} must be non-null.`);
  if (typeof record.uploadKey !== 'string' || record.uploadKey.length === 0) throw new TypeError(`[SectorRenderer] Texture uploadKey${label} must be a non-empty string.`);
  const uv = record.uvRect;
  if (!uv || typeof uv !== 'object') throw new TypeError(`[SectorRenderer] Texture uvRect${label} is required.`);
  for (const name of ['u0', 'v0', 'u1', 'v1']) if (!Number.isFinite(uv[name]) || uv[name] < 0 || uv[name] > 1) throw new TypeError(`[SectorRenderer] Texture uvRect.${name}${label} must be within 0..1.`);
  if (uv.u1 < uv.u0 || uv.v1 < uv.v0) throw new TypeError(`[SectorRenderer] Texture uvRect${label} must not be reversed.`);
  for (const name of ['width', 'height']) if (!Number.isFinite(record[name]) || record[name] <= 0) throw new TypeError(`[SectorRenderer] Texture ${name}${label} must be finite and positive.`);
  if (record.sourceSize != null) for (const name of ['w', 'h']) if (!Number.isFinite(record.sourceSize[name]) || record.sourceSize[name] <= 0) throw new TypeError(`[SectorRenderer] Texture sourceSize.${name}${label} must be finite and positive.`);
  return record;
}
