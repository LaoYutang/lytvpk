import { showError, showNotification } from "../../core/toast.js";
import {
  DEFAULT_SPRAY_OPTIONS,
  FORMAT_LABELS,
  TEXTURE_FORMATS,
  buildSprayOutputs,
  decodeFilesAsBatch,
  decodeFilesAsProject,
  decodeMipmapOverride,
  drawFrameToCanvas,
  estimateVTFSize,
  getMipmapDimensions,
  resolveOutputSize,
  sanitizeOutputName,
} from "./vtf.js";

const RESOLUTION_PRESETS = [1024, 768, 720, 512, 256, 128, 64, 32, 16, 8, 4];
const ACCEPTED_FILES = "image/*,.tga,video/*";
const SPRAY_IMPORT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".tga",
  ".mp4",
  ".webm",
  ".ogv",
  ".ogg",
  ".mov",
  ".m4v",
  ".avi",
  ".mkv",
  ".wmv",
]);

const state = {
  projects: [],
  activeProjectId: null,
  options: { ...DEFAULT_SPRAY_OPTIONS },
  packageName: "spray_pack",
  frameIndex: 0,
  playing: false,
  timer: null,
  busy: false,
  refreshFilesKeepFilter: null,
};

let refs = {};

export function openSprayTool({ refreshFilesKeepFilter } = {}) {
  state.refreshFilesKeepFilter = refreshFilesKeepFilter || null;
  ensureSprayModal();
  refs.modal.classList.remove("hidden");
  renderAll();
  updatePreview();
}

export function isSprayImportPath(path) {
  const ext = getPathExtension(path);
  return SPRAY_IMPORT_EXTENSIONS.has(ext);
}

export function isSprayImportFile(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/") || isSprayImportPath(file.name);
}

export async function importSprayFiles(files = [], { refreshFilesKeepFilter } = {}) {
  const sprayFiles = Array.from(files || []).filter(isSprayImportFile);
  if (!sprayFiles.length) return false;

  openSprayTool({ refreshFilesKeepFilter });
  await importPrimaryFiles(sprayFiles);
  return true;
}

export async function importSprayPaths(paths = [], { refreshFilesKeepFilter } = {}) {
  const sprayPaths = Array.from(paths || []).filter(isSprayImportPath);
  if (!sprayPaths.length) return false;

  openSprayTool({ refreshFilesKeepFilter });
  setBusy(true, "正在读取拖入素材...");
  try {
    const payloads = await callApp("LoadSprayImportFiles", sprayPaths);
    const files = sprayPayloadsToFiles(payloads || []);
    await importPrimaryFiles(files);
    return true;
  } catch (error) {
    showError("导入喷漆素材失败: " + formatError(error));
    return false;
  } finally {
    setBusy(false);
  }
}

function ensureSprayModal() {
  let modal = document.getElementById("spray-tool-modal");
  if (modal) {
    refs.modal = modal;
    collectRefs();
    return;
  }

  modal = el("div", "modal hidden spray-tool-modal");
  modal.id = "spray-tool-modal";
  modal.appendChild(createModalContent());
  document.body.appendChild(modal);
  refs.modal = modal;
  collectRefs();
  bindStaticEvents();
}

function createModalContent() {
  const content = el("div", "modal-content spray-tool-content");

  const header = el("div", "modal-header spray-tool-header");
  const titleWrap = el("div", "spray-tool-title-wrap");
  titleWrap.append(
    el("h3", "", "喷漆制作"),
    el("p", "", "制作 L4D2 可用的 VTF/VMT 喷漆，并可直接打包安装。")
  );
  const closeBtn = button("spray-tool-close", "close-btn", "×");
  closeBtn.setAttribute("aria-label", "关闭");
  header.append(titleWrap, closeBtn);

  const body = el("div", "modal-body spray-tool-body");
  body.append(createImportPanel(), createPreviewPanel(), createSettingsPanel());

  const footer = el("div", "modal-footer spray-tool-footer");
  const status = el("div", "spray-tool-footer-status");
  status.id = "spray-footer-status";
  const actions = el("div", "spray-tool-footer-actions");
  actions.append(
    button("spray-export-btn", "btn btn-secondary", "导出文件"),
    button("spray-install-btn", "btn btn-primary", "制作 VPK 并安装")
  );
  footer.append(status, actions);

  content.append(header, body, footer);
  return content;
}

function createImportPanel() {
  const panel = el("section", "spray-panel spray-import-panel");
  panel.append(panelTitle("素材", "导入帧、动画或批量素材"));

  const primaryBtn = button("spray-primary-import-btn", "btn btn-primary", "选择素材");
  const primaryInput = input("file", "spray-primary-input");
  primaryInput.accept = ACCEPTED_FILES;
  primaryInput.multiple = true;
  primaryInput.classList.add("hidden");

  const batchBtn = button("spray-batch-import-btn", "btn btn-secondary", "批量导入");
  const batchInput = input("file", "spray-batch-input");
  batchInput.accept = ACCEPTED_FILES;
  batchInput.multiple = true;
  batchInput.classList.add("hidden");

  const buttonRow = el("div", "spray-import-buttons");
  buttonRow.append(primaryBtn, batchBtn, primaryInput, batchInput);

  const list = el("div", "spray-project-list");
  list.id = "spray-project-list";

  panel.append(buttonRow, list);
  return panel;
}

