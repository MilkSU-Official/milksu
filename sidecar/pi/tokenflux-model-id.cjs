"use strict";

// TokenFlux key shapes (docs.tokenflux.dev/docs/tokenflux/composite-key):
// 1. single-group keys: /v1/models returns bare model ids for that group
// 2. composite keys: /v1/models returns prefix/model for each mapped group
//
// MilkSU treats the catalog id as authoritative. Request rewriting only tries
// the bare form when the selected id already has a prefix separator, so a
// stale composite selection can still work on a single-group key.

function normalizeModelID(value) {
  return String(value ?? "").trim();
}

function tokenfluxCompositePrefixRequired(error) {
  const details = [
    error?.errorMessage,
    error?.message,
    error?.code,
    error?.type,
    error?.error?.message,
    error?.error?.code,
    error?.error?.type,
  ].filter(value => value !== undefined && value !== null);
  if (details.length === 0 && error !== undefined && error !== null) {
    details.push(error);
  }
  const message = details.map(String).join(" ");
  return /COMPOSITE_KEY_MODEL_PREFIX_REQUIRED|composite api key model must use prefix\/model_id/iu
    .test(message);
}

function tokenfluxModelNotFound(error) {
  const details = [
    error?.errorMessage,
    error?.message,
    error?.type,
    error?.code,
    error?.error?.message,
    error?.error?.type,
  ].filter(value => value !== undefined && value !== null);
  if (details.length === 0 && error !== undefined && error !== null) {
    details.push(error);
  }
  const message = details.map(String).join(" ").toLowerCase();
  return (
    /\bmodel_not_found\b/u.test(message)
    || /model[\s\S]{0,384}(not found|not supported|unsupported|unavailable)/u.test(message)
    || /does not support the requested model/u.test(message)
    || /not supported by any configured account/u.test(message)
    || /COMPOSITE_KEY_PREFIX_NOT_FOUND|composite_key_prefix_not_found/u.test(message)
  );
}

function tokenfluxBareModelID(modelID) {
  const id = normalizeModelID(modelID);
  const slash = id.indexOf("/");
  if (slash <= 0 || slash >= id.length - 1) return id;
  const prefix = id.slice(0, slash);
  // Composite prefixes are 1-32 chars of [A-Za-z0-9_-] (TokenFlux docs).
  if (prefix.length > 32 || !/^[A-Za-z0-9_-]+$/u.test(prefix)) return id;
  return id.slice(slash + 1);
}

// TokenFlux thinking-tier groups expose the same model as -tiered / -high / -low.
// Longer suffixes first so -xhigh is not stripped as -high.
const TOKENFLUX_THINKING_SUFFIXES = ["-tiered", "-xhigh", "-medium", "-high", "-low", "-max"];

function tokenfluxModelStem(modelID) {
  const bare = tokenfluxBareModelID(modelID);
  const lower = bare.toLowerCase();
  for (const suffix of TOKENFLUX_THINKING_SUFFIXES) {
    if (lower.endsWith(suffix)) return bare.slice(0, -suffix.length);
  }
  return bare;
}

function tokenfluxAliasRank(modelID) {
  const lower = tokenfluxBareModelID(modelID).toLowerCase();
  if (lower.endsWith("-tiered")) return 2;
  return 1;
}

function tokenfluxRequestModelIDs(modelID, catalogModelIDs = []) {
  const id = normalizeModelID(modelID);
  if (!id) return [];
  const result = [];
  const push = value => {
    const next = normalizeModelID(value);
    if (next && !result.includes(next)) result.push(next);
  };

  const catalog = new Set(
    (Array.isArray(catalogModelIDs) ? catalogModelIDs : [])
      .map(value => normalizeModelID(value))
      .filter(Boolean),
  );

  // Prefer catalog-known forms of the same selection. Do not invent vendor
  // prefixes or thinking suffixes — only reuse ids TokenFlux already returned
  // (bare vs prefix, or -tiered / -high). A saved suffix-less id must not
  // lead the request if the catalog only lists the thinking-tier form.
  if (catalog.size > 0) {
    const bare = tokenfluxBareModelID(id);
    const stem = tokenfluxModelStem(id);
    if (catalog.has(id)) push(id);
    if (bare !== id && catalog.has(bare)) push(bare);
    const extras = [];
    for (const candidate of catalog) {
      if (candidate === id) continue;
      const candidateBare = tokenfluxBareModelID(candidate);
      if (candidateBare === bare || candidateBare === id || tokenfluxModelStem(candidate) === stem) {
        extras.push(candidate);
      }
    }
    extras.sort((left, right) => tokenfluxAliasRank(right) - tokenfluxAliasRank(left));
    for (const candidate of extras) {
      push(candidate);
      const candidateBare = tokenfluxBareModelID(candidate);
      if (candidateBare !== candidate) push(candidateBare);
    }
    if (result.length === 0) {
      push(id);
      if (bare !== id) push(bare);
    }
    return result;
  }

  // Without a catalog, only try stripping an existing composite prefix so a
  // single-group key can accept a previously saved prefix/model selection.
  push(id);
  const bare = tokenfluxBareModelID(id);
  if (bare !== id) push(bare);
  return result;
}

function tokenfluxRequestModels(model, catalogModelIDs = []) {
  const ids = tokenfluxRequestModelIDs(model?.id, catalogModelIDs);
  if (ids.length === 0) return model ? [model] : [];
  return ids.map(id => (
    id === model.id
      ? model
      : { ...model, id, name: model?.name && model.id === id ? model.name : id }
  ));
}

function tokenfluxRequestRetryable(error) {
  return tokenfluxCompositePrefixRequired(error) || tokenfluxModelNotFound(error);
}

module.exports = {
  tokenfluxBareModelID,
  tokenfluxCompositePrefixRequired,
  tokenfluxModelNotFound,
  tokenfluxModelStem,
  tokenfluxRequestModelIDs,
  tokenfluxRequestModels,
  tokenfluxRequestRetryable,
};
