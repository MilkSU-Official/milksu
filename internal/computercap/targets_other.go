//go:build !darwin || !cgo

package computercap

import "fmt"

func platformTargets() ([]Target, error) {
	return nil, fmt.Errorf("Computer Use target discovery requires macOS with cgo")
}
