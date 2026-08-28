import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(join(root, "assets/promo-tile.svg"), "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;width:440px;height:280px;overflow:hidden;background:transparent}</style>${svg}`);
  await page.screenshot({ path: join(root, "assets/promo-tile-440x280.png"), type: "png" });
} finally {
  await browser.close();
}

console.log("Rendered assets/promo-tile-440x280.png (440 × 280)");
