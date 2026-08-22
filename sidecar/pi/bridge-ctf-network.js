import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import {
  DEFAULT_MAX_BYTES,
  defineTool,
  formatSize,
} from "@earendil-works/pi-coding-agent";

export const ctfEndpointRequestToolName = "ctf_request_endpoint";
export const ctfNetworkToolNames = ["ctf_http", "ctf_socket", "ctf_ssh"];
export const ctfHTTPModelMaxBytes = DEFAULT_MAX_BYTES;
export const ctfHTTPAssetPreviewBytes = 4 * 1024;

function manifestScopes(manifest) {
  return [
    manifest?.source?.scope,
    ...(Array.isArray(manifest?.networkScopes) ? manifest.networkScopes : []),
  ].filter(scope => scope && typeof scope === "object");
}

function scopeState(scope) {
  if (scope?.revokedAt) return "revoked";
  if (!scope?.expiresAt) return "invalid";
  const expiresAt = Date.parse(String(scope.expiresAt));
  if (!Number.isFinite(expiresAt)) return "invalid";
  return Date.now() >= expiresAt ? "expired" : "active";
}

function scopeTargets(scope) {
  return Array.isArray(scope?.targets) ? scope.targets : [];
}

export function ctfScopedNetworkToolNames(manifest) {
  const kinds = new Set(
    manifestScopes(manifest)
      .flatMap(scopeTargets)
      .map(target => String(target?.kind || "")),
  );
  return [
    kinds.has("origin") ? "ctf_http" : "",
    kinds.has("socket") ? "ctf_socket" : "",
    kinds.has("ssh") ? "ctf_ssh" : "",
  ].filter(Boolean);
}

function authorizedTargetValues(manifest, kind, toolName) {
  const values = new Set();
  let matchingInactiveState = "";
  for (const scope of manifestScopes(manifest)) {
    const matches = scopeTargets(scope).filter(target => String(target?.kind) === kind);
    if (matches.length === 0) continue;
    const state = scopeState(scope);
    if (state !== "active") {
      if (!matchingInactiveState) matchingInactiveState = state;
      continue;
    }
    for (const target of matches) {
      const value = String(target?.value || "").trim();
      if (value) values.add(value);
    }
  }
  if (values.size > 0) return values;
  if (matchingInactiveState === "revoked") {
    throw new Error(`${toolName} denied: the matching user-granted scope was revoked`);
  }
  if (matchingInactiveState === "expired") {
    throw new Error(`${toolName} denied: the matching user-granted scope expired`);
  }
  if (matchingInactiveState === "invalid") {
    throw new Error(`${toolName} denied: the matching user-granted scope is invalid`);
  }
  throw new Error(`${toolName} denied: the challenge has no matching user-granted scope`);
}

function authorizedOrigins(manifest) {
  const origins = new Set();
  for (const value of authorizedTargetValues(manifest, "origin", "ctf_http")) {
    try {
      const parsed = new URL(value);
      if (
        ["http:", "https:"].includes(parsed.protocol)
        && parsed.username === ""
        && parsed.password === ""
        && parsed.pathname === "/"
        && parsed.search === ""
        && parsed.hash === ""
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // An invalid manifest target is never admitted as implicit authority.
    }
  }
  if (origins.size === 0) {
    throw new Error("ctf_http denied: the matching scope contains no valid exact origin");
  }
  return origins;
}

function authorizedSockets(manifest) {
  return authorizedTargetValues(manifest, "socket", "ctf_socket");
}

function authorizedSSH(manifest) {
  return authorizedTargetValues(manifest, "ssh", "ctf_ssh");
}

export function scopeAllowsNetwork() {
  // CTF shells are permanently offline. Exact grants enable only the bounded
  // protocol tools in this module and never become ambient process authority.
  return false;
}

function printableRatio(data) {
  if (data.length === 0) return 1;
  let printable = 0;
  for (const byte of data) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      printable += 1;
    }
  }
  return printable / data.length;
}

