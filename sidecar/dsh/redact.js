const credential = /\b(?:sk[-_]|gsk_|aiza|nss_agent_)[a-z0-9._-]{8,}/gi;
const bearer = /(bearer\s+)[a-z0-9._~+/=-]{8,}/gi;
const assignment = /\b(api[_ -]?key|key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi;
const query = /([?&](?:api[_-]?key|key|token|secret|password)=)[^&#\s]+/gi;

export function redactProcessText(value, limit = 320) {
  let message = String(value ?? "").trim();
  message = message.replace(credential, "[REDACTED]");
  message = message.replace(bearer, "$1[REDACTED]");
  message = message.replace(assignment, "$1=[REDACTED]");
  message = message.replace(query, "$1[REDACTED]");
  const line = message.split("\n")[0] ?? "";
  message = line.replace(/^Error:\s*/i, "").trim();
  const runes = [...message];
  if (runes.length > limit) {
    return `${runes.slice(0, limit).join("")}...`;
  }
  return message;
}

export function formatProcessFailure(reason, stderr = "") {
  const head = redactProcessText(reason);
  const tail = redactProcessText(stderr);
  if (tail && tail !== head) {
    return redactProcessText(`${head}: ${tail}`);
  }
  return head || "DeepSeek Harness sidecar stopped";
}
