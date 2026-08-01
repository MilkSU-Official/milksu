package codingenv

import (
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestParseListeningPortsDeduplicatesAndSorts(t *testing.T) {
	output := strings.Join([]string{
		"p123",
		"n127.0.0.1:4173",
		"n*:3000",
		"n[::1]:4173",
		"ninvalid",
		"n127.0.0.1:70000",
	}, "\n")
	if got, want := parseListeningPorts(output), []int{3000, 4173}; !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected ports: got %v want %v", got, want)
	}
}

func TestParseListeningPortsBoundsOutput(t *testing.T) {
	lines := make([]string, 0, maximumReportedListeningPorts+5)
	for index := 0; index < maximumReportedListeningPorts+5; index++ {
		lines = append(lines, "n*:"+strconv.Itoa(1000+index))
	}
	if got := parseListeningPorts(strings.Join(lines, "\n")); len(got) != maximumReportedListeningPorts {
		t.Fatalf("unexpected bounded port count: %d", len(got))
	}
}
