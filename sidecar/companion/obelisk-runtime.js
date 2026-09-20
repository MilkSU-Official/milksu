import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createPiFamilyProvider, createPiProvider, PI_CANONICAL_TRANSCRIPT_MARKER } from "../../third_party/obelisk/packages/core/src/providers/pi.ts";
import { createDeepseekProvider } from "../../third_party/obelisk/packages/core/src/providers/deepseek.ts";
import { createProviderRegistry } from "../../third_party/obelisk/packages/core/src/providers/registry.ts";
import { createProviderIndexPlan, indexProviderPlan } from "../../third_party/obelisk/packages/core/src/provider-indexing.ts";
import { ensureFtsReady } from "../../third_party/obelisk/packages/core/src/index-finalize.ts";
import { configureConnection, nodeSqliteTransactionAdapter } from "../../third_party/obelisk/packages/core/src/tx.ts";
import { runRetryableWriteTransaction } from "../../third_party/obelisk/packages/core/src/write-coordinator.ts";
import { acquireWriterLease, writerLockPathFor } from "../../third_party/obelisk/packages/core/src/writer-lease.ts";
import { createMilksuConversationProvider } from "./milksu-provider.js";

const COMPANION_FAMILY = Object.freeze({
  source: "milksu-companion",
  displayName: "MilkSU Companion",
  vendor: "MilkSU",
  color: "#64748b",
  indexVersionMarker: PI_CANONICAL_TRANSCRIPT_MARKER,
  allowTitlePrelude: true,
});

function loadObeliskSchema() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "obelisk-schema.sql"),
    join(here, "../../third_party/obelisk/packages/core/src/schema.sql"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error("Obelisk schema.sql is missing");
}

function safeFtsQuery(query) {
  const tokens = String(query ?? "").match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens
    .map(token => `"${token.replaceAll("\"", "\"\"")}"`)
    .join(" AND ");
}

export function companionIndexRoots(env = process.env) {
  return {
    piSessions: String(env.MILKSU_PI_SESSIONS_DIR ?? "").trim(),
    dshSessions: String(env.MILKSU_DSH_SESSIONS_DIR ?? "").trim(),
    companionSessions: String(env.MILKSU_COMPANION_SESSIONS_DIR ?? "").trim(),
    conversations: String(env.MILKSU_CONVERSATIONS_DIR ?? "").trim(),
  };
}

export function createMilkSUProviderRegistry(roots = companionIndexRoots()) {
  const providers = [];
  if (roots.piSessions) {
    providers.push(createPiProvider({ rootDir: roots.piSessions }));
  }
  if (roots.companionSessions) {
    providers.push(createPiFamilyProvider({
      rootResolution: { root: roots.companionSessions, requiresExplicitRoot: false },
      config: COMPANION_FAMILY,
    }));
  }
  if (roots.dshSessions) {
    providers.push(createDeepseekProvider({ rootDir: roots.dshSessions }));
  }
  if (roots.conversations) {
    providers.push(createMilksuConversationProvider({ rootDir: roots.conversations }));
  }
  return createProviderRegistry(providers);
}

export function openCompanionIndexDb(path) {
  if (!path) throw new Error("companion index path is required");
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  configureConnection(database, { busyTimeoutMs: 250 });
  database.exec(loadObeliskSchema());
  return database;
}

function openWriterLeaseDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path);
}

export function refreshCompanionIndex({
  path = process.env.MILKSU_COMPANION_INDEX_PATH,
  roots = companionIndexRoots(),
  waitMs = 1000,
} = {}) {
  if (!path) return { written: false, error: "companion index path is required" };
  const lease = acquireWriterLease({
    lockPath: writerLockPathFor(path),
    openDb: openWriterLeaseDb,
    waitMs,
  });
  if (!lease) return { written: false, error: "writer_busy" };
  const database = openCompanionIndexDb(path);
  try {
    const registry = createMilkSUProviderRegistry(roots);
    const txDb = nodeSqliteTransactionAdapter(database);
    const plan = createProviderIndexPlan(database, registry, { force: false });
    const result = indexProviderPlan({
      db: database,
      plan,
      runTransaction: (label, work) => runRetryableWriteTransaction(txDb, work, { label }),
      onError: () => "skip",
    });
    runRetryableWriteTransaction(txDb, () => {
      ensureFtsReady(database);
    }, { label: "companion-fts" });
    return {
      written: true,
      committed: result.committed.length,
      skipped: result.failedItems.length,
    };
  } finally {
    database.close();
    lease.release();
  }
}

