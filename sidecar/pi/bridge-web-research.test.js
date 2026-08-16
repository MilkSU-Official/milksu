import assert from "node:assert/strict";
import test from "node:test";

import piWebResearchExtension from "./bridge-web-research.js";

function registeredExtension() {
  const tools = new Map();
  piWebResearchExtension({
    registerTool(tool) { tools.set(tool.name, tool); },
  });
  return tools;
}

test("registers the reviewed Pi web_search and web_fetch extension", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("lite.duckduckgo.com")) {
      return new Response([
        "[Grok 4.5 | xAI Docs](https://docs.x.ai/developers/models/grok-4.5)",
        "Official model documentation and capabilities.",
      ].join("\n\n"));
    }
    return new Response("# Grok 4.5\n\nModalities: Text, Image");
  };

  try {
    const tools = registeredExtension();
    assert.deepEqual([...tools.keys()], ["web_search", "web_fetch"]);

    const searched = await tools.get("web_search").execute(
      "search-1",
      { query: "Is Grok 4.5 multimodal?", max_results: 5 },
      AbortSignal.timeout(5_000),
    );
    assert.equal(searched.details.results[0].title, "Grok 4.5 | xAI Docs");
    assert.equal(
      searched.details.results[0].url,
      "https://docs.x.ai/developers/models/grok-4.5",
    );

    const fetched = await tools.get("web_fetch").execute(
      "fetch-1",
      { url: searched.details.results[0].url },
      AbortSignal.timeout(5_000),
    );
    assert.match(fetched.content[0].text, /Modalities: Text, Image/);
    assert.match(requests[0], /^https:\/\/r\.jina\.ai\/https:\/\/lite\.duckduckgo\.com\/lite\/\?q=/u);
    assert.equal(
      requests[1],
      "https://r.jina.ai/https://docs.x.ai/developers/models/grok-4.5",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns the upstream retry signal when live search is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const result = await registeredExtension().get("web_search").execute(
      "search-1",
      { query: "latest Grok documentation" },
      AbortSignal.timeout(5_000),
    );
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.retry, true);
    assert.match(payload.error, /Search failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
