(function exposeTabOrganizer(global) {
  "use strict";

  const TAB_GROUP_NONE = -1;
  const GROUP_COLORS = Object.freeze([
    "blue",
    "cyan",
    "green",
    "purple",
    "yellow",
    "orange",
    "pink"
  ]);

  const CATEGORY_RULES = Object.freeze([
    { name: "Social", pattern: /(^|\.)(reddit|x|twitter|facebook|instagram|linkedin|tiktok)\.com$/ },
    { name: "Video", pattern: /(^|\.)(youtube|vimeo|netflix|twitch)\.com$/ },
    { name: "News", pattern: /(^|\.)(news\.ycombinator|nytimes|theguardian|bbc|cnn|reuters|medium|substack)\./ },
    { name: "Work", pattern: /(^|\.)(github|gitlab|figma|notion|slack)\.com$|(^|\.)linear\.app$|(^|\.)(docs|drive|calendar)\.google\.com$/ },
    { name: "Research", pattern: /(^|\.)(wikipedia|arxiv|scholar\.google|stackoverflow|developer\.mozilla|developer\.chrome)\./ },
    { name: "Learning", pattern: /(^|\.)(coursera|udemy|edx|khanacademy|codecademy|freecodecamp)\./ },
    { name: "Shopping", pattern: /(^|\.)(amazon|ebay|etsy|flipkart|walmart|target|bestbuy|aliexpress|myntra|meesho|ikea)\./ }
  ]);

  const CATCH_ALL_GROUP_TITLE = /^(related tabs?|misc|other|general)$/i;
  const GENERIC_WORKSTREAM_TITLE = /^(work|research|learning)$/i;
  const CROSS_SITE_CATEGORY_NAMES = new Set(["Social", "Video", "News", "Shopping"]);
  const LINKED_TAB_PREFIX = "🔗 ";

  // Chrome's built-in model uses a broader taxonomy than the local rules. Keep
  // its values bounded and translate the one long label into a compact group name.
  const AI_CATEGORY_NAMES = Object.freeze({
    Social: "Social",
    Video: "Video",
    News: "News",
    Entertainment: "Entertainment",
    Communication: "Communication",
    Productivity: "Productivity",
    Shopping: "Shopping",
    "Reference & learning": "Learning",
    Finance: "Finance"
  });

  function hostFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.hostname.replace(/^www\./, "").toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function normalizedHost(value) {
    const host = String(value || "").replace(/^www\./, "").toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
      ? host
      : "";
  }

  function labelForHost(host) {
    const normalized = normalizedHost(host);
    const knownLabels = {
      "github.com": "GitHub",
      "gitlab.com": "GitLab",
      "linkedin.com": "LinkedIn",
      "stackoverflow.com": "Stack Overflow",
      "youtube.com": "YouTube",
      "x.com": "X"
    };
    if (knownLabels[normalized]) return knownLabels[normalized];
    const root = String(host || "").split(".")[0].replace(/[-_]/g, " ");
    return root ? root.charAt(0).toUpperCase() + root.slice(1) : "Related tabs";
  }

  function categoryForHost(host, categoryOverrides = {}) {
    const override = AI_CATEGORY_NAMES[categoryOverrides?.[host]];
    if (override) return override;
    return CATEGORY_RULES.find((rule) => rule.pattern.test(host))?.name || "";
  }

  function categoryForTab(tab, categoryOverrides = {}) {
    const hostCategory = categoryForHost(tab.host, categoryOverrides);
    if (hostCategory) return hostCategory;
    return /\bnews\b/i.test(String(tab.title || "")) ? "News" : "";
  }

  function isOrganizable(tab) {
    return Boolean(Number.isInteger(tab?.id) && !tab.pinned && (hostFromUrl(tab.url) || normalizedHost(tab.host)));
  }

  function normalizedTabs(tabs) {
    return (Array.isArray(tabs) ? tabs : [])
      .filter(isOrganizable)
      .map((tab) => ({
        id: tab.id,
        windowId: Number.isInteger(tab.windowId) ? tab.windowId : 0,
        index: Number.isInteger(tab.index) ? tab.index : 0,
        groupId: Number.isInteger(tab.groupId) ? tab.groupId : TAB_GROUP_NONE,
        title: String(tab.title || "").replace(/\s+/g, " ").trim().slice(0, 160),
        host: hostFromUrl(tab.url) || normalizedHost(tab.host)
      }));
  }

  function nameForTabs(tabs, categoryOverrides = {}) {
    const safeTabs = normalizedTabs(tabs);
    const hosts = [...new Set(safeTabs.map((tab) => tab.host))];
    if (hosts.length === 1) return labelForHost(hosts[0]);
    const categories = safeTabs
      .map((tab) => categoryForTab(tab, categoryOverrides))
      .filter(Boolean);
    const category = categories.length === safeTabs.length && categories[0] &&
      categories.every((value) => value === categories[0])
      ? categories[0]
      : "";
    if (category) return category;
    return "Related tabs";
  }

  function nameForLinkedTabs(tabs, sourceHost = "") {
    const safeTabs = normalizedTabs(tabs);
    const hosts = [...new Set(safeTabs.map((tab) => tab.host))];
    if (hosts.length === 1) return `${LINKED_TAB_PREFIX}${labelForHost(hosts[0])}`;

    const source = hostFromUrl(sourceHost) || normalizedHost(sourceHost);
    return source ? `${LINKED_TAB_PREFIX}${labelForHost(source)}` : "Related tabs";
  }

  function colorForName(name) {
    let hash = 0;
    for (const character of String(name || "")) {
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }
    return GROUP_COLORS[hash % GROUP_COLORS.length];
  }

  function plansForTabs(tabs, categoryOverrides = {}) {
    const candidates = normalizedTabs(tabs).filter((tab) => tab.groupId === TAB_GROUP_NONE);
    const buckets = new Map();
    for (const tab of candidates) {
      const category = categoryForTab(tab, categoryOverrides);
      const key = CROSS_SITE_CATEGORY_NAMES.has(category)
        ? `category:${category}`
        : `host:${tab.host}`;
      const items = buckets.get(key) || [];
      items.push(tab);
      buckets.set(key, items);
    }

    return Array.from(buckets.values())
      .filter((items) => items.length >= 2)
      .map((tabsInGroup) => {
        const title = nameForTabs(tabsInGroup, categoryOverrides);
        return {
          title,
          color: colorForName(title),
          tabs: tabsInGroup.sort((a, b) => a.index - b.index)
        };
      })
      .sort((left, right) => left.tabs[0].index - right.tabs[0].index);
  }

  function safePlanTitle(value) {
    const title = String(value || "")
      .replace(/[\u0000-\u001F\u007F<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    return CATCH_ALL_GROUP_TITLE.test(title) || GENERIC_WORKSTREAM_TITLE.test(title) ? "" : title;
  }

  // Accept a model's proposed clusters only after resolving every tab id against
  // the current, ungrouped window. A connected model is the semantic authority:
  // local hostname categories are only a fallback when no model result exists.
  // We still reject malformed IDs, duplicate ownership, and catch-all titles.
  function plansForExplicitGroups(tabs, groups) {
    const candidates = normalizedTabs(tabs).filter((tab) => tab.groupId === TAB_GROUP_NONE);
    const byId = new Map(candidates.map((tab) => [tab.id, tab]));
    const usedTabIds = new Set();
    if (!Array.isArray(groups)) return [];

    return groups.slice(0, 20).flatMap((group) => {
      const title = safePlanTitle(group?.title);
      if (!title || !Array.isArray(group?.tabIds)) return [];
      const groupTabIds = [...new Set(group.tabIds.filter(Number.isInteger))]
        .filter((tabId) => byId.has(tabId) && !usedTabIds.has(tabId));
      if (groupTabIds.length < 2) return [];
      const tabsInGroup = groupTabIds
        .map((tabId) => byId.get(tabId))
        .sort((left, right) => left.index - right.index);
      if (!title || CATCH_ALL_GROUP_TITLE.test(title)) return [];
      for (const tabId of groupTabIds) usedTabIds.add(tabId);
      return [{
        title,
        color: colorForName(title),
        tabs: tabsInGroup
      }];
    });
  }

  function groupPayload(groupId, tabs, fallbackName = "Related tabs") {
    const safeTabs = normalizedTabs(tabs);
    return {
      id: Number(groupId),
      fallbackName: String(fallbackName || "Related tabs").slice(0, 60),
      tabs: safeTabs.map(({ id, host, title }) => ({ id, host, title }))
    };
  }

  global.StillTabOrganizer = Object.freeze({
    TAB_GROUP_NONE,
    colorForName,
    groupPayload,
    hostFromUrl,
    isOrganizable,
    nameForLinkedTabs,
    nameForTabs,
    normalizedTabs,
    plansForExplicitGroups,
    plansForTabs
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
