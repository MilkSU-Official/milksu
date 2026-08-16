// Mechanically compiled from earendil-works/pi PR #3080, revision 53e430c.
// MilkSU only adapts the reviewed TypeScript extension to the packaged ESM runtime.
import { Type } from "typebox";
function isIpInCidr(ip, cidr) {
  const [range, bits] = cidr.split("/");
  const mask = parseInt(bits, 10);
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  if (ipNum === null || rangeNum === null) return false;
  const maskBits = mask === 0 ? 0 : 4294967295 << 32 - mask;
  return (ipNum & maskBits) === (rangeNum & maskBits);
}
function ipToNumber(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (Number.isNaN(num) || num < 0 || num > 255) return null;
    result = result << 8 | num;
  }
  return result >>> 0;
}
function isIpv6InPrefix(ipParts, cidrPrefix, cidrBits) {
  const prefixParts = [];
  for (let i = 0; i < 8; i++) {
    const start = i * (cidrBits > 16 ? 4 : cidrBits - i * 16 > 0 ? 4 : 0);
    const end = Math.min(start + 4, cidrPrefix.length);
    if (start < cidrPrefix.length) {
      const hex = cidrPrefix.slice(start, end);
      prefixParts.push(parseInt(hex.padEnd(4, "0"), 16));
    } else {
      prefixParts.push(0);
    }
  }
  const partsToCheck = Math.ceil(cidrBits / 16);
  for (let i = 0; i < partsToCheck && i < 8; i++) {
    if (i < partsToCheck - 1) {
      if (ipParts[i] !== prefixParts[i].toString(16).padStart(4, "0")) return false;
    } else {
      const bitsInLastPart = cidrBits - i * 16;
      const mask = 65535 << 16 - bitsInLastPart >>> 0;
      const ipPartNum = parseInt(ipParts[i], 16);
      const prefixPartNum = prefixParts[i];
      if ((ipPartNum & mask) !== (prefixPartNum & mask)) return false;
    }
  }
  return true;
}
function parseIpv6(ip) {
  const ipv4Mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (ipv4Mapped?.[1]) {
    const ipv4Num = ipToNumber(ipv4Mapped[1]);
    if (ipv4Num === null) return null;
    return ["0000", "0000", "0000", "0000", "0000", "ffff", ipv4Num.toString(16).padStart(4, "0")];
  }
  const zoneIndex = ip.indexOf("%");
  if (zoneIndex !== -1) {
    ip = ip.slice(0, zoneIndex);
  }
  let normalized = ip;
  if (ip.includes("::")) {
    const parts2 = ip.split("::");
    const leftParts = parts2[0] ? parts2[0].split(":") : [];
    const rightParts = parts2[1] ? parts2[1].split(":") : [];
    const missing = 8 - leftParts.length - rightParts.length;
    const middle = Array(missing).fill("0");
    normalized = [...leftParts, ...middle, ...rightParts].join(":");
  }
  const parts = normalized.split(":");
  if (parts.length !== 8) return null;
  const result = [];
  for (const p of parts) {
    if (p === "") {
      result.push("0");
      continue;
    }
    const num = parseInt(p, 16);
    if (Number.isNaN(num) || num < 0 || num > 65535) return null;
    result.push(num.toString(16).padStart(4, "0").toLowerCase());
  }
  return result;
}
function isBlockedHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "localhost.") {
    return true;
  }
  const internalHostnames = ["metadata", "instance-data", "metadata.google", "metadata.google.internal"];
  if (internalHostnames.includes(lower)) {
    return true;
  }
  return false;
}
function isBlockedIp(ip) {
  if (ip.includes(".") && !ip.includes(":")) {
    if (isIpInCidr(ip, "127.0.0.0/8")) return true;
    if (isIpInCidr(ip, "10.0.0.0/8")) return true;
    if (isIpInCidr(ip, "172.16.0.0/12")) return true;
    if (isIpInCidr(ip, "192.168.0.0/16")) return true;
    if (isIpInCidr(ip, "169.254.0.0/16")) return true;
    if (isIpInCidr(ip, "0.0.0.0/8")) return true;
    return false;
  }
  const ipv6Parts = parseIpv6(ip);
  if (ipv6Parts === null) {
    return true;
  }
  if (ipv6Parts.join(":") === "0000:0000:0000:0000:0000:0000:0000:0001") {
    return true;
  }
  if (ipv6Parts.slice(0, 5).join(":") === "0000:0000:0000:0000:0000" && ipv6Parts[5] === "ffff") {
    const mappedIp = `${parseInt(ipv6Parts[6].slice(0, 2), 16)}.${parseInt(ipv6Parts[6].slice(2), 16)}.${parseInt(ipv6Parts[7].slice(0, 2), 16)}.${parseInt(ipv6Parts[7].slice(2), 16)}`;
    return isBlockedIp(mappedIp);
  }
  if (isIpv6InPrefix(ipv6Parts, "fe80", 10)) {
    return true;
  }
  if (isIpv6InPrefix(ipv6Parts, "fc", 7)) {
    return true;
  }
  if (ipv6Parts.every((p) => p === "0000")) {
    return true;
  }
  return false;
}
function isUrlBlocked(url) {
  const hostname = url.hostname;
  if (isBlockedHostname(hostname)) {
    return true;
  }
  const ipPattern = /^[\d.:[\]]+$/;
  if (ipPattern.test(hostname)) {
    const ip = hostname.replace(/^\[|\]$/g, "");
    if (isBlockedIp(ip)) {
      return true;
    }
  }
  if (hostname.startsWith("[") && hostname.includes(":") && hostname.endsWith("]")) {
    const ip = hostname.slice(1, -1);
    if (isBlockedIp(ip)) {
      return true;
    }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return true;
  }
  return false;
}
class SearchBlockedError extends Error {
  constructor(message = "Search backend blocked the request") {
    super(message);
    this.name = "SearchBlockedError";
  }
}
const ANOMALY_MARKERS = ["anomaly.js", "Unfortunately, bots", "challenge-form"];
function decodeDuckDuckGoRedirect(href) {
  try {
    const normalized = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(normalized);
    if (!parsed.hostname.endsWith("duckduckgo.com")) return null;
    const uddg = parsed.searchParams.get("uddg");
    if (!uddg) return null;
    return decodeURIComponent(uddg);
  } catch {
    return null;
  }
}
function resolveResultUrl(href) {
  const decoded = decodeDuckDuckGoRedirect(href);
  if (decoded) return decoded;
  if (href.startsWith("//")) return `https:${href}`;
  return href;
}
function isNavigationUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}
function parseJinaSearchMarkdown(markdown, maxResults) {
  const results = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const matches = [];
  let m = linkPattern.exec(markdown);
  while (m !== null) {
    const title = m[1].trim();
    const rawHref = m[2].trim();
    const url = resolveResultUrl(rawHref);
    if (title && url && !isNavigationUrl(url)) {
      matches.push({ title, url, start: m.index, end: m.index + m[0].length });
    }
    m = linkPattern.exec(markdown);
  }
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < matches.length && results.length < maxResults; i++) {
    const current = matches[i];
    if (seen.has(current.url)) continue;
    seen.add(current.url);
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : markdown.length;
    const between = markdown.slice(current.end, nextStart);
    let domain;
    try {
      domain = new URL(current.url).hostname.replace(/^www\./, "");
    } catch {
    }
    const snippet = between.split("\n").map((l) => l.trim()).filter((l) => {
      if (l.length === 0) return false;
      if (l.startsWith("[") || l.startsWith("#") || l.startsWith("---") || l.startsWith("!")) return false;
      if (/^\d+\.$/.test(l)) return false;
      if (domain && (l === domain || l === `www.${domain}` || l.startsWith(`${domain}/`) || l.startsWith(`www.${domain}/`)))
        return false;
      return true;
    }).join(" ").replace(/\*\*/g, "").replace(/\s*\d+\.\s*$/, "").slice(0, 300).trim();
    results.push({ title: current.title, url: current.url, snippet });
  }
  return results;
}
async function searchViaJinaReader(query, maxResults, signal) {
  const encodedQuery = encodeURIComponent(query);
  const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;
  const jinaUrl = `https://r.jina.ai/${ddgUrl}`;
  const headers = {
    Accept: "text/markdown, text/plain",
    "X-Return-Format": "markdown",
    "User-Agent": "Mozilla/5.0 (compatible; PiBot/1.0)"
  };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }
  const response = await fetch(jinaUrl, { signal, headers });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    }
    throw new Error(`Search failed: HTTP ${response.status}`);
  }
  const markdown = await response.text();
  if (ANOMALY_MARKERS.some((marker) => markdown.includes(marker))) {
    throw new SearchBlockedError();
  }
  return parseJinaSearchMarkdown(markdown, maxResults);
}
const METADATA_PREFIXES = [
  "title:",
  "url:",
  "description:",
  "image:",
  "publishedtime:",
  "author:",
  "domain:",
  "locale:",
  "canonical:"
];
const MAX_TITLE_LENGTH = 100;
const CONTENT_TRUNCATE_LIMIT = 4096;
async function fetchWithJinaReader(url, signal) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(jinaUrl, {
    signal,
    headers: {
      Accept: "text/markdown, text/plain",
      "X-Return-Format": "markdown",
      "User-Agent": "Mozilla/5.0 (compatible; PiBot/1.0)"
    }
  });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    }
    if (response.status === 404) {
      throw new Error("Page not found");
    }
    throw new Error(`Fetch failed: HTTP ${response.status}`);
  }
  const content = await response.text();
  return {
    title: "",
    content
  };
}
function stripMetadataPrefix(content) {
  const lines = content.split("\n");
  const result = [];
  let metadataEnded = false;
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    const isMetadata = METADATA_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
    if (!isMetadata) {
      metadataEnded = true;
    }
    if (metadataEnded && !isMetadata) {
      result.push(line);
    }
  }
  return result.join("\n").trim();
}
function extractTitleFromMarkdown(content, fallbackTitle) {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    let title = headingMatch[1].trim();
    title = title.replace(/\*\*(.+?)\*\*/g, "$1");
    title = title.replace(/\*(.+?)\*/g, "$1");
    title = title.replace(/\[(.+?)\]\(.+?\)/g, "$1");
    title = title.replace(/`(.+?)`/g, "$1");
    return title.slice(0, MAX_TITLE_LENGTH);
  }
  return fallbackTitle ?? "Untitled";
}
function deriveTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const segments = path.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) {
      return void 0;
    }
    const lastSegment = segments[segments.length - 1];
    const withoutExt = lastSegment.replace(/\.[^.]+$/, "");
    if (!withoutExt || /^(index|default|home|page)$/i.test(withoutExt)) {
      return void 0;
    }
    const title = withoutExt.replace(/[-_]/g, " ");
    return title;
  } catch {
    return void 0;
  }
}
function truncateContent(content, maxLength = CONTENT_TRUNCATE_LIMIT) {
  if (content.length <= maxLength) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, maxLength)}

