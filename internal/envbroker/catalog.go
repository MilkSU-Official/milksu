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

const androidAVDBrief = `本机官方 Android 模拟器，空白设备。受限 adb 只打租约串口。不要打宿主机其它 App。`

const androidLabBrief = `InjuredAndroid（Apache-2.0，B3nac）装在本机 AVD 上。用 adb 打，不要打宿主机其它 App。

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

过程写进 report.md。没有自动 Judge。QEMU 窗口不是 Computer Use 靶。`

func Catalog() []Package {
	return []Package{
		{
			ID:          "juice-shop",
			Name:        "OWASP Juice Shop",
			KindLabel:   "Web",
			Detail:      "Docker · 约 400MB · :3000",
			Brief:       juiceShopBrief,
			Provider:    "docker",
			Surface:     "browser",
			Address:     "127.0.0.1:3000",
			Port:        3000,
			ComposePath: "juice-shop/compose.yaml",
		},
		{
			ID:          "webgoat",
			Name:        "OWASP WebGoat",
			KindLabel:   "Web",
			Detail:      "Docker · 教学靶 · :18081",
			Brief:       webGoatBrief,
			Provider:    "docker",
			Surface:     "browser",
			Address:     "127.0.0.1:18081",
			Port:        18081,
			ComposePath: "webgoat/compose.yaml",
		},
		{
			ID:          "struts2-s2-045",
			Name:        "Struts2 S2-045",
			KindLabel:   "Vulhub",
			Detail:      "Docker · CVE-2017-5638 · :18045",
			Brief:       strutsBrief,
			Provider:    "docker",
			Surface:     "browser",
			Address:     "127.0.0.1:18045",
			Port:        18045,
			CVEIDs:      []string{"CVE-2017-5638"},
			ComposePath: "struts2-s2-045/compose.yaml",
		},
		{
			ID:          "whoami",
			Name:        "Whoami HTTP",
			KindLabel:   "Linux",
			Detail:      "Docker · 无 Web 教学页 · :18080",
			Brief:       whoamiBrief,
			Provider:    "docker",
			Surface:     "shell",
			Address:     "127.0.0.1:18080",
			Port:        18080,
			ComposePath: "whoami/compose.yaml",
		},
		{
			ID:        "android-avd",
			Name:      "Android 模拟器",
			KindLabel: "模拟器",
			Detail:    "本机官方 AVD · 空白设备 · 受限 adb",
			Brief:     androidAVDBrief,
			Provider:  "android-avd",
			Surface:   "emulator",
			Address:   "emulator-5554",
		},
		{
			ID:        "android-lab",
			Name:      "InjuredAndroid",
			KindLabel: "安卓题",
			Detail:    "本机 AVD · 12 道 Flag · 受限 adb",
			Brief:     androidLabBrief,
			Provider:  "android-avd",
			Surface:   "emulator",
			Address:   "emulator-5554",
			Challenges: []string{
				"Flag 1 登录绕过",
				"Flag 2 导出 Activity",
				"Flag 3 资源文件硬编码",
				"Flag 4 第二处登录",
				"Flag 5 导出 BroadcastReceiver",
				"Flag 6 第三处登录",
				"Flag 7 SQLite",
				"Flag 8 AWS 凭据",
				"Flag 9 Firebase",
				"Flag 10 Unicode",
				"Flag 11 Deep Link（flag11://）",
				"Flag 12 受保护组件",
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
