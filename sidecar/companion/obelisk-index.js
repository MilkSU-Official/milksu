import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function openCompanionIndex(path) {
  if (!path) throw new Error("companion index path is required");
  await mkdir(dirname(path), { recursive: true });
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    throw new Error(`node:sqlite is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode=WAL;
    CREATE VIRTUAL TABLE IF NOT EXISTS episodes USING fts5(
      session_id UNINDEXED,
      title,
      snippet,
      kernel UNINDEXED,
      tokenize='unicode61'
    );
  `);
  return {
    indexEpisode(episode) {
      const sessionId = String(episode?.sessionId ?? "").trim();
      const snippet = String(episode?.snippet ?? "").trim();
      if (!sessionId || !snippet) return { written: false };
      database.prepare(
        "INSERT INTO episodes(session_id, title, snippet, kernel) VALUES (?, ?, ?, ?)",
      ).run(
        sessionId,
        String(episode?.title ?? "").trim(),
        snippet,
        String(episode?.kernel ?? "").trim(),
      );
      return { written: true };
    },
    search(query, limit = 8) {
      const text = String(query ?? "").trim();
      if (!text) return [];
      return database.prepare(
        "SELECT session_id AS sessionId, title, snippet FROM episodes WHERE episodes MATCH ? LIMIT ?",
      ).all(text, Number(limit) || 8);
    },
    close() {
      database.close();
    },
  };
}

export function scheduleIndex(index, episode) {
  queueMicrotask(() => {
    try {
      index?.indexEpisode(episode);
    } catch {
      // Index writes must never fail a companion turn.
    }
  });
}
