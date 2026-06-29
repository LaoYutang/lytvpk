// Derived from the GPL-3.0 VTF-Editor conversion flow by Mishcatt.
// This file keeps the VTF header/data layout and texture-format handling,
// but is reorganized for LytVPK's module-based spray tool UI.

export const TEXTURE_FORMATS = {
  RGBA8888: 0,
  RGB888: 2,
  RGB565: 4,
  DXT1: 13,
  DXT5: 15,
  BGRA4444: 19,
  BGRA5551: 21,
};

export const FORMAT_LABELS = new Map([
  [TEXTURE_FORMATS.RGBA8888, "RGBA8888"],
  [TEXTURE_FORMATS.RGB888, "RGB888"],
  [TEXTURE_FORMATS.RGB565, "RGB565"],
  [TEXTURE_FORMATS.DXT1, "DXT1"],
  [TEXTURE_FORMATS.DXT5, "DXT5"],
  [TEXTURE_FORMATS.BGRA4444, "BGRA4444"],
  [TEXTURE_FORMATS.BGRA5551, "BGRA5551"],
]);

const HEADER_SIZE = 64;

export function buildVTFBytes(payload) {
  const width = Math.max(1, payload.width | 0);
  const height = Math.max(1, payload.height | 0);
  const frames = normalizeMipFrames(payload.mipmaps);
  const frameCount = Math.max(1, frames[0]?.length || 1);
  const format = Number(payload.format ?? TEXTURE_FORMATS.DXT1);
  const sampling = Number(payload.sampling || 0);
  const hasMipmaps = frames.length > 1;

  const encodedMipmaps = frames.map((mipFrames) =>
    mipFrames.map((frame) => encodeFrame(frame, format, payload))
  );

  const dataSize = encodedMipmaps.reduce(
    (sum, mipFrames) =>
      sum + mipFrames.reduce((inner, frame) => inner + frame.length, 0),
    0
  );
  const file = new Uint8Array(HEADER_SIZE + dataSize);
  writeHeader(file, {
    width,
    height,
    format,
    sampling,
    frameCount,
    mipmapCount: hasMipmaps ? frames.length : 1,
    hasMipmaps,
  });

  let pos = HEADER_SIZE;
  for (let mip = encodedMipmaps.length - 1; mip >= 0; mip -= 1) {
    const mipFrames = encodedMipmaps[mip];
    for (let frame = 0; frame < mipFrames.length; frame += 1) {
      file.set(mipFrames[frame], pos);
      pos += mipFrames[frame].length;
    }
  }

  return file;
}

export function estimateVTFSize(width, height, frameCount, format, mipmaps) {
  const levels = mipmaps ? getMipmapDimensions(width, height) : [{ width, height }];
  const frames = Math.max(1, frameCount || 1);
  const dataBytes = levels.reduce((sum, level) => {
    return sum + getFrameEncodedSize(level.width, level.height, format) * frames;
  }, 0);
  return HEADER_SIZE + dataBytes;
}

