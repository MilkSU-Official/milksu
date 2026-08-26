//go:build !linux

package computercap

import "fmt"

func newXDGPortalSession() (PortalSession, error) {
	return nil, fmt.Errorf("XDG Desktop Portal Computer Use requires Linux")
}
