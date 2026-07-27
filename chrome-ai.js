(function exposeChromeAI(global) {
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
  const TAXONOMY_SET = new Set(TAXONOMY);
  const DAYPARTS = Object.freeze(["morning", "afternoon", "evening", "night"]);
  const MODEL_OPTIONS = Object.freeze({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  });
  const MAX_DOMAINS = 100;
  const MAX_SECONDS = 366 * 24 * 60 * 60;
  const MAX_SESSIONS = 1_000_000;
  const MAX_INSIGHT_LENGTH = 240;

  const CLASSIFICATION_SCHEMA = Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["classifications"],
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["domain", "category", "confidence"],
          properties: {
            domain: { type: "string" },
            category: { type: "string", enum: TAXONOMY },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      }
    }
  });

  function languageModel() {
    return global && (global.StillPreviewLanguageModel || global.LanguageModel);
  }

  function safeError(error, fallback = "The browser’s built-in model could not complete this request.") {
    const message =
      error && typeof error.message === "string" ? error.message.trim() : "";
    return (message || fallback).slice(0, 180);
  }

  function availabilityResult(state, extra = {}) {
    return {
      supported: state !== "unsupported",
      state,
      ...extra
    };
  }

  async function getAvailability() {
    const model = languageModel();
    if (!model || typeof model.availability !== "function") {
      return availabilityResult("unsupported", {
        reason: "This browser does not provide a compatible built-in model."
      });
    }

    try {
      const state = await model.availability(MODEL_OPTIONS);
      if (
        state === "unavailable" ||
        state === "downloadable" ||
        state === "downloading" ||
        state === "available"
      ) {
        return availabilityResult(state);
      }
      return availabilityResult("error", {
        error: `Chrome built-in AI returned an unknown availability state: ${String(state)}`
      });
    } catch (error) {
      return availabilityResult("error", { error: safeError(error) });
    }
  }

  function hasUserActivation(options) {
    if (!options || options.userInitiated !== true) return false;
    const userActivation = global && global.navigator && global.navigator.userActivation;
    return !userActivation || userActivation.isActive === true;
  }

  function reportDownload(onDownloadProgress, event) {
    if (typeof onDownloadProgress !== "function") return;
    const loaded = Number(event && event.loaded);
    const normalized = Number.isFinite(loaded)
      ? Math.max(0, Math.min(1, loaded))
      : 0;
    try {
      onDownloadProgress({
        loaded: normalized,
        percent: Math.round(normalized * 100)
      });
    } catch (_error) {
      // UI callbacks must never interrupt model setup.
    }
  }

  async function createSession(options = {}) {
    if (!hasUserActivation(options)) {
      return {
        ok: false,
        state: "user-action-required",
        error: "Start on-device intelligence from a button or another direct user action."
      };
    }

    const availability = await getAvailability();
    if (availability.state !== "available" &&
        availability.state !== "downloadable" &&
        availability.state !== "downloading") {
      return {
        ok: false,
        state: availability.state,
        error:
          availability.error ||
          availability.reason ||
          "The browser’s built-in model is unavailable on this device."
      };
    }

    const model = languageModel();
    try {
      const session = await model.create({
        ...MODEL_OPTIONS,
        monitor(monitor) {
          if (!monitor || typeof monitor.addEventListener !== "function") return;
          monitor.addEventListener("downloadprogress", (event) => {
            reportDownload(options.onDownloadProgress, event);
          });
        }
      });
      return { ok: true, state: "available", session };
    } catch (error) {
      return { ok: false, state: "error", error: safeError(error) };
    }
  }

  async function destroySession(session) {
    if (!session || typeof session.destroy !== "function") return;
    try {
      await session.destroy();
    } catch (_error) {
      // The inference result is still usable if Chrome already disposed the session.
    }
  }

  function normalizeDomain(value) {
    if (typeof value !== "string") return "";
    let domain = value.trim().toLowerCase().replace(/\.$/, "");
    if (domain.startsWith("www.")) domain = domain.slice(4);
    if (!domain || domain.length > 253 || /[/:?#@\s]/.test(domain)) return "";
    if (!/^[a-z0-9.-]+$/.test(domain)) return "";
    const labels = domain.split(".");
    if (
      labels.length < 2 ||
      labels.some(
        (label) =>
          !label ||
          label.length > 63 ||
          label.startsWith("-") ||
          label.endsWith("-")
      )
    ) {
      return "";
    }
    return domain;
  }

  function boundedNumber(value, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.min(maximum, Math.round(number));
  }

  function sanitizeDayparts(value) {
    const input = value && typeof value === "object" ? value : {};
    const result = {};
    for (const daypart of DAYPARTS) {
      result[daypart] = boundedNumber(input[daypart], MAX_SECONDS);
    }
    return result;
  }

  function sanitizeDomains(domains) {
    if (!Array.isArray(domains)) return [];
    const merged = new Map();

    for (const item of domains.slice(0, MAX_DOMAINS * 2)) {
      const source = typeof item === "string" ? { domain: item } : item;
      if (!source || typeof source !== "object") continue;
      const domain = normalizeDomain(source.domain || source.host);
      if (!domain) continue;

      const existing = merged.get(domain) || {
        domain,
        activeSeconds: 0,
        sessionCount: 0,
        daypartSeconds: sanitizeDayparts()
      };
      existing.activeSeconds = Math.min(
        MAX_SECONDS,
        existing.activeSeconds +
          boundedNumber(
            source.activeSeconds ?? source.durationSeconds ?? source.seconds,
            MAX_SECONDS
          )
      );
      existing.sessionCount = Math.min(
        MAX_SESSIONS,
        existing.sessionCount +
          boundedNumber(source.sessionCount ?? source.sessions, MAX_SESSIONS)
      );
      const dayparts = sanitizeDayparts(source.daypartSeconds || source.dayparts);
      for (const daypart of DAYPARTS) {
        existing.daypartSeconds[daypart] = Math.min(
          MAX_SECONDS,
          existing.daypartSeconds[daypart] + dayparts[daypart]
        );
      }
      merged.set(domain, existing);
      if (merged.size >= MAX_DOMAINS) break;
    }

    return Array.from(merged.values());
  }

  function defaultClassifications(domains) {
    return domains.map(({ domain }) => ({
      domain,
      category: "Other",
      confidence: 0
    }));
  }

  function parseClassificationResponse(response, domains) {
    let parsed;
    try {
      parsed = JSON.parse(String(response));
    } catch (_error) {
      return {
        ok: false,
        suggestions: defaultClassifications(domains),
        error: "The browser’s built-in model returned an unreadable category response."
      };
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.classifications) ||
      Object.keys(parsed).length !== 1
    ) {
      return {
        ok: false,
        suggestions: defaultClassifications(domains),
        error: "The browser’s built-in model returned an invalid category response."
      };
    }

    const requested = new Set(domains.map(({ domain }) => domain));
    const byDomain = new Map();
    for (const value of parsed.classifications) {
      if (!value || typeof value !== "object") continue;
      const domain = normalizeDomain(value.domain);
      if (!requested.has(domain) || byDomain.has(domain)) continue;
      const confidence = Number(value.confidence);
      const keys = Object.keys(value);
      const isExactShape =
        keys.length === 3 &&
        keys.includes("domain") &&
        keys.includes("category") &&
        keys.includes("confidence");
      const isValidConfidence =
        Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
      const category =
        isExactShape && isValidConfidence && TAXONOMY_SET.has(value.category)
          ? value.category
          : "Other";
      byDomain.set(domain, {
        domain,
        category,
        confidence: category !== "Other" ? confidence : 0
      });
    }

    return {
      ok: true,
      suggestions: domains.map(({ domain }) =>
        byDomain.get(domain) || { domain, category: "Other", confidence: 0 }
      )
    };
  }

  function responseConstraintUnsupported(error) {
    return (
      error instanceof TypeError ||
      (error && (error.name === "NotSupportedError" ||
        error.name === "DataError"))
    );
  }

  async function promptForClassifications(session, prompt) {
    try {
      return await session.prompt(prompt, {
        responseConstraint: CLASSIFICATION_SCHEMA
      });
    } catch (error) {
      if (!responseConstraintUnsupported(error)) throw error;
      return session.prompt(
        `${prompt}\nReturn only the JSON object described above. Do not use Markdown.`
      );
    }
  }

  async function classifyDomains(domains, options = {}) {
    const safeDomains = sanitizeDomains(domains);
    if (!safeDomains.length) {
      return {
        ok: false,
        state: "invalid-input",
        suggestions: [],
        error: "At least one valid aggregated domain is required."
      };
    }

    const created = await createSession(options);
    if (!created.ok) {
      return {
        ok: false,
        state: created.state,
        suggestions: defaultClassifications(safeDomains),
        error: created.error
      };
    }

    const prompt =
      "Suggest one browsing category for each domain using only this taxonomy: " +
      `${TAXONOMY.join(", ")}. Categories are suggestions, not facts. ` +
      "Use Other when uncertain. Confidence must be between 0 and 1. " +
      "Return a JSON object with a classifications array containing domain, category, and confidence. " +
      "The input contains only locally aggregated active time, session count, and time-of-day totals:\n" +
      JSON.stringify(safeDomains);

    try {
      const response = await promptForClassifications(created.session, prompt);
      const parsed = parseClassificationResponse(response, safeDomains);
      return {
        ok: parsed.ok,
        state: parsed.ok ? "available" : "error",
        suggestions: parsed.suggestions,
        ...(parsed.error ? { error: parsed.error } : {})
      };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        suggestions: defaultClassifications(safeDomains),
        error: safeError(error)
      };
    } finally {
      await destroySession(created.session);
    }
  }

  function sanitizeCategoryRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, MAX_DOMAINS).flatMap((row) => {
      if (!row || typeof row !== "object" || !TAXONOMY_SET.has(row.category)) {
        return [];
      }
      return [{
        category: row.category,
        activeSeconds: boundedNumber(
          row.activeSeconds ?? row.durationSeconds,
          MAX_SECONDS
        ),
        sessionCount: boundedNumber(row.sessionCount ?? row.sessions, MAX_SESSIONS)
      }];
    });
  }

  function sanitizeInsightSummary(summary) {
    const source = summary && typeof summary === "object" ? summary : {};
    return {
      rangeDays: Math.min(366, boundedNumber(source.rangeDays, 366)),
      totalActiveSeconds: boundedNumber(
        source.totalActiveSeconds ?? source.durationSeconds,
        MAX_SECONDS
      ),
      totalSessions: boundedNumber(
        source.totalSessions ?? source.sessionCount,
        MAX_SESSIONS
      ),
      daypartSeconds: sanitizeDayparts(source.daypartSeconds || source.dayparts),
      categories: sanitizeCategoryRows(source.categories),
      domains: sanitizeDomains(source.domains).map((domain) => {
        const original = Array.isArray(source.domains)
          ? source.domains.find((item) => {
              const value = typeof item === "string" ? item : item && (item.domain || item.host);
              return normalizeDomain(value) === domain.domain;
            })
          : null;
        return {
          ...domain,
          category:
            original && TAXONOMY_SET.has(original.category)
              ? original.category
              : "Other"
        };
      })
    };
  }

  function trimInsight(value) {
    const normalized = String(value || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[*_#>`]/g, "")
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return "";
    if (normalized.length <= MAX_INSIGHT_LENGTH) return normalized;
    const shortened = normalized.slice(0, MAX_INSIGHT_LENGTH - 1);
    const lastSpace = shortened.lastIndexOf(" ");
    return `${shortened.slice(0, lastSpace > 160 ? lastSpace : shortened.length).trim()}…`;
  }

  function hasInsightEvidence(summary) {
    return (
      summary.totalActiveSeconds > 0 ||
      summary.totalSessions > 0 ||
      summary.categories.length > 0 ||
      summary.domains.length > 0 ||
      DAYPARTS.some((daypart) => summary.daypartSeconds[daypart] > 0)
    );
  }

  async function explainInsights(aggregatedSummary, options = {}) {
    const summary = sanitizeInsightSummary(aggregatedSummary);
    if (!hasInsightEvidence(summary)) {
      return {
        ok: false,
        state: "insufficient-data",
        insight: "",
        error: "There is not enough aggregated activity to explain yet."
      };
    }

    const created = await createSession(options);
    if (!created.ok) {
      return {
        ok: false,
        state: created.state,
        insight: "",
        error: created.error
      };
    }

    const prompt =
      "Write one short, neutral, useful observation about these browsing patterns. " +
      "Use only the supplied numbers. Do not infer motives, productivity, wellbeing, " +
      "or anything not directly supported by the data. Mention uncertainty when the sample is small. " +
      "Use plain language and no heading, bullets, advice, or judgment.\n" +
      JSON.stringify(summary);

    try {
      const insight = trimInsight(await created.session.prompt(prompt));
      if (!insight) {
        return {
          ok: false,
          state: "error",
          insight: "",
          error: "The browser’s built-in model returned an empty observation."
        };
      }
      return { ok: true, state: "available", insight };
    } catch (error) {
      return {
        ok: false,
        state: "error",
        insight: "",
        error: safeError(error)
      };
    } finally {
      await destroySession(created.session);
    }
  }

  global.StillChromeAI = Object.freeze({
    TAXONOMY,
    getAvailability,
    createSession,
    classifyDomains,
    explainInsights,
    sanitizeDomains,
    sanitizeInsightSummary,
    parseClassificationResponse,
    trimInsight
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
