// VTF writing follows the original GPL-3.0 VTF-Editor conversion flow by Mishcatt.
// Keep the byte layout intentionally close to the upstream createVTF/convert.js path.

import {
  CalculateColourWeightings,
  CompressAlphaBlock,
  CompressRGBBlock,
  configureDXTQuality,
} from "./vtf-editor-dxt.js";

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
const VTF_MAX_COLUMN_HEIGHT = 32767;

const DITHER_MATRIX = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1],
  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
  [1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
  [1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

export function buildVTFBytes(payload) {
  const width = Math.max(1, payload.width | 0);
  const height = Math.max(1, payload.height | 0);
  const frames = normalizeMipFrames(payload.mipmaps);
  const frameCount = Math.max(1, frames[0]?.length || 1);
  const format = Number(payload.format ?? TEXTURE_FORMATS.DXT1);
  const sampling = Number(payload.sampling || 0);
  const shortened = !!payload.shortened;
  const hasMipmaps = frames.length > 1;

  const encodedLevels = frames.map((mipFrames, level) =>
    encodeOriginalLevel(mipFrames, {
      baseWidth: width,
      baseHeight: height,
      level,
      frameCount,
      format,
      shortened,
      dither: !!payload.dither,
      dxtQuality: Number(payload.dxtQuality || 2),
    })
  );

  const dataSize = encodedLevels.reduce((sum, level) => sum + level.length, 0);
  const file = new Uint8Array(HEADER_SIZE + dataSize);
  writeHeader(file, {
    width: shortened ? width - 4 : width,
    height,
    format,
    sampling,
    frameCount,
    mipmapCount: hasMipmaps ? frames.length : 1,
    hasMipmaps,
  });

  let pos = HEADER_SIZE;
  for (let mip = encodedLevels.length - 1; mip >= 0; mip -= 1) {
    file.set(encodedLevels[mip], pos);
    pos += encodedLevels[mip].length;
  }

  return file;
}

export function estimateVTFSize(width, height, frameCount, format, mipmaps, shortened = false) {
  const frames = Math.max(1, frameCount || 1);
  const baseWidth = Math.max(1, Math.round(Number(width) || 1));
  const baseHeight = Math.max(1, Math.round(Number(height) || 1));
  const levels = mipmaps ? getMipmapDimensions(baseWidth, baseHeight) : [{ width: baseWidth, height: baseHeight }];
  return HEADER_SIZE + levels.reduce((sum, _, level) => {
    const levelWidth = Math.max(1, Math.floor(baseWidth / (2 ** level)));
    const levelFrameHeight = Math.max(1, Math.floor(baseHeight / (2 ** level)));
    const encodedWidth = shortened ? levelWidth - 4 : levelWidth;
    const totalHeight = levelFrameHeight * frames;
    return sum + getOriginalEncodedSize(encodedWidth, totalHeight, format);
  }, 0);
}

export function getMipmapDimensions(width, height) {
  const levels = [{ width: Math.max(1, width | 0), height: Math.max(1, height | 0) }];
  for (let divisor = 2; width / divisor > 16 && height / divisor > 16; divisor *= 2) {
    levels.push({
      width: Math.max(1, Math.floor(width / divisor)),
      height: Math.max(1, Math.floor(height / divisor)),
    });
  }
  return levels;
}

export function shouldUseOriginalMipmaps(width, height, frameCount, format, sampling, shortened = false) {
  const sizeKB = estimateVTFSize(width, height, frameCount, format, false, shortened) / 1024;
  return sizeKB < 385 &&
    !shortened &&
    Number(sampling || 0) !== 1 &&
    width % 64 === 0 &&
    height % 64 === 0;
}

export function shouldShortenOriginalVTF(width, height, frameCount, format) {
  const sizeKB = estimateVTFSize(width, height, frameCount, format, false, false) / 1024;
  return sizeKB >= 512 && sizeKB < 513;
}

export function buildVMTText(name) {
  const clean = sanitizeVMTTextureName(name || "spray");
  return `"UnlitGeneric"
{
\t"$basetexture" "vgui/logos/custom/${clean}"
\t"$translucent" "1"
\t"$ignorez" "1"
\t"$vertexcolor" "1"
\t"$vertexalpha" "1"
}
`;
}

function encodeOriginalLevel(mipFrames, options) {
  const levelWidth = Math.max(1, Math.floor(options.baseWidth / (2 ** options.level)));
  const levelFrameHeight = Math.max(1, Math.floor(options.baseHeight / (2 ** options.level)));
  const encodedWidth = options.shortened ? levelWidth - 4 : levelWidth;
  const rows = getFrameRows(options.frameCount, options.baseHeight);
  const columns = getFrameColumns(options.frameCount, options.baseHeight);
  const strips = [];
  const workerCountForLevel = getWorkerCount(levelFrameHeight * options.frameCount);

  for (let column = 0; column < columns; column += 1) {
    let columnHeight = levelFrameHeight * options.frameCount;
    if (columns > 1) {
      columnHeight = column === columns - 1
        ? (options.frameCount % rows) * options.baseHeight
        : rows * options.baseHeight;
    }

    const workerCount = Math.max(1, Math.min(workerCountForLevel, Math.ceil(Math.max(1, columnHeight) / 64)));
    let stripHeight = Math.ceil(columnHeight / workerCount / 4) * 4;
    let stripStart = 0;

    for (let strip = 0; strip < workerCount; strip += 1) {
      if (strip === workerCount - 1) {
        stripHeight = columnHeight - stripStart;
      }
      const stripIndex = strip * columns + column;
      strips[stripIndex] = encodeOriginalStrip(mipFrames, {
        ...options,
        levelWidth,
        levelFrameHeight,
        encodedWidth,
        rows,
        columns,
        column,
        stripStart,
        stripHeight,
      });
      stripStart += stripHeight;
    }
  }

  return concatByteArrays(strips.filter(Boolean));
}

function encodeOriginalStrip(mipFrames, options) {
  const format = Number(options.format);
  const strip = collectOriginalStripPixels(mipFrames, options);
  if (format === TEXTURE_FORMATS.DXT1 || format === TEXTURE_FORMATS.DXT5) {
    return encodeOriginalDXT(strip, options);
  }
  if (format === TEXTURE_FORMATS.RGBA8888) {
    return strip.data;
  }

  if (format === TEXTURE_FORMATS.RGB888) {
    forceOpaque(strip.data);
    return packRGB888Original(strip.data);
  }
  if (format === TEXTURE_FORMATS.RGB565) {
    forceOpaque(strip.data);
    reduceColorsOriginal(strip, 5, 6, 5, 8, options.dither);
    return packRGB565Original(strip.data);
  }
  if (format === TEXTURE_FORMATS.BGRA5551) {
    reduceColorsOriginal(strip, 5, 5, 5, 1, options.dither);
    return packBGRA5551Original(strip.data);
  }
  if (format === TEXTURE_FORMATS.BGRA4444) {
    reduceColorsOriginal(strip, 4, 4, 4, 4, options.dither);
    return packBGRA4444Original(strip.data);
  }
  return strip.data;
}

function collectOriginalStripPixels(mipFrames, options) {
  const isDXT = options.format === TEXTURE_FORMATS.DXT1 || options.format === TEXTURE_FORMATS.DXT5;
  const width = isDXT ? Math.ceil(options.encodedWidth / 4) * 4 : options.encodedWidth;
  const height = isDXT ? Math.ceil(options.stripHeight / 4) * 4 : options.stripHeight;
  const out = new Uint8ClampedArray(Math.max(0, width * height * 4));
  const cropStart = (options.levelWidth * options.columns) / 2 / options.columns -
    options.encodedWidth / 2 +
    options.column * options.encodedWidth;

  for (let y = 0; y < height; y += 1) {
    const virtualY = options.stripStart + y;
    const frameOffsetInColumn = Math.floor(virtualY / options.levelFrameHeight);
    const frameIndex = options.column * options.rows + frameOffsetInColumn;
    const sourceFrame = mipFrames[Math.min(frameIndex, mipFrames.length - 1)];
    const sourceY = virtualY - frameOffsetInColumn * options.levelFrameHeight;

    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.round(cropStart + x - options.column * options.levelWidth);
      const dest = (y * width + x) * 4;
      if (!sourceFrame ||
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX >= sourceFrame.width ||
        sourceY >= sourceFrame.height) {
        continue;
      }
      const src = (sourceY * sourceFrame.width + sourceX) * 4;
      out[dest] = sourceFrame.data[src];
      out[dest + 1] = sourceFrame.data[src + 1];
      out[dest + 2] = sourceFrame.data[src + 2];
      out[dest + 3] = sourceFrame.data[src + 3];
    }
  }

  return { width, height, data: out };
}

function encodeOriginalDXT(strip, options) {
  configureDXTQuality(Number(options.dxtQuality || 2));
  const out = new Int32Array(Math.ceil(strip.width / 4) * 4 * Math.ceil(strip.height / 4) * 4 /
    (options.format === TEXTURE_FORMATS.DXT1 ? 8 : 4));
  const bufsrc = new Int32Array(16);
  const bufprv = new Uint8Array(64);
  const bufsrcalpha = new Uint8Array(16);
  const bufout = new Int32Array(2);
  let blockPosition = 0;

  for (let blockY = 0; blockY < strip.height / 4; blockY += 1) {
    for (let blockX = 0; blockX < strip.width / 4; blockX += 1) {
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const position = x * 4 + (16 * blockX) + (strip.width * 16 * blockY) + (strip.width * 4 * y);
          bufsrc[x + y * 4] =
            (strip.data[position + 3] << 24) +
            (strip.data[position] << 16) +
            (strip.data[position + 1] << 8) +
            strip.data[position + 2];
        }
      }

      if (options.format === TEXTURE_FORMATS.DXT5) {
        for (let y = 0; y < 4; y += 1) {
          for (let x = 0; x < 4; x += 1) {
            const position = x * 4 + (16 * blockX) + (strip.width * 16 * blockY) + (strip.width * 4 * y);
            bufsrcalpha[x + y * 4] = strip.data[position + 3];
          }
        }
        CompressAlphaBlock(bufsrcalpha, bufout, bufprv);
        out.set(bufout, blockPosition);
        blockPosition += 2;
      }

      CompressRGBBlock(
        bufsrc,
        bufout,
        CalculateColourWeightings(bufsrc),
        options.format === TEXTURE_FORMATS.DXT1,
        options.format === TEXTURE_FORMATS.DXT1,
        127,
        bufprv
      );
      out.set(bufout, blockPosition);
      blockPosition += 2;
    }
  }

  const bytes = new Uint8Array(out.length * 4);
  let pos = 0;
  for (let i = 0; i < out.length; i += 1) {
    writeUint32(bytes, pos, out[i]);
    pos += 4;
  }
  return bytes;
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
  file[20] = 12 + Number(options.sampling || 0);
  file[21] = 35 - (options.hasMipmaps ? 1 : 0);
  writeUint16(file, 24, options.frameCount);
  file[52] = options.format & 0xff;
  file[56] = options.mipmapCount & 0xff;
  file[57] = TEXTURE_FORMATS.DXT1;
  file[62] = 0;
  file[63] = 1;
}

