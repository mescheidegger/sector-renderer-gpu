/**
 * Module: Creates texture objects for preloaded assets, uploads image data, and exposes lookup/stats helpers.
 */
import { assertRendererTextureRecord, assertTextureKeys } from '../../textureProvider.js';
import { clearWebGLErrors, throwIfWebGLError } from '../webGLErrors.js';

function isPowerOfTwo(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

/** Resolves WebGL1-safe upload state and any shader assistance required by explicit repeat intent. */
export function resolveTextureSampling({ width, height, wrap = null }) {
  const powerOfTwo = isPowerOfTwo(width) && isPowerOfTwo(height);
  const wantsRepeat = wrap === 'repeat' || (wrap == null && powerOfTwo);

  return Object.freeze({
    wrap: wantsRepeat ? 'repeat' : 'clamp',
    gpuWrap: wantsRepeat && powerOfTwo ? 'repeat' : 'clamp',
    repeatMode: wantsRepeat ? (powerOfTwo ? 'hardware' : 'shader') : 'none',
    useMipmaps: powerOfTwo
  });
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

function runTextureUploadStage(gl, stage, operation) {
  clearWebGLErrors(gl);
  try {
    operation();
  } catch (error) {
    throw new Error(
      `[SectorRenderer] Texture GPU upload failed during ${stage}: ${error?.message ?? error}`,
      { cause: error }
    );
  }
  throwIfWebGLError(gl, `Texture GPU upload during ${stage}`);
}

function uploadImageTexture(gl, texture, image, anisotropySupport, sampling) {
  runTextureUploadStage(gl, 'image upload', () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  });

  runTextureUploadStage(gl, 'mipmap/sampling configuration', () => {
    const gpuWrap = sampling.gpuWrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gpuWrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gpuWrap);

    if (sampling.useMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    applySamplingPolicy(gl, { useMipmaps: sampling.useMipmaps, anisotropySupport });
  });
}

function initializeFallbackTexture(gl, texture) {
  runTextureUploadStage(gl, 'initial allocation', () => {
    const pixel = new Uint8Array([255, 255, 255, 255]);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  });
}

function getMaxTextureSize(gl) {
  clearWebGLErrors(gl);
  const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  throwIfWebGLError(gl, 'MAX_TEXTURE_SIZE query');
  if (!Number.isFinite(maximum) || maximum <= 0) {
    throw new Error(`[SectorRenderer] Invalid MAX_TEXTURE_SIZE reported by WebGL: ${maximum}.`);
  }
  return maximum;
}

/** Uploads all preloaded textures and exposes key-based lookup/stat helpers. */
export function createTextureRegistry(gl, textureKeys, textureProvider) {
  assertTextureKeys(textureKeys);
  const records = new Map();
  const glTextureByUploadKey = new Map();
  const imageByUploadKey = new Map();
  const samplingByUploadKey = new Map();
  const createdTextures = new Set();
  const anisotropySupport = getAnisotropySupport(gl);
  const maxTextureSize = textureKeys.length > 0 ? getMaxTextureSize(gl) : null;

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
      const sourceWidth = image.width ?? width;
      const sourceHeight = image.height ?? height;
      const sampling = resolveTextureSampling({
        width: sourceWidth,
        height: sourceHeight,
        wrap: source.wrap ?? null
      });

      if (sourceWidth > maxTextureSize || sourceHeight > maxTextureSize) {
        throw new Error(
          `[SectorRenderer] Texture asset "${key}" (${sourceWidth}x${sourceHeight}) exceeds `
          + `WebGL MAX_TEXTURE_SIZE (${maxTextureSize}).`
        );
      }

      const record = {
        key,
        texture: null,
        loaded: false,
        failed: false,
        uvRect,
        width,
        height,
        wrap: sampling.wrap,
        repeatMode: sampling.repeatMode,
        uploadWidth: sourceWidth,
        uploadHeight: sourceHeight,
        sourceSize: sourceSize ?? Object.freeze({ w: width, h: height })
      };

      const priorImage = imageByUploadKey.get(uploadKey);
      if (priorImage && priorImage !== image) {
        throw new Error(`[SectorRenderer] Texture uploadKey "${uploadKey}" is associated with a different image object.`);
      }
      const priorSampling = samplingByUploadKey.get(uploadKey);
      if (priorSampling && (
        priorSampling.gpuWrap !== sampling.gpuWrap
        || priorSampling.useMipmaps !== sampling.useMipmaps
      )) {
        throw new Error(`[SectorRenderer] Texture uploadKey "${uploadKey}" has conflicting wrap requirements.`);
      }
      let texture = glTextureByUploadKey.get(uploadKey);
      if (!texture) {
        texture = gl.createTexture();
        if (!texture) {
          throw new Error(`[SectorRenderer] Texture allocation failed for asset "${key}".`);
        }
        createdTextures.add(texture);
        try {
          initializeFallbackTexture(gl, texture);
          uploadImageTexture(gl, texture, image, anisotropySupport, sampling);
        } catch (error) {
          throw new Error(
            `[SectorRenderer] Failed to create texture asset "${key}": ${error?.message ?? error}`,
            { cause: error }
          );
        }
        glTextureByUploadKey.set(uploadKey, texture);
        imageByUploadKey.set(uploadKey, image);
        samplingByUploadKey.set(uploadKey, sampling);
      }
      record.texture = texture;
      record.loaded = true;

      records.set(record.key, record);
    }
  } catch (error) {
    for (const texture of createdTextures) gl.deleteTexture(texture);
    glTextureByUploadKey.clear();
    imageByUploadKey.clear();
    samplingByUploadKey.clear();
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
      for (const texture of createdTextures) {
        gl.deleteTexture(texture);
      }
      createdTextures.clear();
      glTextureByUploadKey.clear();
      imageByUploadKey.clear();
      samplingByUploadKey.clear();
      records.clear();
    }
  };
}
