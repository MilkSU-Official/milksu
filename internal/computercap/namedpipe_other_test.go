//go:build !windows

package computercap

import "fmt"

func serveTestNamedPipe(string) error {
	return fmt.Errorf("named pipes are Windows-only")
}