function getOriginalEncodedSize(width, totalHeight, format) {
  if (format === TEXTURE_FORMATS.DXT1) {
    return Math.ceil(width / 4) * Math.ceil(totalHeight / 4) * 8;
  }
  if (format === TEXTURE_FORMATS.DXT5) {
    return Math.ceil(width / 4) * Math.ceil(totalHeight / 4) * 16;
  }
  if (format === TEXTURE_FORMATS.RGBA8888) return width * totalHeight * 4;
  if (format === TEXTURE_FORMATS.RGB888) return width * totalHeight * 3;
  return width * totalHeight * 2;
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

function reduceColorsOriginal(image, rb, gb, bb, ab, useDither) {
  const data = image.data;
  const rs = 8 - rb;
  const gs = 8 - gb;
  const bs = 8 - bb;
  const as = 8 - ab;
  const rm = 255 / (255 >> rs);
  const gm = 255 / (255 >> gs);
  const bm = 255 / (255 >> bs);
  const am = 255 / (255 >> as);

  for (let x = 0; x < image.width; x += 1) {
    for (let y = 0; y < image.height; y += 1) {
      const pixel = (y * image.width * 4) + (x * 4);
      const color = [data[pixel], data[pixel + 1], data[pixel + 2]];
      const floor = [
        Math.round(Math.floor(data[pixel] / rm) * rm),
        Math.round(Math.floor(data[pixel + 1] / gm) * gm),
        Math.round(Math.floor(data[pixel + 2] / bm) * bm),
      ];
      const ceil = [
        Math.round(Math.ceil(data[pixel] / rm) * rm),
        Math.round(Math.ceil(data[pixel + 1] / gm) * gm),
        Math.round(Math.ceil(data[pixel + 2] / bm) * bm),
      ];
      const closest = bestMatchOriginal([floor, ceil], color);
      const closest2 = closest[0] === floor[0] && closest[1] === floor[1] && closest[2] === floor[2]
        ? ceil
        : floor;
      let alpha = Math.round(Math.floor(data[pixel + 3] / am) * am);
      const alpha2 = Math.round(Math.ceil(data[pixel + 3] / am) * am);
      if (Math.abs(alpha - data[pixel + 3]) > Math.abs(alpha2 - data[pixel + 3])) {
        alpha = alpha2;
      }

      if (useDither) {
        const between = [];
        for (let b = 0; b < 17; b += 1) {
          between.push([
            closest[0] + (closest2[0] - closest[0]) * b / 16,
            closest[1] + (closest2[1] - closest[1]) * b / 16,
            closest[2] + (closest2[2] - closest[2]) * b / 16,
          ]);
        }
        const closest3 = bestMatchOriginal(between, color);
        const index3 = between.indexOf(closest3);
        const trans = [closest, closest2][getDitherOriginal(DITHER_MATRIX[index3], x, y)];
        data[pixel] = trans[0];
        data[pixel + 1] = trans[1];
        data[pixel + 2] = trans[2];
      } else {
        data[pixel] = closest[0];
        data[pixel + 1] = closest[1];
        data[pixel + 2] = closest[2];
      }
      data[pixel + 3] = alpha;
    }
  }
}

function bestMatchOriginal(palette, color) {
  let best = [Infinity, [0, 0, 0]];
  for (let i = 0; i < palette.length; i += 1) {
    const difference = Math.abs(palette[i][0] - color[0]) +
      Math.abs(palette[i][1] - color[1]) +
      Math.abs(palette[i][2] - color[2]);
    if (difference < best[0]) {
      best = [difference, palette[i]];
    }
  }
  return best[1];
}

function getDitherOriginal(matrix, x, y) {
  return matrix[((y % 4) * 4) + (x % 4)];
}

function forceOpaque(data) {
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 255;
  }
}

