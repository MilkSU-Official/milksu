package securitytools

type definition struct {
	id              string
	name            string
	purpose         string
	connection      string
	runtime         string
	capabilities    []string
	schema          []string
	setupSupported  bool
	codingSupported bool
	defaultEnabled  bool
	overlayKind     string
}

var catalog = []definition{
	{
		id: ToolIDA, name: "IDA Pro", purpose: "交互式反汇编与二进制分析",
		connection: "idalib MCP", runtime: "按需启动本地 MCP",
		capabilities:   []string{"读取函数与反编译结果", "读取交叉引用", "读取字符串与调用图", "打开工作区内二进制数据库"},
		schema:         []string{"idb_open", "list_funcs", "decompile", "xrefs_to", "callgraph", "get_string"},
		setupSupported: true, codingSupported: true, defaultEnabled: true,
	},
	{
		id: ToolCapa, name: "capa", purpose: "识别二进制能力与行为特征",
		connection: "本地 CLI Adapter", runtime: "工作区内受限进程",
		capabilities:   []string{"识别能力规则", "输出匹配证据", "读取样本元数据", "生成 JSON 报告"},
		schema:         []string{"capa_analyze(relativePath, format)"},
		setupSupported: true, codingSupported: true, defaultEnabled: true,
	},
	{
		id: ToolCodeQL, name: "CodeQL", purpose: "代码查询与漏洞分析",
		connection: "本地 CodeQL CLI", runtime: "工作区数据库",
		capabilities:    []string{"检测本地 CLI", "创建分析数据库", "运行固定查询", "读取 SARIF 结果"},
		schema:          []string{"本批次仅检测 CLI；专用 Adapter 尚未接入"},
		codingSupported: true, defaultEnabled: true,
	},
	{
		id: ToolBurp, name: "Burp Suite", purpose: "Web 安全测试与代理抓包",
		connection: "桌面软件探测", runtime: "连接现有 Burp",
		capabilities:    []string{"检测本机 Burp", "后续读取 Proxy 历史", "后续读取 Repeater 请求"},
		schema:          []string{"本批次仅检测软件；MCP Adapter 尚未接入"},
		codingSupported: true, defaultEnabled: true,
	},
	{
		id: ToolShannon, name: "Shannon", purpose: "授权目标的安全任务 Worker",
		connection: "容器 Worker", runtime: "隔离 Docker 容器",
		capabilities:    []string{"检测 Docker", "后续检查 Worker 健康", "后续读取任务报告"},
		schema:          []string{"本批次仅检测运行前提；Worker Adapter 尚未接入"},
		codingSupported: true, defaultEnabled: true,
	},
	{
		id: ToolGhidraRPC, name: "Ghidra RPC",
		purpose:    "Ghidra 本机 RPC 覆盖（短名 ghidra-rpc-main）",
		connection: "内置 MCP 覆盖", runtime: "Ghidra 11+ · Java 17+ · GHIDRA_INSTALL_DIR",
		capabilities:    []string{"检测 Ghidra 与 Java", "样本和工程限制在工作区", "就绪且启用后才进入模型目录"},
		schema:          []string{"cellebrite-labs/ghidra-rpc main " + GhidraRPCRevision + "（备选 " + GhidraRPCTag + " " + GhidraRPCTagRevision + "）；只出 when-to-use，不 vendor 上游仓库"},
		codingSupported: true, defaultEnabled: false, overlayKind: "mcp",
	},
	{
		id: ToolJADXAndroid, name: "JADX Android 恶意样本",
		purpose:    "实验室 InjuredAndroid 的 JADX Skill 覆盖",
		connection: "内置 Skill 覆盖", runtime: "磁盘 SKILL.md · 仅 Lab / InjuredAndroid 路径",
		capabilities:    []string{"检测本机 JADX", "样本隔离与输出清洗", "不用 Computer Use"},
		schema:          []string{"只 vendor mukul975 " + JADXSkillSubtree + " @" + JADXSkillTag},
		codingSupported: true, defaultEnabled: false, overlayKind: "skill",
	},
}
