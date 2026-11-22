import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const render = await readFile(new URL("../src/js/features/file-list/render.js", import.meta.url), "utf8");
const utils = await readFile(new URL("../src/js/core/utils.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/css/app/mods.css", import.meta.url), "utf8");
const renderItem = (utils + "\n" + render.slice(render.indexOf("function appendFileTags"), render.indexOf("export function createFileCard")))
  .replaceAll("export function", "function");

function fileRow(hasUpdate, secondaryTags = []) {
  const filename = "很长的文件名".repeat(80) + ".vpk";
  const filenameText = {};
  const children = [filenameText];
  const badges = [];
  const containers = {
    ".file-checkbox-container": { appendChild() {} },
    ".file-name": {},
    ".file-title": {},
    ".file-size": {},
    ".file-location": { appendChild() {} },
    ".file-tags": { appendChild(badge) { badges.push(badge); } },
    ".file-filename-text": filenameText,
    ".file-filename": { prepend(node) { children.unshift(node); } },
  };
  const document = {
    createRange() { return { createContextualFragment() {} }; },
    createElement(tagName) {
      return { tagName, dataset: {}, append() {}, addEventListener() {},
        querySelector(selector) { return containers[selector]; }, querySelectorAll() { return []; } };
    },
  };
  const helpers = {
    document, appState: { selectedFiles: new Set() },
    hasPanelServers: () => false, iconSvg: String, getLocationSvg: String,
  };
  const create = vm.runInNewContext(renderItem + "\ncreateFileItem", helpers);
  const item = create({ name: filename, title: "Title", path: "X:/mods/file.vpk", size: 512, location: "root", workshopId: "9007199254740993", hasUpdate, secondaryTags });
  assert.match(item.innerHTML, /class="file-filename"><span class="file-filename-text">/);
  return { children, badges };
}

test("list rows keep a clickable update button before the ellipsized filename", () => {
  const [first, filename] = fileRow(true).children;
  assert.equal(first.tagName, "button");
  assert.equal(first.className, "update-available-tag");
  assert.equal(first.textContent, "待更新");
  assert.equal(first.dataset.workshopId, "9007199254740993");
  assert.match(filename.textContent, /\.vpk$/);
  assert.equal(fileRow(false).children.length, 1);
  assert.match(css, /\.file-filename\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.update-available-tag\s*\{[^}]*flex:\s*none/);
  assert.match(css, /\.file-filename-text\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
});

test("campaign tags retain their text and tooltip values, including the overflow tooltip", () => {
  const tags = ['雾港 "晨光" & 海风', "合作", "港口 '夜航'", "纪念 &amp; 典藏"];
  const { badges } = fileRow(false, tags);
  assert.deepEqual(badges.map((badge) => [badge.textContent, badge.title]), [
    [tags[0], tags[0]], [tags[1], tags[1]], ["+2", tags.slice(2).join(", ")],
  ]);
});
