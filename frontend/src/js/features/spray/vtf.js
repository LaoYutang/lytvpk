import {
  TEXTURE_FORMATS,
  FORMAT_LABELS,
  buildVMTText,
  buildVTFBytes,
  estimateVTFSize,
  getMipmapDimensions,
} from "./vtf-core.js";

export { TEXTURE_FORMATS, FORMAT_LABELS, estimateVTFSize, getMipmapDimensions };

export const DEFAULT_SPRAY_OPTIONS = {
  widthMode: "auto",
  heightMode: "auto",
  customWidth: 512,
  customHeight: 512,
  rescale: true,
  mipmaps: false,
  singleFrameAnimation: false,
  singleFrameCount: 8,
  format: TEXTURE_FORMATS.DXT1,
  sampling: 0,
  dither: true,
  dxtQuality: 2,
};

const IMAGE_DECODER_MAX_FRAMES = 120;
const VIDEO_MAX_FRAMES = 120;

export async function decodeFilesAsProject(files, { requestClipOptions } = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) {
    throw new Error("请选择至少一个素材文件");
  }

  const frames = [];
  for (const file of list) {
    const decoded = await decodeFileFrames(file, { requestClipOptions });
    frames.push(...decoded.frames);
  }
  if (!frames.length) {
    throw new Error("没有可用的图像帧");
  }

  return {
    id: `spray-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: baseName(list[0].name) || "spray",
    sourceNames: list.map((file) => file.name),
    frames,
    mipOverrides: {},
  };
}

export async function decodeFilesAsBatch(files, { requestClipOptions } = {}) {
  const list = Array.from(files || []).filter(Boolean);
  const projects = [];
  for (const file of list) {
    projects.push(await decodeFilesAsProject([file], { requestClipOptions }));
  }
  return projects;
}

export async function decodeMipmapOverride(files, { requestClipOptions } = {}) {
  const project = await decodeFilesAsProject(files, { requestClipOptions });
  return project.frames;
}

export async function buildSprayOutputs(project, options) {
  if (!project || !Array.isArray(project.frames) || !project.frames.length) {
    throw new Error("请先导入喷漆素材");
  }

  const finalOptions = { ...DEFAULT_SPRAY_OPTIONS, ...(options || {}) };
  const size = resolveOutputSize(project, finalOptions);
  const payload = prepareVTFPayload(project, finalOptions, size);
  let vtfBytes;

  try {
    vtfBytes = await buildVTFWithWorker(payload);
  } catch (error) {
    vtfBytes = buildVTFBytes(payload);
  }

  const outputName = getProjectOutputName(project);
  return {
    name: outputName,
    width: size.width,
    height: size.height,
    frameCount: payload.frameCount,
    mipmapCount: payload.mipmaps.length,
    format: Number(finalOptions.format),
    vtfBytes,
    vtfBase64: bytesToBase64(vtfBytes),
    vmtText: buildVMTText(outputName),
    estimatedSize: vtfBytes.length,
  };
}

export function resolveOutputSize(project, options) {
  const frames = project?.frames || [];
  const maxSource = frames.reduce(
    (acc, frame) => ({
      width: Math.max(acc.width, frame.width || frame.canvas?.width || 1),
      height: Math.max(acc.height, frame.height || frame.canvas?.height || 1),
    }),
    { width: 1, height: 1 }
  );

  const width =
    options.widthMode === "custom"
      ? Number(options.customWidth)
      : options.widthMode === "auto"
        ? maxSource.width
        : Number(options.widthMode);
  const height =
    options.heightMode === "custom"
      ? Number(options.customHeight)
      : options.heightMode === "auto"
        ? maxSource.height
        : Number(options.heightMode);

  return {
    width: clampDimension(width),
    height: clampDimension(height),
  };
}

export function sanitizeOutputName(value) {
  return String(value || "spray")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "") || "spray";
}

function getProjectOutputName(project) {
  const sourceName = Array.isArray(project?.sourceNames) ? project.sourceNames[0] : "";
  return sanitizeOutputName(project?.name || baseName(sourceName) || "spray");
}

export function drawFrameToCanvas(frame, targetCanvas, options = {}) {
  const width = targetCanvas.width;
  const height = targetCanvas.height;
  const ctx = targetCanvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  drawCanvasCentered(ctx, frame.canvas, width, height, options.rescale !== false);
}

function prepareVTFPayload(project, options, size) {
  const baseFrames = getProjectFrames(project, options);
  const mipDimensions =
    options.mipmaps && size.width <= 512 && size.height <= 512
      ? getMipmapDimensions(size.width, size.height)
      : [{ width: size.width, height: size.height }];

  const mipmaps = mipDimensions.map((dim, level) => {
    const override = Array.isArray(project.mipOverrides?.[level])
      ? project.mipOverrides[level]
      : null;
    const sourceFrames = override && override.length ? override : baseFrames;
    return baseFrames.map((_, frameIndex) => {
      const source = sourceFrames[Math.min(frameIndex, sourceFrames.length - 1)];
      return renderFrameImageData(source, dim.width, dim.height, options.rescale);
    });
  });

  return {
    width: size.width,
    height: size.height,
    frameCount: baseFrames.length,
    format: Number(options.format),
    sampling: Number(options.sampling || 0),
    dither: !!options.dither,
    dxtQuality: Number(options.dxtQuality || 2),
    mipmaps,
  };
}

function getProjectFrames(project, options) {
  if (
    options.singleFrameAnimation &&
    project.frames.length === 1 &&
    Number(options.singleFrameCount) > 1
  ) {
    return Array.from({ length: clamp(Number(options.singleFrameCount), 2, 64) }, () => project.frames[0]);
  }
  return project.frames;
}

function renderFrameImageData(frame, width, height, rescale) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  drawCanvasCentered(ctx, frame.canvas, width, height, rescale !== false);
  const imageData = ctx.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: imageData.data,
  };
}

function drawCanvasCentered(ctx, sourceCanvas, width, height, rescale) {
  const srcWidth = sourceCanvas.width || 1;
  const srcHeight = sourceCanvas.height || 1;
  let drawWidth = srcWidth;
  let drawHeight = srcHeight;
  if (rescale) {
    const scale = Math.min(width / srcWidth, height / srcHeight);
    drawWidth = Math.max(1, Math.round(srcWidth * scale));
    drawHeight = Math.max(1, Math.round(srcHeight * scale));
  }
  const x = Math.round((width - drawWidth) / 2);
  const y = Math.round((height - drawHeight) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, x, y, drawWidth, drawHeight);
}

function buildVTFWithWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./spray-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data?.ok) {
        resolve(new Uint8Array(event.data.bytes));
      } else {
        reject(new Error(event.data?.error || "Worker 转换失败"));
      }
    };
    worker.onerror = (error) => {
      worker.terminate();
      reject(error instanceof Error ? error : new Error("Worker 转换失败"));
    };
    worker.postMessage(payload);
  });
}

async function decodeFileFrames(file, { requestClipOptions } = {}) {
  if (isVideoFile(file)) {
    return decodeVideoFile(file, { requestClipOptions });
  }
  if (isTGAFile(file)) {
    const canvas = decodeTGAToCanvas(await file.arrayBuffer());
    return frameResult(file, [canvas]);
  }
  if (isGifFile(file)) {
    const frames = await decodeGifFile(file, { requestClipOptions });
    return frameResult(file, frames);
  }

  const canvas = await loadImageToCanvas(file);
  return frameResult(file, [canvas]);
}

async function decodeGifFile(file, { requestClipOptions } = {}) {
  if (!("ImageDecoder" in window)) {
    return [await loadImageToCanvas(file)];
  }

  const bytes = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: bytes, type: file.type || "image/gif" });
  await decoder.tracks.ready;
  const frameCount = Number(decoder.tracks.selectedTrack?.frameCount || 1);
  const safeFrameCount = Number.isFinite(frameCount)
    ? Math.min(frameCount, IMAGE_DECODER_MAX_FRAMES)
    : IMAGE_DECODER_MAX_FRAMES;
  const opts = await getClipOptions(requestClipOptions, file, {
    type: "gif",
    frameCount: safeFrameCount,
    defaultFps: 5,
  });
  const start = clamp(Math.floor(opts.start || 0), 0, safeFrameCount - 1);
  const end = clamp(Math.ceil(opts.end || safeFrameCount), start + 1, safeFrameCount);
  const step = opts.allFrames ? 1 : Math.max(1, Math.round(5 / Math.max(1, Number(opts.fps || 5))));
  const frames = [];

  for (let i = start; i < end && frames.length < IMAGE_DECODER_MAX_FRAMES; i += step) {
    const decoded = await decoder.decode({ frameIndex: i });
    frames.push(imageBitmapToCanvas(decoded.image));
    decoded.image.close?.();
  }
  decoder.close?.();
  return frames.length ? frames : [await loadImageToCanvas(file)];
}

async function decodeVideoFile(file, { requestClipOptions } = {}) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(file);

  try {
    await waitForEvent(video, "loadedmetadata");
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForEvent(video, "loadeddata");
    }
    await waitForVideoFrame(video);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const opts = await getClipOptions(requestClipOptions, file, {
      type: "video",
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      defaultFps: 5,
    });
    const start = clamp(Number(opts.start || 0), 0, Math.max(0, duration));
    const end = clamp(Number(opts.end || duration || 0), start, Math.max(start, duration));
    const fps = opts.allFrames ? 12 : clamp(Number(opts.fps || 5), 1, 30);
    const interval = 1 / fps;
    const frames = [];

    for (
      let time = start;
      time <= end + 0.0001 && frames.length < VIDEO_MAX_FRAMES;
      time += interval
    ) {
      const targetTime = Math.min(time, duration || time);
      await seekVideoTo(video, targetTime);
      frames.push(videoFrameToCanvas(video));
    }

    const cleanedFrames = trimLeadingBlankVideoFrames(frames);
    return frameResult(file, cleanedFrames.length ? cleanedFrames : [videoFrameToCanvas(video)]);
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

async function getClipOptions(requestClipOptions, file, meta) {
  if (typeof requestClipOptions === "function") {
    const selected = await requestClipOptions(file, meta);
    if (selected?.cancelled) {
      throw new Error("已取消导入");
    }
    if (selected) return selected;
  }
  if (meta.type === "video") {
    return {
      start: 0,
      end: meta.duration || 0,
      fps: meta.defaultFps,
      allFrames: false,
    };
  }
  return {
    start: 0,
    end: meta.frameCount || 1,
    fps: meta.defaultFps,
    allFrames: true,
  };
}

function frameResult(file, canvases) {
  return {
    file,
    frames: canvases.map((canvas, index) => ({
      canvas,
      width: canvas.width,
      height: canvas.height,
      label: canvases.length > 1 ? `${file.name} #${index + 1}` : file.name,
      duration: 200,
    })),
  };
}

function loadImageToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 1;
      canvas.height = img.naturalHeight || img.height || 1;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取图片: ${file.name}`));
    };
    img.src = url;
  });
}

function imageBitmapToCanvas(bitmap) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.displayWidth || bitmap.width || 1;
  canvas.height = bitmap.displayHeight || bitmap.height || 1;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return canvas;
}

function videoFrameToCanvas(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1;
  canvas.height = video.videoHeight || 1;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function seekVideoTo(video, targetTime) {
  if (Math.abs(video.currentTime - targetTime) > 0.001) {
    video.currentTime = targetTime;
    await waitForEvent(video, "seeked");
  }
  await waitForVideoFrame(video);
}

function waitForVideoFrame(video) {
  return new Promise((resolve) => {
    let done = false;
    let callbackHandle = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (
        callbackHandle != null &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(callbackHandle);
      }
      resolve();
    };
    const timer = setTimeout(finish, 90);

    if (typeof video.requestVideoFrameCallback === "function") {
      callbackHandle = video.requestVideoFrameCallback(finish);
    } else {
      requestAnimationFrame(() => requestAnimationFrame(finish));
    }
  });
}

function trimLeadingBlankVideoFrames(frames) {
  if (frames.length <= 1) return frames;

  let firstContentIndex = -1;
  for (let i = 0; i < frames.length; i += 1) {
    if (!isNearBlankCanvas(frames[i])) {
      firstContentIndex = i;
      break;
    }
  }

  if (firstContentIndex > 0 && firstContentIndex <= 2) {
    return frames.slice(firstContentIndex);
  }
  return frames;
}

function isNearBlankCanvas(canvas) {
  const sampleSize = 32;
  const sample = document.createElement("canvas");
  sample.width = sampleSize;
  sample.height = sampleSize;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, sampleSize, sampleSize);
  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  let visiblePixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    const brightness = data[i] + data[i + 1] + data[i + 2];
    if (alpha > 12 && brightness > 30) {
      visiblePixels += 1;
    }
  }
  return visiblePixels / (data.length / 4) < 0.01;
}

function waitForEvent(target, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("媒体读取失败"));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

function decodeTGAToCanvas(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length < 18) throw new Error("TGA 文件过短");

  const idLength = data[0];
  const colorMapType = data[1];
  const imageType = data[2];
  const width = data[12] | (data[13] << 8);
  const height = data[14] | (data[15] << 8);
  const pixelDepth = data[16];
  const descriptor = data[17];
  if (colorMapType !== 0) throw new Error("暂不支持带调色板的 TGA");
  if (![2, 3, 10, 11].includes(imageType)) throw new Error("暂不支持该 TGA 类型");
  if (![8, 24, 32].includes(pixelDepth)) throw new Error("暂不支持该 TGA 位深");

  let offset = 18 + idLength;
  const bytesPerPixel = pixelDepth / 8;
  const out = new Uint8ClampedArray(width * height * 4);
  const topOrigin = (descriptor & 0x20) !== 0;

  const writePixel = (index, sourceOffset) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const destY = topOrigin ? y : height - 1 - y;
    const dest = (destY * width + x) * 4;
    if (pixelDepth === 8) {
      const value = data[sourceOffset];
      out[dest] = value;
      out[dest + 1] = value;
      out[dest + 2] = value;
      out[dest + 3] = 255;
      return;
    }
    out[dest] = data[sourceOffset + 2];
    out[dest + 1] = data[sourceOffset + 1];
    out[dest + 2] = data[sourceOffset];
    out[dest + 3] = pixelDepth === 32 ? data[sourceOffset + 3] : 255;
  };

  if (imageType === 2 || imageType === 3) {
    for (let i = 0; i < width * height; i += 1) {
      writePixel(i, offset);
      offset += bytesPerPixel;
    }
  } else {
    let index = 0;
    while (index < width * height && offset < data.length) {
      const packet = data[offset++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        const pixelOffset = offset;
        offset += bytesPerPixel;
        for (let i = 0; i < count && index < width * height; i += 1) {
          writePixel(index, pixelOffset);
          index += 1;
        }
      } else {
        for (let i = 0; i < count && index < width * height; i += 1) {
          writePixel(index, offset);
          offset += bytesPerPixel;
          index += 1;
        }
      }
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isVideoFile(file) {
  return /^video\//i.test(file.type || "");
}

function isGifFile(file) {
  return (file.type || "").toLowerCase() === "image/gif" || /\.gif$/i.test(file.name || "");
}

function isTGAFile(file) {
  const type = (file.type || "").toLowerCase();
  return type === "image/x-tga" || type === "image/targa" || /\.tga$/i.test(file.name || "");
}

function baseName(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();
}

function clampDimension(value) {
  return clamp(Math.round(Number(value) || 1), 4, 1024);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