function boundedBody(data, contentType = "") {
  const text = data.toString("utf8");
  const textualType = /(?:^text\/|json|xml|javascript|x-www-form-urlencoded)/i.test(contentType);
  const replacementCount = [...text].filter(character => character === "\uFFFD").length;
  const likelyText = textualType || (replacementCount === 0 && printableRatio(data) >= 0.75);
  return likelyText
    ? { bodyEncoding: "utf8", body: text }
    : { bodyEncoding: "base64", body: data.toString("base64") };
}

export function isCTFHTTPStaticAsset(contentType = "", url = "") {
  return /javascript|ecmascript|css|wasm|font\b|image\//i.test(String(contentType))
    || /\.(?:js|mjs|cjs|css|wasm|map|woff2?|ttf|png|jpe?g|gif|svg|ico)(?:\?|#|$)/i.test(String(url));
}

function clipUtf8(text, maxBytes) {
  const buffer = Buffer.from(String(text), "utf8");
  if (buffer.length <= maxBytes) {
    return { text: String(text), truncated: false, bytes: buffer.length };
  }
  let slice = buffer.subarray(0, maxBytes);
  while (slice.length > 0 && (slice[slice.length - 1] & 0xc0) === 0x80) {
    slice = slice.subarray(0, slice.length - 1);
  }
  return { text: slice.toString("utf8"), truncated: true, bytes: slice.length };
}

export function projectCTFHTTPBody(data, contentType = "", url = "") {
  const encoded = boundedBody(data, contentType);
  const cap = isCTFHTTPStaticAsset(contentType, url)
    ? ctfHTTPAssetPreviewBytes
    : ctfHTTPModelMaxBytes;
  if (encoded.bodyEncoding === "utf8") {
    const clipped = clipUtf8(encoded.body, cap);
    return {
      bodyEncoding: "utf8",
      body: clipped.text,
      truncatedForModel: clipped.truncated,
      previewBytes: clipped.bytes,
      totalBytes: Buffer.byteLength(encoded.body, "utf8"),
    };
  }
  const preview = encoded.body.length > cap ? encoded.body.slice(0, cap) : encoded.body;
  return {
    bodyEncoding: "base64",
    body: preview,
    truncatedForModel: encoded.body.length > cap,
    previewBytes: preview.length,
    totalBytes: encoded.body.length,
  };
}

async function writeHTTPCapture(data) {
  const digest = createHash("sha256").update(data).digest("hex");
  const relative = join("work", "http-captures", `${digest}.bin`).replaceAll("\\", "/");
  const absolute = join(process.cwd(), relative);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  await writeFile(absolute, data, { mode: 0o600 });
  return relative;
}

const blockedHTTPHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "transfer-encoding",
  "upgrade",
]);

