package main

import (
	"os"
	"syscall"
	"unsafe"
)

const (
	wsOverlappedWindow = 0x00CF0000
	wsVisible          = 0x10000000
	wsChild            = 0x40000000
	wsTabstop          = 0x00010000
	wsBorder           = 0x00800000
	wsExClientEdge     = 0x00000200
	cwUseDefault       = 0x80000000
	swShow             = 5
	wmDestroy          = 0x0002
	wmClose            = 0x0010
	colorWindow        = 5
	idiApplication     = 32512
	idcArrow           = 32512
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	registerClass    = user32.NewProc("RegisterClassExW")
	createWindowEx   = user32.NewProc("CreateWindowExW")
	defWindowProc    = user32.NewProc("DefWindowProcW")
	getMessage       = user32.NewProc("GetMessageW")
	translateMessage = user32.NewProc("TranslateMessage")
	dispatchMessage  = user32.NewProc("DispatchMessageW")
	postQuitMessage  = user32.NewProc("PostQuitMessage")
	showWindow       = user32.NewProc("ShowWindow")
	updateWindow     = user32.NewProc("UpdateWindow")
	loadCursor       = user32.NewProc("LoadCursorW")
	getModuleHandle  = kernel32.NewProc("GetModuleHandleW")
)

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   syscall.Handle
	Icon       syscall.Handle
	Cursor     syscall.Handle
	Background syscall.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     syscall.Handle
}

type point struct{ X, Y int32 }

type msg struct {
	Hwnd    syscall.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
}

func utf16ptr(value string) *uint16 {
	pointer, err := syscall.UTF16PtrFromString(value)
	if err != nil {
		os.Exit(2)
	}
	return pointer
}

func wndProc(hwnd syscall.Handle, message uint32, wParam, lParam uintptr) uintptr {
	if message == wmDestroy || message == wmClose {
		postQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := defWindowProc.Call(uintptr(hwnd), uintptr(message), wParam, lParam)
	return ret
}

func main() {
	title := "MilkSU CUA Live"
	if len(os.Args) > 1 && os.Args[1] != "" {
		title = os.Args[1]
	}
	instance, _, _ := getModuleHandle.Call(0)
	className := utf16ptr("MilkSUCuaLiveTarget")
	cursor, _, _ := loadCursor.Call(0, uintptr(idcArrow))
	class := wndClassEx{
		Size:       uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:    syscall.NewCallback(wndProc),
		Instance:   syscall.Handle(instance),
		Cursor:     syscall.Handle(cursor),
		Background: colorWindow + 1,
		ClassName:  className,
	}
	atom, _, err := registerClass.Call(uintptr(unsafe.Pointer(&class)))
	if atom == 0 {
		panic(err)
	}
	hwnd, _, err := createWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(utf16ptr(title))),
		wsOverlappedWindow|wsVisible,
		cwUseDefault,
		cwUseDefault,
		640,
		400,
		0,
		0,
		instance,
		0,
	)
	if hwnd == 0 {
		panic(err)
	}
	edit, _, err := createWindowEx.Call(
		wsExClientEdge,
		uintptr(unsafe.Pointer(utf16ptr("EDIT"))),
		uintptr(unsafe.Pointer(utf16ptr(""))),
		wsChild|wsVisible|wsTabstop|wsBorder|0x0004|0x0080,
		12,
		12,
		600,
		320,
		hwnd,
		1,
		instance,
		0,
	)
	if edit == 0 {
		panic(err)
	}
	showWindow.Call(hwnd, swShow)
	updateWindow.Call(hwnd)
	var message msg
	for {
		ret, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(ret) <= 0 {
			return
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&message)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&message)))
	}
}