function createPreviewPanel() {
  const panel = el("section", "spray-panel spray-preview-panel");
  const header = panelTitle("预览", "按当前分辨率和缩放设置显示");
  const meta = el("div", "spray-preview-meta");
  meta.id = "spray-preview-meta";
  header.appendChild(meta);

  const stage = el("div", "spray-preview-stage");
  const canvas = document.createElement("canvas");
  canvas.id = "spray-preview-canvas";
  canvas.width = 512;
  canvas.height = 512;
  stage.appendChild(canvas);

  const controls = el("div", "spray-playback-controls");
  controls.append(
    button("spray-prev-frame-btn", "btn btn-icon", "‹"),
    button("spray-play-btn", "btn btn-secondary", "播放"),
    button("spray-next-frame-btn", "btn btn-icon", "›"),
    el("span", "spray-frame-label", "0 / 0")
  );
  controls.querySelector(".spray-frame-label").id = "spray-frame-label";

  const frameStrip = el("div", "spray-frame-strip");
  frameStrip.id = "spray-frame-strip";

  panel.append(header, stage, controls, frameStrip);
  return panel;
}

function createSettingsPanel() {
  const panel = el("section", "spray-panel spray-settings-panel");
  panel.append(panelTitle("设置", "输出参数"));

  const form = el("div", "spray-settings-form");
  const sizeNote = el("div", "spray-size-note", "");
  sizeNote.id = "spray-size-note";
  sizeNote.hidden = true;
  form.append(
    textControl("喷漆名称", "spray-project-name", "", "留空默认使用素材文件名"),
    textControl("VPK 名称", "spray-package-name", state.packageName),
    dimensionControl("宽度", "spray-width-value"),
    dimensionControl("高度", "spray-height-value"),
    checkboxControl("缩放以适应", "spray-rescale", true),
    checkboxControl("生成 Mipmaps", "spray-mipmaps", false),
    createMipmapControls(),
    checkboxControl("单张图片制作动画", "spray-single-frame", false),
    numberControl("单张动画帧数", "spray-single-frame-count", 8, 2, 64),
    formatControl(),
    selectControl("采样方法", "spray-sampling", [
      ["0", "默认"],
      ["1", "点采样"],
      ["2", "三线性"],
      ["16", "各向异性"],
    ]),
    checkboxControl("使用抖动", "spray-dither", true),
    selectControl("DXT 压缩质量", "spray-dxt-quality", [
      ["0", "快速"],
      ["1", "普通"],
      ["2", "慢速"],
      ["3", "非常慢"],
    ]),
    sizeNote
  );
  panel.appendChild(form);
  return panel;
}

function createMipmapControls() {
  const wrap = el("div", "spray-mipmap-controls");
  const row = el("div", "spray-control spray-control-inline");
  const label = el("label", "", "替换层级");
  label.setAttribute("for", "spray-mipmap-level");
  row.append(label, customSelectInput("spray-mipmap-level", []));

  const actions = el("div", "spray-mipmap-actions");
  const inputEl = input("file", "spray-mipmap-input");
  inputEl.accept = ACCEPTED_FILES;
  inputEl.multiple = true;
  inputEl.classList.add("hidden");
  actions.append(
    button("spray-mipmap-import-btn", "btn btn-secondary", "替换 Mipmap"),
    button("spray-mipmap-clear-btn", "btn btn-secondary", "清除替换"),
    inputEl
  );
  wrap.append(row, actions);
  return wrap;
}

function formatControl() {
  const pairs = [
    [TEXTURE_FORMATS.RGBA8888, "RGBA8888"],
    [TEXTURE_FORMATS.RGB888, "RGB888"],
    [TEXTURE_FORMATS.RGB565, "RGB565"],
    [TEXTURE_FORMATS.BGRA5551, "BGRA5551"],
    [TEXTURE_FORMATS.BGRA4444, "BGRA4444"],
    [TEXTURE_FORMATS.DXT1, "DXT1（推荐）"],
    [TEXTURE_FORMATS.DXT5, "DXT5（透明度更细）"],
  ];
  return selectControl("纹理格式", "spray-format", pairs);
}

