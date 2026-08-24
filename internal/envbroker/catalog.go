package envbroker

import (
	"strings"

	"github.com/MilkSU-Official/milksu/internal/envbroker/packages"
)

const juiceShopBrief = `OWASP Juice Shop 是故意有漏洞的网上商店。浏览器打开 127.0.0.1:3000。
用隔离浏览器打登录、搜索和结账。过程写进 report.md。没有自动 Judge。`

const webGoatBrief = `OWASP WebGoat 是官方教学靶。浏览器打开 127.0.0.1:18081/WebGoat。
按课程做，不要扫宿主机其它端口。过程写进 report.md。没有自动 Judge。`

const strutsBrief = `Struts2 S2-045（CVE-2017-5638）在 127.0.0.1:18045。按公开 advisory 复现。
不要扫其它主机。过程写进 report.md。没有自动 Judge。`

const whoamiBrief = `Whoami 是最小 HTTP 服务，127.0.0.1:18080。用 shell 探测这个靶，不是 Web 教学页。
过程写进 report.md。没有自动 Judge。`

const androidAVDBrief = `专用实验室模拟器 MilkSU-Lab，空白设备。租约会给出串口，用 adb -s <串口> 操作这台设备。`

const androidLabBrief = `InjuredAndroid（Apache-2.0，B3nac）装在专用实验室模拟器 MilkSU-Lab 上。

设备：adb -s <租约串口>
包名：b3nac.injuredandroid
打开：adb -s <租约串口> shell am start -n b3nac.injuredandroid/.MainActivity

先做这几道（应用里还有后续 Flag）：
1. Flag 1 登录绕过
2. Flag 2 导出 Activity（adb am start）
3. Flag 3 资源 / 硬编码
4. Flag 5 导出 BroadcastReceiver
5. Flag 7 SQLite（run-as 或备份）
6. Flag 11 Deep Link：adb shell am start -a android.intent.action.VIEW -d flag11://...

过程写进 report.md。没有自动 Judge。`

func target(id, title, kind, guidance string) Challenge {
	return Challenge{ID: id, Title: title, Kind: kind, Guidance: guidance}
}

func Catalog() []Package {
	return []Package{
		{
			ID:        "juice-shop",
			Name:      "OWASP Juice Shop",
			KindLabel: "Web",
			Detail:    "故意有漏洞的网上商店",
			Brief:     juiceShopBrief,
			Provider:  "docker",
			Surface:   "browser",
			Address:   "127.0.0.1:3000",
			Port:      3000,
			Challenges: []Challenge{
				target("login-sqli", "登录注入", "注入", "打开登录页，试着不靠已知密码进后台。过程写进 report.md。"),
				target("search-xss", "搜索 XSS", "XSS", "在搜索框输入，看会不会原样进页面。过程写进 report.md。"),
				target("forgot-password", "遗忘密码", "重置", "走遗忘密码流程，找可预测或可改的一步。过程写进 report.md。"),
				target("basket", "购物篮", "业务逻辑", "看购物篮和结账能不能动到不属于你的数据。过程写进 report.md。"),
			},
			ComposePath: "juice-shop/compose.yaml",
		},
		{
			ID:        "webgoat",
			Name:      "OWASP WebGoat",
			KindLabel: "Web",
			Detail:    "官方教学靶，按课程做",
			Brief:     webGoatBrief,
			Provider:  "docker",
			Surface:   "browser",
			Address:   "127.0.0.1:18081",
			Port:      18081,
			Challenges: []Challenge{
				target("sql-injection", "SQL 注入课", "注入", "按 WebGoat 注入课做，不要扫其它端口。过程写进 report.md。"),
				target("xss", "XSS 课", "XSS", "找到反射或存储点，记下触发步骤。过程写进 report.md。"),
				target("access-control", "访问控制课", "越权", "看未授权页面能不能直接打开。过程写进 report.md。"),
			},
			ComposePath: "webgoat/compose.yaml",
		},
		{
			ID:        "struts2-s2-045",
			Name:      "Struts2 S2-045",
			KindLabel: "CVE",
			Detail:    "CVE-2017-5638 公开复现",
			Brief:     strutsBrief,
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
			ID:        "whoami",
			Name:      "Whoami HTTP",
			KindLabel: "Linux",
			Detail:    "最小 HTTP 服务，用来探活",
			Brief:     whoamiBrief,
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
			ID:        "android-avd",
			Name:      "Android 模拟器",
			KindLabel: "安卓",
			Detail:    "专用空白模拟器",
			Brief:     androidAVDBrief,
			Provider:  "android-avd",
			Surface:   "emulator",
			Challenges: []Challenge{
				target("blank-device", "空白设备", "探测", "这台 MilkSU-Lab 是空的。用租约串口的 adb 自己装样或探测。过程写进 report.md。"),
			},
		},
		{
			ID:        "android-lab",
			Name:      "InjuredAndroid",
			KindLabel: "安卓",
			Detail:    "一台设备上的 12 面 Flag",
			Brief:     androidLabBrief,
			Provider:  "android-avd",
			Surface:   "emulator",
			Challenges: []Challenge{
				target("flag-1", "登录绕过", "认证", "看登录页怎么判成功，试不依赖正确密码的路径。"),
				target("flag-2", "导出 Activity", "导出组件", "用 am start 打开桌面上没有的 Activity。"),
				target("flag-3", "资源硬编码", "硬编码", "查应用资源里有没有写死的秘密。"),
				target("flag-4", "第二处登录", "认证", "另一处登录，手法不一定和 Flag 1 相同。"),
				target("flag-5", "导出 BroadcastReceiver", "导出组件", "找可被外部触发的 Receiver。"),
				target("flag-6", "第三处登录", "认证", "第三处登录，对比前两处差在哪。"),
				target("flag-7", "SQLite", "本地存储", "看 run-as 或备份能不能读到库。"),
				target("flag-8", "AWS 凭据", "凭据", "在应用里找云凭据痕迹。"),
				target("flag-9", "Firebase", "云配置", "查 Firebase 相关配置是否可被读出。"),
				target("flag-10", "Unicode", "编码", "看特殊字符会不会绕过校验。"),
				target("flag-11", "Deep Link", "Deep Link", "adb 发 flag11:// 看应用怎么解析。"),
				target("flag-12", "受保护组件", "权限", "打标了权限保护的组件，看保护是否真的有效。"),
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