export function getMipmapDimensions(width, height) {
  const levels = [];
  let w = Math.max(1, width | 0);
  let h = Math.max(1, height | 0);
  while (true) {
    levels.push({ width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  }
  return levels;
}

export function buildVMTText(name) {
  const clean = sanitizeVMTTextureName(name || "spray");
  return `"UnlitGeneric"
{
\t"$basetexture" "vgui/logos/${clean}"
\t"$translucent" "1"
\t"$ignorez" "1"
\t"$vertexcolor" "1"
\t"$vertexalpha" "1"
}
`;
}

function sanitizeVMTTextureName(value) {
  return String(value || "spray")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "") || "spray";
}

function normalizeMipFrames(mipmaps) {
  if (!Array.isArray(mipmaps) || !mipmaps.length) {
    throw new Error("没有可写入的图像帧");
  }
  return mipmaps.map((mipFrames) => {
    if (!Array.isArray(mipFrames) || !mipFrames.length) {
      throw new Error("mipmap 缺少帧数据");
    }
    return mipFrames.map((frame) => {
      if (!frame || !frame.data || !frame.width || !frame.height) {
        throw new Error("帧数据不完整");
      }
      return frame;
    });
  });
}

function writeHeader(file, options) {
  file[0] = 86;
  file[1] = 84;
  file[2] = 70;
  file[3] = 0;
  writeUint32(file, 4, 7);
  writeUint32(file, 8, 1);
  writeUint32(file, 12, HEADER_SIZE);
  writeUint16(file, 16, options.width);
  writeUint16(file, 18, options.height);

  // Match VTF-Editor's flags baseline, with sampling bits mixed in.
  file[20] = 12 + Number(options.sampling || 0);
  file[21] = 35 - (options.hasMipmaps ? 1 : 0);

  writeUint16(file, 24, options.frameCount);
  file[52] = options.format & 0xff;
  file[56] = options.mipmapCount & 0xff;
  file[57] = TEXTURE_FORMATS.DXT1;
  file[62] = 0;
  file[63] = 1;
}

function getFrameEncodedSize(width, height, format) {
  if (format === TEXTURE_FORMATS.DXT1) {
    return Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
  }
  if (format === TEXTURE_FORMATS.DXT5) {
    return Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  }
  if (format === TEXTURE_FORMATS.RGBA8888) return width * height * 4;
  if (format === TEXTURE_FORMATS.RGB888) return width * height * 3;
  return width * height * 2;
}

function encodeFrame(frame, format, options = {}) {
  const rgba = frame.data instanceof Uint8ClampedArray || frame.data instanceof Uint8Array
    ? frame.data
    : new Uint8ClampedArray(frame.data);
  const source = shouldDither(format, options)
    ? applyFloydSteinbergDither(rgba, frame.width, frame.height, format)
    : rgba;

  switch (format) {
    case TEXTURE_FORMATS.RGBA8888:
      return new Uint8Array(source);
    case TEXTURE_FORMATS.RGB888:
      return encodeRGB888(source);
    case TEXTURE_FORMATS.RGB565:
      return encodeRGB565(source);
    case TEXTURE_FORMATS.BGRA5551:
      return encodeBGRA5551(source);
    case TEXTURE_FORMATS.BGRA4444:
      return encodeBGRA4444(source);
    case TEXTURE_FORMATS.DXT5:
      return encodeDXT5(source, frame.width, frame.height, options);
    case TEXTURE_FORMATS.DXT1:
    default:
      return encodeDXT1(source, frame.width, frame.height, options);
  }
}

function encodeRGB888(rgba) {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

function encodeRGB565(rgba) {
  const out = new Uint8Array((rgba.length / 4) * 2);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 2) {
    writeUint16(out, j, rgbTo565(rgba[i], rgba[i + 1], rgba[i + 2]));
  }
  return out;
}

function encodeBGRA5551(rgba) {
  const out = new Uint8Array((rgba.length / 4) * 2);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 2) {
    const b = rgba[i + 2] >> 3;
    const g = rgba[i + 1] >> 3;
    const r = rgba[i] >> 3;
    const a = rgba[i + 3] >= 128 ? 1 : 0;
    writeUint16(out, j, b | (g << 5) | (r << 10) | (a << 15));
  }
  return out;
}

function encodeBGRA4444(rgba) {
  const out = new Uint8Array((rgba.length / 4) * 2);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 2) {
    const b = rgba[i + 2] >> 4;
    const g = rgba[i + 1] >> 4;
    const r = rgba[i] >> 4;
    const a = rgba[i + 3] >> 4;
    writeUint16(out, j, b | (g << 4) | (r << 8) | (a << 12));
  }
  return out;
}

function encodeDXT1(rgba, width, height, options = {}) {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(blocksX * blocksY * 8);
  let offset = 0;

  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const block = collectBlock(rgba, width, height, bx, by);
      const encoded = encodeDXT1Block(block, true, options);
      out.set(encoded, offset);
      offset += 8;
    }
  }
  return out;
}

function encodeDXT5(rgba, width, height, options = {}) {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const out = new Uint8Array(blocksX * blocksY * 16);
  let offset = 0;

  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const block = collectBlock(rgba, width, height, bx, by);
      out.set(encodeDXT5Alpha(block), offset);
      out.set(encodeDXT1Block(block, false, options), offset + 8);
      offset += 16;
    }
  }
  return out;
}

function collectBlock(rgba, width, height, blockX, blockY) {
  const pixels = new Array(16);
  let p = 0;
  for (let y = 0; y < 4; y += 1) {
    const sy = Math.min(height - 1, blockY * 4 + y);
    for (let x = 0; x < 4; x += 1) {
      const sx = Math.min(width - 1, blockX * 4 + x);
      const i = (sy * width + sx) * 4;
      pixels[p] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      p += 1;
    }
  }
  return pixels;
}

