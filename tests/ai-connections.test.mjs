import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../ai-connections.js", import.meta.url), "utf8");

function loadConnections() {
  const context = {
    globalThis: {},
    URL,
    AbortController,
    Date,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(source, context);
  return context.globalThis.StillAIConnections;
}

test("provides privacy-aware presets for remote and local models", () => {
  const adapter = loadConnections();
  assert.equal(adapter.PROVIDERS.openai.requiresApiKey, true);
  assert.equal(adapter.PROVIDERS.ollama.local, true);
  assert.equal(adapter.PROVIDERS.lmstudio.endpoint, "http://localhost:1234/v1/chat/completions");
});

test("requires a key for OpenAI but not for a local Ollama model", () => {
  const adapter = loadConnections();
  const openai = adapter.validateConnection({
    provider: "openai",
    label: "OpenAI",
    model: "example-model",
    endpoint: "https://api.openai.com/v1/chat/completions"
  });
  assert.equal(openai.ok, false);
  assert.equal(openai.field, "apiKey");

  const ollama = adapter.validateConnection({
    provider: "ollama",
    label: "Local",
    model: "llama3.2",
    endpoint: "http://localhost:11434/v1/chat/completions"
  });
  assert.equal(ollama.ok, true);
  assert.equal(ollama.connection.local, true);
});

test("blocks unencrypted remote endpoints", () => {
  const adapter = loadConnections();
  const result = adapter.validateConnection({
    provider: "compatible",
    label: "Remote",
    model: "model",
    endpoint: "http://models.example.com/v1/chat/completions"
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, "endpoint");
  assert.match(result.error, /HTTPS/);
});

test("puts the API key only in the authorization header", () => {
  const adapter = loadConnections();
  const request = adapter.requestFor(
    {
      model: "example-model",
      endpoint: "https://api.example.com/v1/chat/completions"
    },
    "secret-key"
  );
  assert.equal(request.options.headers.Authorization, "Bearer secret-key");
  assert.doesNotMatch(request.options.body, /secret-key/);
  assert.deepEqual(JSON.parse(request.options.body).messages, [
    { role: "user", content: "Reply with the single word: ready" }
  ]);
});

test("tests an OpenAI-compatible response without exposing response content", async () => {
  const adapter = loadConnections();
  let captured;
  const result = await adapter.testConnection(
    {
      provider: "compatible",
      label: "Private endpoint",
      model: "model-a",
      endpoint: "https://models.example.com/v1/chat/completions"
    },
    {
      apiKey: "private-token",
      async fetchImpl(url, options) {
        captured = { url, options };
        return {
          ok: true,
          status: 200,
          async json() {
            return { choices: [{ message: { content: "ready" } }] };
          }
        };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.connection.model, "model-a");
  assert.equal("content" in result, false);
  assert.equal(captured.url, "https://models.example.com/v1/chat/completions");
  assert.equal(captured.options.headers.Authorization, "Bearer private-token");
});

test("returns a concise provider error for failed connection tests", async () => {
  const adapter = loadConnections();
  const result = await adapter.testConnection(
    {
      provider: "openai",
      label: "OpenAI",
      model: "missing-model",
      endpoint: "https://api.openai.com/v1/chat/completions"
    },
    {
      apiKey: "key",
      async fetchImpl() {
        return {
          ok: false,
          status: 404,
          async json() {
            return { error: { message: "Model not found" } };
          }
        };
      }
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Model not found");
});