function bindStaticEvents() {
  refs.closeBtn.addEventListener("click", closeSprayTool);
  refs.modal.addEventListener("click", (event) => {
    if (event.target === refs.modal) closeSprayTool();
  });
  refs.settingsPanel?.addEventListener("scroll", () => closeSprayDropdowns());

  refs.primaryImportBtn.addEventListener("click", () => refs.primaryInput.click());
  refs.batchImportBtn.addEventListener("click", () => refs.batchInput.click());
  refs.primaryInput.addEventListener("change", async () => {
    await importPrimaryFiles(refs.primaryInput.files);
    refs.primaryInput.value = "";
  });
  refs.batchInput.addEventListener("change", async () => {
    await importBatchFiles(refs.batchInput.files);
    refs.batchInput.value = "";
  });

  refs.prevBtn.addEventListener("click", () => moveFrame(-1));
  refs.nextBtn.addEventListener("click", () => moveFrame(1));
  refs.playBtn.addEventListener("click", togglePlayback);
  refs.exportBtn.addEventListener("click", exportSprayFiles);
  refs.installBtn.addEventListener("click", installSprayVPK);
  refs.mipmapImportBtn.addEventListener("click", () => refs.mipmapInput.click());
  refs.mipmapInput.addEventListener("change", async () => {
    await importMipmapOverride(refs.mipmapInput.files);
    refs.mipmapInput.value = "";
  });
  refs.mipmapClearBtn.addEventListener("click", clearMipmapOverride);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".spray-select-dropdown, .spray-combo-field, .spray-select-menu")) {
      closeSprayDropdowns();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSprayDropdowns();
  });

  bindOptionControls();
}

function bindOptionControls() {
  refs.projectName.addEventListener("input", () => {
    const project = activeProject();
    if (project) {
      project.name = refs.projectName.value;
      renderProjectList();
      updateFooter();
    }
  });
  refs.packageName.addEventListener("input", () => {
    state.packageName = refs.packageName.value;
  });
  bindDimensionControl("width", refs.widthValue);
  bindDimensionControl("height", refs.heightValue);

  const optionBindings = [
    ["rescale", refs.rescale, "checked"],
    ["mipmaps", refs.mipmaps, "checked"],
    ["singleFrameAnimation", refs.singleFrame, "checked"],
    ["singleFrameCount", refs.singleFrameCount, "number"],
    ["format", refs.format, "number"],
    ["sampling", refs.sampling, "number"],
    ["dither", refs.dither, "checked"],
    ["dxtQuality", refs.dxtQuality, "number"],
  ];

  optionBindings.forEach(([key, control, kind]) => {
    control.addEventListener("change", () => {
      if (kind === "checked") state.options[key] = control.checked;
      else if (kind === "number") state.options[key] = Number(control.value);
      else state.options[key] = control.value;
      enforceMipmapSizeLimit(key === "mipmaps");
      renderMipmapLevels();
      updatePreview();
    });
    control.addEventListener("input", () => {
      if (kind === "number") {
        state.options[key] = Number(control.value);
        updatePreview();
      }
    });
  });

  refs.mipmapLevel.addEventListener("change", () => {
    renderMipmapControlsState();
  });
}

function bindDimensionControl(axis, control) {
  control.addEventListener("input", () => {
    if (!applyDimensionValue(axis, control.value, false)) return;
    enforceMipmapSizeLimit(false);
    renderMipmapLevels();
    updatePreview();
  });
  control.addEventListener("change", () => {
    if (applyDimensionValue(axis, control.value, true)) {
      enforceMipmapSizeLimit(false);
      renderMipmapLevels();
      updatePreview();
    }
    control.value = dimensionValueFromOptions(axis);
  });
}

function applyDimensionValue(axis, rawValue, normalize) {
  const modeKey = `${axis}Mode`;
  const customKey = axis === "width" ? "customWidth" : "customHeight";
  const value = String(rawValue || "").trim();
  if (!value || value === "自动" || value.toLowerCase() === "auto") {
    state.options[modeKey] = "auto";
    return true;
  }

  const numeric = Number(value.replace(/px$/i, ""));
  if (!Number.isFinite(numeric)) return false;

  const clamped = Math.max(4, Math.min(1024, Math.round(numeric)));
  state.options[modeKey] = String(clamped);
  state.options[customKey] = clamped;
  if (normalize) {
    const control = axis === "width" ? refs.widthValue : refs.heightValue;
    control.value = String(clamped);
  }
  return true;
}

function dimensionValueFromOptions(axis) {
  const modeKey = `${axis}Mode`;
  const customKey = axis === "width" ? "customWidth" : "customHeight";
  const mode = state.options[modeKey];
  if (!mode || mode === "auto") return "自动";
  if (mode === "custom") return String(state.options[customKey] || 512);
  return String(mode);
}

function enforceMipmapSizeLimit(showMessage) {
  if (!state.options.mipmaps || canUseMipmaps()) return;
  state.options.mipmaps = false;
  refs.mipmaps.checked = false;
  if (showMessage) {
    showNotification("Mipmaps 仅在宽高不高于 512 时可用", "info");
  }
}

async function importPrimaryFiles(files) {
  if (!files || !files.length) return;
  setBusy(true, "正在读取素材...");
  try {
    const project = await decodeFilesAsProject(files, {
      requestClipOptions: showClipOptionsModal,
    });
    state.projects.push(project);
    state.activeProjectId = project.id;
    state.frameIndex = 0;
    enforceMipmapSizeLimit(true);
    if (!state.packageName || state.packageName === "spray_pack") {
      state.packageName = sanitizeOutputName(project.name) || "spray_pack";
      refs.packageName.value = state.packageName;
    }
    renderAll();
    showNotification("素材已导入", "success");
  } catch (error) {
    showError("导入素材失败: " + formatError(error));
  } finally {
    setBusy(false);
  }
}

