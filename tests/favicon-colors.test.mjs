import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const faviconColorsCode = await readFile(
  new URL("../favicon-colors.js", import.meta.url),
  "utf8"
);

function createHarness(pixel) {
  const requests = [];
  class FakeCanvas {
    getContext() {
      return {
        clearRect() {},
        drawImage() {},
        getImageData() {
          return { data: new Uint8ClampedArray(32 * 32 * 4).fill(0).map((_value, index) => pixel[index % 4]) };
        }
      };
    }
  }
  const context = {
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, async blob() { return {}; } };
    },
    createImageBitmap: async () => ({ close() {} }),
    OffscreenCanvas: FakeCanvas
  };
  vm.runInNewContext(faviconColorsCode, context);
  return { context, requests };
}

test("maps a favicon accent to the nearest Chrome tab-group color", async () => {
  const { context } = createHarness([232, 66, 52, 255]);
  const color = await context.StillFaviconColors.colorForTabs([
    { host: "example.com", favIconUrl: "https://example.com/favicon.ico" }
  ]);
  assert.equal(color, "red");
});

test("keeps a dark blue favicon blue instead of confusing it with green", async () => {
  const { context } = createHarness([0, 70, 130, 255]);
  const color = await context.StillFaviconColors.colorForTabs([
    { host: "theguardian.com", favIconUrl: "https://theguardian.com/favicon.ico" }
  ]);
  assert.equal(color, "blue");
});

test("prefers the source site's favicon for linked-tab groups", async () => {
  const { context, requests } = createHarness([52, 168, 83, 255]);
  const color = await context.StillFaviconColors.colorForTabs([
    { host: "target.example", favIconUrl: "https://target.example/favicon.ico" },
    { host: "source.example", favIconUrl: "https://source.example/favicon.ico" }
  ], { sourceHost: "source.example" });
  assert.equal(color, "green");
  assert.equal(requests[0], "https://source.example/favicon.ico");
});

test("returns no favicon color when the browser cannot decode icons", async () => {
  const context = {};
  vm.runInNewContext(faviconColorsCode, context);
  const color = await context.StillFaviconColors.colorForTabs([
    { favIconUrl: "https://example.com/favicon.ico" }
  ]);
  assert.equal(color, "");
});