function encodeDXT1Block(block, oneBitAlpha, options = {}) {
  const transparent = oneBitAlpha && block.some((p) => p[3] < 128);
  const endpoints = chooseColorEndpoints(block, transparent, Number(options.dxtQuality || 0));
  let c0 = rgbTo565(endpoints.max[0], endpoints.max[1], endpoints.max[2]);
  let c1 = rgbTo565(endpoints.min[0], endpoints.min[1], endpoints.min[2]);

  if (transparent && c0 > c1) {
    [c0, c1] = [c1, c0];
  } else if (!transparent && c0 < c1) {
    [c0, c1] = [c1, c0];
  }

  const palette = buildDXTColorPalette(c0, c1, transparent);
  let indices = 0;
  for (let i = 0; i < 16; i += 1) {
    let index = 0;
    if (transparent && block[i][3] < 128) {
      index = 3;
    } else {
      index = closestColorIndex(block[i], palette, transparent ? 3 : 4);
    }
    indices |= index << (i * 2);
  }

  const out = new Uint8Array(8);
  writeUint16(out, 0, c0);
  writeUint16(out, 2, c1);
  writeUint32(out, 4, indices);
  return out;
}

function encodeDXT5Alpha(block) {
  let min = 255;
  let max = 0;
  for (const pixel of block) {
    min = Math.min(min, pixel[3]);
    max = Math.max(max, pixel[3]);
  }

  const palette = new Array(8);
  palette[0] = max;
  palette[1] = min;
  if (max > min) {
    for (let i = 1; i <= 6; i += 1) {
      palette[i + 1] = Math.round(((7 - i) * max + i * min) / 7);
    }
  } else {
    for (let i = 1; i <= 4; i += 1) {
      palette[i + 1] = Math.round(((5 - i) * max + i * min) / 5);
    }
    palette[6] = 0;
    palette[7] = 255;
  }

  let bits = BigInt(0);
  for (let i = 0; i < 16; i += 1) {
    let best = 0;
    let bestDistance = Infinity;
    for (let p = 0; p < palette.length; p += 1) {
      const distance = Math.abs(block[i][3] - palette[p]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = p;
      }
    }
    bits |= BigInt(best) << BigInt(i * 3);
  }

  const out = new Uint8Array(8);
  out[0] = max;
  out[1] = min;
  for (let i = 0; i < 6; i += 1) {
    out[2 + i] = Number((bits >> BigInt(i * 8)) & BigInt(0xff));
  }
  return out;
}

function chooseColorEndpoints(block, transparent, quality) {
  const candidates = block.filter((pixel) => !transparent || pixel[3] >= 128);
  if (!candidates.length) {
    return { min: [0, 0, 0, 0], max: [0, 0, 0, 0] };
  }

  const luma = chooseLumaEndpoints(candidates);
  if (quality <= 0) return luma;

  const bounds = chooseBoundsEndpoints(candidates);
  if (quality === 1) return bounds;

  const farthest = chooseFarthestEndpoints(candidates);
  if (quality < 3) return farthest;

  return [luma, bounds, farthest].reduce((best, pair) => {
    const score = scoreEndpointPair(block, pair, transparent);
    if (score < best.score) {
      return { pair, score };
    }
    return best;
  }, { pair: luma, score: Infinity }).pair;
}

function chooseLumaEndpoints(candidates) {
  let min = null;
  let max = null;
  let minLuma = Infinity;
  let maxLuma = -Infinity;
  for (const pixel of candidates) {
    const luma = pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114;
    if (luma < minLuma) {
      minLuma = luma;
      min = pixel;
    }
    if (luma > maxLuma) {
      maxLuma = luma;
      max = pixel;
    }
  }
  return { min, max };
}

function chooseBoundsEndpoints(candidates) {
  const min = [255, 255, 255, 255];
  const max = [0, 0, 0, 255];
  for (const pixel of candidates) {
    min[0] = Math.min(min[0], pixel[0]);
    min[1] = Math.min(min[1], pixel[1]);
    min[2] = Math.min(min[2], pixel[2]);
    max[0] = Math.max(max[0], pixel[0]);
    max[1] = Math.max(max[1], pixel[1]);
    max[2] = Math.max(max[2], pixel[2]);
  }
  return { min, max };
}

function chooseFarthestEndpoints(candidates) {
  let min = candidates[0];
  let max = candidates[0];
  let best = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i; j < candidates.length; j += 1) {
      const distance = colorDistance(candidates[i], candidates[j]);
      if (distance > best) {
        best = distance;
        min = candidates[i];
        max = candidates[j];
      }
    }
  }
  return { min, max };
}