async function importBatchFiles(files) {
  if (!files || !files.length) return;
  setBusy(true, "正在批量导入...");
  try {
    const projects = await decodeFilesAsBatch(files, {
      requestClipOptions: showClipOptionsModal,
    });
    state.projects.push(...projects);
    state.activeProjectId = projects[0]?.id || state.activeProjectId;
    state.frameIndex = 0;
    enforceMipmapSizeLimit(true);
    renderAll();
    showNotification(`已导入 ${projects.length} 个喷漆项目`, "success");
  } catch (error) {
    showError("批量导入失败: " + formatError(error));
  } finally {
    setBusy(false);
  }
}

async function importMipmapOverride(files) {
  const project = activeProject();
  if (!project || !files || !files.length) return;
  const level = Number(refs.mipmapLevel.value || 0);
  if (level <= 0) return;
  setBusy(true, "正在替换 mipmap...");
  try {
    project.mipOverrides[level] = await decodeMipmapOverride(files, {
      requestClipOptions: showClipOptionsModal,
    });
    renderMipmapControlsState();
    updatePreview();
    showNotification("Mipmap 已替换", "success");
  } catch (error) {
    showError("替换 mipmap 失败: " + formatError(error));
  } finally {
    setBusy(false);
  }
}

function clearMipmapOverride() {
  const project = activeProject();
  if (!project) return;
  const level = Number(refs.mipmapLevel.value || 0);
  if (level <= 0) return;
  delete project.mipOverrides[level];
  renderMipmapControlsState();
  updatePreview();
}

async function exportSprayFiles() {
  const outputs = await buildOutputsForProjects();
  if (!outputs) return;
  setBusy(true, "正在导出...");
  try {
    const result = await callApp("ExportSprayFiles", {
      files: outputs.map(outputPayload),
    });
    if (result?.outputDir) {
      showNotification(`已导出 ${result.files?.length || outputs.length} 组喷漆文件`, "success");
      await callOptionalApp("OpenFileLocation", result.outputDir);
    }
  } catch (error) {
    showError("导出失败: " + formatError(error));
  } finally {
    setBusy(false);
  }
}

async function installSprayVPK() {
  const outputs = await buildOutputsForProjects();
  if (!outputs) return;
  setBusy(true, "正在制作 VPK...");
  try {
    await callApp("InstallSprayVPK", {
      packageName: refs.packageName.value || state.packageName || "spray_pack",
      files: outputs.map(outputPayload),
    });
    showNotification("喷漆 VPK 已安装", "success");
    if (typeof state.refreshFilesKeepFilter === "function") {
      await state.refreshFilesKeepFilter();
    }
  } catch (error) {
    showError("制作 VPK 失败: " + formatError(error));
  } finally {
    setBusy(false);
  }
}

async function buildOutputsForProjects() {
  if (!state.projects.length) {
    showError("请先导入素材");
    return null;
  }
  setBusy(true, "正在转换 VTF...");
  try {
    const outputs = [];
    for (const project of state.projects) {
      outputs.push(await buildSprayOutputs(project, state.options));
    }
    return outputs;
  } catch (error) {
    showError("转换失败: " + formatError(error));
    return null;
  } finally {
    setBusy(false);
  }
}

function outputPayload(output) {
  return {
    name: output.name,
    vtfBase64: output.vtfBase64,
    vmtText: output.vmtText,
  };
}

function renderAll() {
  collectRefs();
  renderProjectList();
  renderSettings();
  renderMipmapLevels();
  renderFrameStrip();
  updatePreview();
}

function renderProjectList() {
  refs.projectList.replaceChildren();
  if (!state.projects.length) {
    refs.projectList.appendChild(el("div", "spray-empty-state", "尚未导入素材"));
    return;
  }

  state.projects.forEach((project) => {
    const row = el("button", "spray-project-row");
    row.type = "button";
    if (project.id === state.activeProjectId) row.classList.add("is-active");
    const main = el("span", "spray-project-row-main");
    main.append(el("strong", "", getProjectDisplayName(project)));
    main.append(el("span", "", `${project.frames.length} 帧`));
    const remove = button("", "spray-project-remove", "×");
    remove.setAttribute("aria-label", "移除");
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeProject(project.id);
    });
    row.append(main, remove);
    row.addEventListener("click", () => {
      state.activeProjectId = project.id;
      state.frameIndex = 0;
      renderAll();
    });
    refs.projectList.appendChild(row);
  });
}

function renderSettings() {
  const project = activeProject();
  refs.projectName.value = project?.name || "";
  refs.packageName.value = state.packageName || "spray_pack";
  refs.widthValue.value = dimensionValueFromOptions("width");
  refs.heightValue.value = dimensionValueFromOptions("height");
  refs.rescale.checked = !!state.options.rescale;
  refs.mipmaps.checked = !!state.options.mipmaps;
  refs.singleFrame.checked = !!state.options.singleFrameAnimation;
  refs.singleFrameCount.value = state.options.singleFrameCount;
  setCustomSelectValue(refs.format, String(state.options.format), false);
  setCustomSelectValue(refs.sampling, String(state.options.sampling), false);
  refs.dither.checked = !!state.options.dither;
  setCustomSelectValue(refs.dxtQuality, String(state.options.dxtQuality), false);
}

