/**
 * Module: Creates texture objects for preloaded assets, uploads image data, and exposes lookup/stats helpers.
 */
import { assertRendererTextureRecord, assertTextureKeys } from '../../textureProvider.js';

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

const WORLD_TEXTURE_SAMPLING_POLICY = Object.freeze({
  minFilter: 'LINEAR_MIPMAP_LINEAR',
  magFilter: 'LINEAR',
  anisotropy: Object.freeze({
    enabled: true,
    level: 8
  })
});

function getAnisotropySupport(gl) {
  const extension =
    gl.getExtension('EXT_texture_filter_anisotropic') ||
    gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
    gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

  if (!extension) {
    return null;
  }

  const max = gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  if (!Number.isFinite(max) || max < 1) {
    return null;
  }

  return {
    extension,
    max
  };
}

function applyAnisotropy(gl, anisotropySupport) {
  if (!anisotropySupport || !WORLD_TEXTURE_SAMPLING_POLICY.anisotropy.enabled) {
    return;
  }

  const level = Math.min(
    WORLD_TEXTURE_SAMPLING_POLICY.anisotropy.level,
    anisotropySupport.max
  );

  gl.texParameterf(
    gl.TEXTURE_2D,
    anisotropySupport.extension.TEXTURE_MAX_ANISOTROPY_EXT,
    level
  );
}

function applySamplingPolicy(gl, { useMipmaps, anisotropySupport }) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl[WORLD_TEXTURE_SAMPLING_POLICY.magFilter]);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl[useMipmaps ? WORLD_TEXTURE_SAMPLING_POLICY.minFilter : 'LINEAR']
  );

  if (useMipmaps) {
    applyAnisotropy(gl, anisotropySupport);
  }
}

function uploadImageTexture(gl, texture, image, anisotropySupport) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  const canRepeat = isPowerOfTwo(image.width) && isPowerOfTwo(image.height);
  const useMipmaps = canRepeat;

  if (useMipmaps) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  applySamplingPolicy(gl, { useMipmaps, anisotropySupport });
}

function initializeFallbackTexture(gl, texture) {
  const pixel = new Uint8Array([255, 255, 255, 255]);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
}

/** Uploads all preloaded textures and exposes key-based lookup/stat helpers. */
export function createTextureRegistry(gl, textureKeys, textureProvider) {
  assertTextureKeys(textureKeys);
  const records = new Map();
  const glTextureByUploadKey = new Map();
  const imageByUploadKey = new Map();
  const createdTextures = new Set();
  const anisotropySupport = getAnisotropySupport(gl);

  try {
    for (const key of textureKeys) {
      const source = textureProvider.getTexture(key);
      if (!source) {
        throw new Error(
          `Missing preloaded texture asset for key "${key}".`
        );
      }
      assertRendererTextureRecord(source, key);

      const { image, uploadKey, uvRect, width, height, sourceSize } = source;

      const record = {
        key,
        texture: null,
        loaded: false,
        failed: false,
        uvRect,
        width,
        height,
        sourceSize: sourceSize ?? Object.freeze({ w: width, h: height })
      };

      try {
        const priorImage = imageByUploadKey.get(uploadKey);
        if (priorImage && priorImage !== image) throw new Error(`uploadKey "${uploadKey}" is associated with a different image object`);
        let texture = glTextureByUploadKey.get(uploadKey);
        if (!texture) {
          texture = gl.createTexture();
          createdTextures.add(texture);
          initializeFallbackTexture(gl, texture);
          uploadImageTexture(gl, texture, image, anisotropySupport);
          glTextureByUploadKey.set(uploadKey, texture);
          imageByUploadKey.set(uploadKey, image);
        }
        record.texture = texture;

        record.loaded = true;
      } catch (error) {
        record.failed = true;
        throw new Error(
          `Failed GPU upload for texture asset "${key}": ${error?.message ?? error}`
        );
      }

      records.set(record.key, record);
    }
  } catch (error) {
    for (const texture of createdTextures) gl.deleteTexture(texture);
    glTextureByUploadKey.clear();
    records.clear();
    throw error;
  }

  const getStats = () => {
    let loaded = 0;
    let failed = 0;

    for (const record of records.values()) {
      if (record.loaded) loaded += 1;
      if (record.failed) failed += 1;
    }

    return {
      total: records.size,
      loaded,
      failed,
      uploadedTextures: glTextureByUploadKey.size
    };
  };

  return {
    get(materialKey) {
      return materialKey ? records.get(materialKey) ?? null : null;
    },
    getStats,
    destroy() {
      for (const texture of glTextureByUploadKey.values()) {
        gl.deleteTexture(texture);
      }
      createdTextures.clear();
      glTextureByUploadKey.clear();
      records.clear();
    }
  };
}
