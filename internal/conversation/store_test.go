package conversation

import "testing"

func TestConversationIDRejectsPaths(t *testing.T) {
	invalid := []string{"", "../settings", "a/b", "a b", "."}
	for _, id := range invalid {
		if validID.MatchString(id) {
			t.Fatalf("expected %q to be rejected", id)
		}
	}
}

func TestConversationIDAcceptsUUID(t *testing.T) {
	if !validID.MatchString("bb97144e-64b2-4bcc-a07f-4f5b3f9f8aa1") {
		t.Fatal("expected UUID to be accepted")
	}
}
