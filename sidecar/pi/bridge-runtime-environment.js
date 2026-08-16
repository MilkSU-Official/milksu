import { delimiter, sep } from "node:path";

function hostLabel(platform) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform || "unknown";
}

export function runtimeEnvironmentGuidance({
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
  uiLocale = "zh",
  modelInput = [],
} = {}) {
  const shell = String(environment.SHELL || "").trim();
  const pathSeparator = platform === "win32" ? "\\" : sep;
  const pathListSeparator = platform === "win32" ? ";" : delimiter;
  const facts = [
    `MilkSU user-interface language: ${uiLocale === "en" ? "English" : "Simplified Chinese"}.`,
    `Host operating system: ${hostLabel(platform)} (${platform}).`,
    `Host architecture: ${arch || "unknown"}.`,
    `Host path separator: ${pathSeparator}; PATH-list separator: ${pathListSeparator}.`,
  ];

  if (platform === "win32") {
    facts.push(
      "Pi's command tool uses its reviewed Bash backend on Windows (normally Git Bash, MSYS2, Cygwin, or WSL), not cmd.exe or PowerShell syntax by default.",
      "Use Windows paths when addressing host files. When a task specifically requires a native Windows command or PowerShell cmdlet, invoke powershell.exe explicitly from the command tool.",
    );
  } else {
    facts.push(
      `Pi's command tool uses a POSIX shell${shell ? ` (${shell})` : ""}.`,
    );
  }

  facts.push(
    "Choose commands, path syntax, installers, and troubleshooting steps for these runtime facts; do not infer the platform from examples in the conversation.",
    "Use the MilkSU user-interface language for every user-visible progress update, answer, label, diagram, and generated artifact unless the user explicitly asks for another language. English tool schemas, commands, paths, or tool results must not switch the visible language.",
    "When the user asks to search, verify, or report current information, use live evidence from an accessible authoritative source. An empty response, timeout, authentication error, blocked page, or failed command is not evidence. Retry through an available reviewed browser or network tool when appropriate; if live verification still fails, say that verification failed and do not present model memory as current or verified fact.",
  );
  if (Array.isArray(modelInput) && modelInput.includes("image")) {
    facts.push(
      "The selected runtime model accepts direct image input. Attached images are sent to the model as images; inspect them directly and never claim that this runtime is text-only or that OCR was used unless explicit local OCR evidence is present in the current turn.",
    );
  }
  return facts.join("\n");
}
