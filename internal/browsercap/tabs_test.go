package browsercap

import "testing"

func TestMatchCodingTabUsesIdOrUniqueQuery(t *testing.T) {
	tabs := []CodingBrowserTab{
		{ID: "tab_a", Title: "Bilibili", URL: "https://www.bilibili.com/video/1", Active: true},
		{ID: "tab_b", Title: "文档", URL: "https://example.com/docs", Active: false},
	}
	matched, err := MatchCodingTab(tabs, "tab_b", "")
	if err != nil || matched.ID != "tab_b" {
		t.Fatalf("id match = %+v, %v", matched, err)
	}
	matched, err = MatchCodingTab(tabs, "", "bilibili")
	if err != nil || matched.ID != "tab_a" {
		t.Fatalf("query match = %+v, %v", matched, err)
	}
	if _, err := MatchCodingTab(tabs, "", "https"); err == nil {
		t.Fatal("ambiguous query should fail")
	}
	if _, err := MatchCodingTab(tabs, "", "missing"); err == nil {
		t.Fatal("unknown query should fail")
	}
}