export function searchCompanionIndex(query, {
  path = process.env.MILKSU_COMPANION_INDEX_PATH,
  limit = 8,
  sessionId = "",
} = {}) {
  const text = safeFtsQuery(query);
  if (!path || !text) return [];
  if (!existsSync(path)) return [];
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout=250");
    const bounded = Math.min(50, Math.max(1, Number(limit) || 8));
    const rows = sessionId
      ? database.prepare(`
          SELECT m.session_id AS sessionId,
                 COALESCE(s.title, m.session_id) AS title,
                 substr(COALESCE(m.text, ''), 1, 280) AS snippet
          FROM messages_fts mf
          JOIN messages m ON m.uuid = mf.uuid
          LEFT JOIN sessions s ON s.id = m.session_id
          WHERE messages_fts MATCH ? AND m.session_id = ? AND COALESCE(m.is_meta, 0) = 0
          ORDER BY rank
          LIMIT ?
        `).all(text, sessionId, bounded)
      : database.prepare(`
          SELECT m.session_id AS sessionId,
                 COALESCE(s.title, m.session_id) AS title,
                 substr(COALESCE(m.text, ''), 1, 280) AS snippet
          FROM messages_fts mf
          JOIN messages m ON m.uuid = mf.uuid
          LEFT JOIN sessions s ON s.id = m.session_id
          WHERE messages_fts MATCH ? AND COALESCE(m.is_meta, 0) = 0
          ORDER BY rank
          LIMIT ?
        `).all(text, bounded);
    const seen = new Set();
    const hits = [];
    for (const row of rows) {
      const key = `${row.sessionId}:${row.snippet}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        sessionId: String(row.sessionId ?? ""),
        title: String(row.title ?? ""),
        snippet: String(row.snippet ?? ""),
      });
    }
    return hits;
  } finally {
    database.close();
  }
}

export function recallCompanionIndex(sessionId, {
  path = process.env.MILKSU_COMPANION_INDEX_PATH,
  limit = 40,
} = {}) {
  const id = String(sessionId ?? "").trim();
  if (!path || !id || !existsSync(path)) return [];
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout=250");
    return database.prepare(`
      SELECT role, text, timestamp
      FROM messages
      WHERE session_id = ? AND COALESCE(is_meta, 0) = 0
      ORDER BY timestamp ASC, rowid ASC
      LIMIT ?
    `).all(id, Math.min(200, Math.max(1, Number(limit) || 40)));
  } finally {
    database.close();
  }
}

export async function queryCompanionMemory(params = {}, options = {}) {
  const enabled = options.memorySearchEnabled !== false;
  const action = String(params.action ?? "").trim();
  if (!enabled) {
    return { written: false, results: [], messages: [] };
  }
  try {
    refreshCompanionIndex({
      path: options.path,
      roots: options.roots,
    });
    if (action === "recall") {
      const messages = recallCompanionIndex(params.sessionId, {
        path: options.path,
        limit: params.limit,
      });
      return {
        written: false,
        sessionId: String(params.sessionId ?? "").trim(),
        messages,
      };
    }
    const results = searchCompanionIndex(params.query, {
      path: options.path,
      limit: params.limit,
      sessionId: params.scope === "session" ? params.sessionId : "",
    });
    return { written: false, results };
  } catch (error) {
    return {
      written: false,
      results: [],
      messages: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function scheduleCompanionIndexRefresh(options = {}) {
  queueMicrotask(() => {
    try {
      refreshCompanionIndex(options);
    } catch {
      // Index refresh must never fail a companion turn.
    }
  });
}