function renderMipmapLevels() {
  const project = activeProject();
  if (!project || !state.options.mipmaps || !canUseMipmaps()) {
    renderCustomSelectOptions(refs.mipmapLevel, []);
    setCustomSelectDisabled(refs.mipmapLevel, true);
    refs.mipmapImportBtn.disabled = true;
    refs.mipmapClearBtn.disabled = true;
    return;
  }

  const size = resolveOutputSize(project, state.options);
  const levels = getMipmapDimensions(size.width, size.height);
  const options = levels.slice(1).map((level, index) => [
    String(index + 1),
    `${index + 1}: ${level.width}×${level.height}`,
  ]);
  renderCustomSelectOptions(refs.mipmapLevel, options);
  setCustomSelectDisabled(refs.mipmapLevel, levels.length <= 1);
  refs.mipmapImportBtn.disabled = levels.length <= 1;
  refs.mipmapClearBtn.disabled = levels.length <= 1;
  renderMipmapControlsState();
}

function renderMipmapControlsState() {
  const project = activeProject();
  const level = Number(refs.mipmapLevel.value || 0);
  const hasOverride = !!project?.mipOverrides?.[level];
  refs.mipmapClearBtn.disabled =
    !project || !state.options.mipmaps || level <= 0 || !hasOverride;
  refs.mipmapImportBtn.textContent = hasOverride ? "重新替换" : "替换 Mipmap";
}

function renderFrameStrip() {
  refs.frameStrip.replaceChildren();
  const project = activeProject();
  if (!project) return;
  project.frames.slice(0, 48).forEach((frame, index) => {
    const item = el("button", "spray-frame-thumb");
    item.type = "button";
    if (index === state.frameIndex) item.classList.add("is-active");
    const canvas = document.createElement("canvas");
    canvas.width = 44;
    canvas.height = 44;
    drawFrameToCanvas(frame, canvas, { rescale: true });
    item.appendChild(canvas);
    item.addEventListener("click", () => {
      state.frameIndex = index;
      updatePreview();
      renderFrameStrip();
    });
    refs.frameStrip.appendChild(item);
  });
}

function updatePreview() {
  const project = activeProject();
  const canvas = refs.previewCanvas;
  const ctx = canvas.getContext("2d");

  if (!project) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    refs.previewMeta.textContent = "等待素材";
    refs.frameLabel.textContent = "0 / 0";
    refs.exportBtn.disabled = true;
    refs.installBtn.disabled = true;
    refs.sizeNote.hidden = true;
    refs.sizeNote.textContent = "";
    updateFooter();
    return;
  }

  const size = resolveOutputSize(project, state.options);
  canvas.width = size.width;
  canvas.height = size.height;
  state.frameIndex = Math.min(state.frameIndex, project.frames.length - 1);
  drawFrameToCanvas(project.frames[state.frameIndex], canvas, state.options);
  refs.previewMeta.textContent = `${size.width}×${size.height}`;
  refs.frameLabel.textContent = `${state.frameIndex + 1} / ${project.frames.length}`;
  refs.exportBtn.disabled = state.busy;
  refs.installBtn.disabled = state.busy;
  updateSizeNote(project, size);
  updateFooter();
}

function updateSizeNote(project, size) {
  const frames = getEffectiveFrameCount(project);
  const estimate = estimateVTFSize(
    size.width,
    size.height,
    frames,
    Number(state.options.format),
    state.options.mipmaps && canUseMipmaps()
  );
  const kb = Math.round(estimate / 1024);
  refs.sizeNote.hidden = false;
  refs.sizeNote.textContent = `预计 ${kb} KB · ${FORMAT_LABELS.get(Number(state.options.format)) || "VTF"}`;
  refs.sizeNote.classList.toggle("is-warning", kb >= 512);
}

function updateFooter() {
  if (state.busy) return;
  const project = activeProject();
  if (!project) {
    refs.footerStatus.textContent = "导入素材后即可预览和输出。";
    return;
  }
  refs.footerStatus.textContent = `当前 ${state.projects.length} 个项目，选中 ${getProjectDisplayName(project)}。`;
}

function setBusy(busy, message = "") {
  state.busy = busy;
  refs.exportBtn.disabled = busy || !state.projects.length;
  refs.installBtn.disabled = busy || !state.projects.length;
  refs.footerStatus.textContent = busy ? message : "";
  if (!busy) updateFooter();
}

function moveFrame(delta) {
  const project = activeProject();
  if (!project) return;
  state.frameIndex = (state.frameIndex + delta + project.frames.length) % project.frames.length;
  updatePreview();
  renderFrameStrip();
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
    return;
  }
  const project = activeProject();
  if (!project || project.frames.length <= 1) return;
  state.playing = true;
  refs.playBtn.textContent = "暂停";
  state.timer = setInterval(() => {
    moveFrame(1);
  }, 200);
}

