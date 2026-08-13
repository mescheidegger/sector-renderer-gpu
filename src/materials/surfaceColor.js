/**
 * Module: Small color utilities used to derive floor/ceiling tints from sector data.
 */
function hexToRgb(color) {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff
  };
}

function rgbToHex(r, g, b) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function multiplyColor(color, factor) {
  const rgb = hexToRgb(color);
  return rgbToHex(
    Math.round(rgb.r * factor),
    Math.round(rgb.g * factor),
    Math.round(rgb.b * factor)
  );
}

function averageWallColor(sector) {
  if (!Array.isArray(sector?.walls) || sector.walls.length === 0) {
    return null;
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const wall of sector.walls) {
    if (typeof wall.color !== 'number') {
      continue;
    }
    const rgb = hexToRgb(wall.color);
    r += rgb.r;
    g += rgb.g;
    b += rgb.b;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return rgbToHex(
    Math.round(r / count),
    Math.round(g / count),
    Math.round(b / count)
  );
}

/** Derives a floor/ceiling color when explicit authoring values are missing. */
export function deriveSurfaceColor(sector, kind) {
  const explicit = kind === 'floor' ? sector.floorColor : sector.ceilColor;
  if (typeof explicit === 'number') {
    return explicit;
  }

  const base = averageWallColor(sector) ?? 0x7a7a7a;
  return kind === 'floor'
    ? multiplyColor(base, 0.48)
    : multiplyColor(base, 0.78);
}