function scoreEndpointPair(block, endpoints, transparent) {
  let c0 = rgbTo565(endpoints.max[0], endpoints.max[1], endpoints.max[2]);
  let c1 = rgbTo565(endpoints.min[0], endpoints.min[1], endpoints.min[2]);
  if (transparent && c0 > c1) {
    [c0, c1] = [c1, c0];
  } else if (!transparent && c0 < c1) {
    [c0, c1] = [c1, c0];
  }
  const palette = buildDXTColorPalette(c0, c1, transparent);
  let score = 0;
  for (const pixel of block) {
    if (transparent && pixel[3] < 128) continue;
    const index = closestColorIndex(pixel, palette, transparent ? 3 : 4);
    score += colorDistance(pixel, palette[index]);
  }
  return score;
}

function buildDXTColorPalette(c0, c1, transparent) {
  const a = colorFrom565(c0);
  const b = colorFrom565(c1);
  const palette = [a, b];
  if (c0 > c1 || !transparent) {
    palette[2] = [
      Math.round((2 * a[0] + b[0]) / 3),
      Math.round((2 * a[1] + b[1]) / 3),
      Math.round((2 * a[2] + b[2]) / 3),
      255,
    ];
    palette[3] = [
      Math.round((a[0] + 2 * b[0]) / 3),
      Math.round((a[1] + 2 * b[1]) / 3),
      Math.round((a[2] + 2 * b[2]) / 3),
      255,
    ];
  } else {
    palette[2] = [
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
      255,
    ];
    palette[3] = [0, 0, 0, 0];
  }
  return palette;
}

function closestColorIndex(pixel, palette, count) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < count; i += 1) {
    const p = palette[i];
    const dr = pixel[0] - p[0];
    const dg = pixel[1] - p[1];
    const db = pixel[2] - p[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function shouldDither(format, options) {
  return !!options.dither && (
    format === TEXTURE_FORMATS.RGB565 ||
    format === TEXTURE_FORMATS.BGRA5551 ||
    format === TEXTURE_FORMATS.BGRA4444
  );
}

function applyFloydSteinbergDither(rgba, width, height, format) {
  const work = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 1) {
    work[i] = rgba[i];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const oldPixel = [
        clampByte(work[i]),
        clampByte(work[i + 1]),
        clampByte(work[i + 2]),
        clampByte(work[i + 3]),
      ];
      const nextPixel = quantizePixelForFormat(oldPixel, format);
      work[i] = nextPixel[0];
      work[i + 1] = nextPixel[1];
      work[i + 2] = nextPixel[2];
      work[i + 3] = nextPixel[3];

      diffuseError(work, width, height, x + 1, y, oldPixel, nextPixel, 7 / 16, format);
      diffuseError(work, width, height, x - 1, y + 1, oldPixel, nextPixel, 3 / 16, format);
      diffuseError(work, width, height, x, y + 1, oldPixel, nextPixel, 5 / 16, format);
      diffuseError(work, width, height, x + 1, y + 1, oldPixel, nextPixel, 1 / 16, format);
    }
  }

  return Uint8ClampedArray.from(work, clampByte);
}

function diffuseError(work, width, height, x, y, oldPixel, nextPixel, factor, format) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const i = (y * width + x) * 4;
  const channels = format === TEXTURE_FORMATS.RGB565 ? 3 : 4;
  for (let channel = 0; channel < channels; channel += 1) {
    work[i + channel] += (oldPixel[channel] - nextPixel[channel]) * factor;
  }
}

function quantizePixelForFormat(pixel, format) {
  if (format === TEXTURE_FORMATS.RGB565) {
    const value = rgbTo565(pixel[0], pixel[1], pixel[2]);
    const rgb = colorFrom565(value);
    return [rgb[0], rgb[1], rgb[2], pixel[3]];
  }
  if (format === TEXTURE_FORMATS.BGRA5551) {
    return [
      Math.round(((pixel[0] >> 3) * 255) / 31),
      Math.round(((pixel[1] >> 3) * 255) / 31),
      Math.round(((pixel[2] >> 3) * 255) / 31),
      pixel[3] >= 128 ? 255 : 0,
    ];
  }
  return [
    Math.round(((pixel[0] >> 4) * 255) / 15),
    Math.round(((pixel[1] >> 4) * 255) / 15),
    Math.round(((pixel[2] >> 4) * 255) / 15),
    Math.round(((pixel[3] >> 4) * 255) / 15),
  ];
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value || 0)));
}

function rgbTo565(r, g, b) {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function colorFrom565(value) {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  return [
    Math.round((r * 255) / 31),
    Math.round((g * 255) / 63),
    Math.round((b * 255) / 31),
    255,
  ];
}

function writeUint16(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >> 8) & 0xff;
}

function writeUint32(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >> 8) & 0xff;
  out[offset + 2] = (value >> 16) & 0xff;
  out[offset + 3] = (value >> 24) & 0xff;
}
