import { delimiter, sep } from "node:path";

export function chineseUiLocale(uiLocale) {
  return String(uiLocale ?? "").trim() !== "en";
}

function hostLabel(platform, chinese) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform || (chinese ? "未知" : "unknown");
}

export function runtimeEnvironmentGuidance({
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
  uiLocale = "zh",
} = {}) {
  const chinese = chineseUiLocale(uiLocale);
  const shell = String(environment.SHELL || "").trim();
  const pathSeparator = platform === "win32" ? "\\" : sep;
  const pathListSeparator = platform === "win32" ? ";" : delimiter;
  const facts = chinese
    ? [
      "MilkSU 界面语言：简体中文。",
      `宿主操作系统：${hostLabel(platform, true)}（${platform}）。`,
      `宿主架构：${arch || "未知"}。`,
      `路径分隔符：${pathSeparator}；PATH 列表分隔符：${pathListSeparator}。`,
    ]
    : [
      `MilkSU user-interface language: English.`,
      `Host operating system: ${hostLabel(platform, false)} (${platform}).`,
      `Host architecture: ${arch || "unknown"}.`,
      `Host path separator: ${pathSeparator}; PATH-list separator: ${pathListSeparator}.`,
    ];

  if (platform === "win32") {
    facts.push(
      chinese
        ? "Pi 的命令工具在 Windows 上走已评审的 Bash 后端（通常是 Git Bash、MSYS2、Cygwin 或 WSL），默认不是 cmd.exe 或 PowerShell 语法。"
        : "Pi's command tool uses its reviewed Bash backend on Windows (normally Git Bash, MSYS2, Cygwin, or WSL), not cmd.exe or PowerShell syntax by default.",
      chinese
        ? "访问宿主文件时用 Windows 路径。任务明确需要原生 Windows 命令或 PowerShell cmdlet 时，从命令工具里显式调用 powershell.exe。"
        : "Use Windows paths when addressing host files. When a task specifically requires a native Windows command or PowerShell cmdlet, invoke powershell.exe explicitly from the command tool.",
    );
  } else {
    facts.push(
      chinese
        ? `Pi 的命令工具使用 POSIX shell${shell ? `（${shell}）` : ""}。`
        : `Pi's command tool uses a POSIX shell${shell ? ` (${shell})` : ""}.`,
    );
  }

  facts.push(
    chinese
      ? "按这些运行时事实选择命令、路径写法、安装方式和排查步骤；不要从对话里的例子推断平台。"
      : "Choose commands, path syntax, installers, and troubleshooting steps for these runtime facts; do not infer the platform from examples in the conversation.",
    chinese
      ? "除非用户明确要求别的语言，思考、过程旁白、进度、答复、标签、图和产物都用 MilkSU 界面语言。英文工具 schema、命令、路径或工具结果不能改掉可见语言。"
      : "Use the MilkSU user-interface language for thinking, progress asides, answers, labels, diagrams, and generated artifacts unless the user explicitly asks for another language. English tool schemas, commands, paths, or tool results must not switch the visible language.",
    chinese
      ? "用户要搜索、核实或报告当前信息时，用可访问的权威来源的现场证据。空响应、超时、认证错误、被拦的页面或失败的命令都不是证据。必要时用已评审的浏览器或网络工具重试；现场核实仍失败就说明核实失败，不要把模型记忆写成当前或已核实的事实。"
      : "When the user asks to search, verify, or report current information, use live evidence from an accessible authoritative source. An empty response, timeout, authentication error, blocked page, or failed command is not evidence. Retry through an available reviewed browser or network tool when appropriate; if live verification still fails, say that verification failed and do not present model memory as current or verified fact.",
  );
  facts.push(
    chinese
      ? "附件图片按图片交给当前模型。直接看图。除非本回合有明确的本地 OCR 证据，不要声称运行时只能处理文字或用过 OCR。"
      : "Attached images are sent to the current model as images. Inspect them directly. Do not claim the runtime is text-only or that OCR was used unless explicit local OCR evidence is present in the current turn.",
  );
  return facts.join("\n");
}
