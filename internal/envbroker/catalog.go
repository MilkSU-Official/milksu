package envbroker

import (
	"strings"

	"github.com/MilkSU-Official/milksu/internal/envbroker/packages"
)

const juiceShopBrief = `一个容器、一个地址，不是四台机器。下面几题是同一家店的不同入口，换题不用重开容器。
隔离浏览器打开 127.0.0.1:3000。过程写进 report.md。没有自动 Judge。`

const webGoatBrief = `一个容器、一门课，不是三台机器。按页面上的课程做下面几题，不要扫宿主机其它端口。
浏览器打开 127.0.0.1:18081/WebGoat。过程写进 report.md。没有自动 Judge。`

const strutsBrief = `按公开 advisory 打这一台靶。不要扫其它主机。过程写进 report.md。没有自动 Judge。`

const whoamiBrief = `用来确认本机靶和终端活面能通，不是 Web 教学页。过程写进 report.md。没有自动 Judge。`

const androidAVDBrief = `空白设备，没有预装练习 App。要做 12 面 Flag，打开 InjuredAndroid 题目包。
租约会给出串口，用 adb -s <串口> 操作这台设备。`

const androidLabBrief = `一台模拟器上的练习 App，不是 12 台设备。应用里的 Flag 菜单和下面的题目是同一组关卡。
换题不用重开模拟器，也不用再装 APK。用租约里的 adb 串口操作。过程写进 report.md。没有自动 Judge。`

func target(id, title, kind, guidance string) Challenge {
	return Challenge{ID: id, Title: title, Kind: kind, Guidance: guidance}
}

