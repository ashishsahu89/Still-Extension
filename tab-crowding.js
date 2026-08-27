(function exposeTabCrowding(global) {
  "use strict";

  const DEFAULT_WINDOW_WIDTH = 1280;
  const CHROME_CONTROLS_ALLOWANCE = 220;
  const PINNED_TAB_WIDTH = 44;
  const GROUP_LABEL_BASE_WIDTH = 30;
  const GROUP_LABEL_CHARACTER_WIDTH = 7;
  const GROUP_LABEL_MAX_WIDTH = 130;
  const CROWDED_TAB_WIDTH = 90;
  const MIN_UNGROUPED_TABS = 10;

  function safeWidth(value, fallback = DEFAULT_WINDOW_WIDTH) {
    const width = Number(value);
    return Number.isFinite(width) && width > 0 ? width : fallback;
  }

  function groupLabelWidth(group = {}) {
    const title = String(group.title || "").trim();
    return Math.min(
      GROUP_LABEL_MAX_WIDTH,
      GROUP_LABEL_BASE_WIDTH + title.length * GROUP_LABEL_CHARACTER_WIDTH
    );
  }

  function estimate({ windowWidth, tabs = [], groups = [] } = {}) {
    const groupById = new Map(
      (Array.isArray(groups) ? groups : [])
        .filter((group) => Number.isInteger(group?.id) && group.id >= 0)
        .map((group) => [group.id, group])
    );
    const safeTabs = Array.isArray(tabs) ? tabs : [];
    const pinnedTabs = safeTabs.filter((tab) => tab?.pinned).length;
    const visibleRegularTabs = safeTabs.filter((tab) => {
      if (tab?.pinned) return false;
      const group = groupById.get(tab?.groupId);
      return !group?.collapsed;
    }).length;
    const ungroupedTabs = safeTabs.filter(
      (tab) =>
        !tab?.pinned &&
        Number(tab?.groupId) === -1 &&
        /^https?:/i.test(String(tab?.url || tab?.pendingUrl || ""))
    ).length;
    const groupLabelsWidth = [...groupById.values()]
      .reduce((total, group) => total + groupLabelWidth(group), 0);
    const availableWidth = Math.max(
      0,
      safeWidth(windowWidth) -
        CHROME_CONTROLS_ALLOWANCE -
        pinnedTabs * PINNED_TAB_WIDTH -
        groupLabelsWidth
    );
    const estimatedTabWidth = visibleRegularTabs
      ? Math.round(availableWidth / visibleRegularTabs)
      : 240;
    const isCrowded =
      ungroupedTabs >= MIN_UNGROUPED_TABS &&
      estimatedTabWidth < CROWDED_TAB_WIDTH;

    return {
      isCrowded,
      estimatedTabWidth,
      ungroupedTabs,
      visibleTabs: visibleRegularTabs + pinnedTabs,
      windowWidth: safeWidth(windowWidth),
      threshold: CROWDED_TAB_WIDTH,
      minimumUngroupedTabs: MIN_UNGROUPED_TABS
    };
  }

  global.StillTabCrowding = Object.freeze({
    CROWDED_TAB_WIDTH,
    MIN_UNGROUPED_TABS,
    estimate,
    groupLabelWidth
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
