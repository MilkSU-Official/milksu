//go:build windows

package computercap

import (
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const (
	processQueryLimitedInformation = 0x1000
	maxWindowsExecutablePath       = 32768
)

var (
	user32                    = syscall.NewLazyDLL("user32.dll")
	enumWindows               = user32.NewProc("EnumWindows")
	isWindowVisible           = user32.NewProc("IsWindowVisible")
	getWindowTextLength       = user32.NewProc("GetWindowTextLengthW")
	getWindowText             = user32.NewProc("GetWindowTextW")
	getWindowThreadProcessID  = user32.NewProc("GetWindowThreadProcessId")
	openProcess               = kernel32.NewProc("OpenProcess")
	queryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	closeHandle               = kernel32.NewProc("CloseHandle")
)

func platformTargets() ([]Target, error) {
	targets := make([]Target, 0, 16)
	callback := syscall.NewCallback(func(window uintptr, _ uintptr) uintptr {
		visible, _, _ := isWindowVisible.Call(window)
		if visible == 0 {
			return 1
		}
		length, _, _ := getWindowTextLength.Call(window)
		if length == 0 || length > 4096 {
			return 1
		}
		titleBuffer := make([]uint16, length+1)
		copied, _, _ := getWindowText.Call(window, uintptr(unsafe.Pointer(&titleBuffer[0])), length+1)
		if copied == 0 {
			return 1
		}
		var pid uint32
		getWindowThreadProcessID.Call(window, uintptr(unsafe.Pointer(&pid)))
		if pid <= 1 {
			return 1
		}
		executable := processExecutablePath(pid)
		if executable == "" {
			return 1
		}
		name := strings.TrimSuffix(filepath.Base(executable), filepath.Ext(executable))
		identifier := windowsApplicationIdentifier(name)
		if !validBundleID(identifier) {
			return 1
		}
		targets = append(targets, Target{
			Name:           name,
			BundleID:       identifier,
			PID:            int(pid),
			WindowID:       int64(window),
			WindowTitle:    syscall.UTF16ToString(titleBuffer[:copied]),
			executablePath: executable,
		})
		return 1
	})
	result, _, callError := enumWindows.Call(callback, 0)
	if result == 0 && callError != syscall.Errno(0) {
		return nil, callError
	}
	return targets, nil
}

func processExecutablePath(pid uint32) string {
	handle, _, _ := openProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return ""
	}
	defer closeHandle.Call(handle)
	buffer := make([]uint16, maxWindowsExecutablePath)
	size := uint32(len(buffer))
	ok, _, _ := queryFullProcessImageName.Call(
		handle,
		0,
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if ok == 0 || size == 0 {
		return ""
	}
	return filepath.Clean(syscall.UTF16ToString(buffer[:size]))
}

func windowsApplicationIdentifier(name string) string {
	var builder strings.Builder
	builder.WriteString("win32.")
	for _, character := range strings.ToLower(strings.TrimSpace(name)) {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' || character == '.' || character == '-' {
			builder.WriteRune(character)
		} else {
			builder.WriteByte('-')
		}
	}
	return strings.TrimRight(builder.String(), "-")
}