func Catalog() []Package {
	return []Package{
		{
			ID:         "juice-shop",
			Name:       "OWASP Juice Shop",
			Category:   "web",
			KindLabel:  "Web",
			Detail:     "一家店 · 4 个入口",
			Source:     "OWASP Juice Shop（官方故意漏洞商店）",
			Purpose:    "练 Web 常见漏洞：注入、XSS、重置密码、购物篮",
			Difficulty: "入门",
			Brief:      juiceShopBrief,
			Provider:  "docker",
			Surface:   "browser",
			Address:   "127.0.0.1:3000",
			Port:      3000,
			Challenges: []Challenge{
				target("login-sqli", "登录注入", "注入", "同一家店的登录页。试着不靠已知密码进后台。"),
				target("search-xss", "搜索 XSS", "XSS", "店内搜索。看输入会不会原样进页面。"),
				target("forgot-password", "遗忘密码", "重置", "重置密码流程。找可预测或可改的一步。"),
				target("basket", "购物篮", "业务逻辑", "购物篮和结账。看能不能动到不属于你的数据。"),
			},
			ComposePath: "juice-shop/compose.yaml",
		},
		{
			ID:         "webgoat",
			Name:       "OWASP WebGoat",
			Category:   "web",
			KindLabel:  "Web",
			Detail:     "一门课 · 3 个练习",
			Source:     "OWASP WebGoat（官方 Web 教学课）",
			Purpose:    "按官方课程练注入、XSS、越权",
			Difficulty: "入门",
			Brief:      webGoatBrief,
			Provider:  "docker",
			Surface:   "browser",
			Address:   "127.0.0.1:18081",
			Port:      18081,
			Challenges: []Challenge{
				target("sql-injection", "SQL 注入课", "注入", "WebGoat 注入课。只打这个容器，不要扫其它端口。"),
				target("xss", "XSS 课", "XSS", "WebGoat XSS 课。记下反射或存储点。"),
				target("access-control", "访问控制课", "越权", "WebGoat 访问控制课。看未授权页面能不能直接打开。"),
			},
			ComposePath: "webgoat/compose.yaml",
		},
		{
			ID:         "struts2-s2-045",
			Name:       "Struts2 S2-045",
			Category:   "cve",
			KindLabel:  "CVE",
			Detail:     "CVE-2017-5638 公开复现",
			Source:     "Vulhub 公开环境 · CVE-2017-5638",
			Purpose:    "按公开 advisory 复现 S2-045 Content-Type OGNL",
			Difficulty: "初中级",
			Brief:      strutsBrief,
			Provider:  "docker",
			Surface:   "browser",
			Address:   "127.0.0.1:18045",
			Port:      18045,
			CVEIDs:    []string{"CVE-2017-5638"},
			Challenges: []Challenge{
				target("s2-045", "S2-045 Content-Type", "OGNL", "按 CVE-2017-5638 公开 advisory 打 127.0.0.1:18045。过程写进 report.md。"),
			},
			ComposePath: "struts2-s2-045/compose.yaml",
		},
		{
			ID:         "whoami",
			Name:       "Whoami HTTP",
			Category:   "probe",
			KindLabel:  "连通性",
			Detail:     "最小 HTTP 服务，用来探活",
			Source:     "Traefik whoami（最小 HTTP 镜像）",
			Purpose:    "确认本机靶和终端活面能通",
			Difficulty: "探活",
			Brief:      whoamiBrief,
			Provider:  "docker",
			Surface:   "shell",
			Address:   "127.0.0.1:18080",
			Port:      18080,
			Challenges: []Challenge{
				target("probe", "探活", "探测", "请求租约地址，看返回了什么主机信息。过程写进 report.md。"),
			},
			ComposePath: "whoami/compose.yaml",
		},
		{
			ID:         "android-avd",
			Name:       "Android 模拟器",
			Category:   "android",
			KindLabel:  "安卓",
			Detail:     "空白模拟器，无预装 App",
			Source:     "Android SDK 官方模拟器",
			Purpose:    "自带 APK 或探测空白设备",
			Difficulty: "空白",
			Brief:      androidAVDBrief,
			Provider:  "android-avd",
			Surface:   "emulator",
			Challenges: []Challenge{
				target("blank-device", "空白设备", "探测", "这台 MilkSU-Lab 是空的。用租约串口的 adb 自己装样或探测。过程写进 report.md。"),
			},
		},
		{
			ID:         "android-lab",
			Name:       "InjuredAndroid",
			Category:   "android",
			KindLabel:  "安卓",
			Detail:     "一台模拟器 · 12 面 Flag",
			Source:     "B3nac InjuredAndroid（Apache-2.0）",
			Purpose:    "练安卓组件、存储、Deep Link 等 12 面 Flag",
			Difficulty: "初中级",
			Brief:      androidLabBrief,
			Provider:  "android-avd",
			Surface:   "emulator",
			Challenges: []Challenge{
				target("flag-1", "登录绕过", "认证", "应用菜单第一项。看客户端怎么判登录成功，不必先有密码。"),
				target("flag-2", "导出 Activity", "导出组件", "桌面上没有入口的页面，可能被 adb am start 直接打开。"),
				target("flag-3", "资源硬编码", "硬编码", "查 strings、xml 或资源里有没有写死的秘密。"),
				target("flag-4", "第二处登录", "认证", "另一套登录。不要默认和 Flag 1 同一手法。"),
				target("flag-5", "导出 BroadcastReceiver", "导出组件", "找可被外部广播打到的 Receiver。"),
				target("flag-6", "第三处登录", "认证", "再一处登录。对比前两处，认证落在哪一侧。"),
				target("flag-7", "SQLite", "本地存储", "本地库。看 run-as、备份或可读写目录能不能读到。"),
				target("flag-8", "AWS 凭据", "凭据", "应用里的云密钥痕迹。只当教学秘密，不要拿到真账号上试。"),
				target("flag-9", "Firebase", "云配置", "远程配置或库规则是否可被读出。"),
				target("flag-10", "Unicode", "编码", "校验是否吃特殊字符。"),
				target("flag-11", "Deep Link", "Deep Link", "adb 发 flag11:// 看谁解析、解析后干什么。"),
				target("flag-12", "受保护组件", "权限", "标了权限的导出组件。看保护是否真挡得住未授权调用。"),
			},
			ApkURL:    "https://github.com/B3nac/InjuredAndroid/releases/download/v1.0.12/InjuredAndroid-1.0.12-release.apk",
			ApkSHA256: "b6b8d2dbd7a428b7754e6e537ba5790c35a73253533454e0768dbf1520a7ed15",
			ApkName:   "InjuredAndroid-1.0.12-release.apk",
			Launcher:  "b3nac.injuredandroid/.MainActivity",
		},
	}
}

func PackageByID(id string) (Package, bool) {
	id = strings.TrimSpace(id)
	for _, item := range Catalog() {
		if item.ID == id {
			return item, true
		}
	}
	return Package{}, false
}

func PackageForCVE(cveID string) (Package, bool) {
	cveID = strings.ToUpper(strings.TrimSpace(cveID))
	if cveID == "" {
		return Package{}, false
	}
	for _, item := range Catalog() {
		for _, candidate := range item.CVEIDs {
			if strings.ToUpper(strings.TrimSpace(candidate)) == cveID {
				return item, true
			}
		}
	}
	return Package{}, false
}

func composeBytes(item Package) ([]byte, error) {
	if item.ComposePath == "" {
		return nil, nil
	}
	return packages.FS.ReadFile(item.ComposePath)
}