function normalizeHTTPHeaders(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ctf_http headers must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error("ctf_http accepts at most 32 request headers");
  const headers = {};
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName).trim();
    const lower = name.toLowerCase();
    const headerValue = String(rawValue);
    if (
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
      || blockedHTTPHeaders.has(lower)
      || /[\r\n]/.test(headerValue)
      || headerValue.length > 8192
    ) {
      throw new Error(`ctf_http denied unsafe request header: ${name || "(empty)"}`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

async function readBoundedResponse(response, maxBytes) {
  if (!response.body) return { data: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel();
        break;
      }
      const chunk = Buffer.from(value);
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    reader.releaseLock();
  }
  return { data: Buffer.concat(chunks, total), truncated };
}

function createCTFHTTPTool(manifest) {
  return defineTool({
    name: "ctf_http",
    label: "Request authorized CTF origin",
    description: "Send one bounded HTTP request only to an exact approved origin. "
      + "No browser cookie jar, platform session, SSH credential, or model-provider credential "
      + "is inherited. Redirects are returned but never followed. "
      + "The model-visible body is a short excerpt (50KB for HTML/JSON, 4KB for JS/CSS/wasm). "
      + "Overflow is saved under work/http-captures/ for the file read tool with offset. "
      + "Do not fetch frontend bundles to discover APIs.",
    parameters: Type.Object({
      url: Type.String({ maxLength: 4096 }),
      method: Type.Optional(Type.Union([
        Type.Literal("GET"),
        Type.Literal("HEAD"),
        Type.Literal("POST"),
        Type.Literal("PUT"),
        Type.Literal("PATCH"),
        Type.Literal("DELETE"),
        Type.Literal("OPTIONS"),
      ])),
      headers: Type.Optional(Type.Record(
        Type.String({ maxLength: 128 }),
        Type.String({ maxLength: 8192 }),
      )),
      body: Type.Optional(Type.String({ maxLength: 262144 })),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
      maxResponseBytes: Type.Optional(Type.Integer({
        minimum: 1024,
        maximum: ctfHTTPModelMaxBytes,
      })),
    }),
    execute: async (_toolCallId, params) => {
      const origins = authorizedOrigins(manifest);
      let parsed;
      try {
        parsed = new URL(params.url);
      } catch {
        throw new Error("ctf_http requires an absolute http(s) URL");
      }
      if (
        !["http:", "https:"].includes(parsed.protocol)
        || parsed.username !== ""
        || parsed.password !== ""
        || !origins.has(parsed.origin)
      ) {
        throw new Error(`ctf_http denied URL outside the exact authorized origins: ${parsed.origin}`);
      }
      const method = params.method || "GET";
      if (["GET", "HEAD"].includes(method) && params.body !== undefined) {
        throw new Error(`${method} requests cannot include a body`);
      }
      const headers = normalizeHTTPHeaders(params.headers);
      const body = params.body === undefined ? undefined : params.body;
      const timeoutSeconds = params.timeoutSeconds || 15;
      const maxResponseBytes = Math.min(
        params.maxResponseBytes || ctfHTTPModelMaxBytes,
        ctfHTTPModelMaxBytes,
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      try {
        const response = await fetch(parsed, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: controller.signal,
        });
        const bounded = await readBoundedResponse(response, maxResponseBytes);
        const responseHeaders = {};
        for (const [name, value] of response.headers.entries()) responseHeaders[name] = value;
        const contentType = response.headers.get("content-type") || "";
        const projected = projectCTFHTTPBody(bounded.data, contentType, parsed.toString());
        let capturePath;
        if (projected.truncatedForModel || bounded.truncated) {
          capturePath = await writeHTTPCapture(bounded.data);
        }
        const result = {
          requestedUrl: parsed.toString(),
          responseUrl: response.url,
          method,
          status: response.status,
          statusText: response.statusText,
          redirected: response.status >= 300 && response.status < 400,
          headers: responseHeaders,
          bytesReturned: bounded.data.length,
          truncated: bounded.truncated || projected.truncatedForModel,
          bodyEncoding: projected.bodyEncoding,
          body: projected.body,
          previewBytes: projected.previewBytes,
          totalBytes: projected.totalBytes,
          capturePath,
          note: projected.truncatedForModel || bounded.truncated
            ? `Model-visible body clipped to ${formatSize(projected.previewBytes)} of ${formatSize(projected.totalBytes)}. `
              + (capturePath
                ? `Fetched bytes are at ${capturePath}; use the file read tool with offset if a later step needs more. `
                : "")
              + "Do not fetch JS/CSS/wasm bundles to map APIs."
            : undefined,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`ctf_http timed out after ${timeoutSeconds}s`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function decodeSocketPayload(value, encoding) {
  const input = value || "";
  switch (encoding) {
  case "hex":
    if (input.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(input)) {
      throw new Error("ctf_socket hex payload must contain complete hexadecimal bytes");
    }
    return Buffer.from(input, "hex");
  case "base64":
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
      throw new Error("ctf_socket payload is not canonical base64");
    }
    return Buffer.from(input, "base64");
  default:
    return Buffer.from(input, "utf8");
  }
}

function parseSocketTarget(target, toolName = "ctf_socket") {
  let parsed;
  try {
    parsed = new URL(`tcp://${target}`);
  } catch {
    throw new Error(`${toolName} target must be an exact authorized host:port`);
  }
  const port = Number(parsed.port);
  if (
    !parsed.hostname
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error(`${toolName} target must include one exact host and valid port`);
  }
  const host = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  return { host, port };
}

function runSocketRequest(target, payload, timeoutSeconds, maxResponseBytes) {
  const address = parseSocketTarget(target);
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(address);
    const chunks = [];
    let total = 0;
    let settled = false;
    let truncated = false;
    let idleTimeout = false;
    const finish = (error = undefined) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise({
        data: Buffer.concat(chunks, total),
        truncated,
        idleTimeout,
      });
    };
    socket.setTimeout(timeoutSeconds * 1000);
    socket.on("connect", () => socket.end(payload));
    socket.on("data", value => {
      const chunk = Buffer.from(value);
      const remaining = maxResponseBytes - total;
      if (remaining <= 0) {
        truncated = true;
        finish();
        return;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        truncated = true;
        finish();
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    socket.on("end", () => finish());
    socket.on("close", () => finish());
    socket.on("timeout", () => {
      if (total === 0) {
        finish(new Error(`ctf_socket timed out after ${timeoutSeconds}s without a response`));
        return;
      }
      idleTimeout = true;
      finish();
    });
    socket.on("error", error => finish(error));
  });
}

function createCTFSocketTool(manifest) {
  return defineTool({
    name: "ctf_socket",
    label: "Talk to authorized CTF socket",
    description: "Open one bounded TCP connection only to an exact approved TCP host:port, "
      + "send one payload, and return one bounded response. SSH grants never authorize this tool.",
    parameters: Type.Object({
      target: Type.String({ maxLength: 512 }),
      payload: Type.Optional(Type.String({ maxLength: 262144 })),
      payloadEncoding: Type.Optional(Type.Union([
        Type.Literal("utf8"),
        Type.Literal("hex"),
        Type.Literal("base64"),
      ])),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
      maxResponseBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 262144 })),
    }),
    execute: async (_toolCallId, params) => {
      const sockets = authorizedSockets(manifest);
      const target = String(params.target || "").trim();
      if (!sockets.has(target)) {
        throw new Error(`ctf_socket denied target outside the exact authorized sockets: ${target}`);
      }
      const payload = decodeSocketPayload(params.payload, params.payloadEncoding || "utf8");
      if (payload.length > 262144) throw new Error("ctf_socket payload exceeds 256 KiB");
      const response = await runSocketRequest(
        target,
        payload,
        params.timeoutSeconds || 10,
        params.maxResponseBytes || 65536,
      );
      const result = {
        target,
        payloadBytes: payload.length,
        bytesReturned: response.data.length,
        truncated: response.truncated,
        idleTimeout: response.idleTimeout,
        ...boundedBody(response.data),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

function runSSHBannerProbe(target, timeoutSeconds, maxResponseBytes) {
  const address = parseSocketTarget(target, "ctf_ssh");
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(address);
    const chunks = [];
    let total = 0;
    let settled = false;
    let truncated = false;
    const finish = (error = undefined) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise({ data: Buffer.concat(chunks, total), truncated });
    };
    socket.setTimeout(timeoutSeconds * 1000);
    socket.on("data", value => {
      const chunk = Buffer.from(value);
      const newline = chunk.indexOf(0x0a);
      const useful = newline >= 0 ? chunk.subarray(0, newline + 1) : chunk;
      const remaining = maxResponseBytes - total;
      if (useful.length > remaining) {
        chunks.push(useful.subarray(0, Math.max(remaining, 0)));
        total += Math.max(remaining, 0);
        truncated = true;
        finish();
        return;
      }
      chunks.push(useful);
      total += useful.length;
      if (newline >= 0 || total >= maxResponseBytes) {
        truncated = total >= maxResponseBytes && newline < 0;
        finish();
      }
    });
    socket.on("end", () => finish());
    socket.on("close", () => finish());
    socket.on("timeout", () => {
      if (total === 0) {
        finish(new Error(`ctf_ssh timed out after ${timeoutSeconds}s without a server banner`));
        return;
      }
      finish();
    });
    socket.on("error", error => finish(error));
  });
}

function createCTFSSHTool(manifest) {
  return defineTool({
    name: "ctf_ssh",
    label: "Probe authorized SSH banner",
    description: "Read only the bounded server identification banner from one exact approved "
      + "SSH host:port. It sends no client banner, username, password, key, SSH-agent request, "
      + "or command and cannot create an authenticated session.",
    parameters: Type.Object({
      target: Type.String({ maxLength: 512 }),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })),
      maxResponseBytes: Type.Optional(Type.Integer({ minimum: 64, maximum: 4096 })),
    }),
    execute: async (_toolCallId, params) => {
      const targets = authorizedSSH(manifest);
      const target = String(params.target || "").trim();
      if (!targets.has(target)) {
        throw new Error(`ctf_ssh denied target outside the exact authorized SSH targets: ${target}`);
      }
      const response = await runSSHBannerProbe(
        target,
        params.timeoutSeconds || 8,
        params.maxResponseBytes || 1024,
      );
      const result = {
        target,
        probe: "server-identification-only",
        sentBytes: 0,
        bytesReturned: response.data.length,
        truncated: response.truncated,
        sha256: createHash("sha256").update(response.data).digest("hex"),
        ...boundedBody(response.data, "text/plain"),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

function boundedRequestText(label, rawValue, maxLength) {
  const value = String(rawValue || "").trim();
  if (
    value.length === 0
    || [...value].length > maxLength
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} is required and must contain no control characters`);
  }
  return value;
}

function normalizeEndpointProposal(params) {
  const protocol = String(params.protocol || "").trim().toLowerCase();
  const source = boundedRequestText("endpoint source", params.source, 240);
  const purpose = boundedRequestText("endpoint purpose", params.purpose, 500);
  const rawEndpoint = String(params.endpoint || "").trim();
  if (["http", "https"].includes(protocol)) {
    let parsed;
    try {
      parsed = new URL(rawEndpoint);
    } catch {
      throw new Error(`${protocol} endpoint must be an exact origin`);
    }
    if (
      parsed.protocol !== `${protocol}:`
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
    ) {
      throw new Error(`${protocol} endpoint must be an exact origin without credentials, path, query, or fragment`);
    }
    return {
      kind: "ctf_endpoint_request",
      protocol,
      endpoint: parsed.origin,
      host: parsed.hostname,
      port: Number(parsed.port || (protocol === "https" ? 443 : 80)),
      targetKind: "origin",
      source,
      purpose,
      requestedBy: "agent",
      status: "pending_user_approval",
    };
  }
  if (["tcp", "ssh"].includes(protocol)) {
    const address = parseSocketTarget(rawEndpoint, "ctf_request_endpoint");
    const host = address.host.includes(":") ? `[${address.host}]` : address.host;
    return {
      kind: "ctf_endpoint_request",
      protocol,
      endpoint: `${host}:${address.port}`,
      host: address.host,
      port: address.port,
      targetKind: protocol === "ssh" ? "ssh" : "socket",
      source,
      purpose,
      requestedBy: "agent",
      status: "pending_user_approval",
    };
  }
  throw new Error("endpoint protocol must be http, https, tcp, or ssh");
}

function createCTFEndpointRequestTool() {
  return defineTool({
    name: ctfEndpointRequestToolName,
    label: "Request CTF Endpoint authorization",
    description: "Propose one newly discovered exact HTTP(S), TCP, or SSH Endpoint for user "
      + "review. This tool only records a pending request; it never changes Scope, connects, "
      + "inherits platform sessions, or authorizes another tool.",
    parameters: Type.Object({
      protocol: Type.Union([
        Type.Literal("http"),
        Type.Literal("https"),
        Type.Literal("tcp"),
        Type.Literal("ssh"),
      ]),
      endpoint: Type.String({ minLength: 1, maxLength: 4096 }),
      source: Type.String({ minLength: 1, maxLength: 240 }),
      purpose: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    execute: async (_toolCallId, params) => {
      const result = normalizeEndpointProposal(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

export function createCTFEndpointToolDefinitions(manifest) {
  return [
    createCTFEndpointRequestTool(),
    createCTFHTTPTool(manifest),
    createCTFSocketTool(manifest),
    createCTFSSHTool(manifest),
  ];
}
