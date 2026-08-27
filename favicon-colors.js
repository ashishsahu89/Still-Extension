(function exposeFaviconColors(global) {
  "use strict";

  // Chrome only accepts a fixed palette for tab-group colors. These RGB values
  // are representative accents used to quantize a favicon into that palette.
  const CHROME_COLORS = Object.freeze([
    { name: "grey", rgb: [128, 128, 128] },
    { name: "blue", rgb: [66, 133, 244] },
    { name: "red", rgb: [234, 67, 53] },
    { name: "yellow", rgb: [251, 188, 4] },
    { name: "green", rgb: [52, 168, 83] },
    { name: "pink", rgb: [233, 30, 99] },
    { name: "purple", rgb: [156, 39, 176] },
    { name: "cyan", rgb: [0, 188, 212] },
    { name: "orange", rgb: [255, 152, 0] }
  ]);
  const colorCache = new Map();
  const MAX_CACHE_ENTRIES = 256;

  function pageUrlForTab(tab) {
    const value = String(tab?.favIconUrl || "").trim();
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    const pageUrl = String(tab?.url || tab?.pendingUrl || "").trim();
    if (!/^https?:/i.test(pageUrl) || !global.chrome?.runtime?.getURL) return "";
    return global.chrome.runtime.getURL(
      `_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`
    );
  }

  function hostForTab(tab) {
    const value = String(tab?.host || "").replace(/^www\./i, "").toLowerCase();
    return value;
  }

  function remember(key, value) {
    if (!key) return value;
    if (colorCache.size >= MAX_CACHE_ENTRIES) {
      colorCache.delete(colorCache.keys().next().value);
    }
    colorCache.set(key, value);
    return value;
  }

  function hslFromRgb([red, green, blue]) {
    const values = [red, green, blue].map((value) => value / 255);
    const maximum = Math.max(...values);
    const minimum = Math.min(...values);
    const lightness = (maximum + minimum) / 2;
    const spread = maximum - minimum;
    if (spread === 0) return [0, 0, lightness];
    const saturation = spread / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (maximum === values[0]) {
      hue = ((values[1] - values[2]) / spread) % 6;
    } else if (maximum === values[1]) {
      hue = (values[2] - values[0]) / spread + 2;
    } else {
      hue = (values[0] - values[1]) / spread + 4;
    }
    return [((hue * 60) + 360) % 360, saturation, lightness];
  }

  function hueDistance(left, right) {
    const difference = Math.abs(left - right);
    return Math.min(difference, 360 - difference) / 180;
  }

  function colorDistance(sample, candidate) {
    const [hue, saturation, lightness] = hslFromRgb(sample);
    const [candidateHue, candidateSaturation, candidateLightness] = hslFromRgb(candidate.rgb);
    if (saturation < 0.16) {
      return candidate.name === "grey"
        ? saturation * 2 + Math.abs(lightness - candidateLightness)
        : 1.5 + Math.abs(lightness - candidateLightness);
    }
    if (candidate.name === "grey") return 1.5 + saturation + Math.abs(lightness - candidateLightness);
    // Hue is the strongest signal: a dark navy icon should remain blue rather
    // than drifting toward cyan or green just because its lightness is lower.
    return hueDistance(hue, candidateHue) * 4 +
      Math.abs(saturation - candidateSaturation) * 0.35 +
      Math.abs(lightness - candidateLightness) * 0.35;
  }

  function nearestChromeColor(sample) {
    return CHROME_COLORS.reduce((closest, candidate) => {
      const distance = colorDistance(sample, candidate);
      return distance < closest.distance ? { name: candidate.name, distance } : closest;
    }, { name: "blue", distance: Number.POSITIVE_INFINITY }).name;
  }

  function averageFaviconColor(data) {
    let vividRed = 0;
    let vividGreen = 0;
    let vividBlue = 0;
    let vividWeight = 0;
    let plainRed = 0;
    let plainGreen = 0;
    let plainBlue = 0;
    let plainWeight = 0;

    for (let index = 0; index + 3 < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      if (alpha < 0.2) continue;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const brightness = (red + green + blue) / 3;
      const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
      const weight = alpha * (0.7 + saturation);

      plainRed += red * alpha;
      plainGreen += green * alpha;
      plainBlue += blue * alpha;
      plainWeight += alpha;

      // Ignore transparent padding and almost-white browser-generated icons;
      // saturated pixels carry the site's recognizable visual signal.
      if (saturation >= 0.16 && brightness >= 28 && brightness <= 248) {
        vividRed += red * weight;
        vividGreen += green * weight;
        vividBlue += blue * weight;
        vividWeight += weight;
      }
    }

    if (vividWeight > 0) {
      return [vividRed / vividWeight, vividGreen / vividWeight, vividBlue / vividWeight];
    }
    if (plainWeight > 0) {
      return [plainRed / plainWeight, plainGreen / plainWeight, plainBlue / plainWeight];
    }
    return null;
  }

  async function readFaviconColor(tab) {
    const faviconUrl = pageUrlForTab(tab);
    if (!faviconUrl || typeof global.fetch !== "function" ||
        typeof global.createImageBitmap !== "function" ||
        typeof global.OffscreenCanvas !== "function") {
      return "";
    }
    const cacheKey = faviconUrl;
    if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);

    try {
      const response = await global.fetch(faviconUrl, {
        cache: "force-cache",
        credentials: "omit"
      });
      if (!response?.ok) return remember(cacheKey, "");
      const bitmap = await global.createImageBitmap(await response.blob());
      const canvas = new global.OffscreenCanvas(32, 32);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        bitmap.close?.();
        return remember(cacheKey, "");
      }
      context.clearRect(0, 0, 32, 32);
      context.drawImage(bitmap, 0, 0, 32, 32);
      const image = context.getImageData(0, 0, 32, 32);
      bitmap.close?.();
      const color = averageFaviconColor(image.data);
      return remember(cacheKey, color ? nearestChromeColor(color) : "");
    } catch (_error) {
      return remember(cacheKey, "");
    }
  }

  function orderedTabs(tabs, sourceHost = "") {
    const source = String(sourceHost || "").replace(/^www\./i, "").toLowerCase();
    return (Array.isArray(tabs) ? tabs : [])
      .filter((tab) => pageUrlForTab(tab))
      .map((tab, index) => ({ tab, index }))
      .sort((left, right) => {
        const leftSource = source && hostForTab(left.tab) === source ? 0 : 1;
        const rightSource = source && hostForTab(right.tab) === source ? 0 : 1;
        return leftSource - rightSource || left.index - right.index;
      })
      .map(({ tab }) => tab);
  }

  async function colorForTabs(tabs, { sourceHost = "" } = {}) {
    for (const tab of orderedTabs(tabs, sourceHost)) {
      const color = await readFaviconColor(tab);
      if (color) return color;
    }
    return "";
  }

  global.StillFaviconColors = Object.freeze({ colorForTabs });
})(typeof globalThis !== "undefined" ? globalThis : this);