function stopPlayback() {
  state.playing = false;
  refs.playBtn.textContent = "播放";
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function closeSprayTool() {
  stopPlayback();
  closeSprayDropdowns();
  refs.modal.classList.add("hidden");
}

function removeProject(id) {
  state.projects = state.projects.filter((project) => project.id !== id);
  if (state.activeProjectId === id) {
    state.activeProjectId = state.projects[0]?.id || null;
    state.frameIndex = 0;
  }
  renderAll();
}

function activeProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null;
}

function canUseMipmaps() {
  const project = activeProject();
  if (!project) {
    return getConfiguredMipmapDimension("width") <= 512 &&
      getConfiguredMipmapDimension("height") <= 512;
  }
  const size = resolveOutputSize(project, state.options);
  return size.width <= 512 && size.height <= 512;
}

function getConfiguredMipmapDimension(axis) {
  const mode = state.options[`${axis}Mode`];
  if (!mode || mode === "auto") return 512;
  if (mode === "custom") {
    return Number(state.options[axis === "width" ? "customWidth" : "customHeight"]) || 512;
  }
  return Number(mode) || 512;
}

function getEffectiveFrameCount(project) {
  if (
    state.options.singleFrameAnimation &&
    project.frames.length === 1 &&
    Number(state.options.singleFrameCount) > 1
  ) {
    return Number(state.options.singleFrameCount);
  }
  return project.frames.length;
}

function getProjectDisplayName(project) {
  if (!project) return "spray";
  return project.name || getProjectSourceBaseName(project) || "spray";
}

function getProjectSourceBaseName(project) {
  const sourceName = Array.isArray(project?.sourceNames) ? project.sourceNames[0] : "";
  return sanitizeOutputName(String(sourceName || "").replace(/\.[^/.]+$/, ""));
}

function showClipOptionsModal(file, meta) {
  return new Promise((resolve) => {
    const modal = el("div", "modal spray-clip-modal");
    const content = el("div", "modal-content modal-small spray-clip-content");
    const header = el("div", "modal-header");
    header.append(el("h3", "", meta.type === "video" ? "视频导入" : "动画导入"));
    const body = el("div", "modal-body spray-clip-body");
    const isVideo = meta.type === "video";
    const start = numberControl(isVideo ? "起始秒" : "起始帧", "spray-clip-start", 0, 0);
    const endDefault = isVideo ? Math.round((meta.duration || 0) * 100) / 100 : meta.frameCount || 1;
    const end = numberControl(isVideo ? "结束秒" : "结束帧", "spray-clip-end", endDefault, 0);
    const fps = numberControl("导入速度", "spray-clip-fps", meta.defaultFps || 5, 1, 30);
    const all = checkboxControl(isVideo ? "使用较高帧率" : "导入所有帧", "spray-clip-all", !isVideo);
    const fileLabel = el("p", "spray-clip-file", file.name || "");
    body.append(fileLabel, start, end, fps, all);
    const footer = el("div", "modal-footer");
    const cancel = button("", "btn btn-secondary", "取消");
    const accept = button("", "btn btn-primary", "导入");
    footer.append(cancel, accept);
    content.append(header, body, footer);
    modal.appendChild(content);
    document.body.appendChild(modal);

    const cleanup = () => modal.remove();
    cancel.addEventListener("click", () => {
      cleanup();
      resolve({ cancelled: true });
    });
    accept.addEventListener("click", () => {
      const value = {
        start: Number(start.querySelector("input").value || 0),
        end: Number(end.querySelector("input").value || endDefault),
        fps: Number(fps.querySelector("input").value || meta.defaultFps || 5),
        allFrames: all.querySelector("input").checked,
      };
      cleanup();
      resolve(value);
    });
  });
}

function collectRefs() {
  refs = {
    modal: refs.modal || document.getElementById("spray-tool-modal"),
    settingsPanel: document.querySelector("#spray-tool-modal .spray-settings-panel"),
    closeBtn: document.getElementById("spray-tool-close"),
    primaryImportBtn: document.getElementById("spray-primary-import-btn"),
    primaryInput: document.getElementById("spray-primary-input"),
    batchImportBtn: document.getElementById("spray-batch-import-btn"),
    batchInput: document.getElementById("spray-batch-input"),
    projectList: document.getElementById("spray-project-list"),
    previewCanvas: document.getElementById("spray-preview-canvas"),
    previewMeta: document.getElementById("spray-preview-meta"),
    prevBtn: document.getElementById("spray-prev-frame-btn"),
    playBtn: document.getElementById("spray-play-btn"),
    nextBtn: document.getElementById("spray-next-frame-btn"),
    frameLabel: document.getElementById("spray-frame-label"),
    frameStrip: document.getElementById("spray-frame-strip"),
    projectName: document.getElementById("spray-project-name"),
    packageName: document.getElementById("spray-package-name"),
    widthValue: document.getElementById("spray-width-value"),
    heightValue: document.getElementById("spray-height-value"),
    rescale: document.getElementById("spray-rescale"),
    mipmaps: document.getElementById("spray-mipmaps"),
    mipmapLevel: document.getElementById("spray-mipmap-level"),
    mipmapImportBtn: document.getElementById("spray-mipmap-import-btn"),
    mipmapClearBtn: document.getElementById("spray-mipmap-clear-btn"),
    mipmapInput: document.getElementById("spray-mipmap-input"),
    singleFrame: document.getElementById("spray-single-frame"),
    singleFrameCount: document.getElementById("spray-single-frame-count"),
    format: document.getElementById("spray-format"),
    sampling: document.getElementById("spray-sampling"),
    dither: document.getElementById("spray-dither"),
    dxtQuality: document.getElementById("spray-dxt-quality"),
    sizeNote: document.getElementById("spray-size-note"),
    footerStatus: document.getElementById("spray-footer-status"),
    exportBtn: document.getElementById("spray-export-btn"),
    installBtn: document.getElementById("spray-install-btn"),
  };
}

