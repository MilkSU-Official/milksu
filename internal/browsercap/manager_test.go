package browsercap

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestCurrentTabBridgeRequiresPairingAndPersistsExactPage(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"title": "Challenge", "url": "https://ctf.example/challenge/7", "text": "flag format and attachments"})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unpaired request returned %d", response.StatusCode)
	}
	request, _ = http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired request returned %d", response.StatusCode)
	}
	pages := manager.SharedPages()
	if len(pages) != 1 || pages[0].URL != "https://ctf.example/challenge/7" || pages[0].Scope.Targets[0].Value != "https://ctf.example" {
		t.Fatalf("unexpected shared page: %#v", pages)
	}
}

func TestOriginTargetRejectsCredentialsAndNonHTTP(t *testing.T) {
	for _, value := range []string{"ssh://host:22", "https://user:pass@example.com", "file:///tmp/x"} {
		if _, err := originTarget(value); err == nil {
			t.Fatalf("unsafe browser target was accepted: %s", value)
		}
	}
}

func TestManagedBrowserDoesNotInheritApplicationSecrets(t *testing.T) {
	t.Setenv("MILKSU_TEST_SECRET", "must-not-reach-browser")
	for _, entry := range browserEnvironment() {
		if strings.HasPrefix(entry, "MILKSU_TEST_SECRET=") {
			t.Fatalf("managed browser inherited an unrelated secret: %q", entry)
		}
	}
}
