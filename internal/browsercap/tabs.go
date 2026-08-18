package browsercap

import (
	"fmt"
	"strings"
)

func MatchCodingTab(tabs []CodingBrowserTab, tabID, query string) (CodingBrowserTab, error) {
	tabID = strings.TrimSpace(tabID)
	query = strings.TrimSpace(query)
	if tabID != "" {
		for _, tab := range tabs {
			if tab.ID == tabID {
				return tab, nil
			}
		}
		return CodingBrowserTab{}, fmt.Errorf("没有这个浏览器标签")
	}
	if query == "" {
		return CodingBrowserTab{}, fmt.Errorf("请提供 tabId，或先列出标签再选一个")
	}
	needle := strings.ToLower(query)
	var matches []CodingBrowserTab
	for _, tab := range tabs {
		title := strings.ToLower(tab.Title)
		address := strings.ToLower(tab.URL)
		if strings.Contains(title, needle) || strings.Contains(address, needle) {
			matches = append(matches, tab)
		}
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	if len(matches) == 0 {
		return CodingBrowserTab{}, fmt.Errorf("没有标题或地址匹配 %q 的标签，请先 list_browser_tabs", query)
	}
	return CodingBrowserTab{}, fmt.Errorf("有 %d 个标签匹配 %q，请改用准确的 tabId", len(matches), query)
}
