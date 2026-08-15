(function exposeAIConnections(global) {
  "use strict";

  const PROVIDERS = Object.freeze({
    openai: Object.freeze({
      id: "openai",
      label: "OpenAI",
      description: "Connect an OpenAI API account.",
      endpoint: "https://api.openai.com/v1/chat/completions",
      local: false,
      requiresApiKey: true,
      modelPlaceholder: "Enter the model name from your API account"
    }),
    ollama: Object.freeze({
      id: "ollama",
      label: "Ollama",
      description: "Use a model running locally with Ollama.",
      endpoint: "http://localhost:11434/v1/chat/completions",
      local: true,
      requiresApiKey: false,
      modelPlaceholder: "For example, llama3.2"
    }),
    lmstudio: Object.freeze({
      id: "lmstudio",
      label: "LM Studio",
      description: "Use a model served locally by LM Studio.",
      endpoint: "http://localhost:1234/v1/chat/completions",
      local: true,
      requiresApiKey: false,
      modelPlaceholder: "Enter the model identifier shown in LM Studio"
    }),
    compatible: Object.freeze({
      id: "compatible",
      label: "OpenAI-compatible API",
      description: "Connect another service that supports Chat Completions.",
      endpoint: "",
      local: false,
      requiresApiKey: false,
      modelPlaceholder: "Enter the provider’s model name"
    })
  });

  const MAX_LABEL_LENGTH = 80;
  const MAX_MODEL_LENGTH = 160;
  const MAX_ENDPOINT_LENGTH = 2048;
  const MAX_API_KEY_LENGTH = 4096;
  const DEFAULT_TIMEOUT_MS = 15000;

  function providerFor(id) {
    return PROVIDERS[id] || null;
  }

  function cleanText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function isLoopbackHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    return (
      normalized === "localhost" ||
      normalized === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(normalized)
    );
  }

  function normalizedEndpoint(value) {
    const text = cleanText(value, MAX_ENDPOINT_LENGTH);
    if (!text) return "";
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol)) return "";
      if (url.username || url.password || url.hash) return "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  }

  function normalizeConnection(input = {}) {
    const preset = providerFor(input.provider) || PROVIDERS.compatible;
    const endpoint = normalizedEndpoint(input.endpoint || preset.endpoint);
    return {
      id: cleanText(input.id, 120),
      provider: preset.id,
      label: cleanText(input.label || preset.label, MAX_LABEL_LENGTH),
      model: cleanText(input.model, MAX_MODEL_LENGTH),
      endpoint,
      local: preset.local || Boolean(endpoint && isLoopbackHostname(new URL(endpoint).hostname)),
      createdAt: Number(input.createdAt) || 0,
      updatedAt: Number(input.updatedAt) || 0,
      lastTestedAt: Number(input.lastTestedAt) || 0,
      lastLatencyMs: Math.max(0, Number(input.lastLatencyMs) || 0)
    };
  }

  function resolveActiveConnectionId(connections = [], storedValue) {
    const ids = new Set(
      (Array.isArray(connections) ? connections : [])
        .map((connection) => cleanText(connection?.id, 120))
        .filter(Boolean)
    );
    if (storedValue === "") return "";
    if (typeof storedValue === "string") return ids.has(storedValue) ? storedValue : "";
    return ids.values().next().value || "";
  }

  function validateConnection(input = {}, apiKey = "") {
    const preset = providerFor(input.provider);
    if (!preset) return { ok: false, field: "provider", error: "Choose a provider." };

    const connection = normalizeConnection(input);
    if (!connection.label) {
      return { ok: false, field: "label", error: "Give this model a name." };
    }
    if (!connection.model) {
      return { ok: false, field: "model", error: "Enter the model request name." };
    }
    if (!connection.endpoint) {
      return { ok: false, field: "endpoint", error: "Enter a valid HTTP or HTTPS endpoint." };
    }

    const endpoint = new URL(connection.endpoint);
    if (endpoint.protocol === "http:" && !isLoopbackHostname(endpoint.hostname)) {
      return {
        ok: false,
        field: "endpoint",
        error: "Use HTTPS for remote models. HTTP is allowed only for models on this device."
      };
    }

    const secret = cleanText(apiKey, MAX_API_KEY_LENGTH);
    // A generic OpenAI-compatible connection can point at a local server
    // (which commonly needs no key) or a hosted provider such as Fireworks
    // (which does). Treat remote compatible endpoints as authenticated by
    // default so we never make a misleading unauthenticated request.
    const needsApiKey = !connection.local && (preset.requiresApiKey || preset.id === "compatible");
    if (needsApiKey && !secret) {
      return { ok: false, field: "apiKey", error: "Enter your API key." };
    }

    return { ok: true, connection, apiKey: secret };
  }

  function requestFor(connection, apiKey, prompt = "Reply with the single word: ready", requestOptions = {}) {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const maxTokens = Math.max(1, Math.min(4096, Number(requestOptions.maxTokens) || 0));
    const temperature = Number(requestOptions.temperature);
    const reasoningEffort = ["low", "medium", "high", "xhigh", "max", "none"].includes(
      String(requestOptions.reasoningEffort || "")
    )
      ? String(requestOptions.reasoningEffort)
      : "";
    return {
      url: connection.endpoint,
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: connection.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          ...(Number.isFinite(temperature) ? { temperature: Math.max(0, Math.min(2, temperature)) } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
        })
      }
    };
  }

  function responseError(payload, status) {
    const candidate =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      `The model returned HTTP ${status}.`;
    return cleanText(candidate, 220) || "The model rejected the connection test.";
  }

  async function testConnection(input, options = {}) {
    const validated = validateConnection(input, options.apiKey);
    if (!validated.ok) return validated;
    const fetchImpl = options.fetchImpl || global.StillPreviewAIConnectionFetch || global.fetch;
    if (typeof fetchImpl !== "function") {
      return { ok: false, error: "This browser cannot test the connection." };
    }

    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const request = requestFor(validated.connection, validated.apiKey);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(request.url, {
        ...request.options,
        ...(controller ? { signal: controller.signal } : {})
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch (_error) {
        // The HTTP status below still provides a useful failure when JSON is absent.
      }
      if (!response.ok) {
        return { ok: false, error: responseError(payload, response.status) };
      }
      if (!Array.isArray(payload?.choices) || !payload.choices.length) {
        return {
          ok: false,
          error: "The endpoint responded, but not with an OpenAI-compatible chat response."
        };
      }
      return {
        ok: true,
        connection: validated.connection,
        latencyMs: Math.max(1, Date.now() - startedAt)
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { ok: false, error: "The connection timed out. Check that the model server is running." };
      }
      return {
        ok: false,
        error:
          error?.name === "TypeError"
            ? "Still couldn’t reach this model. Check the endpoint and make sure the model server is running."
            : cleanText(error?.message, 220) || "Still could not reach this model."
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function complete(input, options = {}) {
    const validated = validateConnection(input, options.apiKey);
    if (!validated.ok) return validated;
    const prompt = cleanText(options.prompt, 12000);
    if (!prompt) return { ok: false, error: "There is no request to send to this model." };
    const fetchImpl = options.fetchImpl || global.StillPreviewAIConnectionFetch || global.fetch;
    if (typeof fetchImpl !== "function") return { ok: false, error: "This browser cannot contact this model." };
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const request = requestFor(validated.connection, validated.apiKey, prompt, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort
    });
    try {
      const response = await fetchImpl(request.url, {
        ...request.options,
        ...(controller ? { signal: controller.signal } : {})
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch (_error) {
        // The HTTP status below is still useful when JSON is absent.
      }
      if (!response.ok) return { ok: false, error: responseError(payload, response.status) };
      const content = cleanText(payload?.choices?.[0]?.message?.content, 16000);
      if (!content) {
        return { ok: false, error: "The model responded without a usable completion." };
      }
      return { ok: true, content, connection: validated.connection };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { ok: false, error: "The model took too long to respond." };
      }
      return {
        ok: false,
        error:
          error?.name === "TypeError"
            ? "Still couldn’t reach this model. Check the endpoint and model server."
            : cleanText(error?.message, 220) || "Still could not contact this model."
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  global.StillAIConnections = Object.freeze({
    PROVIDERS,
    providerFor,
    normalizeConnection,
    resolveActiveConnectionId,
    validateConnection,
    requestFor,
    complete,
    testConnection,
    isLoopbackHostname
  });
})(globalThis);
