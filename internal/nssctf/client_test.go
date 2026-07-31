package nssctf

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeProblemURL(t *testing.T) {
	url, id, err := NormalizeProblemURL(" https://www.nssctf.cn/problem/382/ ")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://www.nssctf.cn/problem/382" || id != 382 {
		t.Fatalf("unexpected normalized problem: %q %d", url, id)
	}
	url, id, err = NormalizeProblemURL(" 316 ")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://www.nssctf.cn/problem/316" || id != 316 {
		t.Fatalf("unexpected normalized problem ID: %q %d", url, id)
	}
	for _, value := range []string{
		"0",
		"-1",
		"316?token=x",
		"http://www.nssctf.cn/problem/382",
		"https://nssctf.cn/problem/382",
		"https://www.nssctf.cn/problem/382?token=x",
		"https://www.nssctf.cn/problem",
		"https://example.com/problem/382",
		"https://user:pass@www.nssctf.cn/problem/382",
	} {
		if _, _, err := NormalizeProblemURL(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestImportChallengeUsesPublicMetadataOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/problem/v2/382/" {
			t.Fatalf("unexpected path %s", request.URL.Path)
		}
		if request.Header.Get("Cookie") != "" || request.Header.Get("Authorization") != "" {
			t.Fatal("public adapter must not forward credentials")
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"code": 200,
			"data": {
				"pid": 382,
				"title": "[SWPUCTF 2021 新生赛]gift_F12",
				"desc": "<p>flag以NSSCTF{}形式提交</p><br>第二行",
				"point": 1,
				"type": 1,
				"level": 3.0,
				"docker": true,
				"annex": false,
				"tag": [["信息收集", 192], ["JS分析", 188]],
				"info": {"solved": 16626, "wa": 37624, "wp": 209}
			}
		}`))
	}))
	defer server.Close()

	client := NewClient(ClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
	challenge, err := client.ImportChallenge(context.Background(), "https://www.nssctf.cn/problem/382")
	if err != nil {
		t.Fatal(err)
	}
	if challenge.PlatformID != 382 || challenge.Category != "Web" || !challenge.HasEnvironment {
		t.Fatalf("unexpected challenge: %+v", challenge)
	}
	if !strings.Contains(challenge.Statement, "第二行") || len(challenge.Tags) != 2 {
		t.Fatalf("metadata was not normalized: %+v", challenge)
	}
}
