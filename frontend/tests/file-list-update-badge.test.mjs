import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const render = await readFile(new URL("../src/js/features/file-list/render.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/css/app/mods.css", import.meta.url), "utf8");
const renderItem = render.slice(render.indexOf("export function createFileItem") + 7, render.indexOf("export function createFileCard"));

function fileRow(hasUpdate) {
  const filename = "很长的文件名".repeat(80) + ".vpk";
  const filenameText = { textContent: filename };
  const children = [filenameText];
  const containers = {
    ".file-checkbox-container": { appendChild() {} },
    ".file-name": {},
    ".file-filename": { prepend(node) { children.unshift(node); } },
  };
  const document = { createElement(tagName) { return { tagName, dataset: {}, addEventListener() {}, querySelector(selector) { return containers[selector]; } }; } };
  const helpers = {
    document, appState: { selectedFiles: new Set() }, escapeHtml: String,
    hasPanelServers: () => false, iconSvg: String, formatTags: () => "", getLocationSvg: String,
    getLocationDisplayName: String, formatFileSize: String, getActionButton: () => "",
  };
  const create = vm.runInNewContext(renderItem + "\ncreateFileItem", helpers);
  const item = create({ name: filename, title: "Title", path: "X:/mods/file.vpk", location: "addons", workshopId: "9007199254740993", hasUpdate });
  assert.match(item.innerHTML, /class="file-filename"><span class="file-filename-text">/);
  return children;
}

test("list rows keep a clickable update button before the ellipsized filename", () => {
  const [first, filename] = fileRow(true);
  assert.equal(first.tagName, "button");
  assert.equal(first.className, "update-available-tag");
  assert.equal(first.textContent, "待更新");
  assert.equal(first.dataset.workshopId, "9007199254740993");
  assert.match(filename.textContent, /\.vpk$/);
  assert.equal(fileRow(false).length, 1);
  assert.match(css, /\.file-filename\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.update-available-tag\s*\{[^}]*flex:\s*none/);
  assert.match(css, /\.file-filename-text\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
});
