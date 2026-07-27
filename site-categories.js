(function initializeStillSiteCategories(root) {
  "use strict";

  const TAXONOMY = Object.freeze([
    "Social",
    "Video",
    "News",
    "Entertainment",
    "Communication",
    "Productivity",
    "Shopping",
    "Reference & learning",
    "Finance",
    "Other"
  ]);

  const CATEGORY_SET = new Set(TAXONOMY);

  const CURATED_HOSTS = Object.freeze({
    // Social
    "reddit.com": "Social",
    "instagram.com": "Social",
    "facebook.com": "Social",
    "threads.net": "Social",
    "x.com": "Social",
    "twitter.com": "Social",
    "tiktok.com": "Social",
    "linkedin.com": "Social",
    "pinterest.com": "Social",
    "tumblr.com": "Social",
    "mastodon.social": "Social",
    "bsky.app": "Social",

    // Video
    "youtube.com": "Video",
    "youtu.be": "Video",
    "vimeo.com": "Video",
    "twitch.tv": "Video",
    "dailymotion.com": "Video",
    "loom.com": "Video",

    // News
    "bbc.com": "News",
    "bbc.co.uk": "News",
    "cnn.com": "News",
    "nytimes.com": "News",
    "theguardian.com": "News",
    "washingtonpost.com": "News",
    "reuters.com": "News",
    "apnews.com": "News",
    "npr.org": "News",
    "theatlantic.com": "News",
    "economist.com": "News",
    "wsj.com": "News",
    "indiatimes.com": "News",
    "thehindu.com": "News",
    "hindustantimes.com": "News",
    "ndtv.com": "News",
    "techcrunch.com": "News",
    "theverge.com": "News",
    "arstechnica.com": "News",

    // Entertainment
    "netflix.com": "Entertainment",
    "disneyplus.com": "Entertainment",
    "hulu.com": "Entertainment",
    "max.com": "Entertainment",
    "primevideo.com": "Entertainment",
    "spotify.com": "Entertainment",
    "music.apple.com": "Entertainment",
    "soundcloud.com": "Entertainment",
    "imdb.com": "Entertainment",
    "letterboxd.com": "Entertainment",
    "goodreads.com": "Entertainment",

    // Communication
    "mail.google.com": "Communication",
    "gmail.com": "Communication",
    "outlook.com": "Communication",
    "slack.com": "Communication",
    "teams.microsoft.com": "Communication",
    "discord.com": "Communication",
    "web.whatsapp.com": "Communication",
    "whatsapp.com": "Communication",
    "telegram.org": "Communication",
    "messenger.com": "Communication",
    "zoom.us": "Communication",
    "meet.google.com": "Communication",

    // Productivity
    "docs.google.com": "Productivity",
    "drive.google.com": "Productivity",
    "sheets.google.com": "Productivity",
    "slides.google.com": "Productivity",
    "calendar.google.com": "Productivity",
    "notion.so": "Productivity",
    "github.com": "Productivity",
    "gitlab.com": "Productivity",
    "bitbucket.org": "Productivity",
    "linear.app": "Productivity",
    "asana.com": "Productivity",
    "trello.com": "Productivity",
    "clickup.com": "Productivity",
    "monday.com": "Productivity",
    "figma.com": "Productivity",
    "canva.com": "Productivity",
    "dropbox.com": "Productivity",
    "office.com": "Productivity",

    // Shopping
    "amazon.com": "Shopping",
    "amazon.in": "Shopping",
    "ebay.com": "Shopping",
    "etsy.com": "Shopping",
    "walmart.com": "Shopping",
    "target.com": "Shopping",
    "bestbuy.com": "Shopping",
    "aliexpress.com": "Shopping",
    "flipkart.com": "Shopping",
    "myntra.com": "Shopping",
    "meesho.com": "Shopping",
    "ikea.com": "Shopping",

    // Reference and learning
    "wikipedia.org": "Reference & learning",
    "stackoverflow.com": "Reference & learning",
    "stackexchange.com": "Reference & learning",
    "developer.mozilla.org": "Reference & learning",
    "coursera.org": "Reference & learning",
    "edx.org": "Reference & learning",
    "khanacademy.org": "Reference & learning",
    "udemy.com": "Reference & learning",
    "skillshare.com": "Reference & learning",
    "duolingo.com": "Reference & learning",
    "medium.com": "Reference & learning",
    "substack.com": "Reference & learning",
    "arxiv.org": "Reference & learning",
    "scholar.google.com": "Reference & learning",
    "archive.org": "Reference & learning",

    // Finance
    "paypal.com": "Finance",
    "stripe.com": "Finance",
    "wise.com": "Finance",
    "coinbase.com": "Finance",
    "robinhood.com": "Finance",
    "tradingview.com": "Finance",
    "finance.yahoo.com": "Finance",
    "bloomberg.com": "Finance",
    "moneycontrol.com": "Finance",
    "zerodha.com": "Finance"
  });

  const TOKEN_HEURISTICS = Object.freeze({
    Social: new Set(["social"]),
    Video: new Set(["video", "videos"]),
    News: new Set(["news"]),
    Entertainment: new Set(["games", "gaming", "movies", "music", "radio"]),
    Communication: new Set(["chat", "mail", "meeting", "meetings"]),
    Productivity: new Set(["calendar", "docs", "tasks", "workspace"]),
    Shopping: new Set(["cart", "shop", "shopping", "store"]),
    "Reference & learning": new Set(["academy", "courses", "learn", "learning", "school"]),
    Finance: new Set(["bank", "banking", "finance", "investing", "payments", "trading"])
  });

  function normalizeHost(input) {
    if (typeof input !== "string") return "";
    let value = input.trim().toLowerCase();
    if (!value) return "";

    try {
      const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
      value = url.hostname;
    } catch {
      value = value.split("/")[0].split("?")[0].split("#")[0];
      if (value.startsWith("[")) {
        const closingBracket = value.indexOf("]");
        value = closingBracket >= 0 ? value.slice(0, closingBracket + 1) : value;
      } else {
        value = value.split(":")[0];
      }
    }

    value = value.replace(/^\.+|\.+$/g, "");
    return value.startsWith("www.") ? value.slice(4) : value;
  }

  function valueFromLookup(lookup, host) {
    if (!lookup || !host) return undefined;
    if (lookup instanceof Map) return lookup.get(host);
    if (typeof lookup === "object") return lookup[host];
    return undefined;
  }

  function categoryFromLookup(lookup, host) {
    let candidate = host;
    while (candidate) {
      const category = valueFromLookup(lookup, candidate);
      if (CATEGORY_SET.has(category)) return category;
      const dot = candidate.indexOf(".");
      if (dot < 0) break;
      candidate = candidate.slice(dot + 1);
    }
    return undefined;
  }

  function categorizeHost(input, options = {}) {
    const host = normalizeHost(input);
    if (!host) return "Other";

    const normalizedOptions =
      options instanceof Map ||
      (options && typeof options === "object" &&
        !("overrides" in options) &&
        !("cachedCategories" in options) &&
        !("aiCategories" in options))
        ? { overrides: options }
        : options || {};

    const explicit =
      categoryFromLookup(normalizedOptions.overrides, host) ||
      categoryFromLookup(normalizedOptions.cachedCategories, host) ||
      categoryFromLookup(normalizedOptions.aiCategories, host);
    if (explicit) return explicit;

    const curated = categoryFromLookup(CURATED_HOSTS, host);
    if (curated) return curated;

    const tokens = new Set(host.split(/[.-]/).filter(Boolean));
    for (const category of TAXONOMY) {
      const keywords = TOKEN_HEURISTICS[category];
      if (keywords && Array.from(keywords).some((keyword) => tokens.has(keyword))) {
        return category;
      }
    }
    if (host.endsWith(".edu") || host.endsWith(".ac.uk")) {
      return "Reference & learning";
    }
    return "Other";
  }

  function toTimestamp(value, fallback) {
    if (value instanceof Date) return value.getTime();
    if (Number.isFinite(value)) return value;
    if (typeof value === "string" && value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  function localDayBounds(dayKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
    if (!match) return null;
    const start = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    ).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
  }

  function activitySeconds(activity) {
    if (Number.isFinite(activity)) return Math.max(0, activity);
    if (!activity || typeof activity !== "object") return 0;
    if (Number.isFinite(activity.usageSeconds)) return Math.max(0, activity.usageSeconds);
    if (Number.isFinite(activity.seconds)) return Math.max(0, activity.seconds);
    if (Number.isFinite(activity.durationSeconds)) {
      return Math.max(0, activity.durationSeconds);
    }
    const start = toTimestamp(
      activity.startedAt ?? activity.startAt ?? activity.start,
      NaN
    );
    const end = toTimestamp(activity.endedAt ?? activity.endAt ?? activity.end, NaN);
    return Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, (end - start) / 1000)
      : 0;
  }

  function activityTimestamp(activity) {
    if (!activity || typeof activity !== "object") return NaN;
    return toTimestamp(
      activity.startedAt ??
        activity.startAt ??
        activity.timestamp ??
        activity.createdAt ??
        activity.start,
      NaN
    );
  }

  function explicitCount(activity, keys) {
    if (!activity || typeof activity !== "object") return null;
    for (const key of keys) {
      if (Number.isFinite(activity[key])) return Math.max(0, activity[key]);
    }
    return null;
  }

  function createUsageRows(usageStats, rangeStart, rangeEnd) {
    const rows = [];
    const add = (host, activity, implicitOccurrence = false) => {
      const normalizedHost = normalizeHost(host || activity?.host || activity?.domain);
      if (!normalizedHost) return;
      const timestamp = activityTimestamp(activity);
      if (
        Number.isFinite(timestamp) &&
        (timestamp < rangeStart || timestamp >= rangeEnd)
      ) {
        return;
      }
      rows.push({
        host: normalizedHost,
        seconds: activitySeconds(activity),
        visits:
          explicitCount(activity, ["visits", "visitCount"]) ??
          (implicitOccurrence ? 1 : null),
        sessions:
          explicitCount(activity, ["sessions", "sessionCount"]) ??
          (implicitOccurrence ? 1 : null)
      });
    };

    if (Array.isArray(usageStats)) {
      usageStats.forEach((activity) => add("", activity, true));
      return rows;
    }
    if (!usageStats || typeof usageStats !== "object") return rows;

    const eventCollections = [
      usageStats.events,
      usageStats.occurrences,
      usageStats.sessions
    ].find(Array.isArray);
    if (eventCollections) {
      eventCollections.forEach((activity) => add("", activity, true));
    }

    for (const [key, value] of Object.entries(usageStats)) {
      if (["events", "occurrences", "sessions"].includes(key)) continue;
      const bounds = localDayBounds(key);
      if (bounds && value && typeof value === "object" && !Array.isArray(value)) {
        if (bounds.end <= rangeStart || bounds.start >= rangeEnd) continue;
        for (const [host, activity] of Object.entries(value)) {
          add(host, activity);
        }
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((activity) => add(key, activity, true));
      } else if (
        typeof value === "number" ||
        (value && typeof value === "object" &&
          ("usageSeconds" in value ||
            "seconds" in value ||
            "durationSeconds" in value ||
            "startedAt" in value))
      ) {
        add(key, value);
      }
    }
    return rows;
  }

  function roundPercent(numerator, denominator) {
    return denominator > 0
      ? Math.round((numerator / denominator) * 1000) / 10
      : 0;
  }

  function aggregateCategoryInsights({
    usageStats = {},
    rangeStart = -Infinity,
    rangeEnd,
    now = Date.now(),
    overrides,
    cachedCategories,
    aiCategories
  } = {}) {
    const start = toTimestamp(rangeStart, -Infinity);
    const end = toTimestamp(rangeEnd, now);
    const categoryOptions = { overrides, cachedCategories, aiCategories };
    const categoryRows = new Map();
    let totalSeconds = 0;

    for (const row of createUsageRows(usageStats, start, end)) {
      const category = categorizeHost(row.host, categoryOptions);
      const current = categoryRows.get(category) || {
        category,
        seconds: 0,
        visits: 0,
        sessions: 0,
        hasVisits: false,
        hasSessions: false,
        domainRows: new Map()
      };
      const domain = current.domainRows.get(row.host) || {
        host: row.host,
        category,
        seconds: 0,
        visits: 0,
        sessions: 0,
        hasVisits: false,
        hasSessions: false
      };

      current.seconds += row.seconds;
      domain.seconds += row.seconds;
      totalSeconds += row.seconds;
      if (row.visits !== null) {
        current.visits += row.visits;
        domain.visits += row.visits;
        current.hasVisits = true;
        domain.hasVisits = true;
      }
      if (row.sessions !== null) {
        current.sessions += row.sessions;
        domain.sessions += row.sessions;
        current.hasSessions = true;
        domain.hasSessions = true;
      }
      current.domainRows.set(row.host, domain);
      categoryRows.set(category, current);
    }

    const categories = Array.from(categoryRows.values())
      .map((row) => {
        const domains = Array.from(row.domainRows.values())
          .map((domain) => {
            const result = {
              host: domain.host,
              category: domain.category,
              seconds: Math.round(domain.seconds),
              percent: roundPercent(domain.seconds, row.seconds)
            };
            if (domain.hasVisits) result.visits = domain.visits;
            if (domain.hasSessions) result.sessions = domain.sessions;
            return result;
          })
          .sort(
            (a, b) =>
              b.seconds - a.seconds ||
              (b.visits || 0) - (a.visits || 0) ||
              a.host.localeCompare(b.host)
          );
        const result = {
          category: row.category,
          seconds: Math.round(row.seconds),
          percent: roundPercent(row.seconds, totalSeconds),
          domains,
          leaders: domains
        };
        if (row.hasVisits) result.visits = row.visits;
        if (row.hasSessions) result.sessions = row.sessions;
        return result;
      })
      .sort(
        (a, b) =>
          b.seconds - a.seconds ||
          (b.visits || 0) - (a.visits || 0) ||
          TAXONOMY.indexOf(a.category) - TAXONOMY.indexOf(b.category)
      );

    return {
      totalSeconds: Math.round(totalSeconds),
      rangeStart: Number.isFinite(start) ? start : null,
      rangeEnd: Number.isFinite(end) ? end : null,
      categories
    };
  }

  const api = Object.freeze({
    TAXONOMY,
    CURATED_HOSTS,
    normalizeHost,
    categorizeHost,
    aggregateCategoryInsights
  });

  root.StillSiteCategories = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "object" ? globalThis : this);
