import assert from "node:assert/strict";
import test from "node:test";
import { companionProviderEnvironment } from "./companion-model-env.js";

test("account companion source uses the TokenFlux relay key", () => {
  const env = companionProviderEnvironment(
    { source: "account" },
    { MILKSU_RELAY_KEY: "account-relay", MILKSU_RELAY_URL: "https://tokenflux.dev/v1" },
  );
  assert.equal(env.TOKENFLUX_API_KEY, "account-relay");
  assert.equal(env.TOKENFLUX_BASE_URL, "https://tokenflux.dev/v1");
});

test("personal companion source keeps the personal TokenFlux key", () => {
  const env = companionProviderEnvironment(
    { source: "personal" },
    { TOKENFLUX_API_KEY: "personal-key", MILKSU_RELAY_KEY: "account-relay" },
  );
  assert.equal(env.TOKENFLUX_API_KEY, "personal-key");
});
