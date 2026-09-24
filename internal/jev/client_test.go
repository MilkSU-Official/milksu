package jev

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNoulReadsYesProbability(t *testing.T) {
	var gotAuth, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"jev-test","answers":{"gate":{"type":"noul","noul":0.12}}}`))
	}))
	defer server.Close()

	client := &Client{Endpoint: server.URL, Key: "jv_live_test", HTTP: server.Client()}
	yes, err := client.Noul(context.Background(), map[string]string{"title": "碎片"}, "Worth keeping?")
	if err != nil {
		t.Fatal(err)
	}
	if yes != 0.12 {
		t.Fatalf("noul = %v", yes)
	}
	if gotAuth != "Bearer jv_live_test" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if !strings.Contains(gotBody, `"type":"noul"`) || strings.Contains(gotBody, "jv_live_test") {
		t.Fatalf("body = %s", gotBody)
	}
}

func TestNoulRequiresKey(t *testing.T) {
	client := &Client{}
	if _, err := client.Noul(context.Background(), "x", "y"); err == nil {
		t.Fatal("expected missing key to fail")
	}
}

func TestChoiceReadsSelectedOption(t *testing.T) {
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"answers":{"route":{"type":"choice","choice":"长任务"}}}`))
	}))
	defer server.Close()
	client := &Client{Endpoint: server.URL, Key: "sk-or-test", HTTP: server.Client()}
	choice, err := client.Choice(context.Background(), "去仓库里改登录", "分成一档。", map[string]string{
		"chat": "短问",
		"long": "改仓库",
	})
	if err != nil {
		t.Fatal(err)
	}
	if choice != "长任务" {
		t.Fatalf("choice = %s", choice)
	}
	if !strings.Contains(gotBody, "typesafe/jev-1.13") ||
		!strings.Contains(gotBody, `"instructions":"分成一档。"`) ||
		!strings.Contains(gotBody, `"criteria"`) ||
		strings.Contains(gotBody, `"options"`) ||
		strings.Contains(gotBody, "sk-or-test") {
		t.Fatalf("body = %s", gotBody)
	}
}
