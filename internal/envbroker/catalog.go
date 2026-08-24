package envbroker

import (
	"strings"

	"github.com/MilkSU-Official/milksu/internal/envbroker/packages"
)

func Catalog() []Package {
	return []Package{
		{
			ID:          "juice-shop",
			Name:        "OWASP Juice Shop",
			KindLabel:   "Web",
			Detail:      "Docker · 约 400MB · :3000",
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
			Detail:    "本机官方 AVD · 受限 adb",
			Provider:  "android-avd",
			Surface:   "emulator",
			Address:   "emulator-5554",
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
