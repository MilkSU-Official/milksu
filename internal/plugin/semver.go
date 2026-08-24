package plugin

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var strictSemverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

type semanticVersion struct {
	major      uint64
	minor      uint64
	patch      uint64
	prerelease []string
}

func parseSemanticVersion(value string) (semanticVersion, error) {
	match := strictSemverPattern.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return semanticVersion{}, fmt.Errorf("%q is not strict semantic versioning", value)
	}
	parts := make([]uint64, 3)
	for index := range parts {
		parsed, err := strconv.ParseUint(match[index+1], 10, 64)
		if err != nil {
			return semanticVersion{}, fmt.Errorf("semantic version component is too large: %w", err)
		}
		parts[index] = parsed
	}
	result := semanticVersion{major: parts[0], minor: parts[1], patch: parts[2]}
	if match[4] != "" {
		result.prerelease = strings.Split(match[4], ".")
	}
	return result, nil
}

func compareSemanticVersions(leftValue, rightValue string) (int, error) {
	left, err := parseSemanticVersion(leftValue)
	if err != nil {
		return 0, err
	}
	right, err := parseSemanticVersion(rightValue)
	if err != nil {
		return 0, err
	}
	for _, pair := range [][2]uint64{{left.major, right.major}, {left.minor, right.minor}, {left.patch, right.patch}} {
		if pair[0] < pair[1] {
			return -1, nil
		}
		if pair[0] > pair[1] {
			return 1, nil
		}
	}
	if len(left.prerelease) == 0 && len(right.prerelease) == 0 {
		return 0, nil
	}
	if len(left.prerelease) == 0 {
		return 1, nil
	}
	if len(right.prerelease) == 0 {
		return -1, nil
	}
	limit := len(left.prerelease)
	if len(right.prerelease) < limit {
		limit = len(right.prerelease)
	}
	for index := 0; index < limit; index++ {
		leftPart, rightPart := left.prerelease[index], right.prerelease[index]
		if leftPart == rightPart {
			continue
		}
		leftNumber, leftErr := strconv.ParseUint(leftPart, 10, 64)
		rightNumber, rightErr := strconv.ParseUint(rightPart, 10, 64)
		switch {
		case leftErr == nil && rightErr == nil:
			if leftNumber < rightNumber {
				return -1, nil
			}
			return 1, nil
		case leftErr == nil:
			return -1, nil
		case rightErr == nil:
			return 1, nil
		case leftPart < rightPart:
			return -1, nil
		default:
			return 1, nil
		}
	}
	if len(left.prerelease) < len(right.prerelease) {
		return -1, nil
	}
	if len(left.prerelease) > len(right.prerelease) {
		return 1, nil
	}
	return 0, nil
}