function panelTitle(title, subtitle) {
  const header = el("div", "spray-panel-header");
  header.append(el("h4", "", title), el("p", "", subtitle));
  return header;
}

function textControl(labelText, id, value, placeholder = "") {
  const wrap = el("div", "spray-control");
  const label = el("label", "", labelText);
  label.setAttribute("for", id);
  const control = input("text", id);
  control.value = value || "";
  control.placeholder = placeholder;
  control.className = "textInput";
  wrap.append(label, control);
  return wrap;
}

function dimensionControl(labelText, id) {
  const wrap = el("div", "spray-control");
  const label = el("label", "", labelText);
  label.setAttribute("for", id);
  const field = el("div", "spray-combo-field");
  const control = input("text", id);
  control.className = "textInput spray-combo-input";
  control.setAttribute("inputmode", "numeric");
  control.placeholder = "自动或输入像素";
  const trigger = button(`${id}-toggle`, "spray-combo-toggle", "");
  trigger.setAttribute("aria-label", `${labelText}预设`);
  trigger.setAttribute("aria-expanded", "false");
  const menu = el("div", "select-menu spray-select-menu spray-combo-menu hidden");
  menu.id = `${id}-menu`;

  ["自动", ...RESOLUTION_PRESETS].forEach((value) => {
    const option = createSelectOption(String(value), String(value));
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      control.value = option.dataset.value || "";
      control.dispatchEvent(new Event("change", { bubbles: true }));
      closeSprayDropdowns();
    });
    menu.appendChild(option);
  });
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSprayDropdown(menu, field, trigger);
  });
  control.addEventListener("focus", () => {
    openSprayDropdown(menu, field, trigger);
  });
  control.addEventListener("click", (event) => {
    event.stopPropagation();
    openSprayDropdown(menu, field, trigger);
  });

  field.append(control, trigger, menu);
  wrap.append(label, field);
  return wrap;
}

function numberControl(labelText, id, value, min, max) {
  const wrap = el("div", "spray-control");
  const label = el("label", "", labelText);
  label.setAttribute("for", id);
  const control = input("number", id);
  control.value = String(value);
  control.min = String(min ?? 0);
  if (max != null) control.max = String(max);
  control.className = "textInput";
  wrap.append(label, control);
  return wrap;
}

function selectControl(labelText, id, options) {
  const wrap = el("div", "spray-control");
  const label = el("label", "", labelText);
  label.setAttribute("for", id);
  wrap.append(label, customSelectInput(id, options));
  return wrap;
}

function customSelectInput(id, options) {
  const dropdown = el("div", "spray-select-dropdown");
  const valueInput = input("hidden", id);
  valueInput.className = "spray-select-value";
  const trigger = button(`${id}-trigger`, "textInput spray-select-trigger", "");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const menu = el("div", "select-menu spray-select-menu hidden");
  menu.id = `${id}-menu`;
  menu.setAttribute("role", "listbox");
  dropdown.append(valueInput, trigger, menu);
  renderCustomSelectOptions(valueInput, options);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (trigger.disabled) return;
    toggleSprayDropdown(menu, trigger, trigger);
  });
  return dropdown;
}

function renderCustomSelectOptions(valueInput, options) {
  const dropdown = valueInput.closest(".spray-select-dropdown");
  const menu = dropdown?.querySelector(".spray-select-menu");
  if (!menu) return;
  menu.replaceChildren();

  const normalized = options.map(normalizeSelectOption);
  normalized.forEach((item) => {
    const option = createSelectOption(item.value, item.label);
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      setCustomSelectValue(valueInput, item.value, true);
      closeSprayDropdowns();
    });
    menu.appendChild(option);
  });

  const nextValue = normalized.some((item) => item.value === valueInput.value)
    ? valueInput.value
    : normalized[0]?.value || "";
  setCustomSelectValue(valueInput, nextValue, false);
}

function normalizeSelectOption(optionValue) {
  const pair = Array.isArray(optionValue) ? optionValue : [optionValue, String(optionValue)];
  return {
    value: String(pair[0]),
    label: pair[1] === "auto" ? "自动" : String(pair[1]),
  };
}

function createSelectOption(value, label) {
  const option = button("", "select-option spray-select-option", label);
  option.dataset.value = value;
  option.setAttribute("role", "option");
  return option;
}

