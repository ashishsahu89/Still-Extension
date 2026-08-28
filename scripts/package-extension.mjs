import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(projectRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = String(manifest.version || "").trim();

if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  throw new Error(`Manifest version is not packageable: ${version}`);
}

const runtimeFiles = [
  "manifest.json",
  "background.js",
  "tab-organizer.js",
  "tab-crowding.js",
  "favicon-colors.js",
  "ai-connections.js",
  "chrome-ai.js",
  "intervention.js",
  "pass-countdown.js",
  "popup.js",
  "options.js",
  "preview-runtime.js",
  "routine-suggestions.js",
  "site-categories.js",
  "intervention.html",
  "options.html",
  "popup.html",
  "intervention.css",
  "options.css",
  "popup.css",
  "ui.css",
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-48.png",
  "assets/icon-128.png"
];

const missing = runtimeFiles.filter((file) => !existsSync(join(projectRoot, file)));
if (missing.length) {
  throw new Error(`Missing runtime file(s): ${missing.join(", ")}`);
}

const distDir = join(projectRoot, "dist");
mkdirSync(distDir, { recursive: true });
const stagingDir = join(distDir, `.staging-${process.pid}`);
const zipPath = join(distDir, `still-focus-extension-v${version}.zip`);

rmSync(stagingDir, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(stagingDir, { recursive: true });

try {
  for (const file of runtimeFiles) {
    const source = join(projectRoot, file);
    const target = join(stagingDir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }

  execFileSync("zip", ["-q", "-r", zipPath, "."], { cwd: stagingDir });
  const listed = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((file) => file && !file.endsWith("/"));
  const expected = new Set(runtimeFiles);
  const unexpected = listed.filter((file) => !expected.has(file));
  const missingFromZip = runtimeFiles.filter((file) => !listed.includes(file));
  if (unexpected.length || missingFromZip.length) {
    throw new Error([
      unexpected.length ? `Unexpected ZIP entries: ${unexpected.join(", ")}` : "",
      missingFromZip.length ? `Missing ZIP entries: ${missingFromZip.join(", ")}` : ""
    ].filter(Boolean).join("\n"));
  }
  console.log(`Packaged ${relative(projectRoot, zipPath)} (${listed.length} files)`);
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}
