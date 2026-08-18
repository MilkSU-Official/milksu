//go:build windows

package computercap

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

var createNamedPipeW = syscall.NewLazyDLL("kernel32.dll").NewProc("CreateNamedPipeW")

func serveTestNamedPipe(path string) error {
	pathPointer, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	handle, _, callError := createNamedPipeW.Call(
		uintptr(unsafe.Pointer(pathPointer)),
		0x00000003, // PIPE_ACCESS_DUPLEX
		0,
		1,
		4096,
		4096,
		50,
		0,
	)
	if handle == 0 || handle == uintptr(syscall.InvalidHandle) {
		if callError != syscall.Errno(0) {
			return callError
		}
		return fmt.Errorf("CreateNamedPipeW failed")
	}
	defer syscall.CloseHandle(syscall.Handle(handle))
	// Keep the process and pipe alive until the test Stop()/taskkill path.
	// A bare select{} deadlocks the Go test harness.
	for {
		time.Sleep(time.Hour)
	}
}