function setCustomSelectValue(valueInput, value, dispatchChange) {
  valueInput.value = String(value || "");
  const dropdown = valueInput.closest(".spray-select-dropdown");
  const trigger = dropdown?.querySelector(".spray-select-trigger");
  const options = Array.from(dropdown?.querySelectorAll(".spray-select-option") || []);
  let selectedLabel = "";
  options.forEach((option) => {
    const isActive = option.dataset.value === valueInput.value;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
    if (isActive) selectedLabel = option.textContent || "";
  });
  if (trigger) trigger.textContent = selectedLabel || "请选择";
  if (dispatchChange) {
    valueInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function setCustomSelectDisabled(valueInput, disabled) {
  valueInput.disabled = !!disabled;
  const dropdown = valueInput.closest(".spray-select-dropdown");
  const trigger = dropdown?.querySelector(".spray-select-trigger");
  const menu = dropdown?.querySelector(".spray-select-menu");
  if (trigger) trigger.disabled = !!disabled;
  if (disabled && menu) closeSprayDropdown(menu);
}

function toggleSprayDropdown(menu, anchor, expandedTrigger = anchor) {
  if (!menu) return;
  const opening = menu.classList.contains("hidden");
  closeSprayDropdowns(menu);
  if (opening) openSprayDropdown(menu, anchor, expandedTrigger);
  else closeSprayDropdown(menu);
}

function openSprayDropdown(menu, anchor, expandedTrigger = anchor) {
  closeSprayDropdowns(menu);
  menu._sprayHome ||= {
    parent: menu.parentNode,
    nextSibling: menu.nextSibling,
    trigger: expandedTrigger,
  };
  document.body.appendChild(menu);
  menu.classList.add("spray-floating-menu");
  menu.classList.remove("hidden");
  expandedTrigger?.setAttribute("aria-expanded", "true");
  positionSprayDropdown(menu, anchor);
}

function positionSprayDropdown(menu, anchor) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const width = Math.max(rect.width, 160);
  const edge = 8;
  const left = Math.max(
    edge,
    Math.min(rect.left, window.innerWidth - width - edge)
  );
  menu.style.position = "fixed";
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(rect.bottom + gap)}px`;
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxHeight = "15rem";

  const menuHeight = menu.offsetHeight || menu.scrollHeight || 0;
  const below = window.innerHeight - rect.bottom - gap;
  const above = rect.top - gap;
  if (below < menuHeight && above > below) {
    menu.style.top = `${Math.max(edge, Math.round(rect.top - Math.min(menuHeight, 240) - gap))}px`;
  }
}

function closeSprayDropdown(menu) {
  if (!menu || menu.classList.contains("hidden")) return;
  menu.classList.add("hidden");
  menu.classList.remove("spray-floating-menu");
  menu.style.position = "";
  menu.style.left = "";
  menu.style.top = "";
  menu.style.width = "";
  menu.style.maxHeight = "";
  const home = menu._sprayHome;
  if (home?.trigger) home.trigger.setAttribute("aria-expanded", "false");
  if (home?.parent) home.parent.insertBefore(menu, home.nextSibling || null);
  menu._sprayHome = null;
}

function closeSprayDropdowns(exceptMenu = null) {
  document.querySelectorAll(".spray-select-menu").forEach((menu) => {
    if (menu !== exceptMenu) closeSprayDropdown(menu);
  });
}

function checkboxControl(labelText, id, checked) {
  const wrap = el("label", "spray-checkbox");
  const control = input("checkbox", id);
  control.checked = !!checked;
  wrap.append(control, el("span", "", labelText));
  return wrap;
}

function input(type, id) {
  const control = document.createElement("input");
  control.type = type;
  if (id) control.id = id;
  return control;
}

function sprayPayloadsToFiles(payloads) {
  return payloads.map((payload) => {
    const bytes = base64ToUint8Array(payload.base64 || "");
    return new File([bytes], payload.name || "spray", {
      type: payload.type || inferMimeType(payload.name || ""),
    });
  });
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function inferMimeType(name) {
  const ext = getPathExtension(name);
  if (ext === ".gif") return "image/gif";
  if (ext === ".tga") return "image/x-tga";
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext)) {
    return `image/${ext === ".jpg" ? "jpeg" : ext.slice(1)}`;
  }
  return "video/mp4";
}

function getPathExtension(path) {
  const clean = String(path || "").toLowerCase().split(/[\\/]/).pop() || "";
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index) : "";
}

function button(id, className, text) {
  const btn = el("button", className, text);
  btn.type = "button";
  if (id) btn.id = id;
  return btn;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function callApp(methodName, ...args) {
  const method = window?.go?.app?.App?.[methodName];
  if (typeof method !== "function") {
    return Promise.reject(new Error(`当前后端不支持 ${methodName}`));
  }
  return method(...args);
}

async function callOptionalApp(methodName, ...args) {
  const method = window?.go?.app?.App?.[methodName];
  if (typeof method !== "function") return null;
  try {
    return await method(...args);
  } catch (error) {
    return null;
  }
}

function formatError(error) {
  if (error?.message) return error.message;
  return String(error || "未知错误");
}