[truncated]`,
    truncated: true
  };
}
function isHtmlOnlyContent(content) {
  const withoutTags = content.replace(/<[^>]*>/g, "").trim();
  return withoutTags.length === 0;
}
function formatError(message) {
  return `Error: ${message}`;
}
function pi_web_tools_default(pi) {
  pi.registerTool({
    name: "web_search",
    label: "web_search",
    description: "Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.",
    promptSnippet: "Search the web for information",
    parameters: Type.Object({
      query: Type.String({
        description: "The search query to find information on the web"
      }),
      max_results: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default: 5)",
          minimum: 1,
          maximum: 20
        })
      )
    }),
    // retry:true  → transient: caller may retry with the same or a modified query
    // retry:false → permanent: query was empty or yielded no real results, retry won't help
    async execute(_toolCallId, { query, max_results }, signal) {
      if (!query || query.trim() === "") {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Empty query", retry: false }) }],
          details: void 0
        };
      }
      const effectiveMaxResults = max_results ?? 5;
      try {
        const results = await searchViaJinaReader(query, effectiveMaxResults, signal);
        if (results.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "No results for query", retry: false }) }],
            details: void 0
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
          details: { results }
        };
      } catch (error) {
        if (error instanceof SearchBlockedError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Search backend blocked the request", retry: true })
              }
            ],
            details: void 0
          };
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        const truncated = message.length > 200 ? `${message.slice(0, 200)}...` : message;
        const isRateLimit = message.toLowerCase().includes("rate limit");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: isRateLimit ? "Search rate limited" : `Search failed: ${truncated}`,
                retry: true
              })
            }
          ],
          details: void 0
        };
      }
    }
  });
  pi.registerTool({
    name: "web_fetch",
    label: "web_fetch",
    description: "Fetch the contents of a web page. Only use URLs from web_search results to ensure you're accessing legitimate, user-intended content. Do not accept URLs from direct user input or other sources.",
    promptSnippet: "Fetch web page content as markdown",
    parameters: Type.Object({
      url: Type.String({
        description: "The URL of the web page to fetch"
      })
    }),
    async execute(_toolCallId, { url }, signal) {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        return {
          content: [{ type: "text", text: formatError("Invalid URL format") }],
          details: { title: "Error", truncated: false }
        };
      }
      if (isUrlBlocked(parsedUrl)) {
        return {
          content: [{ type: "text", text: "Error: URL not allowed" }],
          details: { title: "Blocked", truncated: false }
        };
      }
      try {
        const result = await fetchWithJinaReader(url, signal);
        let content = stripMetadataPrefix(result.content);
        if (!content || content.trim().length === 0) {
          return {
            content: [{ type: "text", text: formatError("No content could be extracted") }],
            details: { title: "Empty", truncated: false }
          };
        }
        if (isHtmlOnlyContent(content)) {
          return {
            content: [{ type: "text", text: formatError("No content could be extracted") }],
            details: { title: "Empty", truncated: false }
          };
        }
        let title = extractTitleFromMarkdown(content);
        if (title === "Untitled") {
          const derivedTitle = deriveTitleFromUrl(url);
          if (derivedTitle) {
            title = derivedTitle;
          }
        }
        if (!content.startsWith("#")) {
          content = `# ${title}

${content}`;
        }
        const { content: truncatedContent, truncated } = truncateContent(content);
        return {
          content: [{ type: "text", text: truncatedContent }],
          details: { title, truncated }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.toLowerCase().includes("timeout") || message.toLowerCase().includes("aborted")) {
          return {
            content: [{ type: "text", text: formatError(`Request timeout: ${message}`) }],
            details: { title: "Timeout", truncated: false }
          };
        }
        if (message.toLowerCase().includes("rate limit")) {
          return {
            content: [{ type: "text", text: formatError("Rate limited, please retry later") }],
            details: { title: "Rate Limited", truncated: false }
          };
        }
        if (message.toLowerCase().includes("not found")) {
          return {
            content: [{ type: "text", text: formatError("Page not found (404)") }],
            details: { title: "Not Found", truncated: false }
          };
        }
        return {
          content: [{ type: "text", text: formatError(`Fetch failed: ${message}`) }],
          details: { title: "Error", truncated: false }
        };
      }
    }
  });
}
export {
  pi_web_tools_default as default
};
