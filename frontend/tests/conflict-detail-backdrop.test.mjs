import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const styles = new URL("../src/css/", import.meta.url);

test("conflict details keep the MOD management backdrop and remove only the underlying mask", async () => {
  const main = await readFile(new URL("main.css", styles), "utf8");
  const imports = [...main.matchAll(/@import\s+"([^"]+)"/g)];
  const underlay = new Map();
  for (const [, path] of imports) {
    const css = postcss.parse(await readFile(new URL(path, styles), "utf8"));
    css.walkRules((rule) => {
      if (rule.selectors.includes("#conflict-modal[inert]")) {
        rule.walkDecls((decl) => underlay.set(decl.prop, decl.value));
      }
      const stylesNestedDetail = rule.selectors.some((selector) =>
        /conflict|\[inert\]|\[aria-modal/.test(selector) &&
        /(?:#file-detail-modal|\.modal)(?:[.\[:][^\s]*)?$/.test(selector)
      );
      if (stylesNestedDetail) {
        rule.walkDecls(/^(?:background(?:-color|-image)?|opacity|(?:-webkit-)?backdrop-filter)$/, (decl) => {
          assert.fail(`${path}: ${rule.selector} overrides the shared detail backdrop with ${decl.prop}`);
        });
      }
    });
  }
  assert.equal(underlay.get("background-color"), "transparent");
  assert.equal(underlay.get("backdrop-filter"), "none");
});