function packRGB888Original(data) {
  const out = new Uint8Array((data.length / 4) * 3);
  let pos = 0;
  for (let k = 0; k < data.length; k += 4) {
    out[pos] = data[k];
    out[pos + 1] = data[k + 1];
    out[pos + 2] = data[k + 2];
    pos += 3;
  }
  return out;
}

function packRGB565Original(data) {
  const out = new Uint8Array((data.length / 4) * 2);
  let pos = 0;
  for (let k = 0; k < data.length; k += 4) {
    writeUint16(out, pos, (data[k] >> 3) + ((data[k + 1] >> 2) << 5) + ((data[k + 2] >> 3) << 11));
    pos += 2;
  }
  return out;
}

function packBGRA5551Original(data) {
  // VTF-Editor's BGRA5551 writer references the wrong loop variable, so it emits zeros.
  return new Uint8Array((data.length / 4) * 2);
}

function packBGRA4444Original(data) {
  const out = new Uint8Array((data.length / 4) * 2);
  let pos = 0;
  for (let k = 0; k < data.length; k += 4) {
    writeUint16(out, pos, ((data[k] >> 4) << 8) +
      ((data[k + 1] >> 4) << 4) +
      (data[k + 2] >> 4) +
      ((data[k + 3] >> 4) << 12));
    pos += 2;
  }
  return out;
}

function getFrameRows(frameCount, height) {
  return Math.min(frameCount, Math.floor(VTF_MAX_COLUMN_HEIGHT / height));
}

function getFrameColumns(frameCount, height) {
  return Math.ceil(frameCount * height / VTF_MAX_COLUMN_HEIGHT);
}

function getWorkerCount(height) {
  const concurrency = typeof navigator !== "undefined" && navigator.hardwareConcurrency
    ? navigator.hardwareConcurrency
    : 1;
  return Math.max(1, Math.min(concurrency, Math.ceil(height / 64)));
}

function concatByteArrays(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function sanitizeVMTTextureName(value) {
  return String(value || "spray")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "") || "spray";
}

function writeUint16(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}
