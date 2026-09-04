// Hash-bound edit anchors for Pi `edit`.
//
// `@oh-my-pi/hashline` is MIT and published on its own, but it depends on
// `@oh-my-pi/pi-natives` / `@oh-my-pi/pi-utils`, and its default Node filesystem
// uses Bun. Tags are SnapshotStore 4-hex tokens, not standalone content hashes.
// This module is the smallest MilkSU-owned layer: bind a patch to a file hash,
// refuse stale writes, and fall back to Pi replace after consecutive failures.
// It does not replace Pi's edit/write tools.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { Type } from "typebox";

export const anchorFallbackFailureLimit = 2;

export const staleAnchorError = "锚点哈希已过期，文件在读取后被改过，已拒绝写入。 "
  + "Anchor hash is stale; the file changed after it was read. Write refused.";
export const invalidAnchorError = "锚点补丁无效。 Anchor patch is invalid.";

const hashlineHeader = /^\[([^#\]]+)#([0-9a-fA-F]{8,64})\]\s*$/;
const hashlinePutRange = /^PUT\s+(\d+)\.=(\d+)\s*:\s*$/;
const hashlinePutBefore = /^PUT\s+<(\d+|\$)\s*:\s*$/;
const hashlinePutAfter = /^PUT\s+>(\d+|\$)\s*:\s*$/;

const lineAnchorSchema = Type.Object({
  startLine: Type.Integer({
    minimum: 1,
    description: "1-based inclusive start line in the hashed file.",
  }),
  endLine: Type.Integer({
    minimum: 1,
    description: "1-based inclusive end line in the hashed file.",
  }),
  lineHash: Type.Optional(Type.String({
    description: "Optional SHA-256 hex prefix of the anchored line range.",
  })),
});

const anchoredReplacementSchema = Type.Object({
  oldText: Type.Optional(Type.String({
    description: "Exact text for one targeted replacement. Required when no line "
      + "anchor is provided, and used as the Pi replace fallback.",
  })),
  newText: Type.Optional(Type.String({
    description: "Replacement text for this targeted edit.",
  })),
  contentHash: Type.Optional(Type.String({
    description: "SHA-256 hex of the file text when this edit was planned. "
      + "Stale hashes refuse the write.",
  })),
  anchor: Type.Optional(lineAnchorSchema),
});

const anchoredEditParameters = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  contentHash: Type.Optional(Type.String({
    description: "SHA-256 hex of the current file text. Bind an anchor patch to this "
      + "hash; stale hashes refuse the write.",
  })),
  patch: Type.Optional(Type.String({
    description: "Optional compact hash-bound patch: [path#hash] then PUT start.=end: "
      + "and +body lines.",
  })),
  edits: Type.Optional(Type.Array(anchoredReplacementSchema, {
    description: "One or more targeted replacements matched against the original file, "
      + "not incrementally.",
  })),
});

const anchorPromptGuidelines = [
  "When you already have the file content hash, send contentHash with edits[].anchor "
    + "{ startLine, endLine } (1-based, inclusive). The tool extracts exact oldText "
    + "from those lines. contentHash is SHA-256 of the file UTF-8 bytes, or of the "
    + "same text after CRLF/BOM normalize. A truncated read preview hash is not the "
    + "file hash. Stale hashes refuse the write.",
  "You may send a compact patch: [path#hash] then PUT start.=end: and +body lines.",
  "If an anchor patch may fail, include oldText and newText in the same call so the "
    + "tool can fall back to Pi exact replace after consecutive failures.",
];

export class AnchorEditError extends Error {
  constructor(message, { code = "bad-format", fallbackable = true } = {}) {
    super(message);
    this.name = "AnchorEditError";
    this.code = code;
    this.fallbackable = fallbackable;
  }
}

export function normalizeFileText(text) {
  let value = String(text ?? "");
  if (value.charCodeAt(0) === 0xfeff) value = value.slice(1);
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function digestHex(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function hashFileText(text) {
  return digestHex(normalizeFileText(text));
}

export function fileContentHashes(text) {
  const raw = String(text ?? "");
  const hashes = [digestHex(raw)];
  const normalized = hashFileText(raw);
  if (!hashes.includes(normalized)) hashes.push(normalized);
  if (raw.charCodeAt(0) === 0xfeff) {
    const withoutBom = raw.slice(1);
    const bomHash = digestHex(withoutBom);
    if (!hashes.includes(bomHash)) hashes.push(bomHash);
  }
  return hashes;
}

export function normalizeContentHash(value) {
  const text = String(value ?? "").trim().toLowerCase().replace(/^sha256:/, "");
  return /^[0-9a-f]{8,64}$/.test(text) ? text : "";
}

export function hashesMatch(expected, actual) {
  const want = normalizeContentHash(expected);
  const have = normalizeContentHash(actual);
  if (!want || !have) return false;
  const length = Math.min(want.length, have.length);
  return want.slice(0, length) === have.slice(0, length);
}

export function hashMatchesFile(expected, fileText) {
  return fileContentHashes(fileText).some(actual => hashesMatch(expected, actual));
}

export function shouldFallbackToReplace(failures) {
  const count = Array.isArray(failures) ? failures.length : Number(failures);
  return Number.isFinite(count) && count >= anchorFallbackFailureLimit;
}

function replaceFallbackEdits(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.edits)) return [];
  return input.edits
    .filter(edit => edit && typeof edit.oldText === "string" && typeof edit.newText === "string")
    .map(edit => ({ oldText: edit.oldText, newText: edit.newText }));
}

function hasStructuredAnchor(edit) {
  if (!edit || typeof edit !== "object") return false;
  return Boolean(
    (typeof edit.contentHash === "string" && edit.contentHash.trim())
    || (edit.anchor && typeof edit.anchor === "object"),
  );
}

function parseLineNumber(value, lineCount, allowEnd) {
  if (value === "$") return allowEnd ? lineCount : lineCount || 1;
  const line = Number(value);
  if (!Number.isInteger(line) || line < 1) {
    throw new AnchorEditError(
      `${invalidAnchorError} Line ${value} is not a 1-based line number.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  return line;
}

function finishHashlineOp(section, op) {
  if (!op) return;
  const newText = op.body.join("\n");
  if (op.kind === "range") {
    section.edits.push({
      newText,
      anchor: { startLine: op.startLine, endLine: op.endLine },
    });
    return;
  }
  section.edits.push({
    newText,
    insert: op.kind,
    line: op.line,
  });
}

export function parseHashlinePatch(text) {
  const source = normalizeFileText(text);
  if (!source.trim()) {
    throw new AnchorEditError(
      `${invalidAnchorError} Compact patch is empty.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  const sections = [];
  let section;
  let op;
  for (const line of source.split("\n")) {
    const header = line.match(hashlineHeader);
    if (header) {
      finishHashlineOp(section, op);
      op = undefined;
      section = {
        path: header[1],
        contentHash: header[2].toLowerCase(),
        edits: [],
      };
      sections.push(section);
      continue;
    }
    if (!section) {
      if (!line.trim()) continue;
      throw new AnchorEditError(
        `${invalidAnchorError} Compact patch must start with [path#hash].`,
        { code: "bad-format", fallbackable: true },
      );
    }
    const range = line.match(hashlinePutRange);
    if (range) {
      finishHashlineOp(section, op);
      op = {
        kind: "range",
        startLine: Number(range[1]),
        endLine: Number(range[2]),
        body: [],
      };
      continue;
    }
    const before = line.match(hashlinePutBefore);
    if (before) {
      finishHashlineOp(section, op);
      op = { kind: "before", line: before[1], body: [] };
      continue;
    }
    const after = line.match(hashlinePutAfter);
    if (after) {
      finishHashlineOp(section, op);
      op = { kind: "after", line: after[1], body: [] };
      continue;
    }
    if (line.startsWith("+") && op) {
      op.body.push(line.slice(1));
      continue;
    }
    if (!line.trim()) continue;
    throw new AnchorEditError(
      `${invalidAnchorError} Unrecognized compact patch line.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  finishHashlineOp(section, op);
  if (sections.length !== 1) {
    throw new AnchorEditError(
      `${invalidAnchorError} Compact patch must name exactly one file.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  return sections[0];
}

function normalizeStructuredEdit(edit, fileHash) {
  if (!edit || typeof edit !== "object") return undefined;
  const contentHash = typeof edit.contentHash === "string" ? edit.contentHash.trim() : "";
  const next = {
    oldText: typeof edit.oldText === "string" ? edit.oldText : undefined,
    newText: typeof edit.newText === "string" ? edit.newText : undefined,
    contentHash: contentHash || fileHash,
  };
  if (edit.anchor && typeof edit.anchor === "object") {
    const startLine = Number(edit.anchor.startLine);
    const endLine = Number(edit.anchor.endLine);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
      throw new AnchorEditError(
        `${invalidAnchorError} anchor.startLine and anchor.endLine must be integers.`,
        { code: "bad-format", fallbackable: true },
      );
    }
    next.anchor = {
      startLine,
      endLine,
      lineHash: typeof edit.anchor.lineHash === "string" ? edit.anchor.lineHash : undefined,
    };
  }
  if (next.oldText === undefined && !next.anchor) return undefined;
  if (next.newText === undefined) {
    throw new AnchorEditError(
      `${invalidAnchorError} newText is required.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  return next;
}

export function parseAnchorEdits(input) {
  if (!input || typeof input !== "object") {
    return { kind: "none" };
  }
  const replaceFallback = replaceFallbackEdits(input);
  const patch = typeof input.patch === "string" ? input.patch : "";
  const contentHash = typeof input.contentHash === "string" ? input.contentHash.trim() : "";
  const rawEdits = Array.isArray(input.edits) ? input.edits : [];
  const hasStructured = Boolean(contentHash) || rawEdits.some(hasStructuredAnchor);
  if (!patch && !hasStructured) {
    return { kind: "none", replaceFallback };
  }

  try {
    let path = typeof input.path === "string" ? input.path : "";
    let hash = contentHash;
    let edits = [];

    if (patch) {
      const parsed = parseHashlinePatch(patch);
      if (path && parsed.path && path !== parsed.path) {
        throw new AnchorEditError(
          `${invalidAnchorError} Compact patch path ${parsed.path} does not match ${path}.`,
          { code: "bad-format", fallbackable: true },
        );
      }
      if (hash && parsed.contentHash && !hashesMatch(hash, parsed.contentHash)) {
        throw new AnchorEditError(
          `${invalidAnchorError} Compact patch hash does not match contentHash.`,
          { code: "bad-format", fallbackable: true },
        );
      }
      path = path || parsed.path;
      hash = hash || parsed.contentHash;
      edits = parsed.edits;
    }

    if (rawEdits.length) {
      const structured = rawEdits
        .map(edit => normalizeStructuredEdit(edit, hash))
        .filter(Boolean);
      const hasLineOps = structured.some(edit => edit.anchor || edit.insert);
      if (structured.length && (hasLineOps || !patch)) {
        edits = structured;
      }
    }

    if (!hash) {
      return {
        kind: "invalid",
        error: `${invalidAnchorError} contentHash is required.`,
        replaceFallback,
      };
    }
    if (!normalizeContentHash(hash)) {
      return {
        kind: "invalid",
        error: `${invalidAnchorError} contentHash is not a valid SHA-256.`,
        replaceFallback,
      };
    }
    if (!edits.length) {
      return {
        kind: "invalid",
        error: `${invalidAnchorError} no edits.`,
        replaceFallback,
      };
    }
    return {
      kind: "anchor",
      path,
      contentHash: hash,
      edits,
      replaceFallback,
    };
  } catch (reason) {
    return {
      kind: "invalid",
      error: reason instanceof Error ? reason.message : String(reason),
      replaceFallback,
    };
  }
}

function fileLines(text) {
  return normalizeFileText(text).split("\n");
}

function extractLines(text, startLine, endLine) {
  const lines = fileLines(text);
  if (
    !Number.isInteger(startLine)
    || !Number.isInteger(endLine)
    || startLine < 1
    || endLine < startLine
    || endLine > lines.length
  ) {
    throw new AnchorEditError(
      `${invalidAnchorError} Line range ${startLine}.=${endLine} is outside the file.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  return lines.slice(startLine - 1, endLine).join("\n");
}

function resolveInsertLine(edit, lineCount) {
  return parseLineNumber(edit.line, lineCount, true);
}

function plannedReplacement(text, edit, acceptedHashes) {
  if (edit.contentHash && !normalizeContentHash(edit.contentHash)) {
    throw new AnchorEditError(
      `${invalidAnchorError} contentHash is not a valid SHA-256.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  if (
    edit.contentHash
    && !acceptedHashes.some(actual => hashesMatch(edit.contentHash, actual))
  ) {
    throw new AnchorEditError(staleAnchorError, { code: "stale-hash", fallbackable: false });
  }
  if (typeof edit.newText !== "string") {
    throw new AnchorEditError(
      `${invalidAnchorError} newText is required.`,
      { code: "bad-format", fallbackable: true },
    );
  }

  const lines = fileLines(text);
  if (edit.insert === "before" || edit.insert === "after") {
    const line = resolveInsertLine(edit, lines.length);
    const oldText = extractLines(text, line, line);
    const newText = edit.insert === "before"
      ? `${edit.newText}\n${oldText}`
      : `${oldText}\n${edit.newText}`;
    return { oldText, newText };
  }

  if (edit.anchor) {
    const oldText = extractLines(text, edit.anchor.startLine, edit.anchor.endLine);
    if (edit.anchor.lineHash) {
      if (!normalizeContentHash(edit.anchor.lineHash)) {
        throw new AnchorEditError(
          `${invalidAnchorError} lineHash is not a valid SHA-256.`,
          { code: "bad-format", fallbackable: true },
        );
      }
      if (!hashesMatch(edit.anchor.lineHash, hashFileText(oldText))) {
        throw new AnchorEditError(
          `${invalidAnchorError} lineHash does not match the anchored range.`,
          { code: "line-hash", fallbackable: true },
        );
      }
    }
    return { oldText, newText: edit.newText };
  }

  if (typeof edit.oldText !== "string") {
    throw new AnchorEditError(
      `${invalidAnchorError} each edit needs an anchor or oldText.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  return { oldText: edit.oldText, newText: edit.newText };
}

export function applyAnchorEdits(fileText, edits) {
  const parsed = Array.isArray(edits)
    ? {
        contentHash: edits.find(edit => edit && typeof edit.contentHash === "string")?.contentHash,
        edits,
      }
    : edits && typeof edits === "object"
      ? edits
      : {};
  const raw = String(fileText ?? "");
  const text = normalizeFileText(raw);
  const acceptedHashes = fileContentHashes(raw);
  const expectedHash = parsed.contentHash;

  if (!expectedHash) {
    throw new AnchorEditError(
      `${invalidAnchorError} contentHash is required.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  if (!normalizeContentHash(expectedHash)) {
    throw new AnchorEditError(
      `${invalidAnchorError} contentHash is not a valid SHA-256.`,
      { code: "bad-format", fallbackable: true },
    );
  }
  if (!hashMatchesFile(expectedHash, raw)) {
    throw new AnchorEditError(staleAnchorError, { code: "stale-hash", fallbackable: false });
  }

  const planned = Array.isArray(parsed.edits) ? parsed.edits : [];
  if (!planned.length) {
    throw new AnchorEditError(
      `${invalidAnchorError} no edits.`,
      { code: "bad-format", fallbackable: true },
    );
  }

  const replacements = [];
  for (const edit of planned) {
    const replacement = plannedReplacement(text, edit, acceptedHashes);
    const first = text.indexOf(replacement.oldText);
    if (first < 0) {
      throw new AnchorEditError(
        `${invalidAnchorError} oldText must match exactly including all whitespace and newlines.`,
        { code: "mismatch", fallbackable: true },
      );
    }
    if (text.indexOf(replacement.oldText, first + 1) >= 0) {
      throw new AnchorEditError(
        `${invalidAnchorError} oldText must be unique in the original file.`,
        { code: "overlap", fallbackable: true },
      );
    }
    replacements.push({
      oldText: replacement.oldText,
      newText: replacement.newText,
      index: first,
      length: replacement.oldText.length,
    });
  }

  const ordered = [...replacements].sort((left, right) => left.index - right.index);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].index < ordered[index - 1].index + ordered[index - 1].length) {
      throw new AnchorEditError(
        `${invalidAnchorError} edits must not overlap.`,
        { code: "overlap", fallbackable: true },
      );
    }
  }

  let next = text;
  for (const replacement of [...replacements].sort((left, right) => right.index - left.index)) {
    next = next.slice(0, replacement.index)
      + replacement.newText
      + next.slice(replacement.index + replacement.length);
  }
  return {
    text: next,
    replacements: replacements.map(replacement => ({
      oldText: replacement.oldText,
      newText: replacement.newText,
    })),
  };
}

function resolveEditPath(root, filePath) {
  const path = String(filePath ?? "").trim();
  if (!path) {
    throw new AnchorEditError(
      `${invalidAnchorError} path is required.`,
      { code: "bad-format", fallbackable: false },
    );
  }
  return isAbsolute(path) ? path : resolve(root || process.cwd(), path);
}

function asAnchorError(reason) {
  if (reason instanceof AnchorEditError) return reason;
  return new AnchorEditError(
    reason instanceof Error ? reason.message : String(reason),
    { code: "bad-format", fallbackable: true },
  );
}

export function wrapEditToolDefinition(definition, { root, readFileText } = {}) {
  const execute = definition.execute.bind(definition);
  const failures = [];
  const readText = readFileText ?? (absolutePath => readFile(absolutePath, "utf8"));

  return {
    ...definition,
    parameters: anchoredEditParameters,
    promptGuidelines: [
      ...(Array.isArray(definition.promptGuidelines) ? definition.promptGuidelines : []),
      ...anchorPromptGuidelines,
    ],
    execute: async (toolCallId, input, signal, onUpdate, ctx) => {
      const parsed = parseAnchorEdits(input);
      if (parsed.kind === "none") {
        return execute(toolCallId, input, signal, onUpdate, ctx);
      }

      const path = String(input?.path ?? parsed.path ?? "").trim();
      const fallbackEdits = parsed.replaceFallback ?? [];
      let fileText;
      try {
        fileText = await readText(resolveEditPath(root, path));
      } catch (reason) {
        if (fallbackEdits.length) {
          return execute(toolCallId, { path, edits: fallbackEdits }, signal, onUpdate, ctx);
        }
        throw reason;
      }

      try {
        if (parsed.kind === "invalid") {
          throw new AnchorEditError(parsed.error || invalidAnchorError, {
            code: "bad-format",
            fallbackable: true,
          });
        }
        const applied = applyAnchorEdits(fileText, parsed);
        failures.length = 0;
        return execute(
          toolCallId,
          { path, edits: applied.replacements },
          signal,
          onUpdate,
          ctx,
        );
      } catch (reason) {
        const error = asAnchorError(reason);
        if (error.code === "stale-hash" || !error.fallbackable) {
          throw error;
        }
        failures.push({ code: error.code, message: error.message });
        if (shouldFallbackToReplace(failures) && fallbackEdits.length) {
          failures.length = 0;
          return execute(toolCallId, { path, edits: fallbackEdits }, signal, onUpdate, ctx);
        }
        throw error;
      }
    },
  };
}
