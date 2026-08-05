package codingenv

import (
	"context"
	"os/exec"
	"sort"
	"strconv"
	"strings"
)

const maximumReportedListeningPorts = 16

// ListeningPorts returns TCP listeners owned by the task's process group.
// It is best-effort environment metadata: an unavailable lsof binary or a
// process that exits during inspection simply produces an empty list.
func ListeningPorts(
	ctx context.Context,
	pid,
	processGroupID int,
) []int {
	targetFlag := "-p"
	targetID := pid
	if processGroupID > 0 {
		targetFlag = "-g"
		targetID = processGroupID
	}
	if targetID <= 0 {
		return nil
	}

	lsof, err := exec.LookPath("lsof")
	if err != nil {
		return nil
	}
	output, err := exec.CommandContext(
		ctx,
		lsof,
		"-nP",
		"-a",
		targetFlag,
		strconv.Itoa(targetID),
		"-iTCP",
		"-sTCP:LISTEN",
		"-Fn",
	).Output()
	if err != nil {
		return nil
	}
	return parseListeningPorts(string(output))
}

func parseListeningPorts(output string) []int {
	seen := make(map[int]struct{})
	for _, line := range strings.Split(output, "\n") {
		if !strings.HasPrefix(line, "n") {
			continue
		}
		name := strings.TrimSpace(strings.TrimPrefix(line, "n"))
		separator := strings.LastIndex(name, ":")
		if separator < 0 || separator == len(name)-1 {
			continue
		}
		port, err := strconv.Atoi(name[separator+1:])
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		seen[port] = struct{}{}
	}
	ports := make([]int, 0, len(seen))
	for port := range seen {
		ports = append(ports, port)
	}
	sort.Ints(ports)
	if len(ports) > maximumReportedListeningPorts {
		ports = ports[:maximumReportedListeningPorts]
	}
	return ports
}
